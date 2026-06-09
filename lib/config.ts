// Server-only configuration. Validated at first read so a misconfigured
// .env fails fast and obviously instead of leaking 401s into the UI.
//
// Two-key model (siloed): the Ninja API and the TTMA Voice API are
// separate services with separate scopes, so the demo holds one key per
// silo and never lets a credential cross APIs:
//   - NINJA_API_KEY → api.moltbot.ninja  (blueprints, agents, voice:install)
//   - TTMA_API_KEY  → api.talktomyagent.io (voice:read, voice:apps,
//                     voice:install-bundles)
// Both fall back to the legacy single `MBN_API_KEY` if the per-silo vars
// are absent, so older one-key setups keep working.

import "server-only";

interface AppConfig {
  apiBase: string;
  ttmaApiBase: string;
  /** Ninja-silo key — NINJA_API_KEY, falling back to legacy MBN_API_KEY. */
  ninjaApiKey: string;
  /**
   * TTMA-silo key — TTMA_API_KEY, falling back to legacy MBN_API_KEY.
   * Empty string when neither is set: the Ninja-only flow still runs; the
   * TTMA client throws a clear "TTMA key not set" error if the optional
   * voice + Wix flow is invoked.
   */
  ttmaApiKey: string;
  /**
   * Anthropic key for the OPTIONAL AI file-seeding pass. Empty string when
   * unset — seeding is then skipped and the blueprint's templated files
   * stand (no behavioral change vs. before AI seeding existed). This key
   * never crosses into the Ninja/TTMA silos; it only talks to
   * api.anthropic.com.
   */
  anthropicApiKey: string;
  /** Model for the seeding pass. Overridable; defaults to Sonnet 4.6. */
  anthropicModel: string;
}

let cached: AppConfig | null = null;

function assertKeyFormat(label: string, key: string): void {
  if (!key.startsWith("mbn_live_") && !key.startsWith("mbn_test_")) {
    throw new Error(
      `${label} must start with mbn_live_ or mbn_test_. Mint one in the dashboard.`,
    );
  }
}

export function getConfig(): AppConfig {
  if (cached) return cached;

  // Legacy single key — still honored as a fallback for both silos so a
  // one-key .env keeps working. New setups should use the per-silo vars.
  const legacyKey = process.env.MBN_API_KEY?.trim() || "";
  const ninjaApiKey = process.env.NINJA_API_KEY?.trim() || legacyKey;
  const ttmaApiKey = process.env.TTMA_API_KEY?.trim() || legacyKey;

  const apiBase =
    process.env.MBN_API_BASE?.trim() || "https://api.moltbot.ninja";
  const ttmaApiBase =
    process.env.TTMA_API_BASE?.trim() || "https://api.talktomyagent.io";

  // The Ninja key is mandatory: every demo run starts with the blueprint
  // deploy half against api.moltbot.ninja.
  if (!ninjaApiKey) {
    throw new Error(
      "NINJA_API_KEY (or legacy MBN_API_KEY) is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  assertKeyFormat("NINJA_API_KEY", ninjaApiKey);
  // TTMA key is optional (only the voice + Wix flow needs it). Validate
  // format only when present so a Ninja-only run isn't blocked.
  if (ttmaApiKey) assertKeyFormat("TTMA_API_KEY", ttmaApiKey);

  try {
    new URL(apiBase);
  } catch {
    throw new Error(`MBN_API_BASE is not a valid URL: ${apiBase}`);
  }

  try {
    new URL(ttmaApiBase);
  } catch {
    throw new Error(`TTMA_API_BASE is not a valid URL: ${ttmaApiBase}`);
  }

  // Anthropic key is optional. When absent the seeding pass is skipped —
  // no format assertion, no throw. We don't assume a fixed prefix because
  // Anthropic key formats can change; presence is the only gate.
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
  const anthropicModel =
    process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";

  cached = {
    ninjaApiKey,
    ttmaApiKey,
    apiBase,
    ttmaApiBase,
    anthropicApiKey,
    anthropicModel,
  };
  return cached;
}
