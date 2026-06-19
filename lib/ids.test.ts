import { describe, expect, it } from "vitest";
import { generateAgentId, isValidAgentId } from "./ids";

describe("generateAgentId", () => {
  it("kebab-cases a plain name", () => {
    expect(generateAgentId("Sarah Collection Bot")).toBe("sarah-collection-bot");
  });
  it("drops leading digits so the id starts with a letter", () => {
    expect(generateAgentId("25 Affordable Markham Notary")).toBe(
      "affordable-markham-notary",
    );
  });
  it("strips punctuation and collapses repeated hyphens", () => {
    expect(generateAgentId("A.B   C--D")).toBe("ab-c-d");
  });
  it("returns empty when no letter-leading characters survive", () => {
    expect(generateAgentId("12345")).toBe("");
  });
  it("caps the id at 32 characters with no trailing hyphen", () => {
    const id = generateAgentId("a".repeat(40));
    expect(id.length).toBeLessThanOrEqual(32);
    expect(id.endsWith("-")).toBe(false);
  });
});

describe("isValidAgentId", () => {
  it("accepts a clean kebab id", () => {
    expect(isValidAgentId("sarah-collection-bot")).toBe(true);
    expect(isValidAgentId("a")).toBe(true);
  });
  it("rejects leading digit, trailing hyphen, and empty", () => {
    expect(isValidAgentId("1abc")).toBe(false);
    expect(isValidAgentId("abc-")).toBe(false);
    expect(isValidAgentId("")).toBe(false);
  });
  it("agrees with generateAgentId for generated ids", () => {
    expect(isValidAgentId(generateAgentId("Top Details Barber"))).toBe(true);
  });
});
