import { describe, expect, it } from "vitest";
import {
  blueprintUsesSite,
  computeStepper,
  STEPS_NO_SITE,
  STEPS_WITH_SITE,
} from "./wizard-steps";
import type { Blueprint } from "./types";

function bp(variableKeys: string[]): Blueprint {
  return {
    id: "x",
    name: "X",
    description: "",
    version: 1,
    variables: variableKeys.map((key) => ({
      key,
      label: key,
      description: "",
      type: "text",
      required: false,
      default: "",
    })),
    skills: [],
    galleryTemplates: [],
    voiceConfig: null,
    fileManifest: [],
    sourceDeploymentId: "",
    sourceAgentId: "",
    createdAt: null,
    updatedAt: null,
  };
}

describe("blueprintUsesSite", () => {
  it("is true when business_name is present", () => {
    expect(blueprintUsesSite(bp(["business_name"]))).toBe(true);
  });
  it("is true when services_table_md is present", () => {
    expect(blueprintUsesSite(bp(["services_table_md"]))).toBe(true);
  });
  it("is false for a site-less blueprint", () => {
    expect(blueprintUsesSite(bp(["owner_name", "personality"]))).toBe(false);
  });
});

describe("computeStepper", () => {
  it("uses the 5-step shape and finds Configure at index 2 when usesSite", () => {
    const { steps, current } = computeStepper("configure", true);
    expect(steps).toEqual([...STEPS_WITH_SITE]);
    expect(current).toBe(2);
  });
  it("uses the 4-step shape and finds Configure at index 1 when site-less", () => {
    const { steps, current } = computeStepper("configure", false);
    expect(steps).toEqual([...STEPS_NO_SITE]);
    expect(current).toBe(1);
  });
  it("keeps catalog and detail on the Blueprint step", () => {
    expect(computeStepper("catalog", true).current).toBe(0);
    expect(computeStepper("detail", true).current).toBe(0);
  });
  it("maps every voice phase to the Voice step", () => {
    const voicePhases = [
      "pick-voice",
      "installing-app",
      "installing-voice",
      "voice-done",
    ] as const;
    for (const p of voicePhases) {
      expect(computeStepper(p, true).current).toBe(4);
      expect(computeStepper(p, false).current).toBe(3);
    }
  });
  it("maps the deploy/error phases to the Deploy step", () => {
    for (const p of ["provisioning", "progress", "done", "error"] as const) {
      expect(computeStepper(p, true).current).toBe(3);
    }
  });
});
