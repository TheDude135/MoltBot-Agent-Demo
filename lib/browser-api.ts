// Browser-side client for the demo's own /api/* routes. Centralizes the
// fetch -> parse-JSON -> check-status -> extract-error pattern so every caller
// (the flow hooks) shares one implementation and one error shape.
//
// Security: the bearer API key never lives here. These functions talk only to
// the demo's same-origin Next.js routes, which hold the key server-side and
// proxy upstream. Nothing in this module reaches MoltBot Ninja directly.

import type {
  Blueprint,
  BlueprintDeployRecord,
  Deployment,
  VoiceDeployment,
  VoiceOperation,
} from "./types";

/**
 * Error thrown by any client call. Carries the HTTP status and the optional
 * API error `code`/`step` so callers can branch on them (e.g. a recoverable
 * agent-id collision) instead of string-matching messages.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly step?: string;

  constructor(
    message: string,
    opts: { status?: number; code?: string; step?: string } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status ?? 0;
    this.code = opts.code;
    this.step = opts.step;
  }
}

/** True for the recoverable "that agentId is already taken" provision failure. */
export function isAgentIdTakenError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 409 || err.code === "agent-id-taken")
  );
}

/** Coerce any thrown value to a display string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Parse a JSON body, tolerating empty/non-JSON responses so an error page
// without a JSON body still yields a usable fallback message.
async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorText(body: Record<string, unknown>): string | undefined {
  return typeof body.error === "string" ? body.error : undefined;
}

function str(body: Record<string, unknown>, key: string): string | undefined {
  return typeof body[key] === "string" ? (body[key] as string) : undefined;
}

// Throw a uniform ApiError from a non-OK response: prefer the server's `error`
// text, fall back to a per-call message, and carry status (+ optional code/step).
function fail(
  res: Response,
  body: Record<string, unknown>,
  fallback: string,
  extra: { code?: string; step?: string } = {},
): never {
  throw new ApiError(errorText(body) ?? fallback, {
    status: res.status,
    ...extra,
  });
}

// Encode a single path segment so an id never breaks out of the URL path. The
// ids we send are server-generated/validated, but encoding is defense-in-depth.
function seg(value: string): string {
  return encodeURIComponent(value);
}

// ── Catalog ──────────────────────────────────────────────────────────

export async function getBlueprints(): Promise<Blueprint[]> {
  const res = await fetch("/api/blueprints", { cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) fail(res, body, `Blueprints HTTP ${res.status}`);
  return (body as { blueprints?: Blueprint[] }).blueprints ?? [];
}

export async function getDeployments(): Promise<Deployment[]> {
  const res = await fetch("/api/deployments", { cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) fail(res, body, `Deployments HTTP ${res.status}`);
  return (body as { deployments?: Deployment[] }).deployments ?? [];
}

// ── Site introspection ───────────────────────────────────────────────

export interface IntrospectResult {
  canonicalUrl: string;
  businessName: string;
  serviceCount: number;
  staffCount: number;
  variables: Record<string, string>;
}

/** `url` should already be trimmed by the caller. */
export async function introspectSite(url: string): Promise<IntrospectResult> {
  const res = await fetch("/api/introspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    fail(res, body, `Could not introspect (${res.status}).`, {
      code: str(body, "code"),
    });
  }
  return body as unknown as IntrospectResult;
}

// ── Provision (create agent + deploy blueprint) ──────────────────────

export interface ProvisionPayload {
  deploymentId: string;
  agentId: string;
  name: string;
  emoji: string;
  blueprintId: string;
  variables: Record<string, string>;
  requestId: string;
}

export interface ProvisionResult {
  requestId: string;
  deploymentId: string;
  agentId: string;
}

export async function provisionAgent(
  payload: ProvisionPayload,
): Promise<ProvisionResult> {
  const res = await fetch("/api/provision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const step = str(body, "step");
    fail(res, body, `Provision failed (${res.status})${step ? ` at ${step}` : ""}`, {
      code: str(body, "code"),
      step,
    });
  }
  return body as unknown as ProvisionResult;
}

// ── Deploy progress ──────────────────────────────────────────────────

export async function getDeployProgress(
  deploymentId: string,
  requestId: string,
): Promise<BlueprintDeployRecord> {
  const res = await fetch(`/api/progress/${seg(deploymentId)}/${seg(requestId)}`, {
    cache: "no-store",
  });
  const body = await readJson(res);
  if (!res.ok) fail(res, body, `HTTP ${res.status}`);
  return (body as { deploy: BlueprintDeployRecord }).deploy;
}

// ── AI file-seeding (best-effort persona enrichment) ─────────────────

export interface SeedFilesPayload {
  deploymentId: string;
  agentId: string;
  siteUrl: string;
  requestId: string;
}

export interface SeedFileEntry {
  path: string;
  status: string;
}

export interface SeedFilesResult {
  seeded: boolean;
  files?: SeedFileEntry[];
  message?: string;
}

export async function seedFiles(
  payload: SeedFilesPayload,
): Promise<SeedFilesResult> {
  const res = await fetch("/api/seed-files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) fail(res, body, `Seeding request failed (${res.status}).`);
  return body as unknown as SeedFilesResult;
}

// ── Voice install ────────────────────────────────────────────────────

export async function getVoiceDeployments(): Promise<VoiceDeployment[]> {
  const res = await fetch("/api/voice-deployments", { cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) {
    fail(res, body, `Could not load voice deployments (HTTP ${res.status}).`);
  }
  return (body as { deployments?: VoiceDeployment[] }).deployments ?? [];
}

export interface InstallAppPayload {
  voiceDeploymentId: string;
  slug: string;
  config: Record<string, unknown>;
  requestId: string;
}

export async function installApp(payload: InstallAppPayload): Promise<void> {
  const res = await fetch("/api/install-app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) fail(res, body, `Wix app install failed (HTTP ${res.status}).`);
}

export interface InstallVoicePayload {
  fleetDeploymentId: string;
  agentId: string;
  voiceDeploymentId: string;
  forceReinstall: boolean;
  requestId: string;
}

export interface InstallVoiceResult {
  opId: string;
  phoneNumber: string | null;
}

export async function installVoice(
  payload: InstallVoicePayload,
): Promise<InstallVoiceResult> {
  const res = await fetch("/api/install-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) fail(res, body, `Install dispatch failed (HTTP ${res.status}).`);
  return body as unknown as InstallVoiceResult;
}

export async function getVoiceOperation(opId: string): Promise<VoiceOperation> {
  const res = await fetch(`/api/voice-operation/${seg(opId)}`, {
    cache: "no-store",
  });
  const body = await readJson(res);
  if (!res.ok) fail(res, body, `HTTP ${res.status}`);
  return (body as { operation: VoiceOperation }).operation;
}
