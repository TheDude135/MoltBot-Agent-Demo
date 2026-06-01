// POST /api/introspect — introspect a Wix Bookings site and return
// pre-fillable values for the demo's blueprint variables.
//
// Lives in the demo app, not in MoltBot Ninja. This route makes
// outbound calls to wix.com endpoints (anonymous visitor-token flow);
// it does NOT touch the Ninja API. Customers building their own
// integration write their own version of this for their own data
// source (Shopify, Square, CSV, etc.).

import { NextResponse } from "next/server";
import { z } from "zod";
import { introspectSite } from "@/lib/wix-introspect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({
  url: z.string().trim().min(3).max(500),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON", code: "validation-failed" },
      { status: 400 },
    );
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        code: "validation-failed",
      },
      { status: 400 },
    );
  }

  const result = await introspectSite(parsed.data.url);

  if (!result.ok) {
    // Use 422 (Unprocessable Entity): syntactically valid input but the
    // remote site can't be introspected. Distinct from 400 (bad body).
    return NextResponse.json(
      {
        error: result.message,
        code: result.reason,
        canonicalUrl: result.canonicalUrl,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    canonicalUrl: result.canonicalUrl,
    businessName: result.businessName,
    serviceCount: result.serviceCount,
    staffCount: result.staffCount,
    variables: result.variables,
  });
}
