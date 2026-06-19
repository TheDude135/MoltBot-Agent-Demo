"use client";

// The core deploy flow: pick a blueprint -> (optional Wix Site step) -> review +
// configure -> provision (create agent + deploy blueprint) -> poll progress ->
// best-effort AI persona seeding. Owns all of that state + the progress poller.
//
// It does NOT own `phase` (the master state machine) or the shared error
// message - those live in the orchestrator and are passed in, so this hook and
// the voice hook can both drive the same screen + error surface.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Blueprint,
  BlueprintDeployRecord,
  DeployStatus,
  IntrospectSummary,
  ProvisionContext,
} from "@/lib/types";
import { EMOJI_VARIABLE_KEY, NAME_VARIABLE_KEY } from "@/lib/types";
import { generateAgentId, generateRequestId, isValidAgentId } from "@/lib/ids";
import {
  errorMessage,
  getDeployProgress,
  introspectSite,
  isAgentIdTakenError,
  provisionAgent,
  seedFiles,
} from "@/lib/browser-api";
import { blueprintUsesSite, type Phase } from "@/lib/wizard-steps";
import type { SeedNote } from "@/components/DonePhase";

const PROGRESS_POLL_INTERVAL_MS = 2000;
// Hard deadline so a wedged upstream deploy surfaces an error instead of
// spinning the UI forever.
const PROGRESS_POLL_TIMEOUT_MS = 5 * 60_000;

