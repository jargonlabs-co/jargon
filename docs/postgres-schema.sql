-- Jargon hosted API state (users, orgs, projects, etc.)
-- Auto-created on API boot when DATABASE_URL is set.
-- Railway: add a Postgres plugin and link DATABASE_URL to the API service.

CREATE TABLE IF NOT EXISTS jargon_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jargon_state ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

-- Writes take pg_advisory_xact_lock + bump version (see src/server/pgStore.ts).
-- Prefer a single API replica until per-org rows land.

-- Optional: inspect registered users
-- SELECT u->>'email' AS email, u->>'name' AS name
-- FROM jargon_state, jsonb_array_elements(data->'users') AS u
-- WHERE id = 'main';
