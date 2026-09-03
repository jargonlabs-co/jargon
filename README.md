# Jargon

1. `jargon deploy "Build a dialer for my AE book"`  
2. User attaches **HubSpot** (their contacts)  
3. UI reads that list  
4. Email / call / LinkedIn run **through Jargon** (platform Gmail, Twilio, HeyReach)

Internal prospecting (Crustdata, etc.) lives in the private [`outbound-ops`](https://github.com/jargonlabs-co/outbound-ops) repo. See [docs/SEPARATION.md](docs/SEPARATION.md).

## How it works

1. `jargon deploy "Build a dialer"` creates a tool (empty queue)
2. Connect **HubSpot** so the tool can load your contacts
3. Email, calling, and LinkedIn send through Jargon (platform Gmail, Twilio, HeyReach)

## Quick start

```bash
npm install
cp .env.example .env
npm run api              # API on :8787
npm run landing:dev      # website on :5180
npm run jargon -- login --email demo@jargon.app --password jargon-demo
npm run jargon -- deploy "Build a dialer for inbound leads"
```

Open the printed `/tools/…` URL while logged in.

## Surfaces

| Surface | Path | Role |
|---------|------|------|
| CLI | `cli/` | `login` · `deploy` · `list` · `api-keys` |
| API | `src/server/` | Auth, HubSpot CRM sync, platform Gmail / Twilio / HeyReach |
| Website | `landing/` | Marketing + login dashboard + tool UIs |

## Hosted API

```bash
npm run api
# or
docker compose up --build
```

Point the CLI and landing at production with `JARGON_API_URL` / `VITE_API_URL`. HubSpot OAuth returns to `JARGON_APP_URL`.
