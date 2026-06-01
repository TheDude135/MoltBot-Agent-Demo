// Server-only HTTP wrapper around the MoltBot Ninja public REST API.
//
// The API key is held in env and injected via Authorization: Bearer.
// Browser code MUST NOT import this module — it would expose the key
// to the client bundle. `import "server-only"` enforces that boundary.

import "server-only";
import { getConfig } from "./config";
import type {
  Blueprint,
  BlueprintDeployRecord,
  Deployment,
  Operation,
} from "./types";

export class MbnApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problemType: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "MbnApiError";
  }
}

interface RequestEnvelope<T> {
  data: T;
}

// 10 s default — generous for cold Cloud Function starts but bounded so
// a wedged backend can't hang a UI poll. Per-call override allowed.
const DEFAULT_TIMEOUT_MS = 10_000;

async function callApi<T>(
  pathAndQuery: string,
  init: RequestInit & { timeoutMs?: number; idempotencyKey?: string } = {},
): Promise<{ envelope: T; response: Response }> {
  const { apiBase, apiKey } = getConfig();
  const url = new URL(pathAndQuery, apiBase).toString();
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // The API REQUIRES `Idempotency-Key` on every non-GET request (matches
  // /^[A-Za-z0-9._~-]{8,100}$/). Replays with the same key + same body
  // get the cached response back; same key + different body → 400. Callers
  // pass a deterministic key derived from their flow's own identifier so
  // the full /api/provision orchestration is replay-safe end-to-end.
  const method = (init.method ?? "GET").toUpperCase();
  const needsIdempotencyKey = method !== "GET" && method !== "HEAD";

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      // Always force a fresh round-trip — the API's own Cache-Control
      // directives + private/no-store rules govern caching for callers.
      // Demo polling explicitly does not want intermediate caches.
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(needsIdempotencyKey && init.idempotencyKey
          ? { "Idempotency-Key": init.idempotencyKey }
          : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new MbnApiError(
        504,
        "gateway-timeout",
        `Upstream request timed out after ${timeoutMs}ms`,
      );
    }
    throw new MbnApiError(
      502,
      "bad-gateway",
      `Upstream request failed: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  // Non-2xx → parse RFC 7807 problem+json if available, then throw.
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // body might be empty or non-JSON — keep null
    }
    const problemType =
      (body as { type?: string } | null)?.type?.split("/").pop() ?? "unknown";
    const message =
      (body as { detail?: string; title?: string } | null)?.detail ??
      (body as { title?: string } | null)?.title ??
      `HTTP ${response.status}`;
    throw new MbnApiError(response.status, problemType, message, body);
  }

  // 204 No Content (none expected for these endpoints, but defend
  // against it so a future spec change can't crash JSON.parse).
  if (response.status === 204) {
    return { envelope: { data: null } as unknown as T, response };
  }

  const envelope = (await response.json()) as T;
  return { envelope, response };
}

// ─── Catalog (read) ───────────────────────────────────────────────────

export async function listBlueprints(limit?: number): Promise<Blueprint[]> {
  const search = new URLSearchParams();
  if (limit) search.set("limit", String(limit));
  const qs = search.toString();
  const { envelope } = await callApi<RequestEnvelope<{ blueprints: Blueprint[] }>>(
    `/v1/blueprints${qs ? `?${qs}` : ""}`,
  );
  return envelope.data.blueprints;
}

export async function getBlueprint(blueprintId: string): Promise<Blueprint> {
  const { envelope } = await callApi<RequestEnvelope<{ blueprint: Blueprint }>>(
    `/v1/blueprints/${encodeURIComponent(blueprintId)}`,
  );
  return envelope.data.blueprint;
}

export async function listDeployments(): Promise<Deployment[]> {
  const { envelope } = await callApi<RequestEnvelope<{ deployments: Deployment[] }>>(
    `/v1/deployments`,
  );
  return envelope.data.deployments;
}

// ─── Agent create (async; returns opId via Location) ──────────────────

export interface CreateAgentInput {
  deploymentId: string;
  agentId: string;
  name: string;
  emoji: string;
  /** Server-side idempotency key — deterministic per logical request. */
  idempotencyKey: string;
}

export interface CreateAgentResult {
  opId: string;
}

export async function createAgent(
  input: CreateAgentInput,
): Promise<CreateAgentResult> {
  const { response } = await callApi<unknown>(
    `/v1/deployments/${encodeURIComponent(input.deploymentId)}/agents`,
    {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({
        agentId: input.agentId,
        name: input.name,
        emoji: input.emoji,
      }),
    },
  );
  if (response.status !== 202) {
    throw new MbnApiError(
      response.status,
      "unexpected-status",
      `Expected 202 Accepted on agent create; got ${response.status}`,
    );
  }
  const location = response.headers.get("Location");
  if (!location) {
    throw new MbnApiError(
      502,
      "missing-location",
      "API did not return a Location header for the new operation",
    );
  }
  const opId = location.split("/").pop();
  if (!opId) {
    throw new MbnApiError(
      502,
      "invalid-location",
      `Location header has no opId: ${location}`,
    );
  }
  return { opId };
}

// ─── Operations (poll) ────────────────────────────────────────────────

export async function getOperation(opId: string): Promise<Operation> {
  const { envelope } = await callApi<RequestEnvelope<Operation>>(
    `/v1/operations/${encodeURIComponent(opId)}`,
  );
  return envelope.data;
}

// ─── Blueprint deploy (async) ─────────────────────────────────────────

export interface DeployBlueprintInput {
  deploymentId: string;
  agentId: string;
  blueprintId: string;
  variables: Record<string, string>;
  requestId: string;
  acknowledgeSharedInfrastructure?: boolean;
}

export interface DeployBlueprintResult {
  opId: string;
  requestId: string;
}

export async function deployBlueprint(
  input: DeployBlueprintInput,
): Promise<DeployBlueprintResult> {
  // For blueprint deploys the body's `requestId` IS the canonical replay
  // key — server-side dispatchBlueprintDeploy short-circuits on the
  // matching subcollection doc. Reusing it for the HTTP Idempotency-Key
  // keeps the two layers in lock-step: same requestId → same deploy.
  const { response } = await callApi<unknown>(
    `/v1/deployments/${encodeURIComponent(input.deploymentId)}/blueprint-deploys`,
    {
      method: "POST",
      idempotencyKey: input.requestId,
      body: JSON.stringify({
        blueprintId: input.blueprintId,
        agentId: input.agentId,
        variables: input.variables,
        requestId: input.requestId,
        ...(input.acknowledgeSharedInfrastructure !== undefined
          ? { acknowledgeSharedInfrastructure: input.acknowledgeSharedInfrastructure }
          : {}),
      }),
    },
  );
  if (response.status !== 202) {
    throw new MbnApiError(
      response.status,
      "unexpected-status",
      `Expected 202 Accepted on blueprint deploy; got ${response.status}`,
    );
  }
  const location = response.headers.get("Location");
  if (!location) {
    throw new MbnApiError(
      502,
      "missing-location",
      "API did not return a Location header for the deploy operation",
    );
  }
  const opId = location.split("/").pop();
  if (!opId) {
    throw new MbnApiError(
      502,
      "invalid-location",
      `Location header has no opId: ${location}`,
    );
  }
  return { opId, requestId: input.requestId };
}

export async function getBlueprintDeploy(
  deploymentId: string,
  requestId: string,
): Promise<BlueprintDeployRecord> {
  const { envelope } = await callApi<RequestEnvelope<{ deploy: BlueprintDeployRecord }>>(
    `/v1/deployments/${encodeURIComponent(deploymentId)}/blueprint-deploys/${encodeURIComponent(requestId)}`,
  );
  return envelope.data.deploy;
}
