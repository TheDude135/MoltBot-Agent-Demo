// Terminal phases — Done (deploy reached complete/partial/failed) and
// Error (orchestrator-side failure before the deploy was even dispatched).
// Both expose a single action: reset to Catalog.

"use client";

import type { BlueprintDeployRecord } from "@/lib/types";
import { formatStepName } from "@/lib/format";

export function DonePhase({
  deployRecord,
  agentId,
  onReset,
  onAttachVoice,
}: {
  deployRecord: BlueprintDeployRecord | null;
  agentId: string;
  onReset: () => void;
  /** Optional — when present, renders the "Add a phone number" action.
   *  Wired only when the deploy completed cleanly; partial / failed
   *  states get only the reset button to keep the failure visible. */
  onAttachVoice?: () => void;
}) {
  const status = deployRecord?.status ?? "complete";
  const failedSteps = deployRecord?.failedSteps ?? [];
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
      <div className="text-3xl">
        {status === "complete" ? "🎉" : status === "partial" ? "⚠️" : "❌"}
      </div>
      <div>
        <p className="text-base font-bold text-white">
          {status === "complete"
            ? `Agent "${agentId}" is live`
            : status === "partial"
              ? "Deployed with some failed steps"
              : "Deploy failed"}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Final status: <span className="font-mono">{status}</span>
        </p>
      </div>
      {failedSteps.length > 0 && (
        <div className="space-y-1 text-left">
          <p className="text-xs font-semibold text-red-300">Failed steps:</p>
          {failedSteps.map((s) => (
            <p key={s} className="font-mono text-[11px] text-red-300/80">
              ✕ {formatStepName(s)}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onAttachVoice && (
          <button
            onClick={onAttachVoice}
            className="rounded-xl bg-violet-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-500/30 hover:bg-violet-400"
          >
            Add a phone number
          </button>
        )}
        <button
          onClick={onReset}
          className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-gray-300 hover:bg-white/5"
        >
          Deploy another
        </button>
      </div>
    </div>
  );
}

export function ErrorPhase({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
      <p className="font-semibold text-red-300">Something went wrong</p>
      <p className="text-sm text-red-200/80">{message}</p>
      <button
        onClick={onReset}
        className="rounded-xl border border-red-300/30 px-4 py-2 text-xs font-bold text-red-200 hover:bg-red-500/15"
      >
        Start over
      </button>
    </div>
  );
}
