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
import { EMOJI_VARIABLE_KEY, NAME_VARIABLE_KEY } from "@/lib/types";
import { generateAgentId, generateRequestId, isValidAgentId } from "@/lib/ids";
import { CatalogPhase } from "@/components/CatalogPhase";
import { BlueprintDetailPhase } from "@/components/BlueprintDetailPhase";
import { UrlPhase } from "@/components/UrlPhase";
import { ConfigurePhase } from "@/components/ConfigurePhase";
import { DonePhase, ErrorPhase, type SeedNote } from "@/components/DonePhase";
import { PickVoiceDeploymentPhase } from "@/components/PickVoiceDeploymentPhase";
import { VoiceTimeline, VoiceDonePhase } from "@/components/InstallVoicePhase";
import { Stepper } from "@/components/Stepper";
import { SetupTimeline } from "@/components/SetupTimeline";

type Phase =
  | "catalog"
  | "detail"
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

// Stepper labels. Site-less blueprints (no Wix introspection) drop the "Site"
// step entirely, so we map each phase to a LABEL and look up its index in the
// active list — which works for both the 5-step (Wix) and 4-step (no-site) shapes.
const STEPS_WITH_SITE = ["Blueprint", "Site", "Configure", "Deploy", "Voice"] as const;
const STEPS_NO_SITE = ["Blueprint", "Configure", "Deploy", "Voice"] as const;
const STEP_LABEL_FOR_PHASE: Record<Phase, string> = {
  catalog: "Blueprint",
  detail: "Blueprint",
  url: "Site",
  configure: "Configure",
  provisioning: "Deploy",
  progress: "Deploy",
  done: "Deploy",
  "pick-voice": "Voice",
  "installing-app": "Voice",
  "installing-voice": "Voice",
  "voice-done": "Voice",
  error: "Deploy",
};

// True when a blueprint's variables include the Wix-introspectable fields the
// Site step fills (e.g. business_name / services). Site-less blueprints (the
// Personal Assistant) skip the Site step and the AI persona seeding.
function blueprintUsesSite(bp: Blueprint): boolean {
  return bp.variables.some(
    (v) => v.key === "services_table_md" || v.key === "business_name",
  );
}

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

  // Initialize variable defaults when a blueprint is selected, then show its
  // intro page (the "detail" phase). The user reads what the blueprint can do
  // and explicitly continues to the deploy form from there.
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
    setPhase("detail");
  }, []);

  // From the blueprint intro page, open the deploy form: the Site (url) phase
  // ONLY for blueprints that carry Wix-introspectable variables; any other
  // blueprint (e.g. the Personal Assistant) goes straight to manual Configure.
  const handleContinueToDeploy = useCallback(() => {
    if (!selectedBlueprint) return;
    setPhase(blueprintUsesSite(selectedBlueprint) ? "url" : "configure");
  }, [selectedBlueprint]);

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

  // Site-less blueprints (e.g. the Personal Assistant) skip the Wix Site step,
  // so the stepper, the Configure back-button, and the deploy timeline all drop
  // their site-specific pieces. Defaults to true before a blueprint is picked.
  const usesSite = useMemo(
    () => (selectedBlueprint ? blueprintUsesSite(selectedBlueprint) : true),
    [selectedBlueprint],
  );
  const stepperSteps: readonly string[] = usesSite ? STEPS_WITH_SITE : STEPS_NO_SITE;
  const stepperCurrent = Math.max(0, stepperSteps.indexOf(STEP_LABEL_FOR_PHASE[phase]));

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
    // The identity controls (the Name field and the emoji picker) are the single
    // source of truth. When the blueprint declares the matching variables (used
    // in its IDENTITY/SOUL/persona files), mirror the controls into them so the
    // Ninja UI, the managed-agent identity, and the persona never diverge - one
    // control, one value. Only inject keys the blueprint actually declares, so we
    // never send an unknown variable.
    const declares = (key: string) =>
      selectedBlueprint.variables.some((v) => v.key === key);
    const variables: Record<string, string> = { ...variableValues };
    if (declares(EMOJI_VARIABLE_KEY)) variables[EMOJI_VARIABLE_KEY] = agentEmoji;
    if (declares(NAME_VARIABLE_KEY)) variables[NAME_VARIABLE_KEY] = agentName.trim();
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
      <header className="mb-6 flex items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 shadow-lg shadow-violet-700/30">
            <span className="text-2xl leading-none" role="img" aria-label="Friendly robot">
              🤖
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white">
                Agent Deploy
              </h1>
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                Demo
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Using the MoltBot Ninja API to deploy a new AI agent from a blueprint.
            </p>
          </div>
        </div>
      </header>

      {phase !== "error" && (
        <div className="mb-8">
          <Stepper steps={stepperSteps} current={stepperCurrent} />
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

      {phase === "detail" && selectedBlueprint && (
        <BlueprintDetailPhase
          blueprint={selectedBlueprint}
          usesSite={usesSite}
          onBack={() => {
            setPhase("catalog");
            setSelectedBlueprint(null);
          }}
          onContinue={handleContinueToDeploy}
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
          onBack={() => setPhase("detail")}
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
          onBack={() => {
            // Site-less blueprints never visited the Site step, so Back returns
            // to the blueprint intro page (mirroring the Site phase's own back).
            setPhase(usesSite ? "url" : "detail");
          }}
          onSubmit={submitProvision}
          canSubmit={canSubmit}
        />
      )}

      {phase === "provisioning" && (
        <SetupTimeline
          phase="provisioning"
          deployRecord={deployRecord}
          seedNote={seedNote}
          usesSite={usesSite}
          agentId={provisionContext?.agentId ?? generatedAgentId ?? "your agent"}
        />
      )}

      {phase === "progress" && (
        <SetupTimeline
          phase="progress"
          deployRecord={deployRecord}
          seedNote={seedNote}
          usesSite={usesSite}
          agentId={provisionContext?.agentId ?? generatedAgentId ?? "(unknown)"}
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
        <VoiceTimeline
          stage="app"
          phoneNumber={voiceInstallContext?.phoneNumber ?? null}
          agentId={provisionContext?.agentId ?? "(unknown)"}
          operation={null}
        />
      )}

      {phase === "installing-voice" && (
        <VoiceTimeline
          stage="gateway"
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
