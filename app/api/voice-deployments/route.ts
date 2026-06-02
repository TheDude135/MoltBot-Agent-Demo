// GET /api/voice-deployments — proxy to TTMA `GET /v1/voice-deployments`.
//
// Surfaces the list intersected with the API key's per-instance scope so
// the demo can show the user a picker of voice deployments they own.
// Server-only — the Bearer key stays in env, never reaches the client.

import { NextResponse } from "next/server";
import { listVoiceDeployments, TtmaApiError } from "@/lib/ttma-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const deployments = await listVoiceDeployments();
    return NextResponse.json(
      { deployments },
      {
        headers: {
          // Customer-private content; do NOT let intermediate caches hold it.
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (err) {
    if (err instanceof TtmaApiError) {
      return NextResponse.json(
        { error: err.message, code: err.problemType },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message, code: "unknown" },
      { status: 500 },
    );
  }
}
