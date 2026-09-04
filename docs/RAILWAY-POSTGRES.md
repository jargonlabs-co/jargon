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
curl -s https://jargon-api-production.up.railway.app/health | jq '.storage, .userCount'
# "postgres"
# 1
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
  "storage": "postgres",
  "userCount": 1
}
```

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
```

Requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` on the API service.

## Demo tenant

On boot the API ensures `demo@jargon.app` / `jargon-demo` exists in **Supabase Auth**
and links a workspace row in app state. Passwords are not stored in Railway.
## Local dev with Postgres

```bash
docker run --name jargon-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
npm run api
```

## Schema

See [postgres-schema.sql](./postgres-schema.sql). State is stored as JSONB in one row (`id = main`) — same shape as the local JSON file, so no separate user-table migration is required yet.
