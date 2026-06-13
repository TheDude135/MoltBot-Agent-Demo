// ID + identifier helpers that mirror the constraints accepted by the
// MoltBot Ninja API. Duplicating the validation here lets the UI catch
// invalid input before it leaves the browser; the server still re-validates.

/**
 * Derives a kebab-case agentId from a free-form name.
 *
 * Must satisfy the STRICTEST rule in the deploy->voice pipeline: the voice
 * install step requires `^[a-z]([a-z0-9-]*[a-z0-9])?$` (start with a LETTER,
 * end alphanumeric, single hyphens, 1-32 chars). This is stricter than the
 * agent-create endpoint, which also accepts a leading digit. If we generated a
 * digit-leading id (e.g. "25-affordable-markham-notary" from "25 Affordable
 * Markham Notary"), the agent would deploy fine but then FAIL at "Install
 * voice" with a 400. So we drop any leading digits/hyphens to guarantee a
 * letter-leading id that works end to end.
 *
 * Returns "" if no valid characters survive (e.g. an all-digits name); the
 * caller treats that as invalid and asks the user to pick a different name.
 */
export function generateAgentId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z]+/, "") // must START with a letter (drop leading digits/hyphens)
    .replace(/-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

/**
 * `requestId` for blueprint deploys is the client's idempotency key.
 * Must match `^[a-zA-Z0-9_-]+$`. crypto.randomUUID() always satisfies
 * the regex. Generated client-side per Provision attempt.
 */
export function generateRequestId(): string {
  // crypto.randomUUID is available in modern Node and all evergreen
  // browsers. The Next.js server route ALWAYS runs in Node, and the
  // browser path passes the id through the same code shape.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without randomUUID — base36 timestamp
  // plus a random suffix. Adequate for idempotency at the demo scale.
  return `req-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function isValidAgentId(value: string): boolean {
  // Mirror the strictest gate in the pipeline (the voice install step): start
  // with a LETTER, end alphanumeric, single hyphens, 1-32 chars. Keeping this
  // in lockstep with generateAgentId means a name the UI accepts always
  // produces an id that survives both deploy AND voice install.
  return /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(value);
}
