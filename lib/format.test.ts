import { describe, expect, it } from "vitest";
import { describeStep, formatBytes, formatStepName, tidyDashes } from "./format";

describe("tidyDashes", () => {
  it("replaces em and en dashes with a hyphen", () => {
    expect(tidyDashes("a — b – c")).toBe("a - b - c");
  });
  it("leaves plain hyphenated text untouched", () => {
    expect(tidyDashes("already - fine")).toBe("already - fine");
  });
});

describe("formatBytes", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(7290)).toBe("7.1 KB");
    expect(formatBytes(204800)).toBe("200 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
  it("guards against non-finite and negative input", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("formatStepName / describeStep", () => {
  it("labels known deploy steps", () => {
    expect(formatStepName("dojoSync")).toBe("Writing the agent's files");
    expect(formatStepName("skill:agentmail")).toBe("Installing skill · agentmail");
  });
  it("describes a secret step without leaking the value", () => {
    const d = describeStep("secret:OPENAI_KEY");
    expect(d).toContain("Secret Manager");
  });
});
