import { describe, expect, it } from "vitest";
import { describeSkill } from "./skill-catalog";

describe("describeSkill", () => {
  it("returns curated copy + icon for a known slug", () => {
    const s = describeSkill("agentmail");
    expect(s.title).toBe("Email");
    expect(s.icon).toBe("email");
    expect(s.blurb.length).toBeGreaterThan(0);
  });
  it("maps both relationship-hub slugs to the CRM entry", () => {
    expect(describeSkill("relationship-hub").icon).toBe("crm");
    expect(describeSkill("dojo-relationship-hub").icon).toBe("crm");
  });
  it("humanizes an unknown slug and uses the generic icon", () => {
    const s = describeSkill("dojo-inbox-manager");
    expect(s.title).toBe("Inbox Manager");
    expect(s.icon).toBe("generic");
    expect(s.blurb.length).toBeGreaterThan(0);
  });
});
