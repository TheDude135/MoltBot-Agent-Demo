import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  errorMessage,
  getBlueprints,
  getDeployProgress,
  getDeployments,
  getVoiceDeployments,
  getVoiceOperation,
  installApp,
  installVoice,
  introspectSite,
  isAgentIdTakenError,
  provisionAgent,
  seedFiles,
  type ProvisionPayload,
} from "./browser-api";

// Stub global fetch with a function that maps (url, init) -> a fake Response.
function stubFetch(
  impl: (url: string, init?: RequestInit) => { ok: boolean; status: number; body: unknown },
) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(url, init);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (body: unknown, status = 200) => ({ ok: true, status, body });
const fail = (status: number, body: unknown = {}) => ({ ok: false, status, body });

// Resolve to the thrown error so we can assert status/code, not just message.
async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
    throw new Error("expected the call to reject, but it resolved");
  } catch (e) {
    return e as ApiError;
  }
}

const PROVISION_PAYLOAD: ProvisionPayload = {
  deploymentId: "dep-1",
  agentId: "agent-1",
  name: "Agent One",
  emoji: "🤖",
  blueprintId: "bp-1",
  variables: {},
  requestId: "req-1",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("helpers", () => {
  it("errorMessage coerces Errors and non-Errors", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
  it("isAgentIdTakenError matches 409 or the agent-id-taken code only", () => {
    expect(isAgentIdTakenError(new ApiError("x", { status: 409 }))).toBe(true);
    expect(isAgentIdTakenError(new ApiError("x", { code: "agent-id-taken" }))).toBe(true);
    expect(isAgentIdTakenError(new ApiError("x", { status: 500 }))).toBe(false);
    expect(isAgentIdTakenError(new Error("x"))).toBe(false);
    expect(isAgentIdTakenError(null)).toBe(false);
  });
});

describe("getBlueprints / getDeployments", () => {
  it("returns the array on success", async () => {
    stubFetch(() => ok({ blueprints: [{ id: "a" }] }));
    await expect(getBlueprints()).resolves.toEqual([{ id: "a" }]);
  });
  it("defaults to [] when the array is missing", async () => {
    stubFetch(() => ok({}));
    await expect(getBlueprints()).resolves.toEqual([]);
    stubFetch(() => ok({}));
    await expect(getDeployments()).resolves.toEqual([]);
  });
  it("requests the right URL with no-store", async () => {
    const fn = stubFetch(() => ok({ blueprints: [] }));
    await getBlueprints();
    expect(fn).toHaveBeenCalledWith("/api/blueprints", { cache: "no-store" });
  });
  it("throws ApiError with a labelled status fallback", async () => {
    stubFetch(() => fail(500));
    const e = await caught(getBlueprints());
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe("Blueprints HTTP 500");
    expect(e.status).toBe(500);
  });
  it("prefers the server-provided error message", async () => {
    stubFetch(() => fail(403, { error: "missing blueprints:read" }));
    const e = await caught(getBlueprints());
    expect(e.message).toBe("missing blueprints:read");
    expect(e.status).toBe(403);
  });
  it("deployments uses its own labelled fallback", async () => {
    stubFetch(() => fail(404));
    const e = await caught(getDeployments());
    expect(e.message).toBe("Deployments HTTP 404");
  });
});

describe("introspectSite", () => {
  it("returns the parsed result and posts the url", async () => {
    const fn = stubFetch(() => ok({ canonicalUrl: "https://x", businessName: "X" }));
    const res = await introspectSite("x.com");
    expect(res.businessName).toBe("X");
    expect(fn).toHaveBeenCalledWith(
      "/api/introspect",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "x.com" }) }),
    );
  });
  it("carries the error code through on failure", async () => {
    stubFetch(() => fail(422, { error: "not wix", code: "not-wix" }));
    const e = await caught(introspectSite("x.com"));
    expect(e.message).toBe("not wix");
    expect(e.code).toBe("not-wix");
  });
  it("falls back to a status message", async () => {
    stubFetch(() => fail(500));
    const e = await caught(introspectSite("x.com"));
    expect(e.message).toBe("Could not introspect (500).");
  });
});

