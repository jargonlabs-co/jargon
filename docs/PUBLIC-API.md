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

Live send/dial also spends credits (email 1, call 5, LinkedIn 2). Empty balance → `402` + `billingUrl`. Sandbox keys and credit checks are free. `GET /account/credits`, `GET /account/usage`, `POST /account/billing-link`.

## Prospects

Already in the API’s Postgres (workspace snapshots from Railway/HubSpot). Read via:

- `GET /v1/prospects` — org-wide list (`q`, `status`, `projectId`, `limit`, `offset`)
- `GET /v1/prospects/{id}`
- `GET /v1/projects/{id}/contacts` — one workspace
- `GET /v1/projects/{id}/queue/next`

Do not build a separate store or cache prospect PII locally. Pass the working list on deploy, or connect HubSpot/Railway and let deploy hydrate.

## Claude Code

Prefer the MCP ([MCP.md](./MCP.md)):

```bash
claude mcp add --scope user \
  --env JARGON_API_URL=https://jargon-api-production.up.railway.app \
  --env JARGON_API_KEY=jarg_test_... \
  jargon -- npx -y @jargon_labs/mcp
```

Or raw HTTP:

```bash
export JARGON_API_URL=https://jargon-api-production.up.railway.app
export JARGON_API_KEY=jarg_...
```

After analysis, ingest the working list with `import_list` (MCP) or `POST /v1/tools/deploy` with `{ "prompt": "…", "contacts": [ { "name", "company", "title", "email", "phone", "linkedinUrl" } ] }`. That list becomes the queue. Omit `contacts` only to hydrate from HubSpot/Railway. Append later with `POST /v1/projects/{id}/contacts`.

Open `https://jargonlabs.co` + `dashboardPath` as the same account that owns the key.
