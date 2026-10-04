# Production readiness

Goal: onboard ~50 customers in separate orgs, each using the website, CLI, and the Jargon connector in Claude, with real email / calls / LinkedIn going to real prospects.

Audit date: 2026-10-02. Baseline: 74/74 tests pass (`node --import tsx --test scripts/*.test.ts`). `tsc --noEmit` fails only in `src/shared/plivoSdp.ts` (uncommitted work in progress).

## What already works

- Supabase login, one org per signup, Jargon API keys, Claude MCP OAuth (PKCE). Every MCP / v1 handler resolves `actor.orgId` and looks records up with `findOrgProject` / `findOrgContact` / `findOrgMessage`.
- HubSpot, Railway, and Postgres connections are per org, with tokens encrypted (AES-GCM).
- Voice DIDs are exclusive per org. Email and LinkedIn have per-org daily budgets.
- Stripe webhooks verify signatures. Credits are charged and refunded per org.

The gap is not "login doesn't work." It's that the server still has dogfood defaults, shared-everything storage, and outbound that is not yet safe to point at real prospects for 50 different companies.

---

## P0: blocks a 50-org launch

### Security and fail-closed config

Production is detected by `RAILWAY_ENVIRONMENT` or `NODE_ENV=production` (`src/server/env.ts`). Boot checks live in `src/server/production.ts`; tests in `scripts/production-hardening.test.ts`.

