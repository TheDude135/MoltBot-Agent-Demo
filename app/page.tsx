"use client";

// Orchestrator for the demo flow. Phase logic, shared state, and the
// browser-side API calls live here. Each phase's UI is its own component
// in /components — page.tsx stays under the 800-line cap from CLAUDE.md
// and keeps cognitive overhead low while reading the control flow.
//
// Phases:
//   1. catalog    — load blueprints + deployments in parallel, then pick one
//   2. url        — Wix site URL → /api/introspect → overlay variables
//   3. configure  — target deployment + new agent name/emoji + variables
//   4. provisioning — POST /api/provision (server orchestrates create + deploy)
//   5. progress   — poll /api/progress until terminal
//   6. done | error — terminal outcomes
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
} from "@/lib/types";
import { generateAgentId, generateRequestId, isValidAgentId } from "@/lib/ids";
import { CatalogPhase } from "@/components/CatalogPhase";
import { UrlPhase } from "@/components/UrlPhase";
import { ConfigurePhase } from "@/components/ConfigurePhase";
import { ProgressPhase } from "@/components/ProgressPhase";
import { DonePhase, ErrorPhase } from "@/components/DonePhase";
import { CenteredStatus } from "@/components/atoms";

type Phase = "catalog" | "url" | "configure" | "provisioning" | "progress" | "done" | "error";

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
  };

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
        />
      )}

      {phase === "error" && (
        <ErrorPhase message={provisionError ?? "Unknown error"} onReset={reset} />
      )}
    </main>
  );
}
