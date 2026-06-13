# Agent Deploy Demo

External demo that provisions a MoltBot Ninja sub-agent from a blueprint AND optionally attaches a phone number to it, end-to-end, using **only the public REST API** of two services (Ninja + TTMA).

No Firebase SDK, no Firestore, no direct calls to the ClawdBot Installer project. Just `fetch` against `api.moltbot.ninja` and `api.talktomyagent.io`.

---

## Heads up: this is not a dry run

Running the deploy flow performs **real** side effects on your account with your
keys: it creates a sub-agent, deploys a blueprint, can install a Wix Bookings
app, dispatches a voice gateway onto a fleet host (which may touch telephony and
billing), and - if `ANTHROPIC_API_KEY` is set - spends Anthropic tokens on the
optional persona-seeding pass. There is no built-in "demo mode". Point it at a
**test deployment** (and ideally an `mbn_test_` key) first. The voice uninstall
path has no UI yet.

---

## What it does

### Sub-agent provisioning

1. Lists the API key owner's blueprints (`GET /v1/blueprints`)
2. Lists the owner's deployments (`GET /v1/deployments`)
3. Lets the user pick a blueprint, target deployment, agent name + emoji, and any blueprint variables
4. Creates a new sub-agent (`POST /v1/deployments/:id/agents`)
5. Polls the operation until terminal (`GET /v1/operations/:opId`)
6. Deploys the blueprint to that new agent (`POST /v1/deployments/:id/blueprint-deploys`)
7. Streams Phase-2 progress (`GET /v1/deployments/:id/blueprint-deploys/:requestId`) until `complete` / `partial` / `failed`

Steps 4-6 happen server-side inside a single `/api/provision` route so the API key never reaches the browser.

### Optional: site introspection + AI persona seeding

Two optional helpers make the blueprint fit a real business. Both live entirely
in the demo (a customer swaps in their own data source - Shopify, Square, CSV):

- **Site introspection** (`POST /api/introspect`, `lib/wix-introspect.ts`): the
  user pastes a Wix Bookings site URL; the server reads the site's PUBLIC,
  anonymous endpoints and pre-fills blueprint variables (business name, services
  table, staff roster). SSRF-guarded (see Security notes).
- **AI persona seeding** (`POST /api/seed-files`, `lib/ai-seed.ts`): after a
  clean deploy, if `ANTHROPIC_API_KEY` is set, Claude rewrites the agent's
  `SOUL.md` into a business-tailored persona and writes it back via the files
  API (requires the Ninja `files:write` scope). Skipped silently when unset.

### Voice + Wix app install (optional)

After the blueprint deploy lands cleanly, the user can opt in to attach a phone number and the Wix Bookings app:

8. Lists the owner's TTMA voice deployments (`GET /v1/voice-deployments`)
9. User picks a voice deployment
10. Installs the Wix Bookings app on that voice deployment (`POST /v1/voice-deployments/:vid/apps`) and confirms via `GET .../apps`. Installing the app BEFORE voice means its HMAC secret + tool reach the gateway from its very first config poll, so the agent can book from call one. The secret is **never** returned - the gateway self-fetches it.
11. Mints an install bundle at TTMA (`POST /v1/voice-deployments/:vid/install-bundles`)
12. Forwards the bundle to Ninja (`POST /v1/deployments/:fleet/agents/:agentId/voice-installs`)
13. Polls the install operation until terminal (`GET /v1/operations/:opId`)

Step 10 is the `/api/install-app` route; steps 11-12 the `/api/install-voice` route - all server-side, the key never in the browser.

The underlying voice install-bundle protocol is documented separately in the platform's own docs (`VOICE-INSTALL-BUNDLE-CUSTOMER-GUIDE.md`); this demo only consumes the public endpoints shown above.

---

## Prerequisites

The Ninja API and the TTMA Voice API are **separate, siloed services**, so
the demo uses **two keys** - one per silo - and never lets a credential
cross APIs. Mint each in its own dashboard.

**`NINJA_API_KEY`** - mint at `https://app.moltbot.ninja` → API Keys → Create.
Scope it to the **fleet deployment** you deploy onto. Scopes:

