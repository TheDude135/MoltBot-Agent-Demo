// POST /api/install-voice — orchestrates the two-call install bundle
// flow and returns the Ninja operation id the client should poll.
//
// Steps (all server-side):
//   1. Validate the input shape.
//   2. POST TTMA `/v1/voice-deployments/:vid/install-bundles` — mints
//      a one-time install token + the bundle's metadata (phoneNumber,
//      voiceDeploymentId, agentId, expiresAt). Synchronous 200.
//   3. POST Ninja `/v1/deployments/:fleet/agents/:agentId/voice-installs`
//      forwarding the bundle verbatim. Returns 202 + opId.
//   4. Return { opId, phoneNumber } to the client.
//
// The two HTTP `Idempotency-Key` headers are deterministic-per-flow:
//   - bundle-${requestId} for the TTMA mint
//   - install-${requestId} for the Ninja dispatch
// so a /api/install-voice retry with the same body is end-to-end
// replay-safe. The TTMA mint cache is 24h; the Ninja dispatch is the
// same. Within that window, retries return the same operation id.

import { NextResponse } from "next/server";
import { z } from "zod";
import { installVoice, MbnApiError } from "@/lib/mbn-client";
import { mintInstallBundle, TtmaApiError } from "@/lib/ttma-client";
import { isValidAgentId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InstallVoiceInputSchema = z.object({
  fleetDeploymentId: z.string().min(1).max(100),
  agentId: z
    .string()
    .min(1)
    .max(32)
    .refine(isValidAgentId, "agentId must be lowercase alnum + single hyphens"),
  voiceDeploymentId: z.string().min(1).max(128),
  /** Override the "gateway already running" guard on the TTMA mint. Optional
   *  on the wire (absent == false); the demo's "Install Voice" button sends
   *  `true` so it can reinstall over a running gateway. */
  forceReinstall: z.boolean().optional(),
  /** Per-attempt logical id from the client. Same id → same operation. */
  requestId: z
    .string()
    .min(8)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid requestId"),
});

function problem(
  status: number,
  message: string,
  code: string,
  extras?: Record<string, unknown>,
) {
  return NextResponse.json({ error: message, code, ...(extras ?? {}) }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "Body must be JSON", "validation-failed");
  }

  const parsed = InstallVoiceInputSchema.safeParse(body);
  if (!parsed.success) {
    return problem(
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      "validation-failed",
    );
  }
  const input = parsed.data;

  // ── Step 1: mint the install bundle at TTMA ────────────────────────
  let installBundle;
  try {
    installBundle = await mintInstallBundle({
      voiceDeploymentId: input.voiceDeploymentId,
      agentId: input.agentId,
      forceReinstall: input.forceReinstall,
      idempotencyKey: `bundle-${input.requestId}`,
    });
  } catch (err) {
    if (err instanceof TtmaApiError) {
      return problem(err.status, err.message, err.problemType, { step: "mint-bundle" });
    }
    return problem(500, (err as Error).message, "unknown", { step: "mint-bundle" });
  }

  // ── Step 2: dispatch the install at Ninja ──────────────────────────
  let dispatchOpId: string;
  try {
    const r = await installVoice({
      fleetDeploymentId: input.fleetDeploymentId,
      agentId: input.agentId,
      installBundle,
      // The TTMA mint already enforced its own forceReinstall (rotated
      // the HMAC secret) — at the Ninja side we want the dispatch to
      // succeed even if the agent already has a stale `voice` field
      // (otherwise the customer is stuck after their first install).
      // Same semantic the TTMA portal flow uses.
      forceReinstall: input.forceReinstall === true,
      idempotencyKey: `install-${input.requestId}`,
    });
    dispatchOpId = r.opId;
  } catch (err) {
    if (err instanceof MbnApiError) {
      return problem(err.status, err.message, err.problemType, { step: "dispatch-install" });
    }
    return problem(500, (err as Error).message, "unknown", { step: "dispatch-install" });
  }

  // The client polls /api/voice-operation/:opId from here. We return
  // the bundle's phoneNumber so the UI can show "Installing voice on
  // +1 …" while polling — useful UX cue for slow installs.
  return NextResponse.json({
    opId: dispatchOpId,
    phoneNumber: installBundle.phoneNumber,
    voiceDeploymentId: installBundle.voiceDeploymentId,
    expiresAt: installBundle.expiresAt,
  });
}
