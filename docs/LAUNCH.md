# Launch / ops for the public product

## Architecture

- **CLI** (`jargon deploy`): creates a tool on the hosted API
- **Website** (`landing/`): marketing, login dashboard, authenticated tool UIs at `/tools/:id`
- **API**: multi-tenant orgs, HubSpot as customer data, platform Gmail / Twilio / HeyReach

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

1. **HubSpot** (customer data): Jargon OAuth app. Redirect `https://api…/oauth/hubspot/callback`. Scopes: `crm.objects.contacts.read crm.objects.companies.read oauth`. Users connect **their** portal.
2. **Gmail** (Jargon platform mailbox): `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` plus `GMAIL_REFRESH_TOKEN` for the sending inbox. Customers do not connect Gmail.
3. **Twilio**: Account SID, Auth Token, API Key, TwiML App Voice URL `https://api…/voice/twiml`, status `https://api…/voice/status`
4. **HeyReach**: `HEYREACH_API_KEY` (optional; LinkedIn send uses demo mode without it)
5. Set `JARGON_ENCRYPTION_KEY`, `JARGON_PUBLIC_URL`, and `JARGON_APP_URL` in production
