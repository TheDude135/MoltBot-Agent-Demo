"use client";

// Orchestrator for the demo flow. Phase logic, shared state, and the
// browser-side API calls live here. Each phase's UI is its own component
// in /components — page.tsx stays under the 800-line cap from CLAUDE.md
// and keeps cognitive overhead low while reading the control flow.
//
// Phases:
//   1. catalog          — load blueprints + deployments in parallel, then pick one
//   2. url              — Wix site URL → /api/introspect → overlay variables
//   3. configure        — target deployment + new agent name/emoji + variables
//   4. provisioning     — POST /api/provision (server orchestrates create + deploy)
//   5. progress         — poll /api/progress until terminal
//   6. done             — deploy success; offer optional voice attach
//   7. pick-voice       — list voice deployments via /api/voice-deployments
//   8. installing-app   — POST /api/install-app (install the Wix Bookings app
//                         on the voice deployment, before the gateway boots)
//   9. installing-voice — POST /api/install-voice, poll /api/voice-operation
//  10. voice-done       — phone is live + Wix app installed on the sub-agent
//      error            — terminal failure (any stage)
//
// No API key, no Firestore credential, no SDK in the browser bundle —
// the demo's own Next.js API routes are the only thing this page talks
// to, and they hold the bearer key server-side.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Blueprint,
  BlueprintDeployRecord,
  Deployment,
  DeployStatus,
  VoiceDeployment,
  VoiceOperation,
} from "@/lib/types";
import { generateAgentId, generateRequestId, isValidAgentId } from "@/lib/ids";
import { CatalogPhase } from "@/components/CatalogPhase";
import { UrlPhase } from "@/components/UrlPhase";
import { ConfigurePhase } from "@/components/ConfigurePhase";
import { ProgressPhase } from "@/components/ProgressPhase";
import { DonePhase, ErrorPhase } from "@/components/DonePhase";
import { PickVoiceDeploymentPhase } from "@/components/PickVoiceDeploymentPhase";
import { InstallVoicePhase, VoiceDonePhase } from "@/components/InstallVoicePhase";
import { CenteredStatus } from "@/components/atoms";

type Phase =
  | "catalog"
  | "url"
  | "configure"
  | "provisioning"
  | "progress"
  | "done"
  | "pick-voice"
  | "installing-app"
  | "installing-voice"
  | "voice-done"
  | "error";

interface IntrospectResponse {
  canonicalUrl: string;
  businessName: string;
  serviceCount: number;
  staffCount: number;
  variables: Record<string, string>;
}

interface IntrospectErrorBody {
  error: string;
  code: string;
  canonicalUrl?: string;
}

const PROGRESS_POLL_INTERVAL_MS = 2000;

