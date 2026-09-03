# Early customer rollout checklist

Public product: CLI deploy + website dashboard. Internal outbound is [`outbound-ops`](https://github.com/jargonlabs-co/outbound-ops) ([SEPARATION.md](./SEPARATION.md)).

```
jargon CLI  ──▶  Hosted API  ──▶  Website /tools/:id (login required)
Claude Code ─┘
```

## Done in repo

- [x] CLI `login` / `deploy` / `list` / `api-keys`
- [x] `POST /tools/deploy` creates a tool (no share links)
- [x] HubSpot as the customer data layer (OAuth + contact sync)
- [x] Website login dashboard + tool UIs
- [x] Platform Gmail / Twilio / HeyReach (not customer-connected)

## Needs you (infra)

- [ ] Hosted API on Railway with `DATABASE_URL`, `JARGON_ENCRYPTION_KEY`, `JARGON_PUBLIC_URL`, `JARGON_APP_URL`
- [ ] HubSpot OAuth app redirect `https://YOUR_API/oauth/hubspot/callback`
- [ ] Platform Gmail: `GOOGLE_*` + `GMAIL_REFRESH_TOKEN` (Jargon mailbox, not customer OAuth)
- [ ] Twilio Voice + TwiML URLs
- [ ] HeyReach API key (or accept demo LinkedIn send)
- [ ] Landing on Vercel with `VITE_API_URL`
- [ ] Publish `@jargon/cli` to npm (optional)
