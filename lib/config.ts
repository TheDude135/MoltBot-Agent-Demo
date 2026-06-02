// Server-only configuration. Validated at first read so a misconfigured
// .env fails fast and obviously instead of leaking 401s into the UI.

import "server-only";

interface AppConfig {
  apiBase: string;
  apiKey: string;
  /** Base URL for the TTMA voice-api (`https://api.talktomyagent.io`). The
   *  same `mbn_live_*` Bearer key is accepted by both Ninja and TTMA —
   *  both functions read from the same `apiKeys` Firestore collection. */
  ttmaApiBase: string;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;

  const apiKey = process.env.MBN_API_KEY?.trim();
  const apiBase =
    process.env.MBN_API_BASE?.trim() || "https://api.moltbot.ninja";
  const ttmaApiBase =
    process.env.TTMA_API_BASE?.trim() || "https://api.talktomyagent.io";

  if (!apiKey) {
    throw new Error(
      "MBN_API_KEY is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  if (!apiKey.startsWith("mbn_live_") && !apiKey.startsWith("mbn_test_")) {
    throw new Error(
      "MBN_API_KEY must start with mbn_live_ or mbn_test_. Mint one at https://app.moltbot.ninja",
    );
  }

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

  cached = { apiKey, apiBase, ttmaApiBase };
  return cached;
}