export default function Page() {
  const [phase, setPhase] = useState<Phase>("catalog");

  // Catalog state
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // Decoupled from catalogError: a key may have blueprints:read but
  // lack deployments:read. We still want the catalog to render in that
  // case; the deployment dropdown surfaces this error contextually.
  const [deploymentsError, setDeploymentsError] = useState<string | null>(null);

  // Selection state
  const [selectedBlueprint, setSelectedBlueprint] = useState<Blueprint | null>(null);
  const [targetDeploymentId, setTargetDeploymentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentEmoji, setAgentEmoji] = useState("🤖");
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  // URL phase state — site introspection
  const [siteUrl, setSiteUrl] = useState("");
  const [introspecting, setIntrospecting] = useState(false);
  const [introspectError, setIntrospectError] = useState<string | null>(null);
  const [introspectSummary, setIntrospectSummary] = useState<{
    businessName: string;
    serviceCount: number;
    staffCount: number;
    canonicalUrl: string;
  } | null>(null);

  // Provisioning state
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionContext, setProvisionContext] = useState<{
    requestId: string;
    deploymentId: string;
    agentId: string;
  } | null>(null);
  const [deployRecord, setDeployRecord] = useState<BlueprintDeployRecord | null>(null);

  // Voice install state — populated only after the blueprint deploy
  // succeeds and the user opts in to attach a phone.
  const [voiceDeployments, setVoiceDeployments] = useState<VoiceDeployment[]>([]);
  const [voiceListLoading, setVoiceListLoading] = useState(false);
  const [voiceListError, setVoiceListError] = useState<string | null>(null);
  const [selectedVoiceDeploymentId, setSelectedVoiceDeploymentId] = useState("");
  const [voiceInstallContext, setVoiceInstallContext] = useState<{
    opId: string;
    phoneNumber: string | null;
  } | null>(null);
  const [voiceOperation, setVoiceOperation] = useState<VoiceOperation | null>(null);
  // Wix app install — installed on the voice deployment before voice install.
  const [wixAppInstalled, setWixAppInstalled] = useState(false);

  // Load catalog on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch the two endpoints in parallel but treat their outcomes
        // independently — a missing deployments:read scope shouldn't
        // hide the catalog. The deployment dropdown shows the error
        // when the user reaches the Configure phase.
        const [bpRes, depRes] = await Promise.all([
          fetch("/api/blueprints", { cache: "no-store" }),
          fetch("/api/deployments", { cache: "no-store" }),
        ]);

        if (bpRes.ok) {
          const bpJson = (await bpRes.json()) as { blueprints: Blueprint[] };
          if (!cancelled) setBlueprints(bpJson.blueprints);
        } else {
          const body = await bpRes.json().catch(() => ({}));
          if (!cancelled) {
            setCatalogError(body.error ?? `Blueprints HTTP ${bpRes.status}`);
          }
        }

        if (depRes.ok) {
          const depJson = (await depRes.json()) as { deployments: Deployment[] };
          if (!cancelled) setDeployments(depJson.deployments);
        } else {
          const body = await depRes.json().catch(() => ({}));
          if (!cancelled) {
            setDeploymentsError(body.error ?? `Deployments HTTP ${depRes.status}`);
          }
        }
      } catch (err) {
        if (cancelled) return;
        // Network or JSON-parse failure — not an API-side problem.
        setCatalogError((err as Error).message);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize variable defaults when a blueprint is selected, then route
  // to the URL phase so introspection can pre-fill the form.
  const handleSelectBlueprint = useCallback((bp: Blueprint) => {
    setSelectedBlueprint(bp);
    const defaults: Record<string, string> = {};
    for (const v of bp.variables) {
      defaults[v.key] = v.default ?? "";
    }
    setVariableValues(defaults);
    // Reset any prior URL-phase state from earlier deploys in the same session.
    setSiteUrl("");
    setIntrospectError(null);
    setIntrospectSummary(null);
    setPhase("url");
  }, []);

  // POST /api/introspect — on success overlay the returned variable values
  // (without clobbering blueprint defaults for keys the introspector left
  // blank), pre-fill the agentName from businessName, then advance to the
  // Configure phase. On failure show an actionable message and stay here.
  const handleIntrospect = useCallback(async () => {
    if (!siteUrl.trim()) {
      setIntrospectError("Enter a Wix Bookings site URL.");
      return;
    }
    setIntrospecting(true);
    setIntrospectError(null);
    try {
      const res = await fetch("/api/introspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: siteUrl.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | IntrospectResponse
        | IntrospectErrorBody;
      if (!res.ok) {
        const err = body as IntrospectErrorBody;
        setIntrospectError(err.error ?? `Could not introspect (${res.status}).`);
        return;
      }
      const ok = body as IntrospectResponse;
      setIntrospectSummary({
        businessName: ok.businessName,
        serviceCount: ok.serviceCount,
        staffCount: ok.staffCount,
        canonicalUrl: ok.canonicalUrl,
      });
      // Overlay only non-empty values so blueprint defaults survive for any
      // variable the introspector didn't have a value for (e.g. payment policy).
      setVariableValues((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(ok.variables)) {
          if (typeof v === "string" && v.length > 0) next[k] = v;
        }
        return next;
      });
      // Pre-fill the agent identity from the discovered business name.
      if (ok.businessName) setAgentName(ok.businessName);
      setPhase("configure");
    } catch (err) {
      setIntrospectError((err as Error).message);
    } finally {
      setIntrospecting(false);
    }
  }, [siteUrl]);

  const generatedAgentId = useMemo(
    () => (agentName ? generateAgentId(agentName) : ""),
    [agentName],
  );

  const operationalDeployments = useMemo(
    () => deployments.filter((d) => d.status === "OPERATIONAL"),
    [deployments],
  );

  const canSubmit = Boolean(
    targetDeploymentId &&
      agentName.trim() &&
      generatedAgentId &&
      isValidAgentId(generatedAgentId),
  );

  // Progress polling
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "progress" || !provisionContext) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/progress/${provisionContext.deploymentId}/${provisionContext.requestId}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { deploy: BlueprintDeployRecord };
        if (cancelled) return;
        setDeployRecord(json.deploy);
        const status: DeployStatus = json.deploy.status;
        if (status === "complete" || status === "partial" || status === "failed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setPhase("done");
        }
      } catch (err) {
        if (cancelled) return;
        setProvisionError((err as Error).message);
        if (pollingRef.current) clearInterval(pollingRef.current);
        setPhase("error");
      }
    };
    // Fire once immediately, then on interval.
    tick();
    pollingRef.current = setInterval(tick, PROGRESS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, [phase, provisionContext]);

  const submitProvision = async () => {
    if (!selectedBlueprint || !canSubmit) return;
    setProvisionError(null);
    setDeployRecord(null);
    setPhase("provisioning");

    const requestId = generateRequestId();
    const payload = {
      deploymentId: targetDeploymentId,
      agentId: generatedAgentId,
      name: agentName.trim(),
      emoji: agentEmoji,
      blueprintId: selectedBlueprint.id,
      variables: variableValues,
      requestId,
    };

    try {
      const res = await fetch("/api/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ??
            `Provision failed (${res.status})${body?.step ? ` at ${body.step}` : ""}`,
        );
      }
      setProvisionContext({
        requestId: body.requestId,
        deploymentId: body.deploymentId,
        agentId: body.agentId,
      });
      setPhase("progress");
    } catch (err) {
      setProvisionError((err as Error).message);
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("catalog");
    setSelectedBlueprint(null);
    setTargetDeploymentId("");
    setAgentName("");
    setAgentEmoji("🤖");
    setVariableValues({});
    setSiteUrl("");
    setIntrospectError(null);
    setIntrospectSummary(null);
    setProvisionError(null);
    setProvisionContext(null);
    setDeployRecord(null);
    // Reset voice state too — a fresh deploy flow shouldn't inherit
    // the previous attempt's voice selection.
    setVoiceDeployments([]);
    setVoiceListError(null);
    setSelectedVoiceDeploymentId("");
    setVoiceInstallContext(null);
    setVoiceOperation(null);
    setWixAppInstalled(false);
  };

  // ── Voice install flow ─────────────────────────────────────────────

  // Triggered from DonePhase via the "Add a phone number" button.
  // Loads the customer's voice deployments lazily — most demo runs don't
  // attach voice, so this avoids the round-trip up front.
  const handleAttachVoice = useCallback(async () => {
    setPhase("pick-voice");
    setVoiceListError(null);
    setVoiceListLoading(true);
    try {
      const res = await fetch("/api/voice-deployments", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ??
            `Could not load voice deployments (HTTP ${res.status}).`,
        );
      }
      setVoiceDeployments((body as { deployments: VoiceDeployment[] }).deployments);
    } catch (err) {
      setVoiceListError((err as Error).message);
    } finally {
      setVoiceListLoading(false);
    }
  }, []);

  // Submit /api/install-voice and store the op id we'll poll for.
  const submitInstallVoice = useCallback(async () => {
    if (!provisionContext || !selectedVoiceDeploymentId) return;
    const requestId = generateRequestId();
    setVoiceOperation(null);
    setVoiceInstallContext(null);
    setProvisionError(null);
    setPhase("installing-voice");

    try {
      const res = await fetch("/api/install-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fleetDeploymentId: provisionContext.deploymentId,
          agentId: provisionContext.agentId,
          voiceDeploymentId: selectedVoiceDeploymentId,
          forceReinstall: true,
          requestId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ??
            `Install dispatch failed (HTTP ${res.status}).`,
        );
      }
      const { opId, phoneNumber } = body as {
        opId: string;
        phoneNumber: string | null;
      };
      setVoiceInstallContext({ opId, phoneNumber });
    } catch (err) {
      setProvisionError((err as Error).message);
      setPhase("error");
    }
  }, [provisionContext, selectedVoiceDeploymentId]);

  // Install the Wix Bookings app on the chosen voice deployment, THEN
  // install voice. Order matters: installing the app first means its secret
  // + tool are delivered to the gateway from its very first config poll, so
  // the agent can book from call one. If there's no Wix config (the user
  // skipped introspection), we just install voice.
  const submitInstallAppThenVoice = useCallback(async () => {
    if (!provisionContext || !selectedVoiceDeploymentId) return;
    setProvisionError(null);
    const siteUrl = introspectSummary?.canonicalUrl;

    if (siteUrl) {
      setPhase("installing-app");
      const requestId = generateRequestId();
      try {
        const res = await fetch("/api/install-app", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            voiceDeploymentId: selectedVoiceDeploymentId,
            slug: "wix-bookings",
            config: {
              siteUrl,
              ...(introspectSummary?.businessName
                ? { businessName: introspectSummary.businessName }
                : {}),
            },
            requestId,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (body as { error?: string }).error ??
              `Wix app install failed (HTTP ${res.status}).`,
          );
        }
        setWixAppInstalled(true);
      } catch (err) {
        setProvisionError((err as Error).message);
        setPhase("error");
        return;
      }
    }

    // App is installed (or skipped) — now mint the bundle + dispatch voice.
    await submitInstallVoice();
  }, [provisionContext, selectedVoiceDeploymentId, introspectSummary, submitInstallVoice]);

  // Poll the voice install operation until terminal. Same pattern as the
  // blueprint-deploy progress polling above.
  const voicePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "installing-voice" || !voiceInstallContext) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/voice-operation/${voiceInstallContext.opId}`,
          { cache: "no-store" },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }
        if (cancelled) return;
        const op = (body as { operation: VoiceOperation }).operation;
        setVoiceOperation(op);
        if (op.status === "succeeded") {
          if (voicePollingRef.current) clearInterval(voicePollingRef.current);
          setPhase("voice-done");
        } else if (op.status === "failed") {
          if (voicePollingRef.current) clearInterval(voicePollingRef.current);
          setProvisionError(
            op.error?.message ?? "Voice install failed without a message.",
          );
          setPhase("error");
        }
      } catch (err) {
        if (cancelled) return;
        setProvisionError((err as Error).message);
        if (voicePollingRef.current) clearInterval(voicePollingRef.current);
        setPhase("error");
      }
    };
    tick();
    voicePollingRef.current = setInterval(tick, PROGRESS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (voicePollingRef.current) clearInterval(voicePollingRef.current);
      voicePollingRef.current = null;
    };
  }, [phase, voiceInstallContext]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
          🪄
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Agent Deploy Demo</h1>
          <p className="text-xs text-gray-500">
            External app, public REST API only. No SDK, no Firestore.
          </p>
        </div>
      </header>

      {phase === "catalog" && (
        <CatalogPhase
          blueprints={blueprints}
          loading={catalogLoading}
          error={catalogError}
          onSelect={handleSelectBlueprint}
        />
      )}

      {phase === "url" && selectedBlueprint && (
        <UrlPhase
          blueprint={selectedBlueprint}
          siteUrl={siteUrl}
          onChangeSiteUrl={setSiteUrl}
          introspecting={introspecting}
          introspectError={introspectError}
          onSubmit={handleIntrospect}
          onBack={() => {
            setPhase("catalog");
            setSelectedBlueprint(null);
          }}
        />
      )}

      {phase === "configure" && selectedBlueprint && (
        <ConfigurePhase
          blueprint={selectedBlueprint}
          deployments={operationalDeployments}
          allDeployments={deployments}
          deploymentsError={deploymentsError}
          targetDeploymentId={targetDeploymentId}
          onChangeTargetDeploymentId={setTargetDeploymentId}
          agentName={agentName}
          onChangeAgentName={setAgentName}
          generatedAgentId={generatedAgentId}
          agentEmoji={agentEmoji}
          onChangeAgentEmoji={setAgentEmoji}
          variableValues={variableValues}
          onChangeVariableValue={(key, val) =>
            setVariableValues((prev) => ({ ...prev, [key]: val }))
          }
          introspectSummary={introspectSummary}
          onBack={() => setPhase("url")}
          onSubmit={submitProvision}
          canSubmit={canSubmit}
        />
      )}

      {phase === "provisioning" && (
        <CenteredStatus
          label="Creating sub-agent..."
          detail="The API is provisioning a new agent on your deployment. This can take 30-60s."
        />
      )}

      {phase === "progress" && (
        <ProgressPhase
          deployRecord={deployRecord}
          agentId={provisionContext?.agentId ?? "(unknown)"}
        />
      )}

      {phase === "done" && (
        <DonePhase
          deployRecord={deployRecord}
          agentId={provisionContext?.agentId ?? "(unknown)"}
          onReset={reset}
          onAttachVoice={
            deployRecord?.status === "complete" ? handleAttachVoice : undefined
          }
        />
      )}

      {phase === "pick-voice" && (
        <PickVoiceDeploymentPhase
          voiceDeployments={voiceDeployments}
          loading={voiceListLoading}
          error={voiceListError}
          agentId={provisionContext?.agentId ?? "(unknown)"}
          selectedVoiceDeploymentId={selectedVoiceDeploymentId}
          onChangeSelected={setSelectedVoiceDeploymentId}
          onBack={() => setPhase("done")}
          onSubmit={submitInstallAppThenVoice}
          onSkip={() => setPhase("done")}
          canSubmit={Boolean(selectedVoiceDeploymentId)}
        />
      )}

      {phase === "installing-app" && (
        <CenteredStatus
          label="Installing Wix Bookings app..."
          detail="Registering the booking app on your voice deployment (POST /apps). The gateway picks up the secret + tool on its next config poll, so the agent can book from call one."
        />
      )}

      {phase === "installing-voice" && (
        <InstallVoicePhase
          phoneNumber={voiceInstallContext?.phoneNumber ?? null}
          agentId={provisionContext?.agentId ?? "(unknown)"}
          operation={voiceOperation}
        />
      )}

      {phase === "voice-done" && (
        <VoiceDonePhase
          phoneNumber={voiceInstallContext?.phoneNumber ?? null}
          agentId={provisionContext?.agentId ?? "(unknown)"}
          wixInstalled={wixAppInstalled}
          onReset={reset}
        />
      )}

      {phase === "error" && (
        <ErrorPhase message={provisionError ?? "Unknown error"} onReset={reset} />
      )}
    </main>
  );
}
