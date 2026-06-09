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
import { EMOJI_VARIABLE_KEY } from "@/lib/types";
import { generateAgentId, generateRequestId, isValidAgentId } from "@/lib/ids";
import { CatalogPhase } from "@/components/CatalogPhase";
import { UrlPhase } from "@/components/UrlPhase";
import { ConfigurePhase } from "@/components/ConfigurePhase";
import { ProgressPhase } from "@/components/ProgressPhase";
import { DonePhase, ErrorPhase, type SeedNote } from "@/components/DonePhase";
import { PickVoiceDeploymentPhase } from "@/components/PickVoiceDeploymentPhase";
import { InstallVoicePhase, VoiceDonePhase } from "@/components/InstallVoicePhase";
import { CenteredStatus } from "@/components/atoms";
import { Stepper } from "@/components/Stepper";

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
// Hard deadlines so a wedged upstream operation can never spin the UI
// forever. On timeout we surface an actionable error instead of hanging.
const PROGRESS_POLL_TIMEOUT_MS = 5 * 60_000;
const VOICE_POLL_TIMEOUT_MS = 5 * 60_000;

// Which of the 5 stepper steps (Blueprint, Site, Configure, Deploy, Voice)
// each phase belongs to. Drives the global progress indicator.
const STEP_FOR_PHASE: Record<Phase, number> = {
  catalog: 0,
  url: 1,
  configure: 2,
  provisioning: 3,
  progress: 3,
  done: 3,
  "pick-voice": 4,
  "installing-app": 4,
  "installing-voice": 4,
  "voice-done": 4,
  error: 3,
};

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
  // Recoverable name collision (derived agentId already exists on the
  // deployment). Shown inline on the Configure screen so the user can rename
  // without losing their setup, instead of dead-ending on the error screen.
  const [nameError, setNameError] = useState<string | null>(null);
  const [provisionContext, setProvisionContext] = useState<{
    requestId: string;
    deploymentId: string;
    agentId: string;
  } | null>(null);
  const [deployRecord, setDeployRecord] = useState<BlueprintDeployRecord | null>(null);

  // AI file-seeding state — best-effort enrichment that runs once the
  // blueprint deploy completes. A ref guards against the progress poller
  // (which fires repeatedly) kicking off more than one seeding run.
  const [seedNote, setSeedNote] = useState<SeedNote | null>(null);
  const seedStartedRef = useRef(false);
  // Run token: bumped on reset / new provision so a slow seeding request
  // that resolves after the user has moved on can't repaint a stale note.
  const seedTokenRef = useRef(0);

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
    // The emoji is a single control (the identity picker). Seed it from the
    // blueprint's agent_emoji default when present; the picker stays the sole
    // source of truth and is mirrored back into the variable at submit.
    const emojiDefault = bp.variables.find((v) => v.key === EMOJI_VARIABLE_KEY)?.default?.trim();
    setAgentEmoji(emojiDefault || "🤖");
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

  // AI file-seeding runner. Best-effort: the agent already works off the
  // blueprint's templated files, so any failure here just keeps those and
  // surfaces a note. Guarded by seedStartedRef so the progress poller can't
  // start it twice.
  const runSeedFiles = useCallback(async () => {
    if (seedStartedRef.current) return;
    const ctx = provisionContext;
    const url = introspectSummary?.canonicalUrl;
    if (!ctx || !url) return;
    seedStartedRef.current = true;
    // Claim this run. If the user resets/redeploys while we're awaiting,
    // seedTokenRef bumps and `post` becomes a no-op, so a late resolve can't
    // repaint a note onto a fresh flow.
    const token = seedTokenRef.current;
    const post = (note: SeedNote) => {
      if (seedTokenRef.current === token) setSeedNote(note);
    };
    post({ status: "running", message: "Reading the site and tailoring the agent's persona…" });
    try {
      const res = await fetch("/api/seed-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deploymentId: ctx.deploymentId,
          agentId: ctx.agentId,
          siteUrl: url,
          requestId: ctx.requestId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        post({
          status: "error",
          message: body?.error ?? `Seeding request failed (${res.status}).`,
        });
        return;
      }
      if (body?.seeded) {
        const files = (body.files ?? []) as { path: string; status: string }[];
        const written = files.filter((f) => f.status === "written").map((f) => f.path);
        const failed = files.filter((f) => f.status !== "written").map((f) => f.path);
        post({
          status: written.length > 0 ? "seeded" : "error",
          message:
            written.length > 0
              ? `Wrote ${written.join(", ")}${failed.length ? ` (failed: ${failed.join(", ")})` : ""}.`
              : `No files written${failed.length ? ` (failed: ${failed.join(", ")})` : ""}.`,
        });
      } else {
        // Skipped by design (e.g. AI disabled) — the templated files stand.
        post({
          status: "skipped",
          message: body?.message ?? "Kept the blueprint's templated files.",
        });
      }
    } catch (err) {
      post({ status: "error", message: (err as Error).message });
    }
  }, [provisionContext, introspectSummary]);

  // Hold the latest runSeedFiles in a ref so the progress effect can call it
  // without listing it as a dependency (which would tear down + re-subscribe
  // the poller whenever introspectSummary/provisionContext identity changes,
  // and double-fire under React StrictMode in dev).
  const runSeedFilesRef = useRef(runSeedFiles);
  useEffect(() => {
    runSeedFilesRef.current = runSeedFiles;
  }, [runSeedFiles]);

  // Progress polling — bounded by PROGRESS_POLL_TIMEOUT_MS so a stuck deploy
  // surfaces an error instead of spinning forever.
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "progress" || !provisionContext) return;
    let cancelled = false;
    const deadline = Date.now() + PROGRESS_POLL_TIMEOUT_MS;
    const stop = () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
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
          stop();
          // Fire AI seeding once, only on a clean complete (so we never
          // overwrite files on a half-deployed agent). Fire-and-forget:
          // the done phase renders immediately and the seed note updates
          // when it resolves.
          if (status === "complete") void runSeedFilesRef.current();
          setPhase("done");
          return;
        }
        if (Date.now() > deadline) {
          stop();
          setProvisionError(
            "The deploy did not finish within 5 minutes. Check the agent in MoltBot Ninja, then try again.",
          );
          setPhase("error");
        }
      } catch (err) {
        if (cancelled) return;
        stop();
        setProvisionError((err as Error).message);
        setPhase("error");
      }
    };
    // Fire once immediately, then on interval.
    tick();
    pollingRef.current = setInterval(tick, PROGRESS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [phase, provisionContext]);

  const submitProvision = async () => {
    if (!selectedBlueprint || !canSubmit) return;
    setProvisionError(null);
    setDeployRecord(null);
    setSeedNote(null);
    seedStartedRef.current = false;
    seedTokenRef.current++;
    setNameError(null);
    setPhase("provisioning");

    const requestId = generateRequestId();
    // The identity emoji (picker) is the single source of truth. When the
    // blueprint defines an agent_emoji variable (used in its persona files),
    // mirror the picker into it so the Ninja UI icon, the managed-agent
    // identity, and the persona never diverge — one control, one value. Only
    // inject it when the blueprint actually declares the variable, so we never
    // send an unknown key for blueprints that don't use it.
    const variables = selectedBlueprint.variables.some((v) => v.key === EMOJI_VARIABLE_KEY)
      ? { ...variableValues, [EMOJI_VARIABLE_KEY]: agentEmoji }
      : variableValues;
    const payload = {
      deploymentId: targetDeploymentId,
      agentId: generatedAgentId,
      name: agentName.trim(),
      emoji: agentEmoji,
      blueprintId: selectedBlueprint.id,
      variables,
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
        // A name collision (the derived agentId already exists on this
        // deployment) is recoverable: go back to Configure with a clear
        // inline message so the user can just rename, keeping everything
        // else (deployment, variables, the site they introspected).
        if (res.status === 409 || body?.code === "agent-id-taken") {
          setNameError(
            `The id "${generatedAgentId}" is already taken on this deployment. Pick a different name.`,
          );
          setPhase("configure");
          return;
        }
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
    setNameError(null);
    setProvisionContext(null);
    setDeployRecord(null);
    setSeedNote(null);
    seedStartedRef.current = false;
    seedTokenRef.current++;
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
    const deadline = Date.now() + VOICE_POLL_TIMEOUT_MS;
    const stop = () => {
      if (voicePollingRef.current) clearInterval(voicePollingRef.current);
      voicePollingRef.current = null;
    };
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
          stop();
          setPhase("voice-done");
          return;
        }
        if (op.status === "failed") {
          stop();
          setProvisionError(
            op.error?.message ?? "Voice install failed without a message.",
          );
          setPhase("error");
          return;
        }
        if (Date.now() > deadline) {
          stop();
          setProvisionError(
            "The voice install did not finish within 5 minutes. The number may still come online — check the TTMA portal, or try again.",
          );
          setPhase("error");
        }
      } catch (err) {
        if (cancelled) return;
        stop();
        setProvisionError((err as Error).message);
        setPhase("error");
      }
    };
    tick();
    voicePollingRef.current = setInterval(tick, PROGRESS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [phase, voiceInstallContext]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-lg shadow-lg shadow-violet-700/30">
            🪄
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">
              Agent Deploy
            </h1>
            <p className="text-xs text-gray-500">
              Provision a voice agent from a blueprint
            </p>
          </div>
        </div>
        <span className="hidden rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-medium text-gray-400 sm:inline">
          Public REST API · no SDK
        </span>
      </header>

      {phase !== "error" && (
        <div className="mb-8">
          <Stepper current={STEP_FOR_PHASE[phase]} />
        </div>
      )}

      <div key={phase} className="animate-fade-in">
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
          onChangeAgentName={(v) => {
            setAgentName(v);
            if (nameError) setNameError(null);
          }}
          nameError={nameError}
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
          label="Creating your agent"
          detail="Provisioning a new sub-agent on your deployment. This usually takes 30 to 60 seconds."
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
          seedNote={seedNote}
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
          label="Installing Wix Bookings"
          detail="Registering the booking app on your voice number so the agent can answer service and price questions and book real appointments from the first call."
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
      </div>
    </main>
  );
}
