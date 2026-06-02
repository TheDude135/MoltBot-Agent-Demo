// GET /api/voice-operation/:opId — proxy to Ninja `GET /v1/operations/:opId`.
//
// Used by the demo's InstallVoicePhase to poll the install operation
// until it reaches a terminal state (succeeded | failed). Mirrors
// `/api/progress` for blueprint deploys but reads operations directly
// instead of the blueprint-deploys collection.
//
// We pass-through the operation envelope unchanged so the client gets
// the full shape including `result` + `error`.

import { NextResponse } from "next/server";
import { getOperation, MbnApiError } from "@/lib/mbn-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OP_ID_REGEX = /^op_[A-Za-z0-9_-]{8,64}$/;

export async function GET(
  _request: Request,
  { params }: { params: { opId: string } },
) {
  const opId = params.opId;
  if (!opId || !OP_ID_REGEX.test(opId)) {
    return NextResponse.json(
      { error: "Invalid opId format", code: "validation-failed" },
      { status: 400 },
    );
  }

  try {
    const operation = await getOperation(opId);
    return NextResponse.json(
      { operation },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof MbnApiError) {
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
