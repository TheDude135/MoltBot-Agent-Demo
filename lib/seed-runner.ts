// Seeding orchestration: introspect → AI-generate → write files.
//
// Called AFTER the blueprint deploy reaches "complete" (so the templated
// SOUL.md already exists on the agent). Re-introspects the site SERVER-SIDE
// (so we trust freshly-derived data, never a client-supplied blob), generates
// a richer business-tailored SOUL.md persona, then writes it through the
// public files PUT — ONE AT A TIME, polling each operation to terminal before
// the next (the API serializes file actions per deployment).
//
// Generic over the file set the generator returns (currently just SOUL.md);
// the blueprint already seeds the booking playbook + business data, and we
// intentionally never touch that tuned, safety-sensitive file.
//
// Never throws: every failure mode degrades to "kept the templated file",
// because the blueprint's templated output is already a working baseline.

import "server-only";
import {
  EMPTY_SHA256,
  getAgentFile,
  getOperation,
  MbnApiError,
  putAgentFile,
} from "./mbn-client";
import { generateSeedFiles, type SeedSkipReason } from "./ai-seed";
import { introspectSite } from "./wix-introspect";

const FILE_POLL_INTERVAL_MS = 1500;
const FILE_POLL_TIMEOUT_MS = 60_000;
// One retry if the API reports another file action is briefly in flight.
const IN_FLIGHT_RETRY_DELAY_MS = 2000;

export interface SeededFileResult {
  path: string;
  status: "written" | "failed";
  detail?: string;
}

export type SeedRunResult =
  | { seeded: true; files: SeededFileResult[] }
  | { seeded: false; reason: SeedSkipReason | "introspection-failed"; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Write one file and poll its operation to terminal. Returns a per-file
 * result; never throws (failures are captured as status "failed").
 */
async function writeOneFile(
  deploymentId: string,
  agentId: string,
  filePath: string,
  content: string,
  requestId: string,
): Promise<SeededFileResult> {
  try {
    // Learn the current sha so the optimistic-concurrency check passes.
    // 404 (not mirrored yet / absent) → create with the empty-string sha.
    const existing = await getAgentFile(deploymentId, agentId, filePath);
    const expectedSha256 = existing?.sha256 ?? EMPTY_SHA256;

    // Deterministic idempotency key per (file, attempt) so a retry of the
    // whole run replays rather than duplicates.
    const idempotencyKey = `seed-${requestId}-${slug(filePath)}`;

    let put;
    try {
      put = await putAgentFile({
        deploymentId,
        agentId,
        filePath,
        content,
        expectedSha256,
        idempotencyKey,
      });
    } catch (err) {
      // Another file action was mid-apply (the per-deployment serialization
      // window). Wait briefly and retry once.
      if (err instanceof MbnApiError && err.status === 409) {
        await sleep(IN_FLIGHT_RETRY_DELAY_MS);
        put = await putAgentFile({
          deploymentId,
          agentId,
          filePath,
          content,
          expectedSha256,
          idempotencyKey,
        });
      } else {
        throw err;
      }
    }

    const deadline = Date.now() + FILE_POLL_TIMEOUT_MS;
    while (true) {
      const op = await getOperation(put.opId);
      if (op.status === "succeeded") {
        return { path: filePath, status: "written" };
      }
      if (op.status === "failed") {
        return {
          path: filePath,
          status: "failed",
          detail: op.error?.message ?? "operation failed",
        };
      }
      if (Date.now() > deadline) {
        return { path: filePath, status: "failed", detail: "timed out polling write op" };
      }
      await sleep(FILE_POLL_INTERVAL_MS);
    }
  } catch (err) {
    const detail =
      err instanceof MbnApiError ? `${err.problemType}: ${err.message}` : (err as Error).message;
    return { path: filePath, status: "failed", detail };
  }
}

/** Filesystem-path → idempotency-key-safe slug. */
function slug(p: string): string {
  return p.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Full seeding run. `requestId` ties the run's idempotency keys together so
 * a replay of the orchestration is safe.
 */
export async function runSeeding(args: {
  deploymentId: string;
  agentId: string;
  siteUrl: string;
  requestId: string;
}): Promise<SeedRunResult> {
  // Re-derive the site context server-side. We never trust a client-supplied
  // context blob for what gets written into a live agent.
  const intro = await introspectSite(args.siteUrl);
  if (!intro.ok) {
    return {
      seeded: false,
      reason: "introspection-failed",
      message: intro.message,
    };
  }

  const generation = await generateSeedFiles(intro.siteContext);
  if (!generation.ok) {
    return { seeded: false, reason: generation.reason, message: generation.message };
  }

  // Write strictly sequentially — the API serializes file actions per
  // deployment, and sequential writes keep idempotency + polling simple.
  const results: SeededFileResult[] = [];
  for (const [filePath, content] of Object.entries(generation.files)) {
    const r = await writeOneFile(
      args.deploymentId,
      args.agentId,
      filePath,
      content,
      args.requestId,
    );
    results.push(r);
  }

  return { seeded: true, files: results };
}
