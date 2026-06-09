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
  InstallBundle,
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
  const { apiBase, ninjaApiKey } = getConfig();
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
        Authorization: `Bearer ${ninjaApiKey}`,
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

// ─── Voice install dispatch (async; returns opId via Location) ───────

export interface InstallVoiceInput {
  fleetDeploymentId: string;
  agentId: string;
  installBundle: InstallBundle;
  forceReinstall?: boolean;
  /** Deterministic per logical install attempt. The body's `installBundle.token`
   *  is single-use; once the bundle expires (15 min) a fresh mint is required. */
  idempotencyKey: string;
}

export async function installVoice(input: InstallVoiceInput): Promise<{ opId: string }> {
  const { response } = await callApi<unknown>(
    `/v1/deployments/${encodeURIComponent(input.fleetDeploymentId)}/agents/${encodeURIComponent(input.agentId)}/voice-installs`,
    {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({
        installBundle: input.installBundle,
        forceReinstall: input.forceReinstall === true,
      }),
    },
  );
  if (response.status !== 202) {
    throw new MbnApiError(
      response.status,
      "unexpected-status",
      `Expected 202 Accepted on voice install; got ${response.status}`,
    );
  }
  const location = response.headers.get("Location");
  if (!location) {
    throw new MbnApiError(
      502,
      "missing-location",
      "API did not return a Location header for the install operation",
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

export interface UninstallVoiceInput {
  fleetDeploymentId: string;
  agentId: string;
  installId: string;
  idempotencyKey: string;
}

export async function uninstallVoice(input: UninstallVoiceInput): Promise<{ opId: string }> {
  const { response } = await callApi<unknown>(
    `/v1/deployments/${encodeURIComponent(input.fleetDeploymentId)}/agents/${encodeURIComponent(input.agentId)}/voice-installs/${encodeURIComponent(input.installId)}`,
    {
      method: "DELETE",
      idempotencyKey: input.idempotencyKey,
    },
  );
  if (response.status !== 202) {
    throw new MbnApiError(
      response.status,
      "unexpected-status",
      `Expected 202 Accepted on voice uninstall; got ${response.status}`,
    );
  }
  const location = response.headers.get("Location");
  if (!location) {
    throw new MbnApiError(
      502,
      "missing-location",
      "API did not return a Location header for the uninstall operation",
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

// ─── Agent detail (for back-pointer surface after install completes) ─

import type { AgentVoiceBackPointer } from "./types";

export interface AgentRecord {
  agentId: string;
  name: string;
  emoji: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  telegramUsername: string | null;
  voice: AgentVoiceBackPointer | null;
}

export async function getAgent(
  deploymentId: string,
  agentId: string,
): Promise<AgentRecord> {
  const { envelope } = await callApi<RequestEnvelope<{ agent: AgentRecord }>>(
    `/v1/deployments/${encodeURIComponent(deploymentId)}/agents/${encodeURIComponent(agentId)}`,
  );
  return envelope.data.agent;
}

// ─── Agent workspace files (read + async write) ───────────────────────
//
// GET  /v1/.../files/:path        → current content + sha256 (mirror, ≤5min lag)
// PUT  /v1/.../files/:path        → 202 + Location:/v1/operations/:opId (async)
//
// The write requires `files:write` scope on the API key. The PUT body
// carries `expectedSha256` for optimistic concurrency: it must equal the
// CURRENT mirror sha, OR sha256("") when the file doesn't exist yet. The
// seeding flow reads the file first to learn its sha (the blueprint deploy
// has already written a templated SOUL.md/AGENTS.md/etc), then overwrites
// it with the richer AI-generated content. The fleet-agent backs up the
// prior content (.bak.<ms>) before writing, so an overwrite is recoverable.

/** sha256 of the empty string — the sentinel for "create a file that does
 *  not exist yet". Must match functions/.../file-actions-service.ts. */
export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface AgentFileContent {
  path: string;
  content: string;
  sha256: string;
  writable: boolean;
}

/**
 * Read one workspace file. Returns null on 404 (file not mirrored yet /
 * does not exist) so the caller can fall back to EMPTY_SHA256 for a
 * create. Any other API error propagates.
 */
export async function getAgentFile(
  deploymentId: string,
  agentId: string,
  filePath: string,
): Promise<AgentFileContent | null> {
  try {
    const { envelope } = await callApi<RequestEnvelope<AgentFileContent>>(
      `/v1/deployments/${encodeURIComponent(deploymentId)}/agents/${encodeURIComponent(agentId)}/files/${encodeFilePath(filePath)}`,
    );
    return envelope.data;
  } catch (err) {
    if (err instanceof MbnApiError && err.status === 404) return null;
    throw err;
  }
}

export interface PutAgentFileInput {
  deploymentId: string;
  agentId: string;
  filePath: string;
  content: string;
  /** Current mirror sha, or EMPTY_SHA256 to create. */
  expectedSha256: string;
  /** Deterministic per logical write so a retry is replay-safe. */
  idempotencyKey: string;
}

/**
 * Overwrite (or create) one workspace file. Async: returns the opId of the
 * operation to poll via getOperation(). The API serializes file actions
 * per deployment (409 resource-in-flight if another write is mid-apply),
 * so the seeding orchestration writes files ONE AT A TIME, polling each to
 * terminal before starting the next.
 */
export async function putAgentFile(
  input: PutAgentFileInput,
): Promise<{ opId: string }> {
  const { response } = await callApi<unknown>(
    `/v1/deployments/${encodeURIComponent(input.deploymentId)}/agents/${encodeURIComponent(input.agentId)}/files/${encodeFilePath(input.filePath)}`,
    {
      method: "PUT",
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({
        content: input.content,
        expectedSha256: input.expectedSha256,
      }),
    },
  );
  if (response.status !== 202) {
    throw new MbnApiError(
      response.status,
      "unexpected-status",
      `Expected 202 Accepted on file write; got ${response.status}`,
    );
  }
  const location = response.headers.get("Location");
  if (!location) {
    throw new MbnApiError(
      502,
      "missing-location",
      "API did not return a Location header for the file-write operation",
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

/**
 * Encode a workspace-relative file path for the URL. The path may contain
 * slashes (e.g. `protocols/dojo-voice-agent-playbook.md`) that are
 * meaningful route separators on the `:filePath{.+}` wildcard, so encode
 * each SEGMENT but keep the slashes literal. Spaces / unicode etc. in a
 * segment get percent-encoded; the API's own validator re-checks the
 * decoded path.
 */
function encodeFilePath(filePath: string): string {
  return filePath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}
