// Progress phase — polls the deploy record from /api/progress and renders
// each step (completed / in-flight / pending / failed) until terminal.

"use client";

import type { BlueprintDeployRecord } from "@/lib/types";
import { formatStepName } from "@/lib/format";
import { CenteredStatus } from "./atoms";

export function ProgressPhase({
  deployRecord,
  agentId,
}: {
  deployRecord: BlueprintDeployRecord | null;
  agentId: string;
}) {
  if (!deployRecord) {
    return (
      <CenteredStatus
        label="Dispatching deploy..."
        detail={`Agent ${agentId} created. Waiting for the first progress update.`}
      />
    );
  }
  const allSteps = [
    ...deployRecord.completedSteps,
    ...deployRecord.pendingSteps,
  ];
  return (
    <div className="space-y-3">
      <header>
        <p className="text-xs uppercase tracking-wider text-gray-500">
          Live progress
        </p>
        <h2 className="text-base font-bold text-white">Deploying to {agentId}</h2>
      </header>
      <div className="space-y-1.5">
        {allSteps.map((step) => {
          const isComplete = deployRecord.completedSteps.includes(step);
          const isFailed = deployRecord.failedSteps.includes(step);
          const isHead = deployRecord.pendingSteps[0] === step;
          return (
            <div
              key={step}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                isComplete
                  ? "bg-emerald-500/10 text-emerald-300"
                  : isFailed
                    ? "bg-red-500/10 text-red-300"
                    : "bg-white/[0.03] text-gray-400"
              }`}
            >
              <span>
                {isComplete
                  ? "✓"
                  : isFailed
                    ? "✕"
                    : isHead
                      ? "⟳"
                      : "·"}
              </span>
              <span>{formatStepName(step)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
