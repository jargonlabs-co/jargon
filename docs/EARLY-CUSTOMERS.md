# Early customer rollout checklist

Public product: CLI deploy + website dashboard. Internal outbound is [`outbound-ops`](https://github.com/jargonlabs-co/outbound-ops) ([SEPARATION.md](./SEPARATION.md)).

```
jargon CLI  ──▶  Hosted API  ──▶  Website /tools/:id (login required)
Claude Code ─┘
```

## Done in repo

- [x] CLI `login` / `deploy` / `list` / `api-keys`
- [x] `POST /tools/deploy` creates a tool (no share links)
- [x] Website login dashboard + tool UIs
- [x] Gmail + Twilio + HeyReach connections

## Needs you (infra)

- [ ] Hosted API on Railway with `DATABASE_URL`, `JARGON_ENCRYPTION_KEY`, `JARGON_PUBLIC_URL`, `JARGON_APP_URL`
- [ ] Gmail OAuth redirect `https://YOUR_API/oauth/gmail/callback`
- [ ] Twilio Voice + TwiML URLs
- [ ] HeyReach API key (or accept demo LinkedIn send)
- [ ] Landing on Vercel with `VITE_API_URL`
- [ ] Publish `@jargon/cli` to npm (optional)
