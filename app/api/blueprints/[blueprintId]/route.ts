// GET /api/blueprints/:blueprintId — proxies to MBN.
// Browser uses this to load a blueprint's variable schema before
// rendering the variable form.

import { NextResponse } from "next/server";
import { getBlueprint, MbnApiError } from "@/lib/mbn-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLUEPRINT_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ blueprintId: string }> },
) {
  const { blueprintId } = await params;
  if (!BLUEPRINT_ID_REGEX.test(blueprintId)) {
    return NextResponse.json(
      { error: "Invalid blueprintId format", code: "validation-failed" },
      { status: 400 },
    );
  }

  try {
    const blueprint = await getBlueprint(blueprintId);
    return NextResponse.json({ blueprint });
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