export function useDeployFlow(opts: {
  phase: Phase;
  setPhase: (p: Phase) => void;
  /** Sets the shared error message (null clears it). The orchestrator also
   *  switches to the "error" phase where appropriate. */
  setError: (message: string | null) => void;
}) {
  const { phase, setPhase, setError } = opts;

  // Selection + identity + variable state
  const [selectedBlueprint, setSelectedBlueprint] = useState<Blueprint | null>(null);
  const [targetDeploymentId, setTargetDeploymentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentEmoji, setAgentEmoji] = useState("🤖");
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  // Site introspection state
  const [siteUrl, setSiteUrl] = useState("");
  const [introspecting, setIntrospecting] = useState(false);
  const [introspectError, setIntrospectError] = useState<string | null>(null);
  const [introspectSummary, setIntrospectSummary] = useState<IntrospectSummary | null>(null);

  // Provision + progress state
  const [nameError, setNameError] = useState<string | null>(null);
  const [provisionContext, setProvisionContext] = useState<ProvisionContext | null>(null);
  const [deployRecord, setDeployRecord] = useState<BlueprintDeployRecord | null>(null);

  // AI file-seeding state - best-effort enrichment that runs once the blueprint
  // deploy completes. seedStartedRef guards against the progress poller (which
  // fires repeatedly) kicking off more than one seeding run.
  const [seedNote, setSeedNote] = useState<SeedNote | null>(null);
  const seedStartedRef = useRef(false);
  // Run token: bumped on reset / new provision so a slow seeding request that
  // resolves after the user has moved on can't repaint a stale note.
  const seedTokenRef = useRef(0);

  // ── Navigation + selection ─────────────────────────────────────────

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
  }, [setPhase]);

  // From the blueprint intro page, open the deploy form: the Site (url) phase
  // ONLY for blueprints that carry Wix-introspectable variables; any other
  // blueprint (e.g. the Personal Assistant) goes straight to manual Configure.
  const handleContinueToDeploy = useCallback(() => {
    if (!selectedBlueprint) return;
    setPhase(blueprintUsesSite(selectedBlueprint) ? "url" : "configure");
  }, [selectedBlueprint, setPhase]);

  // Back from the intro page to the catalog: clear the selection too.
  const backToCatalog = useCallback(() => {
    setPhase("catalog");
    setSelectedBlueprint(null);
  }, [setPhase]);

  // ── Site introspection ─────────────────────────────────────────────

  // POST /api/introspect - on success overlay the returned variable values
  // (without clobbering blueprint defaults for keys the introspector left
  // blank), pre-fill the agentName from businessName, then advance to Configure.
  // On failure show an actionable message and stay on the URL phase.
  const handleIntrospect = useCallback(async () => {
    if (!siteUrl.trim()) {
      setIntrospectError("Enter a Wix Bookings site URL.");
      return;
    }
    setIntrospecting(true);
    setIntrospectError(null);
    try {
      const result = await introspectSite(siteUrl.trim());
      setIntrospectSummary({
        businessName: result.businessName,
        serviceCount: result.serviceCount,
        staffCount: result.staffCount,
        canonicalUrl: result.canonicalUrl,
      });
      // Overlay only non-empty values so blueprint defaults survive for any
      // variable the introspector didn't have a value for (e.g. payment policy).
      setVariableValues((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(result.variables)) {
          if (typeof v === "string" && v.length > 0) next[k] = v;
        }
        return next;
      });
      // Pre-fill the agent identity from the discovered business name.
      if (result.businessName) setAgentName(result.businessName);
      setPhase("configure");
    } catch (err) {
      setIntrospectError(errorMessage(err));
    } finally {
      setIntrospecting(false);
    }
  }, [siteUrl, setPhase]);

  // ── Derived values ─────────────────────────────────────────────────

  const generatedAgentId = useMemo(
    () => (agentName ? generateAgentId(agentName) : ""),
    [agentName],
  );

  // Site-less blueprints (e.g. the Personal Assistant) skip the Wix Site step,
  // so the stepper, the Configure back-button, and the deploy timeline all drop
  // their site-specific pieces. Defaults to true before a blueprint is picked.
  const usesSite = useMemo(
    () => (selectedBlueprint ? blueprintUsesSite(selectedBlueprint) : true),
    [selectedBlueprint],
  );

  const canSubmit = Boolean(
    targetDeploymentId &&
      agentName.trim() &&
      generatedAgentId &&
      isValidAgentId(generatedAgentId),
  );

  // ── AI file-seeding ─────────────────────────────────────────────────

  // Best-effort: the agent already works off the blueprint's templated files,
  // so any failure here just keeps those and surfaces a note. Guarded by
  // seedStartedRef so the progress poller can't start it twice.
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
      const result = await seedFiles({
        deploymentId: ctx.deploymentId,
        agentId: ctx.agentId,
        siteUrl: url,
        requestId: ctx.requestId,
      });
      if (result.seeded) {
        const files = result.files ?? [];
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
        // Skipped by design (e.g. AI disabled) - the templated files stand.
        post({
          status: "skipped",
          message: result.message ?? "Kept the blueprint's templated files.",
        });
      }
    } catch (err) {
      post({ status: "error", message: errorMessage(err) });
    }
  }, [provisionContext, introspectSummary]);

  // Hold the latest runSeedFiles in a ref so the progress effect can call it
  // without listing it as a dependency (which would tear down + re-subscribe the
  // poller whenever introspectSummary/provisionContext identity changes, and
  // double-fire under React StrictMode in dev).
  const runSeedFilesRef = useRef(runSeedFiles);
  useEffect(() => {
    runSeedFilesRef.current = runSeedFiles;
  }, [runSeedFiles]);

  // ── Progress polling ────────────────────────────────────────────────

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
        const deploy = await getDeployProgress(
          provisionContext.deploymentId,
          provisionContext.requestId,
        );
        if (cancelled) return;
        setDeployRecord(deploy);
        const status: DeployStatus = deploy.status;
        if (status === "complete" || status === "partial" || status === "failed") {
          stop();
          // Fire AI seeding once, only on a clean complete (so we never overwrite
          // files on a half-deployed agent). Fire-and-forget: the done phase
          // renders immediately and the seed note updates when it resolves.
          if (status === "complete") void runSeedFilesRef.current();
          setPhase("done");
          return;
        }
        if (Date.now() > deadline) {
          stop();
          setError(
            "The deploy did not finish within 5 minutes. Check the agent in MoltBot Ninja, then try again.",
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
    // Fire once immediately, then on interval.
    tick();
    pollingRef.current = setInterval(tick, PROGRESS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [phase, provisionContext, setPhase, setError]);

  // ── Provision ───────────────────────────────────────────────────────

  const submitProvision = useCallback(async () => {
    if (!selectedBlueprint || !canSubmit) return;
    setError(null);
    setDeployRecord(null);
    setSeedNote(null);
    seedStartedRef.current = false;
    seedTokenRef.current++;
    setNameError(null);
    setPhase("provisioning");

    // The identity controls (the Name field and the emoji picker) are the single
    // source of truth. When the blueprint declares the matching variables (used
    // in its IDENTITY/SOUL/persona files), mirror the controls into them so the
    // Ninja UI, the managed-agent identity, and the persona never diverge - one
    // control, one value. Only inject keys the blueprint actually declares.
    const declares = (key: string) =>
      selectedBlueprint.variables.some((v) => v.key === key);
    const variables: Record<string, string> = { ...variableValues };
    if (declares(EMOJI_VARIABLE_KEY)) variables[EMOJI_VARIABLE_KEY] = agentEmoji;
    if (declares(NAME_VARIABLE_KEY)) variables[NAME_VARIABLE_KEY] = agentName.trim();

    try {
      const result = await provisionAgent({
        deploymentId: targetDeploymentId,
        agentId: generatedAgentId,
        name: agentName.trim(),
        emoji: agentEmoji,
        blueprintId: selectedBlueprint.id,
        variables,
        requestId: generateRequestId(),
      });
      setProvisionContext(result);
      setPhase("progress");
    } catch (err) {
      // A name collision (the derived agentId already exists on this deployment)
      // is recoverable: go back to Configure with a clear inline message so the
      // user can just rename, keeping everything else (deployment, variables,
      // the site they introspected).
      if (isAgentIdTakenError(err)) {
        setNameError(
          `The id "${generatedAgentId}" is already taken on this deployment. Pick a different name.`,
        );
        setPhase("configure");
        return;
      }
      setError(errorMessage(err));
      setPhase("error");
    }
  }, [
    selectedBlueprint,
    canSubmit,
    variableValues,
    agentEmoji,
    agentName,
    targetDeploymentId,
    generatedAgentId,
    setPhase,
    setError,
  ]);

  // ── Field change handlers ───────────────────────────────────────────

  const onChangeAgentName = useCallback(
    (v: string) => {
      setAgentName(v);
      setNameError((prev) => (prev ? null : prev));
    },
    [],
  );

  const onChangeVariableValue = useCallback((key: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Reset (the orchestrator also clears phase + the shared error) ────

  const resetDeploy = useCallback(() => {
    setSelectedBlueprint(null);
    setTargetDeploymentId("");
    setAgentName("");
    setAgentEmoji("🤖");
    setVariableValues({});
    setSiteUrl("");
    setIntrospectError(null);
    setIntrospectSummary(null);
    setNameError(null);
    setProvisionContext(null);
    setDeployRecord(null);
    setSeedNote(null);
    seedStartedRef.current = false;
    seedTokenRef.current++;
  }, []);

  return {
    // selection + identity
    selectedBlueprint,
    usesSite,
    handleSelectBlueprint,
    handleContinueToDeploy,
    backToCatalog,
    // site step
    siteUrl,
    setSiteUrl,
    introspecting,
    introspectError,
    handleIntrospect,
    introspectSummary,
    // configure form
    targetDeploymentId,
    setTargetDeploymentId,
    agentName,
    onChangeAgentName,
    agentEmoji,
    setAgentEmoji,
    variableValues,
    onChangeVariableValue,
    generatedAgentId,
    nameError,
    canSubmit,
    submitProvision,
    // provision result + progress
    provisionContext,
    deployRecord,
    seedNote,
    // lifecycle
    resetDeploy,
  };
}
