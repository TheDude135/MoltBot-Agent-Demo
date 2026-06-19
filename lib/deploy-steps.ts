// Turns a blueprint-deploy record into the granular sub-steps shown under the
// "Deploy the blueprint" row: one entry per file-write / skill / secret, each
// with a friendly label, an explanatory one-liner, and a status.
//
// Skills get their catalog title + benefit blurb (so "skill:caldav-calendar"
// reads as "Calendar - Checks availability, books, and reschedules events");
// structural steps use the deploy-step formatter. Pure + unit-tested.

import type { BlueprintDeployRecord } from "./types";
import { describeSkill } from "./skill-catalog";
import { describeStep, formatStepName } from "./format";

export type DeployStepStatus = "done" | "active" | "pending" | "failed";

export interface DeploySubstep {
  key: string;
  label: string;
  desc?: string;
  status: DeployStepStatus;
}

function substepCopy(step: string): { label: string; desc?: string } {
  if (step.startsWith("skill:")) {
    const info = describeSkill(step.slice("skill:".length));
    return { label: info.title, desc: info.blurb };
  }
  return { label: formatStepName(step), desc: describeStep(step) ?? undefined };
}

/**
 * Build the ordered sub-step list. completed -> failed -> pending, deduped.
 * Failed steps ARE included (they were previously dropped, which hid which
 * skill broke); the first pending step is the one currently installing.
 */
export function buildDeploySubsteps(
  rec: BlueprintDeployRecord,
): DeploySubstep[] {
  const seen = new Set<string>();
  const ordered = [
    ...rec.completedSteps,
    ...rec.failedSteps,
    ...rec.pendingSteps,
  ].filter((s) => (seen.has(s) ? false : (seen.add(s), true)));

  return ordered.map((step) => {
    const status: DeployStepStatus = rec.completedSteps.includes(step)
      ? "done"
      : rec.failedSteps.includes(step)
        ? "failed"
        : rec.pendingSteps[0] === step
          ? "active"
          : "pending";
    const { label, desc } = substepCopy(step);
    return { key: step, label, desc, status };
  });
}
