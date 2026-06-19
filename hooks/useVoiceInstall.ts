"use client";

// The optional voice-attach flow, run after a blueprint deploy succeeds: list
// the owner's voice deployments, install the Wix Bookings app on the chosen one
// (when there's a site), then dispatch the voice install and poll it to a
// terminal state.
//
// Like useDeployFlow, it does not own `phase` or the shared error message - the
// orchestrator passes those in, plus the provisionContext (which agent to wire
// voice onto) and the introspectSummary (the Wix config to install).

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IntrospectSummary,
  ProvisionContext,
  VoiceDeployment,
  VoiceOperation,
} from "@/lib/types";
import { generateRequestId } from "@/lib/ids";
import {
  errorMessage,
  getVoiceDeployments,
  getVoiceOperation,
  installApp,
  installVoice,
} from "@/lib/browser-api";
import type { Phase } from "@/lib/wizard-steps";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60_000;

export function useVoiceInstall(opts: {
  phase: Phase;
  provisionContext: ProvisionContext | null;
  introspectSummary: IntrospectSummary | null;
  setPhase: (p: Phase) => void;
  setError: (message: string | null) => void;
}) {
  const { phase, provisionContext, introspectSummary, setPhase, setError } = opts;

  const [voiceDeployments, setVoiceDeployments] = useState<VoiceDeployment[]>([]);
  const [voiceListLoading, setVoiceListLoading] = useState(false);
  const [voiceListError, setVoiceListError] = useState<string | null>(null);
  const [selectedVoiceDeploymentId, setSelectedVoiceDeploymentId] = useState("");
  const [voiceInstallContext, setVoiceInstallContext] = useState<{
    opId: string;
    phoneNumber: string | null;
  } | null>(null);
  const [voiceOperation, setVoiceOperation] = useState<VoiceOperation | null>(null);
  // Wix app install - installed on the voice deployment before voice install.
  const [wixAppInstalled, setWixAppInstalled] = useState(false);

  // Triggered from DonePhase via the "Add a phone number" button. Loads the
  // owner's voice deployments lazily - most demo runs don't attach voice, so
  // this avoids the round-trip up front.
  const handleAttachVoice = useCallback(async () => {
    setPhase("pick-voice");
    setVoiceListError(null);
    setVoiceListLoading(true);
    try {
      const deployments = await getVoiceDeployments();
      setVoiceDeployments(deployments);
    } catch (err) {
      setVoiceListError(errorMessage(err));
    } finally {
      setVoiceListLoading(false);
    }
  }, [setPhase]);

  // Dispatch /api/install-voice and store the op id we'll poll for.
  const submitInstallVoice = useCallback(async () => {
    if (!provisionContext || !selectedVoiceDeploymentId) return;
    setVoiceOperation(null);
    setVoiceInstallContext(null);
    setError(null);
    setPhase("installing-voice");
    try {
      const result = await installVoice({
        fleetDeploymentId: provisionContext.deploymentId,
        agentId: provisionContext.agentId,
        voiceDeploymentId: selectedVoiceDeploymentId,
        forceReinstall: true,
        requestId: generateRequestId(),
      });
      setVoiceInstallContext(result);
    } catch (err) {
      setError(errorMessage(err));
      setPhase("error");
    }
  }, [provisionContext, selectedVoiceDeploymentId, setPhase, setError]);

  // Install the Wix Bookings app on the chosen voice deployment, THEN install
  // voice. Order matters: installing the app first means its secret + tool are
  // delivered to the gateway from its very first config poll, so the agent can
  // book from call one. If there's no Wix config (the user skipped
  // introspection), we just install voice.
  const submitInstallAppThenVoice = useCallback(async () => {
    if (!provisionContext || !selectedVoiceDeploymentId) return;
    setError(null);
    const siteUrl = introspectSummary?.canonicalUrl;

    if (siteUrl) {
      setPhase("installing-app");
      try {
        await installApp({
          voiceDeploymentId: selectedVoiceDeploymentId,
          slug: "wix-bookings",
          config: {
            siteUrl,
            ...(introspectSummary?.businessName
              ? { businessName: introspectSummary.businessName }
              : {}),
          },
          requestId: generateRequestId(),
        });
        setWixAppInstalled(true);
      } catch (err) {
        setError(errorMessage(err));
        setPhase("error");
        return;
      }
    }

    // App is installed (or skipped) - now mint the bundle + dispatch voice.
    await submitInstallVoice();
  }, [
    provisionContext,
    selectedVoiceDeploymentId,
    introspectSummary,
    submitInstallVoice,
    setPhase,
    setError,
  ]);

  // Poll the voice install operation until terminal. Same pattern as the
  // blueprint-deploy progress polling.
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "installing-voice" || !voiceInstallContext) return;
    let cancelled = false;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const stop = () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
    const tick = async () => {
      try {
        const op = await getVoiceOperation(voiceInstallContext.opId);
        if (cancelled) return;
        setVoiceOperation(op);
        if (op.status === "succeeded") {
          stop();
          setPhase("voice-done");
          return;
        }
        if (op.status === "failed") {
          stop();
          setError(op.error?.message ?? "Voice install failed without a message.");
          setPhase("error");
          return;
        }
        if (Date.now() > deadline) {
          stop();
          setError(
            "The voice install did not finish within 5 minutes. The number may still come online - check the TTMA portal, or try again.",
          );
          setPhase("error");
        }
      } catch (err) {
        if (cancelled) return;
        stop();
        setError(errorMessage(err));
        setPhase("error");
      }
    };
    tick();
    pollingRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [phase, voiceInstallContext, setPhase, setError]);

  // A fresh deploy flow shouldn't inherit the previous attempt's voice state.
  const resetVoice = useCallback(() => {
    setVoiceDeployments([]);
    setVoiceListError(null);
    setSelectedVoiceDeploymentId("");
    setVoiceInstallContext(null);
    setVoiceOperation(null);
    setWixAppInstalled(false);
  }, []);

  return {
    voiceDeployments,
    voiceListLoading,
    voiceListError,
    selectedVoiceDeploymentId,
    setSelectedVoiceDeploymentId,
    voiceInstallContext,
    voiceOperation,
    wixAppInstalled,
    handleAttachVoice,
    submitInstallAppThenVoice,
    resetVoice,
  };
}
