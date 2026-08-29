# Jargon

Build custom outbound tools on **Crustdata** people context — with **Gmail** and **Twilio** for email and calling.

## Stack

| Layer | Provider | Role |
|-------|----------|------|
| Context | Crustdata | People search → prospect queue + talk tracks |
| Email | Gmail OAuth | Send from rep tool surfaces |
| Voice | Twilio | Call from dial surfaces |

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

Probe Crustdata without the app:

```bash
npx tsx scripts/crustdata-probe.ts --limit 5
```

## What's included

- Electron desktop client (auth, deep-link OAuth, auto-update hook)
- Multi-tenant hosted API (orgs, sessions, encrypted connection secrets)
- Crustdata person search · Gmail send · Twilio Voice
- Packaging via `electron-builder` + GitHub Release workflow

## Hosted API

```bash
cp .env.example .env
npm run api
# or
docker compose up --build
```

See [docs/LAUNCH.md](docs/LAUNCH.md) for provider setup, packaging, and ops.

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

Web account UI (login, builds, billing, API keys) — deploy to Vercel at `app.jargon.app`:

```bash
npm run portal:dev      # http://127.0.0.1:5181
npm run portal:build
```

Set `VITE_API_URL` on Vercel to your Railway API. Set `JARGON_PORTAL_URL` on the API for Stripe redirect URLs.
