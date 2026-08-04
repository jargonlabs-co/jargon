# Jargon

Desktop app for vibe-coding outbound sales tools. Describe what you want — Jargon clarifies, then builds a full multi-page dialer or sequencer backed by a **local simulated API**.

## Flow

1. Prompt → clarify questions
2. Project saved under Projects
3. Full-window product with separate pages: Dashboard, Campaigns, Dial console, Sequences, Inbox, Contacts, Analytics

## Stack

- Electron + Vite + React + TypeScript
- Local Express API + JSON file store (userData)
- Simulated call/email engines (no Twilio/Gmail yet)

## Develop

```bash
npm install
npm run dev
```

API defaults to `http://127.0.0.1:8787` and is started by Electron main.

## Landing page

Marketing site lives in `landing/` (Vite + React).

```bash
npm run landing:dev
```

Opens at `http://localhost:5180`.

### Deploy (GitHub Pages)

Push to `main` deploys via `.github/workflows/deploy-landing.yml`.

Site URL (default): `https://<your-user>.github.io/jargon/`

If the repo name isn’t `jargon`, set the Vite base to match:

```bash
# example: repo named jargon-landing
VITE_BASE=/jargon-landing/ npm run landing:build
```

Or for a custom domain / `*.github.io` root repo:

```bash
VITE_BASE=/ npm run landing:build
```

