-- Jargon hosted API state (users, orgs, projects, etc.)
-- Auto-created on API boot when DATABASE_URL is set (see src/server/pgStore.ts).
-- Railway: add a Postgres plugin and link DATABASE_URL to the API service.

-- Ownership + storage flag. `data` is the legacy single-row state (pre-migration,
-- or a backup written by `npm run db:state -- restore`, which sets storage = 'row').
CREATE TABLE IF NOT EXISTS jargon_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE jargon_state ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
-- Bumped by each API boot; a process whose epoch is stale stops writing and sending.
ALTER TABLE jargon_state ADD COLUMN IF NOT EXISTS writer_epoch BIGINT NOT NULL DEFAULT 0;
-- 'records' = live state is in jargon_records; 'row' = rebuild records from data on next boot.
ALTER TABLE jargon_state ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'row';

-- One row per record. collection = Database key (orgs, contacts, messages, …).
-- seq keeps insertion order; newest-first collections are reversed on load.
CREATE TABLE IF NOT EXISTS jargon_records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  org_id TEXT,
  seq BIGINT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS jargon_records_org ON jargon_records (org_id, collection);

CREATE TABLE IF NOT EXISTS jargon_state_snapshots (
  id BIGSERIAL PRIMARY KEY,
  data JSONB NOT NULL,
  version BIGINT NOT NULL,
  reason TEXT NOT NULL,          -- 'boot' | 'daily' | 'pre-restore'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Run exactly one API replica: the state is cached in memory per process.

-- Optional: inspect registered users
-- SELECT data->>'email' AS email, data->>'name' AS name
-- FROM jargon_records WHERE collection = 'users';