- `deployments:read`
- `agents:write`
- `blueprints:read`
- `blueprints:deploy`
- `files:write` *(optional - lets the AI persona-seeding pass write `SOUL.md`)*
- `voice:install` *(optional - dispatch the gateway onto the agent)*
- `voice:uninstall` *(optional - DELETE flow; no UI yet)*

**`ANTHROPIC_API_KEY`** *(optional)* - get one at `https://console.anthropic.com`.
Only used by the AI persona-seeding pass; set `ANTHROPIC_MODEL` to override the
default (`claude-sonnet-4-6`). When unset, seeding is skipped and the blueprint's
own `SOUL.md` is kept.

**`TTMA_API_KEY`** - mint in the **TTMA portal** → API Keys. Scope it to the
**voice deployment** you install from. Only needed for the voice + Wix flow:

- `voice:read` - list voice deployments
- `voice:apps` - install the Wix Bookings app
- `voice:install-bundles` - mint install bundles

Per-instance scope is enforced on both APIs: the key only works on the
deployments you select, and the API blocks cross-deployment use even with
valid scopes.

> **Legacy single-key fallback:** if you leave the two vars unset, both
> silos fall back to a single `MBN_API_KEY` - but that only works if the
> key carries *both* silos' scopes (a cross-API key). The two-key model is
> preferred.

You also need the API itself deployed and reachable. Verify with:

```bash
curl https://api.moltbot.ninja/v1/openapi.json | python -c "import json,sys; d=json.load(sys.stdin); print([p for p in d['paths'] if 'blueprint' in p])"
```

The output must list `/v1/blueprints` and `/v1/blueprints/{blueprintId}`. If it doesn't, the API needs `firebase deploy --only functions` from the ClawdBot Installer repo first.

---

## Setup

Requires **Node >= 18.18**.

```bash
cd MoltBot-Agent-Demo
npm install
cp .env.example .env.local
# Edit .env.local: paste NINJA_API_KEY (and TTMA_API_KEY for the voice flow,
# ANTHROPIC_API_KEY for optional AI seeding). See .env.example for every var.
npm run dev
```

The app starts on `http://localhost:3030`. Config is read once and cached, so
restart the dev server after editing `.env.local`.

---

## Architecture

```
Browser
    │
    ▼
Next.js (port 3030)
    ├─ /                              ← UI (no API key)
    ├─ /api/blueprints                ← proxy → /v1/blueprints
    ├─ /api/blueprints/:id            ← proxy → /v1/blueprints/:id
    ├─ /api/deployments               ← proxy → /v1/deployments
    ├─ /api/introspect (POST)         ← reads a PUBLIC Wix site (SSRF-guarded),
    │                                    pre-fills blueprint variables
    ├─ /api/provision (POST)          ← orchestrates:
    │      1. POST /v1/deployments/:id/agents
    │      2. poll  /v1/operations/:opId
    │      3. POST /v1/deployments/:id/blueprint-deploys
    ├─ /api/progress/:depId/:rid      ← proxy → /v1/deployments/:id/blueprint-deploys/:rid
    ├─ /api/seed-files (POST)         ← optional: Claude rewrites SOUL.md,
    │                                    PUT → /v1/deployments/:id/agents/:a/files
    │
    │  ─── voice + Wix app flow (optional) ───────────
    ├─ /api/voice-deployments         ← proxy → TTMA /v1/voice-deployments
    ├─ /api/install-app (POST)        ← install Wix app + confirm:
    │      1. POST TTMA /v1/voice-deployments/:vid/apps
    │      2. GET  TTMA /v1/voice-deployments/:vid/apps
    ├─ /api/install-voice (POST)      ← orchestrates:
    │      1. POST TTMA /v1/voice-deployments/:vid/install-bundles
    │      2. POST Ninja /v1/deployments/:fleet/agents/:agent/voice-installs
    └─ /api/voice-operation/:opId     ← proxy → Ninja /v1/operations/:opId
                │
                ▼ Bearer + JSON
        api.moltbot.ninja   +   api.talktomyagent.io
```

