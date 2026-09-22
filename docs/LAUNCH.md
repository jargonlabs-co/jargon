# Launch / ops for the public product

## Architecture

- **CLI** (`jargon deploy`): creates a tool on the hosted API
- **Website** (`landing/`): marketing, login dashboard, authenticated tool UIs at `/tools/:id`
- **API**: multi-tenant orgs, HubSpot as customer data, platform Gmail / Plivo / HeyReach

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
2. **Gmail** (Jargon managed mailboxes): `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` plus `GMAIL_REFRESH_TOKEN` (or `GMAIL_POOL_JSON` for multiple). Customers do not connect Gmail.
3. **Plivo** (managed calling): Auth ID/Token plus exclusive DID pool (`PLIVO_FROM_NUMBER` + SIP username, or `PLIVO_POOL_JSON`). Softphone auth is JWT — do not put endpoint passwords in pool JSON. Use the **returned** Plivo username (12-digit suffix). See [OUTBOUND-POOLS.md](./OUTBOUND-POOLS.md).
4. **HeyReach** (managed LinkedIn): `HEYREACH_API_KEY` plus `HEYREACH_SENDER_ACCOUNT_ID` or `HEYREACH_SENDER_ACCOUNT_IDS` for a seat pool.
5. Fair-share defaults: `JARGON_EMAIL_DAILY_PER_ORG=50`, `JARGON_LINKEDIN_DAILY_PER_ORG=20`, `JARGON_VOICE_DAILY_PER_ORG=100`, `JARGON_CONCURRENT_CALLS_PER_ORG=1`
6. Set `JARGON_ENCRYPTION_KEY`, `JARGON_PUBLIC_URL`, and `JARGON_APP_URL` in production
7. Ask Plivo to raise account CPS before parallel dialing (default ~2/sec account-wide)