- [x] **Remove the boot-time demo account.** Deleted `bootstrap.ts`, the demo signup in `standalone.ts`, and `ensureSupabaseUser`. **Manual step:** delete `demo@jargon.app` in the Supabase dashboard (Auth → Users), since it still exists there.
- [x] **Fail boot without `JARGON_ENCRYPTION_KEY`.** Production refuses to start if the key is missing, under 32 chars, or the public dev key. Rotate with `JARGON_ENCRYPTION_KEY_PREVIOUS` (secrets re-encrypt on boot).
- [x] **Fail boot without `DATABASE_URL` in production.** `createHostedStore` throws in production; the Dockerfile no longer sets `JARGON_DB_PATH`. `JsonStore` throws on a corrupt file instead of overwriting it.
- [x] **Make `demoMode` explicit.** Demo mode is always off in production. Calls and LinkedIn throw (credits refunded) instead of faking; HubSpot/Railway `code=demo` OAuth is refused. Email already threw.
- [x] **Verify Plivo webhook signatures.** V3 signatures checked on `/voice/plivo/answer`, `/dial`, `/hangup` (matches plivo-node's `validateV3Signature`).
- [x] **Fix cross-org call attribution.** The fallback now only matches a dialing call on the same pool DID as the calling SIP endpoint. `/answer` hangs up if the call ID belongs to a different endpoint than the caller.
- [x] **Remove the Twilio voice routes.** `/voice/twiml` and `/voice/status` are unauthenticated and Twilio isn't the voice provider anymore (see cleanup).
- [x] **Close the MCP preview reflection.** `payload` removed, `<` escaped, and the route is not mounted in production.
- [x] **Stop leaking ops data on `/health`.** Public `/health` returns `{ ok, storage }`. Details moved to `/health/details` with `Authorization: Bearer $JARGON_ADMIN_TOKEN` (404 otherwise).
- [x] **Require email verification on signup.** On by default in production (`JARGON_REQUIRE_EMAIL_VERIFICATION=0` opts out). Sign-up goes through Supabase `signUp`, which emails a link to `{appUrl}/login?verified=1`. No session or workspace is created until the first sign-in after confirming (name and org are kept in user metadata). Unconfirmed sign-in returns 403 `email_not_confirmed`; `POST /auth/resend-verification` sends a new link. The website shows "check your inbox" and a resend button. **Manual (Supabase dashboard):** Authentication → Sign In / Providers → Email → turn on **Confirm email**; Authentication → SMTP → set custom SMTP (Supabase's built-in sender is limited to a few emails an hour); URL Configuration → add `https://jargonlabs.co/login` to Redirect URLs. If "Confirm email" is off, sign-ups are let in and the API logs a warning.
- [x] **Rate-limit unauthenticated endpoints.** Per-IP limits on `/auth/login` (20/15m), `/auth/register` (5), `/auth/forgot-password` (5), `/auth/resend-verification` (5), `/auth/reset-password` (10), `/oauth/register` (100), `/oauth/token` (300). `/oauth/register` reuses an existing client for identical redirect URIs and caps input size.

### Outbound that's safe for real recipients

- [x] **Reply detection.** `src/server/mailboxes.ts` polls each connected org mailbox every 3 min (production, or `JARGON_REPLY_POLL=1`): Gmail via the history API, Outlook via inbox `receivedDateTime`. Only threads Jargon sent in the last 60 days count. A reply sets the contact to `replied`, cancels its queued and draft messages, and logs an activity with the snippet. Auto-replies and out-of-office only log. Bounce notices in that inbox are suppressed the same way as pool bounces. **Limits:** mail sent through the shared pool still has no reply detection; replies aren't shown in the website yet, only as activities.
- [x] **Unsubscribe and suppression.** `src/server/compliance.ts`. Every email carries `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058) and a footer link to `/u/:token` (signed, GET shows a button, POST unsubscribes). Per-org and global suppression lists (email, domain, phone, LinkedIn) are checked in `sendPublicMessage`, `deliverPublicMessage`, the scheduler (before charging), and enrollment. Adding a suppression cancels queued messages it covers. HubSpot `hs_email_optout` blocks email. Org API: `/v1/suppressions`, `/v1/account/compliance`. **Follow-ups:** a website page for the list and postal address; require `postalAddress` before live email.
- [x] **Bounce handling.** `src/server/bounces.ts` polls each pool mailbox for mailer-daemon notices every 10 min (production only), parses 5.x.x recipients, and globally suppresses addresses Jargon actually emailed. **Manual step:** pool refresh tokens need the `gmail.readonly` scope, otherwise polling logs a warning and skips that mailbox.
- [x] **Voice compliance.** Do-not-call list plus 8:00–21:00 recipient-local window (`JARGON_CALL_WINDOW`), checked at call start and again in the Plivo `/answer` webhook. Timezone from `attrs.timezone` / HubSpot `hs_timezone`; US numbers without one must be in-window in both ET and PT; non-US numbers need a timezone. In production `/answer` only dials the stored phone of a real Jargon call, so the softphone can't dial arbitrary numbers.
- [x] **Sender identity: per-org mailboxes (decided 2026-10-02).** Account → Data → Sending mailbox connects Gmail / Google Workspace or Outlook / Microsoft 365 (one per org; connecting the other replaces it). Email sends from that mailbox (Outlook via a MIME draft so `List-Unsubscribe` survives), capped by `JARGON_MAILBOX_DAILY_LIMIT` (200/day). A revoked grant marks the mailbox for reconnect and blocks email instead of silently using the pool. Orgs without a mailbox fall back to the shared pool unless `JARGON_REQUIRE_ORG_MAILBOX=1`. **Before launch:** register both OAuth redirect URIs (see `.env.example`); Google's restricted scopes need verification (CASA) past 100 users; some Microsoft tenants need admin consent; turn on `JARGON_REQUIRE_ORG_MAILBOX` once customers are moved over. SMTP / custom-domain sending isn't supported.
- [ ] **Inventory sized for 50 orgs.** Voice is exclusive per org and `PLIVO_POOL_JSON` is hand-maintained. **Done in code:** when the pool is full, the DID of the org idle longest (no calls in `JARGON_VOICE_RECLAIM_DAYS`, default 30, and no live call) is reassigned, so you need about one DID per *actively calling* org. Customers see "Calling is at capacity" instead of ops instructions. The API logs `Voice pool low` at 20% free and `Voice pool exhausted` when full; `/health/details` lists who holds each DID. **Manual:** buy DIDs for expected active callers plus ~20% (Plivo number + endpoint each), and size HeyReach seats (least-loaded shared, `JARGON_LINKEDIN_DAILY_PER_ORG`). Email no longer needs pool sizing once orgs connect their own mailbox. Auto-provisioning DIDs isn't built.

### Storage

- [x] **Move off the single `jargon_state` JSONB row (step 1 of 2).** State now saves as one row per record in `jargon_records (collection, id, org_id, seq, data)`. Each save writes only added, changed, or removed records, and bursts of updates coalesce into one transaction. The first boot migrates the old row in one transaction (the old row is left in place, and a boot snapshot is taken). Tested against real Postgres (PGlite) in `scripts/pg-store-real.test.ts`. **Step 2, not done:** reads still come from an in-memory copy of everything, so memory grows with total data and the API is limited to one replica. The next move is to load per org on demand and query tables directly for hot paths (sessions, API keys, messages due). That's a rewrite of every `store.db` read (about 150 call sites), so do it once load requires it.
- [x] **Single-writer scheduler.** `PgStore` claims the state row on boot (`writer_epoch`). Every write, every scheduler tick, every queued message, and every immediate email send checks the claim. A replaced process (deploy overlap or a second replica) has its writes rejected, stops sending, and exits 0 so Railway doesn't restart it. **Still:** run exactly one replica. A second one just kills the first. Horizontal scale waits on relational storage.
- [x] **Backups plus a tested restore.** In-database snapshots in `jargon_state_snapshots`: one at every boot (state before the new code touches it) and one daily, 14 kept of each. `npm run db:state -- list | export | verify | restore` handles off-site copies and restores (see `docs/RAILWAY-POSTGRES.md`). Restore saves a `pre-restore` snapshot first and fences the running API. **Manual:** turn on Railway volume backups for the product Postgres (snapshots in the same database don't survive losing it). Run the restore drill once before launch, then monthly.

---

## P1: painful at 50 orgs

### Accounts and teams
- [ ] Team invites, roles, and multiple memberships. `orgForUser` uses the first membership only, and nothing checks `role`. Today every org is one person.
- [x] Enforce `maxMembers` / `maxDataSources` from `billing/catalog.ts` or remove them. Removed: they weren't advertised, there are no invites yet, and a one-source cap on Free would block the Railway + HubSpot path. Add back with team invites if needed.
- [x] Account and org deletion, plus data export (prospect PII is stored per org). Settings → Your data: `GET /account/export` (every org record, no credentials) and `DELETE /account` (session only, type the workspace name; blocked while a paid plan is active). Deletion revokes mailbox tokens, removes every org record and members with no other org, and deletes their Supabase login. Global hard-bounce suppressions and Supabase billing ledgers are kept.
- [x] Replace dogfood email checks with feature flags: `JARGON_UNLIMITED_TOOLS_EMAILS` and `JARGON_HUBSPOT_ENRICHMENT_WAIT_EMAILS` (comma-separated; unset keeps `tara@jargonlabs.co`, empty turns them off).
- [x] Expire and clean up sessions, MCP auth codes/tokens/clients, OAuth states, idempotency records, and rate windows. `housekeeping.ts` runs hourly from the scheduler.

### Claude connector
- [x] MCP refresh tokens. Access tokens last 24h; refresh tokens rotate on every use and last 90 days from the last refresh, so an active connector never expires. A refresh fails once the user leaves the org. Connectors authorized before this change still get one 30-day token and then re-authorize once.
- [x] Make instructions stack-agnostic. `JARGON_MCP_INSTRUCTIONS`, `nextAction`, and the tool descriptions now say facts come from the customer's source (HubSpot, Railway/Postgres, pasted list) via `context` and `attrs`. Lusha property mapping is still supported.
- [x] Bring the npm stdio MCP (`mcp/src/index.ts`) to parity, or deprecate it. Deprecated: 0.2.0 prints a notice pointing to the hosted connector, and the website's API-key snippet now uses `claude mcp add --transport http` with the key as a bearer header. **Manual:** `npm publish` 0.2.0, then `npm deprecate` (commands in `mcp/README.md`). Previously: It's missing `enroll_hubspot`, `list_crm_contacts`, `list_tasks`, `load_email_workspace`, `note_schedule_choice`, `resume_workspace`, `show_email_workspace`, `show_tasks`.

### Data and enrichment (from the enrichment review)
- [x] Structured ingest Claude is allowed to use (`contacts[]` with `attrs`), plus an `upsert_enrichment` tool that merges by email / LinkedIn / CRM id. MCP `upsert_enrichment` takes rows as a table/CSV/JSON string (Allow cards can't render nested arrays), and `POST /v1/contacts/enrichment` takes `contacts[]`. Rows match by contactId, CRM id, email, or LinkedIn within the org. Extra columns become `attrs`, blank identity fields are filled (never overwritten), and context is appended. People who become complete are enrolled if the sequence is running.
- [x] Parse requested fields from the deploy prompt and require them before enroll. `shared/requestedFields.ts` reads `{{placeholders}}` plus signals named in a personalization clause ("personalize with their funding and tech stack"), so audience filters like "companies that raised a Series B" don't gate anything. Fields are stored on `project.requestedFields`. Enroll skips anyone missing one (`Missing requested fields: …`), and the deploy response returns `requestedFields`, `missingFields`, and a `nextAction` pointing Claude at `upsert_enrichment`. Vendor aliases count (Bombora topics satisfy `intent_topics`).
- [x] Source-agnostic signal aliases so ranking and `{{attrs.*}}` work beyond Lusha property names. `shared/signalAliases.ts` maps Lusha, Bombora, 6sense, Demandbase, G2, and common warehouse column names (case and punctuation-insensitive) to canonical signals. Ranking no longer labels people "inbound" at random: inbound now means a real intent signal.
- [x] Remove synthetic context. `buildProspectContext` is gone; Postgres, Railway, and pasted rows get only facts from the row (`factsFromProspect`: title, size, city, industry, domain).
- [x] Copy HubSpot company properties into `attrs`, and revisit the 80-prop / 40-attr caps for requested fields. Custom company properties land as `company_*` with their own 20-key budget, so contact fields can't crowd them out. Raising caps for specific requested fields is part of the "parse requested fields" item below.
- [x] HubSpot writeback. Sent emails, completed live calls (with duration and outcome), notes, and dispositions are logged as engagements on the HubSpot contact. They go through a durable `hubspotOutbox` flushed by the scheduler: retries with backoff on 429/5xx, and on 403 the Data page shows "Reconnect HubSpot". Access tokens now refresh (they expire after 30 minutes; before this, HubSpot reads silently broke after the first half hour). Set `meta.writeback = 'off'` on the connection to opt out. **Manual:** add the `crm.objects.contacts.write` scope to the HubSpot app; existing portals must reconnect to grant it.

### API surface
- [x] Move the CLI from legacy `/tools/deploy` to `/v1/tools/deploy`. Password login now swaps the session for a "Jargon CLI" API key (existing session configs are swapped on the next `deploy` or `prospects`).
- [x] Retire the unversioned legacy routes in `index.ts` that duplicate `/v1` once the website is migrated. **Decision: keep them as the tool app's session API.** The website (`landing/`) only uses account/auth/connection routes, which have no `/v1` twin. The duplicates serve the tool app (`src/renderer`), which needs session auth and the `ProjectBundle` response shape, so moving it to `/v1` would mean rewriting its data layer for no user benefit. The routes are thin wrappers over the same `publicApi` functions as `/v1`, and drift is fixed: `PATCH /contacts/:id` sends outcomes through `applyDisposition` (follow-ups cancelled, HubSpot logged) and no longer wipes an outcome when the app marks a selected contact `active`. `/calls/:id/complete` validates the disposition, and `/contacts/:id/messages` validates channel/status and returns the real status (409 on compliance blocks, not 502). Covered by `scripts/tool-app-routes.test.ts` and the tenant-isolation route walk.
- [x] Settle the hostnames. Decision: the API is `api.jargonlabs.co`, the app is the apex, and `www` stays as a legacy alias of the API so installed Claude connectors keep working (`JARGON_PUBLIC_URL_ALIASES`; MCP OAuth discovery answers with whichever host was called). Code and docs now point at `api.`. **Cutover, in this order:**
  1. DNS: `api` CNAME to the Railway service, and add `api.jargonlabs.co` as a custom domain on that service. Keep `www`.
  2. Add `https://api.jargonlabs.co/oauth/<provider>/callback` redirect URIs in Google (gmail), Azure (outlook), the HubSpot app, and the Railway OAuth app. Keep the old ones until the cutover is done, then remove them. Update the Stripe webhook URL to `https://api.jargonlabs.co/billing/stripe/webhook`.
  3. Railway env: `JARGON_PUBLIC_URL=https://api.jargonlabs.co` and `JARGON_PUBLIC_URL_ALIASES=https://www.jargonlabs.co`, then redeploy. Plivo URLs re-sync at boot.
  4. Vercel: `VITE_API_URL=https://api.jargonlabs.co`, then deploy the website. Do this last: the website advertises `api.jargonlabs.co/mcp`.

---

## P2: engineering hygiene

- [x] CI (`.github/workflows/ci.yml`) typechecks the API and website and runs `npm test` on every PR and push to `main`. It will fail until the `plivoSdp.ts` errors below are fixed.
- [ ] Fix the `plivoSdp.ts` type errors before merging that work.
- [x] Error monitoring (e.g. Sentry) and structured logs with `orgId` on API, scheduler, and webhooks. `observability.ts`: in production every request is one JSON line (`requestId`, route, status, ms, `orgId`); unhandled errors return `{ error, requestId }` with no stack and go to Sentry when `SENTRY_DSN` is set. Scheduler, reply poll, bounce poll, and boot failures are reported the same way. **Manual:** create a Sentry project and set `SENTRY_DSN` on Railway.
- [ ] A staging environment with its own Supabase, Postgres, and sandbox pools.
- [x] Tests for tenant isolation (cross-org lookups return 404), webhook signature rejection, and scheduler idempotency. `tenant-isolation.test.ts` walks every id route and every MCP tool with another org's ids and checks for leaks and writes. `send-idempotency.test.ts` covers a manual send racing the scheduler (this was a real double-send; sends are now locked per message, and cancelled messages are refused).

---

## Cleanup plan

### Deleted (2026-10-02)
- The 9 `tmp-*` preview files at the repo root.
- Twilio: `providers/twilio.ts`, `/voice/twiml`, `/voice/status`, `config.twilio`, the Twilio branches in `providers/voice.ts`, `twilio` on `/health`, `landing/src/lib/twilioVoice.ts`, the `twilio` and `@twilio/voice-sdk` packages, and `twilio` from the call-mode and connection-provider types. `toE164` now lives in `src/shared/phone.ts`.
- Customer Gmail OAuth: `gmailAuthUrl`, `exchangeGmailCode`, `finishGmailOAuthHtml`, `config.google.scopes`.
- `writeDemoContactsToProject` and the fake contact generator behind it.
- `ShareLink` / `PreviewComment` / shared-preview types and their state arrays.
- `hashPassword`, `verifyPassword`, `User.passwordHash/passwordSalt`. `migrateDb` strips any old hashes and share arrays from saved state on boot.
- Desktop leftovers: `deepLinkScheme`, `desktopDeepLink`, `defaultDbPath`.

Kept: `ensureHeyReachConnection` / `resolveHeyReachApiKey` are the managed LinkedIn send path, not customer helpers. `validateHeyReachKey` is used by `scripts/heyreach-check.ts`.

### Needs a decision first
| Item | Question |
|------|----------|
| `src/renderer/` | Not dead: the website tool page (`landing/src/components/ToolApp.tsx`) mounts its `ProductApp`. Move the pages you still use into `landing/`, delete the rest (Campaigns, Context, Analytics?), then drop the `@renderer` alias |
| `/campaigns/:id/pause`, `/run` and `CampaignsPage` | Only the old renderer calls these. Keep only if the dialer campaign view stays |
| `.github/workflows/deploy-landing.yml` (GitHub Pages, base `/jargon/`) | Landing also deploys via `vercel.json`. Keep one |
| Legacy unversioned routes in `index.ts` | Delete once landing and the CLI are on `/v1` |
| `scripts/heyreach-check.ts` | Manual diagnostic. Keep or move to `scripts/ops/` |
| `mcp/` stdio package | Bring to parity or deprecate in favor of the hosted connector |
| Crustdata references (`fieldCatalog.ts`, `deployContacts.ts`, `postgresProspects.ts`, `renderer/lib/prospectContext.ts`) | Ops vocabulary inside the product. Keep only the generic column aliases |

### Keep, but isolate from production
- `SAMPLE_EMAIL_WORKSPACE` / `SAMPLE_QUEUE_WORKSPACE` / `SAMPLE_TASKS_WORKSPACE`: only for the MCP app preview. Serve that route in dev only.
- Sandbox API keys (`jarg_test_`): legitimate, keep.
- `.gitignore` entries for `mcp-pdl/`, `.env.apollo`, `.env.hubspot`: harmless, prune whenever convenient.

### Docs that contradict the product
- `docs/API.md` lists "MCP" and "day-based sequence scheduler" as out of scope. Both have shipped.
- `docs/RAILWAY-POSTGRES.md` requires `CRUSTDATA_API_KEY` and documents the demo tenant.
- `docs/EARLY-CUSTOMERS.md` doesn't mention the MCP connector, pools, or compliance.
- `mcp/README.md` points `JARGON_API_URL` at `www`.

---

## Suggested order

1. **Week 1:** P0 security and fail-closed config, plus the safe-to-delete cleanup (small, low risk, shrinks the surface before bigger work).
2. **Weeks 2–3:** reply detection, unsubscribe, suppression, bounces. Make the sender identity decision.
3. **Weeks 3–5:** relational storage migration and the single-writer scheduler, behind a dual-write or one-shot migration from `jargon_state`.
4. **Then:** teams, MCP refresh tokens, enrichment ingest, CLI on `/v1`, CI.
