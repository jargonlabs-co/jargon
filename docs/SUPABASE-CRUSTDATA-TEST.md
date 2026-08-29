# Supabase + Crustdata test setup

This guide walks through connecting **your** Supabase project as Jargon's context layer, with Crustdata as the people data source.

## Architecture for this test

```
Crustdata API  ──(optional seed script)──▶  Supabase jargon_prospects
                                                    │
                                                    ▼
                                           Jargon Today queue
                                           (email + call surfaces)
```

**Prospect priority** when you create a Today project:

1. **Supabase** — reads from your `jargon_prospects` table (preferred)
2. **Crustdata** — live person search if Supabase is empty/unconnected
3. **Apollo** — fallback if configured
4. Demo fixtures — if nothing else is connected

---

## Step 1: Create the Supabase table

1. Open your [Supabase SQL Editor](https://supabase.com/dashboard)
2. Paste and run [`docs/supabase-schema.sql`](supabase-schema.sql)

This creates `jargon_prospects` with columns Jargon maps automatically.

---

## Step 2: Load Crustdata into Supabase (optional)

If your Crustdata data is **already** in Supabase, skip to Step 3. Map your column names in the Connections UI or via `meta.columnMap` on the connection.

To seed from Crustdata API:

```bash
# Add to .env:
CRUSTDATA_API_KEY=your_key
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

npx tsx scripts/crustdata-to-supabase.ts --limit 50
```

This searches Crustdata for GTM-title prospects and upserts them into `jargon_prospects`.

---

## Step 3: Configure Jargon

```bash
cp .env.example .env
```

Add to `.env`:

```env
CRUSTDATA_API_KEY=...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_PROSPECTS_TABLE=jargon_prospects
```

Start the app:

```bash
npm run dev
```

Sign in: `demo@jargon.app` / `jargon-demo`

---

## Step 4: Connect in the UI

Open **Context** in the sidebar → Connections page.

1. **Supabase** — paste project URL + service role key (or rely on `.env`) → Connect
2. **Crustdata** — paste API key (or rely on `.env`) → Connect

You should see row count on Supabase and credit balance on Crustdata when connected.

---

## Step 5: Create a Today project

Use the chat prompt:

> Find me the top 100 prospects I need to contact today

If Supabase has rows, the queue loads from your warehouse (`prospect_source: supabase`). If the table is empty, Jargon falls back to a live Crustdata person search.

---

## Probe scripts (CLI smoke tests)

```bash
# Verify Crustdata key + search
npx tsx scripts/crustdata-probe.ts --limit 5

# Verify Supabase table read
npx tsx scripts/supabase-probe.ts --limit 5

# Seed Crustdata → Supabase
npx tsx scripts/crustdata-to-supabase.ts --limit 25
```

---

## Custom table / column mapping

If your Supabase table uses different column names, connect via API with a column map:

```bash
curl -X POST http://127.0.0.1:8787/connections/supabase/start \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectUrl": "https://xxx.supabase.co",
    "apiKey": "service_role_key",
    "table": "my_prospects"
  }'
```

Supported default columns: `name`, `email`, `phone`, `title`, `company`, `city`, `linkedin_url`, `company_domain`, `company_industry`, `company_size`, `crustdata_person_id`.

Jargon also recognizes aliases like `full_name`, `job_title`, `profile_url`, `employer`.

---

## Crustdata API reference

- [Introduction](https://docs.crustdata.com/general/introduction)
- [Person Search](https://docs.crustdata.com/person-docs/search/introduction)
- Auth: `Authorization: Bearer <key>` + `x-api-version: 2025-11-01`

Person search costs ~0.03 credits per result returned — start with `--limit 10` when testing.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Table not found` | Run `supabase-schema.sql` |
| `Invalid Supabase API key` | Use **service role** key from Project Settings → API |
| Empty Today queue | Check table has rows; run seed script or connect Crustdata |
| Crustdata 401 | Verify API key at [docs.crustdata.com](https://docs.crustdata.com) |
| Still shows Apollo demo | Disconnect Apollo or ensure Supabase/Crustdata connect first |
