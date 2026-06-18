# Agent Deploy — a MoltBot Ninja starter

A small, complete, **copy-this** web app that deploys AI agents onto **[MoltBot Ninja](https://app.moltbot.ninja)** from reusable **blueprints**, using nothing but the public REST API. No SDK, no Firebase, no secrets in the browser.

Use it as the base for your own portal: a self-serve page where *your* customers spin up a configured agent in a few clicks, while your API key stays safely on the server.

It ships a clean, production-shaped pattern you can lift wholesale:

- **Browser → your server → MoltBot Ninja.** The API key never leaves the server (enforced at build time with `import "server-only"`).
- A guided 4-step wizard: **pick a blueprint → configure → deploy → (optionally) give it a phone number.**
- Real input validation, SSRF guards, idempotency, and timeouts — the boring-but-important stuff, already done.

> **Not a dry run.** Running the deploy flow makes **real** changes on your account: it creates an agent, applies a blueprint, and can install a voice gateway (which may touch telephony + billing). Point it at a **test deployment** first. See [Heads up](#heads-up).

---

## How MoltBot Ninja fits together (60-second mental model)

```
Your MoltBot Ninja account
   └── Deployment  ("instance" — a hosted bot, e.g. on Telegram)
          ├── main agent
          └── sub-agents  ←── this demo creates these
                 ▲
                 │ deployed from
              Blueprint  (a reusable template: persona + files + skills + variables)
```

- A **deployment** (a.k.a. *instance*) is a hosted bot you own. Agents run on it.
- A **blueprint** is a reusable template — an agent's persona, files, skills, and the variables that customize it per use.
- The **public REST API** (`api.moltbot.ninja`) lets you list your blueprints and **deploy a fresh agent from one** onto a deployment. That's what this app does.

So the flow you'll build toward is: **own a deployment + a blueprint → mint an API key → deploy agents from the blueprint on demand.**

---

## Get set up on MoltBot Ninja (one-time)

You need four things before this demo is useful: an **account**, a **deployment**, at least one **blueprint**, and an **API key**. All of it is self-serve in the dashboard at **[app.moltbot.ninja](https://app.moltbot.ninja)**.

### 1. Create an account
Go to **[app.moltbot.ninja](https://app.moltbot.ninja)** and **sign in with Google**. Your account is created on first sign-in — nothing else to do.

### 2. Create a deployment (your first instance)
In the dashboard, open the **New Agent** tab and walk the wizard:

1. **API Keys** — your Anthropic key (`sk-ant-…`) and a Telegram bot token (from [@BotFather](https://t.me/BotFather)).
2. **Agent Setup** — a bot name and Telegram username.
3. **Personality** — optional system behavior (a sensible default is provided).
4. **Deploy** — accept terms, hit **Deploy Agent**.

It provisions a real host and takes **~3–10 minutes** to reach **Operational**. When it's done you have a deployment with a `deploymentId` — that's what you'll deploy agents onto.

> **New accounts start with zero deployment quota.** If the wizard asks you to request quota, do so and wait for it to be granted before deploying. (One deployment is enough for this demo.)

### 3. Create a blueprint
A blueprint is a **snapshot of a configured agent**. The simplest path: configure your deployment's agent the way you like (its persona/files/skills), then in the **Blueprints** tab click **Create Blueprint**, give it a name + description, and save. It captures the agent's files, skills, and any `{{variables}}` for later customization.

You only need **one** blueprint to try the demo. The two examples behind this app give a sense of the range:
- a **Wix Bookings voice receptionist** (answers calls, books appointments) — uses an optional "Site" step to read a Wix site and pre-fill variables;
- a **chat-only Personal Assistant** (triages email, manages a calendar) — no site, so the demo skips straight to configuration.

The demo lists **your** blueprints, so whatever you create here is what shows up.

### 4. Create an API key
Open the **API Keys** tab → **Create**:

- **Name** it (e.g. `Agent Deploy demo`).
- **Permissions (scopes)** — tick the ones the demo needs (below).
- **Deployments** — scope the key to the **specific deployment** you'll deploy onto (per-deployment scoping is required; the key is rejected on any deployment you didn't select).

The key is shown **once** — copy it immediately. You'll paste it into the demo's `.env.local`.

**Scopes this demo uses** (Ninja key):

| Scope | Needed for |
|---|---|
| `deployments:read` | listing your deployments |
| `blueprints:read` | listing your blueprints |
| `blueprints:deploy` | deploying a blueprint onto an agent |
| `agents:write` | creating the new sub-agent |
| `files:write` | *optional* — the AI persona-seeding step (rewrites `SOUL.md`) |
| `voice:install` | *optional* — dispatch the voice gateway (voice flow only) |

That's it — you now have an account, a deployment, a blueprint, and a scoped key. Time to run the demo.

---

## Run the demo (5 minutes)

Requires **Node ≥ 20.9** (Next.js 16).

```bash
git clone https://github.com/TheDude135/MoltBot-Agent-Demo
cd MoltBot-Agent-Demo
npm install

cp .env.example .env.local
#  Paste your NINJA_API_KEY into .env.local.
#  (.env.example documents every variable, including the optional voice keys.)

npm run dev
```

Open **http://localhost:3030**, pick your blueprint, fill in the fields, and **Deploy**. You'll watch each public REST call happen, step by step.

> Config is read **once at startup** and cached — restart `npm run dev` after editing `.env.local`.

---

## What the demo does

### The core flow — deploy an agent from a blueprint

1. Lists your blueprints (`GET /v1/blueprints`) and deployments (`GET /v1/deployments`).
2. You pick a blueprint, a target deployment, an agent name + emoji, and fill any blueprint variables.
3. Creates a new sub-agent (`POST /v1/deployments/:id/agents`) and polls until it's up (`GET /v1/operations/:opId`).
4. Deploys the blueprint onto it (`POST /v1/deployments/:id/blueprint-deploys`) and streams progress (`GET …/blueprint-deploys/:requestId`) until `complete`.

Steps 3–4 run **server-side** inside one `/api/provision` route, so the API key never reaches the browser.

Blueprints with no "site" (like the chat Personal Assistant) skip straight to the configure step; Wix-style blueprints get an optional **Site** step that reads a public site to pre-fill variables.

### Optional extras

- **Site introspection** (`/api/introspect`, `lib/wix-introspect.ts`) — paste a Wix Bookings URL; the server reads its *public* endpoints and pre-fills variables (business name, services, staff). SSRF-guarded. Swap in your own data source (Shopify, Square, a CSV) to adapt it.
- **AI persona seeding** (`/api/seed-files`, `lib/ai-seed.ts`) — if `ANTHROPIC_API_KEY` is set, Claude rewrites the agent's `SOUL.md` to fit the business after deploy. Skipped silently when unset; needs the `files:write` scope.
- **Voice + Wix app** — after a clean deploy, optionally attach a phone number and the Wix Bookings app via the TTMA voice API. This needs a separate **TTMA voice deployment** and a `TTMA_API_KEY` (see `.env.example`). Leave it unconfigured to ignore the voice flow entirely.

---

## How it's built (the part worth copying)

```
Browser  (no API key, ever)
   │
   ▼
Next.js server  (your BFF — holds the key)
   ├─ /api/blueprints, /api/deployments      → proxy to api.moltbot.ninja
   ├─ /api/introspect (POST)                 → read a PUBLIC site, SSRF-guarded
   ├─ /api/provision  (POST)                 → create agent → poll → deploy blueprint
   ├─ /api/progress/:dep/:req                → proxy deploy status
   └─ /api/seed-files (POST)                 → optional: Claude rewrites SOUL.md
                │  Bearer + JSON
                ▼
        api.moltbot.ninja          (+ api.talktomyagent.io for the optional voice flow)
```

- **One key per silo, server-only.** Ninja calls go through `lib/mbn-client.ts`; the optional voice calls through `lib/ttma-client.ts`. Both are guarded by `import "server-only"`, so importing a key into a client component is a **build error**, not a runtime leak.
- **Thin, typed proxies.** Each `app/api/*` route validates input and forwards a single upstream call. Path params are regex-checked; bodies are Zod-validated; the key is attached on the server.
- **Phase-aware UI.** `app/page.tsx` orchestrates the wizard; each phase is its own component in `components/`; every API shape lives in `lib/types.ts`.

### Security model (the reusable lesson)

- **Key never reaches the browser** — enforced by `import "server-only"` at build time.
- **Path params regex-validated** and **bodies Zod-validated** at the proxy edge before any upstream call.
- **Idempotency** — every provision generates a fresh `requestId`; replaying the same body returns the existing record (safe), replaying with different variables returns `409`.
- **Timeouts** — agent creation is given up to 180 s before surfacing a `504`; the browser never hangs.
- **SSRF guard** — `/api/introspect` refuses IP-literal hosts and any name that resolves to a private/loopback/link-local/cloud-metadata address before fetching.
- **No secrets in git** — `.env.local` is git-ignored. If you expose this beyond localhost, add auth + rate limiting in front of the side-effecting routes.

---

## Make it your own

This repo is meant to be forked. Good places to start:

- **Add your blueprints.** The catalog is just `GET /v1/blueprints` for the key owner — create blueprints in your account and they appear automatically. No code change.
- **Swap the data source.** Replace `lib/wix-introspect.ts` with your own pre-fill logic (Shopify, a CRM, a spreadsheet) — or drop the Site step entirely for site-less blueprints.
- **Add real auth.** Today the key in `.env.local` *is* the operator. For a multi-tenant portal, put an auth provider in front and store a key per user/tenant; keep the BFF pattern so keys stay server-side.
- **Reskin freely.** The UI is plain Tailwind components in `components/`; the API logic is isolated in `lib/` and `app/api/`.

---

## Heads up

Running the deploy flow performs **real** side effects with your key: it creates a sub-agent, applies a blueprint, can install a Wix Bookings app, and can dispatch a voice gateway (which may touch telephony + billing). If `ANTHROPIC_API_KEY` is set, the persona-seeding pass spends Anthropic tokens. There is no built-in "demo mode" — point it at a **test deployment** (and ideally an `mbn_test_` key) first.

---

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `401` / "Authentication required" | Missing or wrong `NINJA_API_KEY` | Re-paste the key into `.env.local`, restart `npm run dev` |
| `403` / "Insufficient scope" | Key is missing a required scope | Re-mint the key with the scopes in the table above |
| "Deployment not found or access denied" | Key is scoped to other deployments | Re-mint with the target deployment selected, or pick a different one |
| Blueprints list is empty | The key's account has no blueprints | Create one in the **Blueprints** tab first |
| A skill shows `failed` in the deploy steps | The blueprint references a skill that can't install on a sub-agent (some are main-agent-only or not in the installable catalog) | Edit the blueprint's skills to installable ones, or check the deploy record's `failedSteps` |
| `504` on provision | Agent creation took > 180 s | Confirm the deployment is **Operational**, then retry |
| **Voice flow:** "Could not load voice deployments" | `TTMA_API_KEY` missing `voice:read`, or no voice deployment in scope | Re-mint the TTMA key with voice scopes + the voice deployment selected |
| **Voice flow:** `409 gateway-already-running` | A live gateway already exists on that voice number | The Install Voice button re-installs by default; or pick a different voice deployment |

---

## Limits

- **Single operator.** The key in `.env.local` is whoever runs the demo. Add auth + per-user keys for a real portal.
- **Local dev only.** No HTTPS, no rate limiting. Don't expose the dev server publicly without a TLS proxy and an auth layer in front of the side-effecting routes (`provision`, `install-voice`, `install-app`, `seed-files`).
- **No catalog retries.** A flaky API surfaces a one-shot error; refresh to retry.

---

## License

MIT — see [LICENSE](./LICENSE).
