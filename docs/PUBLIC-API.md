# Jargon Dialer — public API

Base: `https://jargon-api-production.up.railway.app/v1`  
Auth: `Authorization: Bearer $JARGON_API_KEY` (in `.env`, never commit)  
Contract: [`../openapi.json`](../openapi.json) — the **only** source of truth for endpoints.  
Live spec: `GET /v1/openapi.json`  
Types: `src/api/types.gen.ts` — generated, never hand-edit.

```bash
npm run api:types
```

## Hard rules

- NEVER call an endpoint absent from `openapi.json`. If you need one that does not exist, STOP. Do not guess a path or field name.
- NEVER pass `org_id` / `tenant_id` in a request. Tenancy comes from the key.
- Use a **sandbox** key (`jarg_test_…`, from `jargon api-keys create --sandbox` or `JARGON_TEST_KEY`) for all local/dev work. The live key (`jarg_…`) can place **real calls and send real email**.
- Every dial/send request **must** send `Idempotency-Key`. Replay within 24h returns the original response.
- Regenerate types after any spec change; never hand-edit the generated file.

## Limits

Send/dial per org, per 15-minute window: live 60 emails / 30 calls; sandbox 120 / 60. Over limit → `429` + `Retry-After`.

## Prospects

Already in the API’s Postgres (workspace snapshots from Railway/HubSpot). Read via:

- `GET /v1/prospects` — org-wide list (`q`, `status`, `projectId`, `limit`, `offset`)
- `GET /v1/prospects/{id}`
- `GET /v1/projects/{id}/contacts` — one workspace
- `GET /v1/projects/{id}/queue/next`

Do not build a separate store, import CSVs, or cache prospect PII locally. Connect + deploy hydrates the list; then only use these endpoints.

## Claude Code

```bash
export JARGON_API_URL=https://jargon-api-production.up.railway.app
export JARGON_API_KEY=jarg_...
```

After analysis, `POST /v1/tools/deploy` with `{ "prompt": "…" }`. Open `https://jargonlabs.co` + `dashboardPath` as the same account that owns the key.
