import { describe, expect, it } from "vitest";
import { buildDeploySubsteps } from "./deploy-steps";
import type { BlueprintDeployRecord } from "./types";

function rec(p: Partial<BlueprintDeployRecord>): BlueprintDeployRecord {
  return {
    requestId: "r",
    blueprintId: "b",
    deploymentId: "d",
    agentId: "a",
    status: "applying",
    completedSteps: [],
    pendingSteps: [],
    failedSteps: [],
    ...p,
  };
}

describe("buildDeploySubsteps", () => {
  it("surfaces a FAILED step (previously hidden) with failed status", () => {
    const subs = buildDeploySubsteps(
      rec({
        status: "partial",
        completedSteps: ["dojoSync", "skill:caldav-calendar", "skill:relationship-hub"],
        failedSteps: ["skill:agentmail"],
        pendingSteps: [],
      }),
    );
    const keys = subs.map((s) => s.key);
    expect(keys).toContain("skill:agentmail");
    expect(subs.find((s) => s.key === "skill:agentmail")?.status).toBe("failed");
    expect(subs.find((s) => s.key === "skill:caldav-calendar")?.status).toBe("done");
  });

  it("gives skills a friendly title + explanatory blurb", () => {
    const subs = buildDeploySubsteps(rec({ pendingSteps: ["skill:caldav-calendar"] }));
    const s = subs.find((x) => x.key === "skill:caldav-calendar");
    expect(s?.label).toBe("Calendar");
    expect((s?.desc ?? "").length).toBeGreaterThan(0);
  });

  it("labels structural steps and marks only the first pending step active", () => {
    const subs = buildDeploySubsteps(
      rec({
        completedSteps: ["dojoSync"],
        pendingSteps: ["skill:relationship-hub", "skill:agentmail"],
      }),
    );
    expect(subs.find((s) => s.key === "dojoSync")?.label).toBe(
      "Writing the agent's files",
    );
    expect(subs.find((s) => s.key === "dojoSync")?.status).toBe("done");
    expect(subs.find((s) => s.key === "skill:relationship-hub")?.status).toBe("active");
    expect(subs.find((s) => s.key === "skill:agentmail")?.status).toBe("pending");
  });

  it("dedupes a step that appears in more than one bucket", () => {
    const subs = buildDeploySubsteps(
      rec({ completedSteps: ["dojoSync"], pendingSteps: ["dojoSync"] }),
    );
    expect(subs.filter((s) => s.key === "dojoSync")).toHaveLength(1);
  });
});
