# Early customer rollout checklist

Ship downloadable desktop + CLI deploy for org sharing.

## Architecture

```
Desktop app  ──┐
Claude Code  ──┼──▶  Hosted API  ──▶  Share URL (browser rep console)
jargon CLI   ──┘
```

---

## Todo status

### Done in repo (this branch)

- [x] Crustdata prompt → prospect queue
- [x] Rep-facing queue UI (ToolWorkspacePage)
- [x] Share preview (browser deploy)
- [x] API key auth (`POST /auth/api-keys`)
- [x] `POST /tools/deploy` — create project + share URL in one call
- [x] `jargon` CLI (`login`, `deploy`, `list`, `share`, `api-keys create`)
- [x] Electron packaging + GitHub Release workflow

### Needs you (infra / accounts)

- [ ] **Hosted API live** — Railway at `https://jargon-api-production.up.railway.app` with env vars set
- [ ] **Preview URL** — set `JARGON_PREVIEW_URL` on API to where `preview.html` is hosted
- [ ] **Crustdata key** — `CRUSTDATA_API_KEY` on hosted API (you have locally)
- [ ] **Gmail OAuth** — production redirect URI on Google Cloud console
- [ ] **Twilio** — complete account SID, auth token, TwiML app, from number
- [ ] **Encryption key** — strong `JARGON_ENCRYPTION_KEY` on Railway (not default)
- [ ] **GitHub Release** — tag `v0.2.0` to publish `.dmg` / `.exe`
- [ ] **Apple code signing** (optional but recommended) — `CSC_*` secrets in GitHub Actions
- [ ] **Custom domain** (optional) — `api.jargon.app`, `app.jargon.app`

### Next engineering (after infra)

- [ ] **Customer portal** — deploy `portal/` to Vercel at `app.jargon.app` (`npm run portal:build`)
- [ ] Set `JARGON_PORTAL_URL` on Railway API + `VITE_API_URL` on portal Vercel project
- [ ] Stripe keys for self-serve Pro billing (`STRIPE_*` in `.env.example`)
- [ ] Desktop build defaults to hosted API (`JARGON_API_URL` baked into production build)
- [ ] Landing page download button → GitHub Release URL
- [ ] Self-serve register screen (replace demo-only onboarding)
- [ ] Publish `@jargon/cli` to npm
- [ ] Postgres migration (JSON DB is fine for first 5 customers)

---

## What I need from you

| Item | Why | Example |
|------|-----|---------|
| **Production API URL** | CLI + desktop point here | `https://jargon-api-production.up.railway.app` |
| **Preview host URL** | Share links open rep UI | `https://app.jargon.app` or Vite preview CDN |
| **Railway env vars** | Crustdata + OAuth on server | See `.env.example` |
| **Google OAuth redirect** | Gmail in production | `https://YOUR_API/oauth/gmail/callback` |
| **GitHub org/repo for releases** | Desktop download | Tag push triggers release workflow |
| **Apple Developer cert** (mac) | No Gatekeeper warning | Or accept unsigned for first testers |

---

## CLI quick start

```bash
# Local dev
npm run api          # terminal 1
npm run jargon -- login --email demo@jargon.app --password jargon-demo
npm run jargon -- deploy "Find 20 prospects to contact today" --json

# Production
export JARGON_API_URL=https://jargon-api-production.up.railway.app
npm run jargon -- login --email you@company.com --password ...
npm run jargon -- deploy "Find 20 VP Sales in Austin" --label "Austin queue"
```

### Claude Code workflow

```bash
# One-time: create long-lived key
jargon login --email you@co.com --password ...
jargon api-keys create --name "Claude Code"
jargon login --api-key jarg_...

# In any script or agent step
jargon deploy "Find 20 prospects from Series B SaaS" --json
# → { "shareUrl": "https://...", "contactCount": 20, ... }
```

Paste `shareUrl` in Slack. Reps work the queue in browser.

---

## Desktop quick start

```bash
# Build for hosted API
JARGON_API_URL=https://jargon-api-production.up.railway.app npm run dist:mac

# Or cut a release
git tag v0.2.0 && git push origin v0.2.0
# → GitHub Actions uploads .dmg to Releases
```

Early customers: download → register → chat prompt → share link.

---

## Share URL requirements

Share links use `JARGON_PREVIEW_URL` + `preview.html#/<token>`.

The preview bundle must be hosted somewhere the browser can load:
- Option A: Ship preview as static assets on same domain as API
- Option B: Include preview in Electron build and host separately on Vercel/Railway static

Set on Railway:
```env
JARGON_PREVIEW_URL=https://your-preview-host.com
JARGON_PUBLIC_URL=https://jargon-api-production.up.railway.app
```

---

## Test checklist before first customer

- [ ] `curl $API/health` returns `ok: true`
- [ ] `jargon login` + `jargon deploy` returns share URL with live contacts
- [ ] Share URL opens rep queue in browser
- [ ] Gmail connect + test send works
- [ ] Desktop app registers new user (not just demo tenant)
- [ ] Desktop download link works on landing page