The keys live in `NINJA_API_KEY` + `TTMA_API_KEY` (server env), one per silo. All Ninja calls go through `lib/mbn-client.ts` (uses `ninjaApiKey`); all TTMA calls go through `lib/ttma-client.ts` (uses `ttmaApiKey`); both are gated by `import "server-only"` so accidentally importing them in a client component is a build error. Each Cloud Function reads the shared `apiKeys` Firestore collection but only ever handles its own silo's scopes, so neither key crosses APIs.

---

## Security notes

- **Key never reaches the browser.** Every MBN call is server-side. The `import "server-only"` directive enforces this at build time.
- **Path params are regex-validated** at the proxy edge (`/api/blueprints/:id`, `/api/progress/:depId/:rid`) before forwarding upstream.
- **Body shape is Zod-validated** at `/api/provision` - invalid input returns 400 without ever contacting the upstream.
- **No CORS** - the browser only talks to `localhost:3030`. If you ever expose this beyond localhost, restrict origins at the proxy.
- **Idempotency**: each provision attempt generates a fresh `requestId` (crypto.randomUUID). Replaying the same body returns the existing record (replay-safe); replaying with different variables returns 409. The voice flow uses the same client-side requestId for both the TTMA mint (`bundle-${requestId}`) and the Ninja dispatch (`install-${requestId}`) - end-to-end replay-safe.
- **Agent creation timeout**: the provision orchestrator gives the agent up to 180 s (3 min) to come up before surfacing a 504. The browser never hangs.
- **SSRF guard on site introspection**: `/api/introspect` fetches a user-supplied URL server-side, so `lib/wix-introspect.ts` rejects IP-literal hosts and any hostname that DNS-resolves to a private / loopback / link-local / cloud-metadata address before fetching.
- **Never commit secrets.** `.env.local` (and rotated copies) are git-ignored. The whole point of the `/api/*` proxy pattern shown here is to keep keys server-side - replicate it in your own integration and never ship a key to the browser.

---

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| "Authentication required" / 401 | Missing or wrong `NINJA_API_KEY` (or `TTMA_API_KEY` on the voice flow) | Re-mint the key in its dashboard, paste into `.env.local`, restart `npm run dev` |
| "Insufficient scope" / 403 | Key missing `blueprints:deploy`, etc. | Mint a new key with the four required scopes |
| "Deployment not found or access denied" | Key is per-instance scoped and doesn't include the chosen deployment | Re-mint with the deployment included, OR pick a different target |
| Blueprints list comes back empty | API deployed but the key's owner has no blueprints | Save an agent as a blueprint in MoltBot Ninja first |
| Catalog request fails immediately | `/v1/blueprints` not in the live OpenAPI | `firebase deploy --only functions` from ClawdBot Installer |
| 504 gateway-timeout on provision | Agent creation hung > 180 s | Check the deployment is OPERATIONAL; restart fleet-agent on the host if needed |
| **Voice flow:** "Could not load voice deployments" | `TTMA_API_KEY` missing `voice:read` OR no voice deployment in its instance scope | Re-mint the TTMA key (TTMA portal) with voice scopes + the voice deployment selected |
| **Voice flow:** 409 `gateway-already-running` | A live gateway exists on the chosen voice deployment | Pass `forceReinstall: true` (the demo defaults this to `true` for the Install Voice button) OR pick a different voice deployment |
| **Voice flow:** operation `failed` after ~60 s with no detail | install.sh failed on the fleet host (often: missing passwordless sudo for `systemctl stop ninja-talk-<agentId>`) | SSH to the host and run install.sh once manually to inspect; configure sudoers as documented in install.sh comments |

---

## Limits

- No multi-user UI - the API key in `.env.local` is whoever owns the demo. If you want per-user keys, wire an auth provider and store keys per user.
- No HTTPS - this is a local dev demo. Don't expose the dev server to the public internet without a TLS reverse proxy.
- No retries on the catalog routes - if the API is flaky, you'll see a one-shot error and have to refresh.
- No per-IP rate limiting / auth on the routes. Each adopter runs this with their own keys; if you host it publicly, add rate limiting and an auth layer in front of the side-effecting routes (`provision`, `install-voice`, `install-app`, `seed-files`).

---

## License

MIT - see [LICENSE](./LICENSE).
