// ID + identifier helpers that mirror the constraints accepted by the
// MoltBot Ninja API. Duplicating the validation here lets the UI catch
// invalid input before it leaves the browser; the server still re-validates.

/**
 * Derives a kebab-case agentId from a free-form name.
 * Must match `/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/` and be 1-32 chars.
 * Returns "" if no characters survived; the caller treats that as invalid.
 */
export function generateAgentId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
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
  return /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(value);
}
