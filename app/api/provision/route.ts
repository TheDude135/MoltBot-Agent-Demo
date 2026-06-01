// POST /api/provision — orchestrates a full "create agent + deploy
// blueprint" sequence and returns the requestId the client should poll.
//
// Steps (all server-side):
//   1. Validate the input shape.
//   2. POST /v1/deployments/:depId/agents (async; returns opId).
//   3. Poll /v1/operations/:opId until terminal or 90 s timeout.
//   4. If succeeded, POST /v1/deployments/:depId/blueprint-deploys
//      with the same agentId and a fresh requestId.
//   5. Return { agentId, requestId } to the browser.
//
// Polling lives here (not in the browser) so the client only sees a
// single async response, and so we never leak the API key into the
// client bundle.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createAgent,
  deployBlueprint,
  getOperation,
  MbnApiError,
} from "@/lib/mbn-client";
import { isValidAgentId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ProvisionInputSchema = z.object({
  deploymentId: z.string().min(1).max(100),
  agentId: z
    .string()
    .min(1)
    .max(32)
    .refine(isValidAgentId, "agentId must be lowercase alnum + single hyphens"),
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(20),
  blueprintId: z.string().min(1).max(100),
  variables: z.record(z.string()),
  requestId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid requestId"),
});

const AGENT_CREATE_POLL_INTERVAL_MS = 2000;
// Fleet-agent typically completes a sub-agent create in 30–60 s, but
// a sleepy or recently-restarted host can take longer on cold start.
// 3 minutes is the same cap the dashboard's Create & Deploy flow uses.
const AGENT_CREATE_POLL_TIMEOUT_MS = 180_000;

function problem(
  status: number,
  message: string,
  code: string,
  extras?: Record<string, unknown>,
) {
  return NextResponse.json({ error: message, code, ...(extras ?? {}) }, { status });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "Body must be JSON", "validation-failed");
  }

  const parsed = ProvisionInputSchema.safeParse(body);
  if (!parsed.success) {
    return problem(
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      "validation-failed",
    );
  }
  const input = parsed.data;

  // ── Step 1: create the agent ────────────────────────────────────────
  let createOpId: string;
  try {
    // Derive a deterministic Idempotency-Key from the client's requestId
    // so a /api/provision retry with the same payload doesn't create a
    // duplicate agent. We prefix with `agent-` so it doesn't collide
    // with the deployBlueprint key (which IS the raw requestId — that
    // call's body differs, so the server would reject a shared key).
    const created = await createAgent({
      deploymentId: input.deploymentId,
      agentId: input.agentId,
      name: input.name,
      emoji: input.emoji,
      idempotencyKey: `agent-${input.requestId}`,
    });
    createOpId = created.opId;
  } catch (err) {
    if (err instanceof MbnApiError) {
      return problem(err.status, err.message, err.problemType, {
        step: "create-agent",
      });
    }
    return problem(500, (err as Error).message, "unknown", { step: "create-agent" });
  }

  // ── Step 2: poll the create operation until terminal ────────────────
  const deadline = Date.now() + AGENT_CREATE_POLL_TIMEOUT_MS;
  let createOp;
  while (true) {
    try {
      createOp = await getOperation(createOpId);
    } catch (err) {
      if (err instanceof MbnApiError) {
        return problem(err.status, err.message, err.problemType, {
          step: "poll-create",
          opId: createOpId,
        });
      }
      return problem(500, (err as Error).message, "unknown", {
        step: "poll-create",
        opId: createOpId,
      });
    }
    if (createOp.status !== "pending") break;
    if (Date.now() > deadline) {
      return problem(
        504,
        `Agent creation did not finish within ${AGENT_CREATE_POLL_TIMEOUT_MS / 1000}s. Check the Operation later.`,
        "gateway-timeout",
        { step: "poll-create", opId: createOpId },
      );
    }
    await sleep(AGENT_CREATE_POLL_INTERVAL_MS);
  }

  if (createOp.status === "failed") {
    return problem(
      502,
      createOp.error?.message ?? "Agent creation failed.",
      createOp.error?.code ?? "create-failed",
      { step: "create-agent", opId: createOpId },
    );
  }

  // ── Step 3: deploy the blueprint to the new agent ───────────────────
  try {
    await deployBlueprint({
      deploymentId: input.deploymentId,
      agentId: input.agentId,
      blueprintId: input.blueprintId,
      variables: input.variables,
      requestId: input.requestId,
      acknowledgeSharedInfrastructure: true,
    });
  } catch (err) {
    if (err instanceof MbnApiError) {
      return problem(err.status, err.message, err.problemType, {
        step: "deploy-blueprint",
      });
    }
    return problem(500, (err as Error).message, "unknown", {
      step: "deploy-blueprint",
    });
  }

  return NextResponse.json({
    deploymentId: input.deploymentId,
    agentId: input.agentId,
    requestId: input.requestId,
  });
}
