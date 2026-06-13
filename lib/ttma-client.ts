// Server-only HTTP wrapper around the TTMA voice-api at
// `api.talktomyagent.io`. Mirrors the patterns in `mbn-client.ts`:
// Bearer auth, RFC-7807 error parsing, `Idempotency-Key` on non-GET.
//
// Siloed key model: this client uses the TTMA-silo key (`ttmaApiKey` from
// lib/config.ts — TTMA_API_KEY, with a legacy MBN_API_KEY fallback). The
// key must carry the TTMA voice scopes (voice:read, voice:apps,
// voice:install-bundles) and be scoped to the target voice deployment.
// The Ninja key never reaches this client, and vice-versa.

import "server-only";
import { getConfig } from "./config";
import type { InstallBundle, VoiceDeployment } from "./types";

export class TtmaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problemType: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "TtmaApiError";
  }
}

interface RequestEnvelope<T> {
  data: T;
}

// `mintInstallBundle` calls into `mintInstallTokenCore` which can spend
// up to ~10-12 s including `autoProvisionTunnel`. Bumped from the demo
// default to leave headroom on cold-start.
const DEFAULT_TIMEOUT_MS = 30_000;

async function callTtma<T>(
  pathAndQuery: string,
  init: RequestInit & { timeoutMs?: number; idempotencyKey?: string } = {},
): Promise<{ envelope: T; response: Response }> {
  const { ttmaApiBase, ttmaApiKey } = getConfig();
  if (!ttmaApiKey) {
    throw new TtmaApiError(
      500,
      "ttma-key-missing",
      "TTMA_API_KEY (or legacy MBN_API_KEY) is not set — the voice + Wix flow needs a TTMA-scoped key.",
    );
  }
  const url = new URL(pathAndQuery, ttmaApiBase).toString();
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const method = (init.method ?? "GET").toUpperCase();
  const needsIdempotencyKey = method !== "GET" && method !== "HEAD";

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${ttmaApiKey}`,
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
      throw new TtmaApiError(
        504,
        "gateway-timeout",
        `TTMA request timed out after ${timeoutMs}ms`,
      );
    }
    // Log the real cause server-side; return a generic message so we never
    // leak internal connection detail / hostnames to the browser.
    console.error("[ttma-client] network failure:", err);
    throw new TtmaApiError(502, "bad-gateway", "Upstream request failed.");
  } finally {
    clearTimeout(timer);
  }

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
    throw new TtmaApiError(response.status, problemType, message, body);
  }

  if (response.status === 204) {
    return { envelope: { data: null } as unknown as T, response };
  }

  const envelope = (await response.json()) as T;
  return { envelope, response };
}

// ─── Voice deployments (read) ────────────────────────────────────────

/** List voice deployments owned by the caller, scoped by their key's
 *  `deploymentIds` (per-instance scope intersection happens server-side). */
export async function listVoiceDeployments(): Promise<VoiceDeployment[]> {
  const { envelope } = await callTtma<RequestEnvelope<{ deployments: VoiceDeployment[] }>>(
    `/v1/voice-deployments`,
  );
  return envelope.data.deployments;
}

// ─── Install bundle (sync mint) ──────────────────────────────────────

export interface MintInstallBundleInput {
  voiceDeploymentId: string;
  agentId: string;
  /** When true, override the "gateway already running" guard. The current
   *  gateway's HMAC secret will be rotated and the agent will need to be
   *  reinstalled. */
  forceReinstall?: boolean;
  /** Customer-supplied Gemini API key — required for BYOK voice
   *  deployments, forbidden for platform-mode. The server returns a clear
   *  400 either way; the demo never asks for this. */
  geminiApiKey?: string;
  /** Idempotency-Key header. Replays within 24h return the cached
   *  response verbatim — same token, same `expiresAt`. */
  idempotencyKey: string;
}

/** POST /v1/voice-deployments/:vid/install-bundles — synchronous 200. */
export async function mintInstallBundle(
  input: MintInstallBundleInput,
): Promise<InstallBundle> {
  const { envelope } = await callTtma<RequestEnvelope<{ installBundle: InstallBundle }>>(
    `/v1/voice-deployments/${encodeURIComponent(input.voiceDeploymentId)}/install-bundles`,
    {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({
        agentId: input.agentId,
        forceReinstall: input.forceReinstall === true,
        ...(input.geminiApiKey ? { geminiApiKey: input.geminiApiKey } : {}),
      }),
    },
  );
  return envelope.data.installBundle;
}

// ─── Marketplace app install (sync) ──────────────────────────────────
//
// Requires the `voice:apps` scope (in addition to the per-instance scope
// on the voiceDeploymentId). The HMAC secret is NEVER returned — the
// gateway self-fetches it on its next config poll, so installing the app
// before voice means the booking tool is live from the gateway's first
// poll.

export interface InstallAppInput {
  voiceDeploymentId: string;
  /** App catalog slug, e.g. "wix-bookings". */
  slug: string;
  /** Per-slug config. For wix-bookings: { siteUrl (https, public host),
   *  businessName?, timezone? (IANA), language?, wixAppId? }. */
  config: Record<string, unknown>;
  /** Idempotency-Key header. Replays within 24h return the cached response. */
  idempotencyKey: string;
}

export interface InstalledApp {
  slug: string;
  status: string;
  /** true on a fresh create (201), false on an idempotent re-install (200). */
  created: boolean;
}

/** POST /v1/voice-deployments/:vid/apps — install a marketplace app.
 *  201 on first install, 200 on idempotent same-config re-install, 409
 *  (app-config-conflict) if the slug exists with a different config. */
export async function installApp(input: InstallAppInput): Promise<InstalledApp> {
  const { envelope } = await callTtma<RequestEnvelope<{ app: InstalledApp }>>(
    `/v1/voice-deployments/${encodeURIComponent(input.voiceDeploymentId)}/apps`,
    {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({ slug: input.slug, config: input.config }),
    },
  );
  return envelope.data.app;
}

/** PATCH /v1/voice-deployments/:vid/apps/:slug — reconfigure an already-installed
 *  app's config (e.g. point wix-bookings at a different site). The HMAC secret is
 *  untouched; the gateway picks up the new config on its next poll. */
export async function reconfigureApp(input: InstallAppInput): Promise<InstalledApp> {
  const { envelope } = await callTtma<
    RequestEnvelope<{ app: { slug: string; status: string } }>
  >(
    `/v1/voice-deployments/${encodeURIComponent(input.voiceDeploymentId)}/apps/${encodeURIComponent(input.slug)}`,
    {
      method: "PATCH",
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({ config: input.config }),
    },
  );
  // Normalize to InstalledApp: a reconfigure is not a fresh create.
  return { slug: envelope.data.app.slug, status: envelope.data.app.status, created: false };
}

/** Install the app, or reconfigure it if one already exists for this number with
 *  a DIFFERENT config — i.e. the number was reused for a different business/site.
 *  Result: the app always ends up pointing at `config`, so a fresh deploy on a
 *  reused number "just works" instead of failing with app-config-conflict.
 *
 *  Why the demo (not the API) does this: the install endpoint is intentionally
 *  strict ("accept-if-same", never silently clobber a different config). The
 *  deploy orchestrator is the right place to decide install-vs-reconfigure. */
export async function ensureApp(input: InstallAppInput): Promise<InstalledApp> {
  try {
    return await installApp(input);
  } catch (err) {
    if (err instanceof TtmaApiError && err.problemType === "app-config-conflict") {
      // Distinct Idempotency-Key so the reconfigure is not conflated with the
      // failed install replay under the same key.
      return await reconfigureApp({
        ...input,
        idempotencyKey: `${input.idempotencyKey}-reconfigure`,
      });
    }
    throw err;
  }
}

export interface InstalledAppSummary {
  slug: string;
  status: string;
  config: {
    siteUrl: string | null;
    businessName?: string;
    timezone?: string;
    language?: string;
  };
  installedAt: string | null;
}

/** GET /v1/voice-deployments/:vid/apps — list installed apps. No secrets. */
export async function listApps(
  voiceDeploymentId: string,
): Promise<InstalledAppSummary[]> {
  const { envelope } = await callTtma<RequestEnvelope<{ apps: InstalledAppSummary[] }>>(
    `/v1/voice-deployments/${encodeURIComponent(voiceDeploymentId)}/apps`,
  );
  return envelope.data.apps;
}
