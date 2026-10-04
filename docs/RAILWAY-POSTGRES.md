# Railway Postgres — persistent user accounts

The hosted API stores all state (users, orgs, sessions, projects) in **Postgres** when `DATABASE_URL` is set. Without it, data lives in a JSON file that **resets on every Railway redeploy**.

## One-time setup (Railway dashboard)

Or via CLI (from repo root, linked to `jargon-api`):

```bash
railway add --database postgres
railway variable set DATABASE_URL='${{Postgres.DATABASE_URL}}' --service jargon-api
railway up --service jargon-api -d -y   # deploy latest code with Postgres support
```

Then verify:

```bash
curl -s https://jargon-api-production.up.railway.app/health | jq '.storage'
# "postgres"
```

### Dashboard alternative

1. Open your [Railway project](https://railway.com) → **+ New** → **Database** → **PostgreSQL**
2. Click the **Postgres** service → **Connect** → copy `DATABASE_URL`
3. Open your **Jargon API** service → **Variables** → add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (use Railway variable reference)
   - Or paste the URL manually
4. Ensure these are also set on the API service:
   - `JARGON_PUBLIC_URL` = `https://jargon-api-production.up.railway.app`
   - `JARGON_ENCRYPTION_KEY` = long random string
   - `CRUSTDATA_API_KEY` = your key
   - `JARGON_PORTAL_URL` / `JARGON_PREVIEW_URL` = your web URLs
5. **Redeploy** the API service

On boot the API creates table `jargon_state` automatically. Check `/health`:

```json
{
  "ok": true,
  "storage": "postgres"
}
```

Run **exactly one replica** of the API. Each boot claims the state row; a second replica takes it over and the first stops itself (exit 0).

## Create your account

Accounts use **Supabase Auth** (not Railway). Railway Postgres only stores app state
(orgs, tools, connections) after a successful Supabase login.

**Option A — Landing / portal**

1. Open your site → **Log in** → **Create account**
2. Use your real email + password (6+ chars)
3. Confirm the user appears under Supabase → **Authentication → Users**

**Option B — CLI**

```bash
export JARGON_API_URL=https://jargon-api-production.up.railway.app
npm run jargon -- login --email you@company.com --password 'your-password'
# or register via API:
curl -X POST "$JARGON_API_URL/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@company.com","password":"your-password","orgName":"Acme"}'
# In production this returns 202 {"verificationRequired":true}: click the emailed link, then log in.
```

Requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` on the API service.

## Local dev with Postgres

```bash
docker run --name jargon-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
npm run api
```

## Backups and restore

Three layers:

1. **Railway volume backups** (Postgres service → Backups). Turn these on. They are the only layer that survives losing the database.
2. **Automatic snapshots** in `jargon_state_snapshots`: one at every API boot (state as the previous deploy left it) and one daily. 14 of each are kept.
3. **Off-site exports** with `npm run db:state`.

```bash
export DATABASE_URL='<product Postgres public URL>'
npm run db:state -- list                          # snapshots
npm run db:state -- export                        # current state → data/backups/*.json.gz
npm run db:state -- export --snapshot 42          # a snapshot → file
npm run db:state -- verify --file data/backups/jargon-state-….json.gz
```

Exports contain every org's data (secrets stay encrypted with `JARGON_ENCRYPTION_KEY`). Store them somewhere private.

**Restore** (overwrites live state, saves a `pre-restore` snapshot first):

```bash
npm run db:state -- restore --snapshot 42 --yes   # or --file <export>
```

The running API notices within ~30s and stops itself. Then restart the API service in Railway.

**Restore drill** (before launch, then monthly): create a scratch Postgres, run `restore --file <latest export> --yes --database-url <scratch URL>`, point a local `npm run api` at it with the same `JARGON_ENCRYPTION_KEY`, and check that you can sign in and see your tools and connections.

## Schema

See [postgres-schema.sql](./postgres-schema.sql). Each record (user, org, contact, message, …) is a row in `jargon_records`, keyed by collection and id and tagged with `org_id`. `jargon_state` (`id = main`) holds the ownership epoch and storage flag. Its `data` column is the pre-migration state, kept untouched as a fallback. The first boot on this code migrates automatically.

Look up one org's data:

```sql
SELECT collection, count(*) FROM jargon_records WHERE org_id = 'org_…' GROUP BY 1;
```
