# Jargon GTM Execution API

**Public contract:** [`openapi.json`](../openapi.json) and [PUBLIC-API.md](./PUBLIC-API.md).

Auth: `Authorization: Bearer jarg_…` (create via CLI `jargon api-keys create` or the dashboard).

Base URL (public): `https://jargon-api-production.up.railway.app/v1`  
Legacy (website/CLI): same host **without** `/v1`.

MCP comes later and will wrap `/v1` 1:1.

---

## Session

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/auth/me` | User, org, plan, credits, Claude connector status |
| `POST` | `/auth/api-keys` | `{ name }` → returns key once |
| `GET` | `/auth/api-keys` | List keys (no secrets) |

---

## Data

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/connections` | Connected providers |
| `POST` | `/connections/hubspot/sync` | Refresh HubSpot contacts into projects |
| `POST` | `/connections/railway/sync` | Refresh bound Postgres prospects |
| `POST` | `/connections/postgres/sync` | Refresh URL-based Postgres |

Connect flows (OAuth / bind) stay as today — use CLI or dashboard.

---

## Workspaces

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/tools/deploy` | `{ prompt }` → `{ projectId, contactCount, dashboardPath, bundle }` |
| `GET` | `/projects` | List workspaces for the org |
| `GET` | `/projects/:id` | Full bundle (UI) |
| `DELETE` | `/projects/:id` | Delete workspace |

---

## Queue (new)

### `GET /v1/prospects`

Org-wide list. Query: `projectId`, `status`, `q`, `limit`, `offset`. Same payload as contact list.

### `GET /v1/prospects/:id`

### `GET /projects/:id/contacts`

Query: `status`, `q` (name/company/title/email/city), `limit` (default 50, max 200), `offset`.

```json
{
  "contacts": [ /* Contact */ ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

### `GET /projects/:id/queue/next`

Returns the next actionable contact (`active`, else earliest `queued` / `no_answer`) plus the current sequence step template.

```json
{
  "contact": { /* Contact or null */ },
  "step": { "channel": "email", "label": "…", "subject": "…", "body": "…" },
  "remaining": 12
}
```

Empty queue: `{ "contact": null, "step": null, "remaining": 0 }`.

### `POST /contacts/:id/disposition`

Body:

```json
{
  "status": "interested",
  "note": "Wants demo Tuesday",
  "advanceStep": true
}
```

`status` required: `queued` | `active` | `completed` | `replied` | `no_answer` | `interested` | `not_interested`.

`advanceStep` optional. Default: advance on `interested` | `completed` | `replied`.

Response: `{ contact, next }` where `next` is the same shape as `queue/next`.

---

## Execute

| Method | Path | Body / notes |
|--------|------|----------------|
| `POST` | `/contacts/:id/messages` | `{ channel: "email"\|"linkedin", subject?, body, status: "sent"\|"draft" }` |
| `POST` | `/contacts/:id/calls` | Start dial session |
| `POST` | `/calls/:id/complete` | `{ disposition }` (call-scoped outcome) |
| `POST` | `/contacts/:id/notes` | `{ note }` |
| `PATCH` | `/contacts/:id` | Partial contact update |
| `GET` | `/voice/token` | Twilio JWT when voice is live |

Prefer **`/disposition`** for outcomes that are not tied to an open call.

---

## Agent loop (curl)

```bash
API=https://jargon-api-production.up.railway.app
KEY=jarg_...

# Deploy / open a workspace
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"Today queue for GTM Engineers in the US"}' \
  "$API/tools/deploy"
# → projectId

# Next contact
curl -s -H "Authorization: Bearer $KEY" \
  "$API/projects/$PROJECT_ID/queue/next"

# Send email (uses platform Gmail; may be demo mode)
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"channel":"email","status":"sent","subject":"Quick question","body":"Hi…"}' \
  "$API/contacts/$CONTACT_ID/messages"

# Disposition
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"status":"interested","note":"Booked for Tuesday"}' \
  "$API/contacts/$CONTACT_ID/disposition"
```

---

## Out of scope (for now)

MCP · day-based sequence scheduler · HubSpot writeback · customer-owned send identity.
