// POST /api/seed-files — AI-seed a freshly-deployed agent's workspace files.
//
// Runs AFTER the blueprint deploy reaches "complete" (the client calls this
// once it sees the deploy finish). Re-introspects the site server-side,
// generates a richer business-tailored SOUL.md persona via the AI seeding
// module, and writes it through the public files PUT. (The booking playbook
// + business data are already seeded by the blueprint; the seeder leaves
// that tuned, safety-sensitive file untouched.)
//
// Degrades gracefully: if AI seeding is disabled (no ANTHROPIC_API_KEY) or
// anything fails, the agent keeps the blueprint's templated files. The
// response always carries enough detail for the UI to show what happened.
//
// Server-only: the Ninja key (which must additionally carry `files:write`)
// stays in env. The Anthropic key never crosses into the Ninja/TTMA silos.

import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidAgentId } from "@/lib/ids";
import { runSeeding } from "@/lib/seed-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Seeding calls Anthropic then writes files (each an async, polled op), so
// it can run a couple of minutes. Raise the platform cap accordingly (no-op
// locally).
export const maxDuration = 300;

const InputSchema = z.object({
  deploymentId: z.string().min(1).max(100),
  agentId: z
    .string()
    .min(1)
    .max(32)
    .refine(isValidAgentId, "agentId must be lowercase alnum + single hyphens"),
  siteUrl: z.string().trim().min(3).max(500),
  requestId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid requestId"),
});

function problem(status: number, message: string, code: string) {
  return NextResponse.json({ error: message, code }, { status });
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

  // runSeeding never throws — it returns a discriminated result. We surface
  // it as 200 either way (seeding is best-effort enrichment, not a hard
  // failure that should fail the whole provisioning UX).
  const result = await runSeeding({
    deploymentId: input.deploymentId,
    agentId: input.agentId,
    siteUrl: input.siteUrl,
    requestId: input.requestId,
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
