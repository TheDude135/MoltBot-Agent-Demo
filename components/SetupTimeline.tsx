// Deploy-half timeline: the three REST calls that stand up a sub-agent
// (create -> deploy blueprint -> AI-tailor the persona), each tagged with its
// endpoint. The blueprint deploy is the one call whose sub-steps the API
// streams (files, skills, secrets, voice config), shown as chips under it.
// Renders through the shared <Timeline> so it matches the voice half exactly.

"use client";

import type { BlueprintDeployRecord } from "@/lib/types";
import { describeStep, formatStepName } from "@/lib/format";
import type { SeedNote } from "./DonePhase";
import { PhaseHeader } from "./atoms";
import { Timeline, type StepStatus, type Substep, type TimelineStep } from "./Timeline";

function buildSubsteps(rec: BlueprintDeployRecord): Substep[] {
  const seen = new Set<string>();
  const ordered = [...rec.completedSteps, ...rec.pendingSteps].filter((s) =>
    seen.has(s) ? false : (seen.add(s), true),
  );
  return ordered.map((step) => {
    const status: StepStatus = rec.completedSteps.includes(step)
      ? "done"
      : rec.failedSteps.includes(step)
        ? "failed"
        : rec.pendingSteps[0] === step
          ? "active"
          : "pending";
    return { key: step, label: formatStepName(step), status };
  });
}

export function SetupTimeline({
  phase,
  deployRecord,
  seedNote,
  agentId,
  usesSite = true,
}: {
  phase: "provisioning" | "progress";
  deployRecord: BlueprintDeployRecord | null;
  seedNote: SeedNote | null;
  agentId: string;
  /** Site-less blueprints (no Wix introspection) have no site to read, so the
   *  AI persona-seeding step is omitted from the timeline. */
  usesSite?: boolean;
}) {
  // 1. Create the sub-agent. Done once a deploy record exists (the deploy can
  //    only run after the agent is created).
  const createStatus: StepStatus = phase === "provisioning" ? "active" : "done";

  // 2. Deploy the blueprint, with the API's streamed sub-steps as chips.
  let deployStatus: StepStatus;
  if (!deployRecord) deployStatus = phase === "provisioning" ? "pending" : "active";
  else if (deployRecord.failedSteps.length > 0) deployStatus = "failed";
  else if (deployRecord.pendingSteps.length === 0 && deployRecord.completedSteps.length > 0)
    deployStatus = "done";
  else deployStatus = "active";

  // 3. AI persona seeding (best-effort, runs after a clean deploy).
  let seedStatus: StepStatus = "pending";
  if (seedNote?.status === "running") seedStatus = "active";
  else if (seedNote?.status === "seeded" || seedNote?.status === "skipped") seedStatus = "done";
  else if (seedNote?.status === "error") seedStatus = "failed";

  const steps: TimelineStep[] = [
    {
      key: "create",
      title: "Create the sub-agent",
      desc: "Spins up an isolated workspace and identity on your deployment.",
      method: "POST",
      path: "/v1/deployments/{id}/agents",
      status: createStatus,
    },
    {
      key: "deploy",
      title: "Deploy the blueprint",
      desc: "Writes the agent's files, skills, secrets, and voice config.",
      method: "POST",
      path: "/v1/deployments/{id}/blueprint-deploys",
      status: deployStatus,
      substeps: deployRecord ? buildSubsteps(deployRecord) : undefined,
    },
    // AI persona seeding reads the site to tailor SOUL.md — only meaningful for
    // blueprints that have a site. Site-less ones keep their templated SOUL.md.
    ...(usesSite
      ? [
          {
            key: "seed",
            title: "Tailor the persona to the site",
            desc:
              seedNote?.message ??
              "Claude rewrites the agent's SOUL.md to match this business. Best-effort; skipped if no Anthropic key is set.",
            method: "PUT",
            path: "/v1/deployments/{id}/agents/{agentId}/files",
            status: seedStatus,
          } as TimelineStep,
        ]
      : []),
  ];

  // While the deploy is active, surface the live sub-step name as the
  // description so the row reflects exactly what the API is doing right now.
  const deployStep = steps[1];
  const activeSub = deployRecord?.pendingSteps[0];
  if (deployStep && deployStatus === "active" && activeSub) {
    deployStep.desc = describeStep(activeSub) ?? "Applying the blueprint to the agent.";
  }

  return (
    <div className="space-y-4">
      <PhaseHeader
        title={`Setting up ${agentId}`}
        description="Each step below is one public REST call. No SDK, no Firebase: just the API."
      />
      <Timeline title="Deploy steps" steps={steps} />
    </div>
  );
}
