// GET /api/progress/:deploymentId/:requestId — proxies to MBN
// GET /v1/deployments/:depId/blueprint-deploys/:requestId so the
// browser can poll the live Phase-2 step list without holding the
// API key.

import { NextResponse } from "next/server";
import { getBlueprintDeploy, MbnApiError } from "@/lib/mbn-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEPLOYMENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;
const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deploymentId: string; requestId: string }> },
) {
  const { deploymentId, requestId } = await params;
  if (!DEPLOYMENT_ID_REGEX.test(deploymentId)) {
    return NextResponse.json(
      { error: "Invalid deploymentId", code: "validation-failed" },
      { status: 400 },
    );
  }
  if (!REQUEST_ID_REGEX.test(requestId)) {
    return NextResponse.json(
      { error: "Invalid requestId", code: "validation-failed" },
      { status: 400 },
    );
  }

  try {
    const deploy = await getBlueprintDeploy(deploymentId, requestId);
    return NextResponse.json({ deploy });
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
