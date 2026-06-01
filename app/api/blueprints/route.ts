// GET /api/blueprints — proxies to MBN GET /v1/blueprints.
// Browser-callable; the API key stays on the server side of this route.

import { NextResponse } from "next/server";
import { listBlueprints, MbnApiError } from "@/lib/mbn-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const blueprints = await listBlueprints(50);
    return NextResponse.json({ blueprints });
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
