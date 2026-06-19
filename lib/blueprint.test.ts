import { describe, expect, it } from "vitest";
import { isIdentityVariable, personalizableVariables } from "./blueprint";
import type { Blueprint, BlueprintVariable } from "./types";

function v(key: string): BlueprintVariable {
  return { key, label: key, description: "", type: "text", required: false, default: "" };
}
function bp(keys: string[]): Blueprint {
  return {
    id: "x",
    name: "X",
    description: "",
    version: 1,
    variables: keys.map(v),
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

describe("isIdentityVariable", () => {
  it("flags the name + emoji keys driven by the demo's own controls", () => {
    expect(isIdentityVariable(v("agent_name"))).toBe(true);
    expect(isIdentityVariable(v("agent_emoji"))).toBe(true);
  });
  it("does not flag ordinary variables", () => {
    expect(isIdentityVariable(v("owner_name"))).toBe(false);
    expect(isIdentityVariable(v("personality"))).toBe(false);
  });
});

describe("personalizableVariables", () => {
  it("removes identity-driven variables, preserving order", () => {
    const keys = personalizableVariables(
      bp(["owner_name", "agent_name", "personality", "agent_emoji"]),
    ).map((x) => x.key);
    expect(keys).toEqual(["owner_name", "personality"]);
  });
  it("returns all variables when none are identity-driven", () => {
    expect(personalizableVariables(bp(["a", "b"])).map((x) => x.key)).toEqual(["a", "b"]);
  });
});
