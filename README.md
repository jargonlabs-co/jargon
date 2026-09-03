# Jargon

CLI-deployed outbound tools. **Gmail** for email, **Twilio** for calling, **HeyReach** for LinkedIn.

Internal prospecting (Crustdata, etc.) lives in the private [`outbound-ops`](https://github.com/jargonlabs-co/outbound-ops) repo. See [docs/SEPARATION.md](docs/SEPARATION.md).

## How it works

1. `jargon deploy "Build a dialer for VP Sales"` creates a tool on the API
2. Log in at the website dashboard to open the dialer / sequencer UI
3. Sends go through Gmail, Twilio, and HeyReach on your workspace

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
| API | `src/server/` | Auth, tools, Gmail / Twilio / HeyReach |
| Website | `landing/` | Marketing + login dashboard + tool UIs |

## Hosted API

```bash
npm run api
# or
docker compose up --build
```

Point the CLI and landing at production with `JARGON_API_URL` / `VITE_API_URL`. Set `JARGON_APP_URL` on the API for Gmail OAuth return.
