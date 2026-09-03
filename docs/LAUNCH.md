# Launch / ops for the public product

## Architecture

- **CLI** (`jargon deploy`): creates a tool on the hosted API
- **Website** (`landing/`): marketing, login dashboard, authenticated tool UIs at `/tools/:id`
- **API**: multi-tenant orgs, Gmail send, Twilio voice, HeyReach LinkedIn

## Local development

```bash
npm install
cp .env.example .env
npm run api
npm run landing:dev
npm run jargon -- login --email demo@jargon.app --password jargon-demo
npm run jargon -- deploy "Build a dialer"
```

## Provider setup

1. **Google Cloud** OAuth: redirect `https://api…/oauth/gmail/callback`, enable Gmail API. After connect, users return to `JARGON_APP_URL`.
2. **Twilio**: Account SID, Auth Token, API Key, TwiML App Voice URL `https://api…/voice/twiml`, status `https://api…/voice/status`
3. **HeyReach**: `HEYREACH_API_KEY` (optional; LinkedIn send uses demo mode without it)
4. Set `JARGON_ENCRYPTION_KEY`, `JARGON_PUBLIC_URL`, and `JARGON_APP_URL` in production
