// POST /api/install-app — install a marketplace app (Wix Bookings) on a
// voice deployment, then list to confirm it landed. Exercises both
// POST /apps and GET /apps so the demo proves the full read+write path.
//
// Server-only: the Bearer key (which must carry `voice:apps` + the voice
// deployment's per-instance scope) stays in env, never reaches the client.
// The HMAC secret is never returned by the API — the gateway self-fetches
// it on its next config poll.

import { NextResponse } from "next/server";
import { z } from "zod";
import { installApp, listApps, TtmaApiError } from "@/lib/ttma-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({
  voiceDeploymentId: z.string().min(1).max(128),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]{0,63}$/, "slug must be lowercase [a-z][a-z0-9-]")
    .default("wix-bookings"),
  config: z
    .object({
      siteUrl: z.string().url("siteUrl must be an https URL"),
      businessName: z.string().optional(),
      timezone: z.string().optional(),
    })
    .passthrough(),
  /** Per-attempt logical id from the client → deterministic Idempotency-Key. */
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

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return problem(
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      "validation-failed",
    );
  }
  const input = parsed.data;

  // ── Install the app (POST /apps) ───────────────────────────────────
  let app;
  try {
    app = await installApp({
      voiceDeploymentId: input.voiceDeploymentId,
      slug: input.slug,
      config: input.config,
      idempotencyKey: `app-${input.requestId}`,
    });
  } catch (err) {
    if (err instanceof TtmaApiError) {
      return problem(err.status, err.message, err.problemType, { step: "install-app" });
    }
    return problem(500, (err as Error).message, "unknown", { step: "install-app" });
  }

  // ── Confirm via GET /apps (read path). Non-fatal if it hiccups. ────
  let apps: Awaited<ReturnType<typeof listApps>> = [];
  try {
    apps = await listApps(input.voiceDeploymentId);
  } catch {
    // Best-effort confirmation; the install already succeeded above.
  }

  return NextResponse.json(
    { app, apps },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
