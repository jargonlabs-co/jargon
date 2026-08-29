# Launch / ops runbook for the customer-facing desktop MVP

## Architecture

- **Desktop app** (Electron): chat → Today queue / dial / inbox. Auth token in OS safe storage. Deep link `jargon://` for OAuth return.
- **Hosted API** (`npm run api` or Docker): multi-tenant orgs, encrypted OAuth secrets, Apollo people search, HubSpot sync, Gmail send, Twilio voice token + webhooks.
- **Demo mode**: when provider env vars / keys are missing, Apollo/HubSpot/Gmail/Twilio run with fixtures so local QA works without keys.

## Local development

```bash
npm install
npm run dev          # Electron + embedded multi-tenant API on :8787
# sign in: demo@jargon.app / jargon-demo
```

Demo prompt: **Find me the top 100 prospects I need to contact today** → pulls GTM-title software prospects (Apollo) into an outbound sequencer (email live via Gmail, call softphone placeholder).

Standalone API (as if hosted):

```bash
cp .env.example .env
npm run api
# or
docker compose up --build
```

Point a packaged desktop build at the API:

```bash
JARGON_API_URL=https://api.your-domain.com npm run dist:mac
```

## Provider setup

1. **HubSpot** private app / OAuth: redirect `https://api…/oauth/hubspot/callback`
2. **Google Cloud** OAuth client: redirect `https://api…/oauth/gmail/callback`, enable Gmail API
3. **Twilio**: Account SID, Auth Token, API Key, TwiML App pointing Voice Request URL to `https://api…/voice/twiml`, status callback `https://api…/voice/status`
4. Set `JARGON_ENCRYPTION_KEY` and `JARGON_PUBLIC_URL` in production

## Packaging & updates

- `npm run dist:mac` / `dist:win` → artifacts in `release/`
- Code signing: set Apple/`CSC_*` secrets in CI before enabling Gatekeeper-friendly distribution
- Auto-update feed: `electron-builder.yml` → `publish.url` (generic CDN)
- Register protocol `jargon://` (configured in builder + main process)

## Landing / download

Update the marketing site download CTAs to the GitHub Release or CDN URLs for the latest `.dmg` / `.exe`.

## Monitoring checklist

- `/health` uptime check
- Alert on 5xx for `/oauth/*`, `/contacts/*/messages`, `/voice/status`
- Retain `data/jargon-db.json` (or migrate to Postgres) with daily backups
- Rotate `JARGON_ENCRYPTION_KEY` only with a re-encrypt migration

## Provider app review notes

- HubSpot / Google: publish OAuth apps for production traffic beyond test users
- Twilio: verify business profile / A2P as needed for SMS; Voice numbers for dialing
- Privacy policy + support email required on OAuth consent screens
