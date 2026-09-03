# Jargon

**Public product** — vibe-code custom outbound sales tools for customers.

Build prospect queues on **Crustdata**, then email and call with **Gmail** and **Twilio**.

> Internal team outbound (no landing / portal / billing) lives in a **separate private repo**: [`outbound-ops`](https://github.com/jargonlabs-co/outbound-ops). Do not share databases, OAuth apps, or deploy targets between the two. See [docs/SEPARATION.md](docs/SEPARATION.md).

## Stack

| Layer | Provider | Role |
|-------|----------|------|
| Context | Crustdata | People search → prospect queue + talk tracks |
| Email | Gmail OAuth | Send from rep tool surfaces |
| Voice | Twilio | Call from dial surfaces |
| Billing | Stripe | Customer portal Pro checkout |

## Product surfaces

| Surface | Path | Role |
|---------|------|------|
| Desktop | `src/` (Electron) | Primary builder + rep workspace |
| API | `src/server/` | Multi-tenant hosted API (Railway) |
| Landing | `landing/` | Marketing + web app shell (Vercel) |
| Portal | `portal/` | Account, builds, billing, API keys (`app.jargon.app`) |
| CLI | `cli/` | `jargon login \| deploy \| list \| share \| api-keys` |

## Quick start

```bash
npm install
cp .env.example .env   # add CRUSTDATA_API_KEY
npm run dev
```

Sign in: `demo@jargon.app` / `jargon-demo`

1. **Crustdata** auto-connects from `CRUSTDATA_API_KEY` in `.env`
2. Open **Connections** → connect **Gmail** and **Twilio**
3. Chat prompt:

> Find me the top 100 prospects I need to contact today

That builds a Today tool: live Crustdata prospects in the queue, email via Gmail, calls via Twilio.

```bash
npx tsx scripts/crustdata-probe.ts --limit 5
```

## Hosted API

```bash
npm run api
# or
docker compose up --build
```

See [docs/LAUNCH.md](docs/LAUNCH.md) for provider setup, packaging, and production checklist.  
See [docs/EARLY-CUSTOMERS.md](docs/EARLY-CUSTOMERS.md) for customer rollout.

## Package desktop

```bash
npm run dist:mac
npm run dist:win
```

Artifacts land in `release/`. Point production builds at the API with `JARGON_API_URL`.

## Landing

```bash
npm run landing:dev
```

## Customer portal

```bash
npm run portal:dev      # http://127.0.0.1:5181
npm run portal:build
```

Set `VITE_API_URL` on Vercel to your Railway API. Set `JARGON_PORTAL_URL` on the API for Stripe redirect URLs.
