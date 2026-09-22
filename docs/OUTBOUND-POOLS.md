# Managed outbound pools

Customers never bring send credentials. Jargon owns three pools; orgs get sticky
assignments plus fair-share budgets.

## Channels

| Channel | Assignment | Shared members? | Budget |
|---------|------------|-----------------|--------|
| Email | Sticky least-loaded | Yes | `emailDailyPerOrg` (default 50) |
| LinkedIn | Sticky least-loaded | Yes (seats under one HeyReach key) | `linkedinDailyPerOrg` (default 20) |
| Voice | **Exclusive sticky** | **No** — one org per DID | `voiceDailyPerOrg` (100) + `concurrentCallsPerOrg` (1) |

### Why voice is exclusive

Plivo STIR/SHAKEN attestation A only applies when caller ID is a Plivo DID rented by
this account. Sharing a DID across orgs means one bad list poisons the number for
everyone stuck to it, and inbound callbacks are ambiguous. If the pool is exhausted,
allocation fails — it does **not** degrade to sharing. Add members to `PLIVO_POOL_JSON`
(auto-provision of new Plivo numbers is not implemented yet).

`fromNumber` must always be a Plivo-rented DID on the originating account. Do not
accept customer main lines as caller ID (drops to attestation B/C → Spam Likely).

## Voice auth (JWT)

Softphones receive a short-lived Plivo Browser SDK JWT (`accessToken`), not the
endpoint password. Minted with `AuthId` + `AuthToken`, `sub` = endpoint username,
`VoiceGrants{IncomingAllow:false, OutgoingAllow:true}`.

`PLIVO_POOL_JSON` members are `{ id, fromNumber, endpointUsername }` only.
Use the **returned** username after Plivo creates the endpoint (12-digit suffix).

## Concurrency (store-tracked)

Do not poll Plivo live calls for org counts. On call-create (`beginManagedVoiceCall`):
increment by creating a `calls` row in `dialing`. On hangup/complete: set `endedAt`.
Phantom sweeper marks live calls older than 4h as `failed`.

Enforce concurrent + daily voice budgets at **call-create / answer**, not at
`GET /voice/token` (token is minted once per session; orgs dial many times on it).

Account-wide Plivo CPS defaults to ~2/sec — raise with Plivo support before
parallel dialing at scale.

## Env

```bash
GMAIL_POOL_JSON=[{"id":"m1","refreshToken":"...","label":"ops1"}]
PLIVO_POOL_JSON=[{"id":"v1","fromNumber":"+1...","endpointUsername":"jargonv1XXXXXXXXXXXX"}]
HEYREACH_SENDER_ACCOUNT_IDS=111,222
JARGON_EMAIL_DAILY_PER_ORG=50
JARGON_LINKEDIN_DAILY_PER_ORG=20
JARGON_VOICE_DAILY_PER_ORG=100
JARGON_CONCURRENT_CALLS_PER_ORG=1
```

Single-credential envs still hydrate a one-member pool (`id: default`).

`/health.outboundPools.voiceMembers[]` shows per-DID `orgId` holder and `liveCalls`.
