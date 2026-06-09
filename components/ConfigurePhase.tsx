// Configure phase — user reviews/edits the blueprint variables and chooses
// the target deployment. The "Pre-filled from <business>" banner only shows
// when the URL phase produced an introspectSummary.

"use client";

import type { Blueprint, BlueprintVariable, Deployment } from "@/lib/types";
import { EMOJI_VARIABLE_KEY } from "@/lib/types";
import { Button, Label, PhaseHeader, Section } from "./atoms";

const EMOJI_OPTIONS = ["🤖", "🧠", "💼", "📞", "🎯", "⭐", "🔥", "💡", "🚀", "🛠️", "📊", "🎨"];

export function ConfigurePhase(props: {
  blueprint: Blueprint;
  deployments: Deployment[];
  allDeployments: Deployment[];
  deploymentsError: string | null;
  targetDeploymentId: string;
  onChangeTargetDeploymentId: (v: string) => void;
  agentName: string;
  onChangeAgentName: (v: string) => void;
  /** Inline error when the derived agentId is already taken on the deployment. */
  nameError?: string | null;
  generatedAgentId: string;
  agentEmoji: string;
  onChangeAgentEmoji: (v: string) => void;
  variableValues: Record<string, string>;
  onChangeVariableValue: (key: string, value: string) => void;
  introspectSummary: {
    businessName: string;
    serviceCount: number;
    staffCount: number;
    canonicalUrl: string;
  } | null;
  onBack: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
}) {
  const noOperational =
    props.deployments.length === 0 && props.allDeployments.length > 0;

  // The agent emoji is driven solely by the identity picker above, so hide the
  // blueprint's agent_emoji variable from the list — one control, never two.
  const visibleVariables = props.blueprint.variables.filter(
    (v) => v.key !== EMOJI_VARIABLE_KEY,
  );

  return (
    <div className="space-y-5">
      <PhaseHeader
        title={`Configure ${props.blueprint.name}`}
        description={props.blueprint.description || undefined}
        onBack={props.onBack}
      />

      {props.introspectSummary && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
          <p className="text-xs font-semibold text-emerald-300">
            ✓ Pre-filled from {props.introspectSummary.businessName}
          </p>
          <p className="mt-0.5 text-[10px] text-emerald-200/70">
            Read {props.introspectSummary.serviceCount} services and{" "}
            {props.introspectSummary.staffCount} staff from{" "}
            <span className="font-mono">
              {props.introspectSummary.canonicalUrl.replace(/^https?:\/\//, "")}
            </span>
            . Review and edit anything below.
          </p>
        </div>
      )}

      <Section title="Target deployment">
        {props.deploymentsError ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <p className="font-semibold text-amber-300">
              Could not load your deployments
            </p>
            <p className="mt-1">{props.deploymentsError}</p>
            <p className="mt-2 text-amber-200/70">
              Most likely your API key is missing the{" "}
              <code className="rounded bg-black/30 px-1 font-mono">
                deployments:read
              </code>{" "}
              scope. Mint a fresh key with all four required scopes (
              <code className="rounded bg-black/30 px-1 font-mono">
                deployments:read
              </code>
              ,{" "}
              <code className="rounded bg-black/30 px-1 font-mono">
                agents:write
              </code>
              ,{" "}
              <code className="rounded bg-black/30 px-1 font-mono">
                blueprints:read
              </code>
              ,{" "}
              <code className="rounded bg-black/30 px-1 font-mono">
                blueprints:deploy
              </code>
              ), paste into{" "}
              <code className="rounded bg-black/30 px-1 font-mono">
                .env.local
              </code>
              , and restart the dev server.
            </p>
          </div>
        ) : props.allDeployments.length === 0 ? (
          <p className="text-xs text-gray-500">
            No deployments visible. Check your API key&apos;s per-instance scope.
          </p>
        ) : noOperational ? (
          <p className="text-xs text-amber-400">
            None of your deployments are OPERATIONAL yet.
          </p>
        ) : (
          <select
            value={props.targetDeploymentId}
            onChange={(e) => props.onChangeTargetDeploymentId(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#1e1b2e] px-3 py-2.5 text-sm text-white"
          >
            <option value="">Select a deployment...</option>
            {props.deployments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.botName ?? d.id}
              </option>
            ))}
          </select>
        )}
      </Section>

      <Section title="New agent identity">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <Label required>Name</Label>
            <input
              type="text"
              value={props.agentName}
              onChange={(e) => props.onChangeAgentName(e.target.value)}
              placeholder="e.g. Sarah Collection Bot"
              className={`w-full rounded-xl border bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none ${
                props.nameError
                  ? "border-rose-500/60 focus:border-rose-500"
                  : "border-white/10 focus:border-violet-500"
              }`}
            />
            {props.nameError ? (
              <p className="mt-1 text-[11px] text-rose-300">{props.nameError}</p>
            ) : (
              props.agentName && (
                <p className="mt-1 font-mono text-[10px] text-gray-600">
                  agentId: {props.generatedAgentId || "(invalid)"}
                </p>
              )
            )}
          </div>
          <div>
            <Label>Emoji</Label>
            <div className="flex max-w-[140px] flex-wrap gap-1 rounded-xl border border-white/10 bg-[#1e1b2e] p-1.5">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => props.onChangeAgentEmoji(e)}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm transition-all ${
                    props.agentEmoji === e
                      ? "bg-violet-500/30 ring-1 ring-violet-500"
                      : "hover:bg-white/10"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {visibleVariables.length > 0 && (
        <Section title={`Variables (${visibleVariables.length})`}>
          <div className="space-y-3">
            {visibleVariables.map((v) => (
              <VariableField
                key={v.key}
                variable={v}
                value={props.variableValues[v.key] ?? ""}
                onChange={(val) => props.onChangeVariableValue(v.key, val)}
              />
            ))}
          </div>
        </Section>
      )}

      <Button
        onClick={props.onSubmit}
        disabled={!props.canSubmit}
        fullWidth
        leadingIcon={<span>🚀</span>}
      >
        Create &amp; Deploy
      </Button>
    </div>
  );
}

function VariableField({
  variable,
  value,
  onChange,
}: {
  variable: BlueprintVariable;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label required={variable.required} secret={variable.type === "secret"}>
        {variable.label || variable.key}
      </Label>
      {variable.description && (
        <p className="mb-1 text-[10px] text-gray-500">{variable.description}</p>
      )}
      {variable.type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={variable.default || undefined}
          rows={3}
          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:border-violet-500 focus:outline-none"
        />
      ) : variable.type === "select" ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-[#1e1b2e] px-3 py-2 text-xs text-white"
        >
          {(variable.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : variable.type === "boolean" ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={value === "true"}
            onClick={() => onChange(value === "true" ? "false" : "true")}
            className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            style={{ backgroundColor: value === "true" ? "#7C3AED" : "#475569" }}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                value === "true" ? "translate-x-[22px]" : "translate-x-[2px]"
              }`}
            />
          </button>
          <span className="text-xs text-gray-400">
            {value === "true" ? "Yes" : "No"}
          </span>
        </div>
      ) : (
        <input
          type={
            variable.type === "secret"
              ? "password"
              : variable.type === "number"
                ? "number"
                : "text"
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={variable.default || undefined}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:border-violet-500 focus:outline-none"
        />
      )}
    </div>
  );
}