describe("provisionAgent", () => {
  it("returns the ids on success", async () => {
    stubFetch(() => ok({ requestId: "r", deploymentId: "d", agentId: "a" }));
    await expect(provisionAgent(PROVISION_PAYLOAD)).resolves.toEqual({
      requestId: "r",
      deploymentId: "d",
      agentId: "a",
    });
  });
  it("flags a 409 as an agent-id collision", async () => {
    stubFetch(() => fail(409, { code: "agent-id-taken" }));
    const e = await caught(provisionAgent(PROVISION_PAYLOAD));
    expect(isAgentIdTakenError(e)).toBe(true);
    expect(e.status).toBe(409);
    expect(e.code).toBe("agent-id-taken");
  });
  it("includes the failing step in the fallback message", async () => {
    stubFetch(() => fail(500, { step: "deployBlueprint" }));
    const e = await caught(provisionAgent(PROVISION_PAYLOAD));
    expect(e.message).toBe("Provision failed (500) at deployBlueprint");
    expect(e.step).toBe("deployBlueprint");
  });
  it("omits the step clause when absent", async () => {
    stubFetch(() => fail(500));
    const e = await caught(provisionAgent(PROVISION_PAYLOAD));
    expect(e.message).toBe("Provision failed (500)");
  });
});

describe("getDeployProgress", () => {
  it("returns the deploy record and builds the URL", async () => {
    const fn = stubFetch(() => ok({ deploy: { status: "complete" } }));
    const rec = await getDeployProgress("dep-1", "req-1");
    expect(rec).toEqual({ status: "complete" });
    expect(fn).toHaveBeenCalledWith("/api/progress/dep-1/req-1", { cache: "no-store" });
  });
  it("throws a bare HTTP fallback on error", async () => {
    stubFetch(() => fail(503));
    const e = await caught(getDeployProgress("d", "r"));
    expect(e.message).toBe("HTTP 503");
  });
});

describe("seedFiles", () => {
  it("returns the result on success", async () => {
    stubFetch(() => ok({ seeded: true, files: [{ path: "SOUL.md", status: "written" }] }));
    const res = await seedFiles({ deploymentId: "d", agentId: "a", siteUrl: "x", requestId: "r" });
    expect(res.seeded).toBe(true);
  });
  it("throws a seeding fallback on error", async () => {
    stubFetch(() => fail(500));
    const e = await caught(seedFiles({ deploymentId: "d", agentId: "a", siteUrl: "x", requestId: "r" }));
    expect(e.message).toBe("Seeding request failed (500).");
  });
});

describe("voice install endpoints", () => {
  it("getVoiceDeployments returns [] when missing and its own error fallback", async () => {
    stubFetch(() => ok({}));
    await expect(getVoiceDeployments()).resolves.toEqual([]);
    stubFetch(() => fail(500));
    const e = await caught(getVoiceDeployments());
    expect(e.message).toBe("Could not load voice deployments (HTTP 500).");
  });
  it("installApp resolves void on success and throws on error", async () => {
    stubFetch(() => ok({}));
    await expect(
      installApp({ voiceDeploymentId: "v", slug: "wix-bookings", config: {}, requestId: "r" }),
    ).resolves.toBeUndefined();
    stubFetch(() => fail(500));
    const e = await caught(
      installApp({ voiceDeploymentId: "v", slug: "wix-bookings", config: {}, requestId: "r" }),
    );
    expect(e.message).toBe("Wix app install failed (HTTP 500).");
  });
  it("installVoice returns the op id + phone on success", async () => {
    stubFetch(() => ok({ opId: "op-1", phoneNumber: "+15555550123" }));
    await expect(
      installVoice({
        fleetDeploymentId: "f",
        agentId: "a",
        voiceDeploymentId: "v",
        forceReinstall: true,
        requestId: "r",
      }),
    ).resolves.toEqual({ opId: "op-1", phoneNumber: "+15555550123" });
  });
  it("installVoice throws a dispatch fallback on error", async () => {
    stubFetch(() => fail(500));
    const e = await caught(
      installVoice({
        fleetDeploymentId: "f",
        agentId: "a",
        voiceDeploymentId: "v",
        forceReinstall: true,
        requestId: "r",
      }),
    );
    expect(e.message).toBe("Install dispatch failed (HTTP 500).");
  });
  it("getVoiceOperation returns the operation and uses the URL", async () => {
    const fn = stubFetch(() => ok({ operation: { status: "succeeded" } }));
    const op = await getVoiceOperation("op-1");
    expect(op).toEqual({ status: "succeeded" });
    expect(fn).toHaveBeenCalledWith("/api/voice-operation/op-1", { cache: "no-store" });
  });
});
