// GET /api/deployments — proxies to MBN GET /v1/deployments so the
// browser can render a target-deployment dropdown. Only operational
// deployments are useful for deploys; the UI filters further.

import { NextResponse } from "next/server";
import { listDeployments, MbnApiError } from "@/lib/mbn-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const deployments = await listDeployments();
    return NextResponse.json({ deployments });
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
