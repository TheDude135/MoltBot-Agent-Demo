// Progress phase — polls the deploy record from /api/progress and renders
// each step (completed / in-flight / pending / failed) until terminal.

"use client";

import type { BlueprintDeployRecord } from "@/lib/types";
import { formatStepName } from "@/lib/format";
import { Card, CenteredStatus, PhaseHeader } from "./atoms";

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
    <div className="space-y-4">
      <PhaseHeader
        title={`Deploying ${agentId}`}
        description="Cloning the blueprint onto your agent: files, skills, and voice config."
      />
      <Card className="space-y-1.5 p-3">
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
                    : isHead
                      ? "bg-violet-500/10 text-violet-200"
                      : "bg-white/[0.03] text-gray-400"
              }`}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center">
                {isComplete ? (
                  "✓"
                ) : isFailed ? (
                  "✕"
                ) : isHead ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  "·"
                )}
              </span>
              <span>{formatStepName(step)}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
