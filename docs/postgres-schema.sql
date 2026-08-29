-- Jargon hosted API state (users, orgs, projects, etc.)
-- Auto-created on API boot when DATABASE_URL is set.
-- Railway: add a Postgres plugin and link DATABASE_URL to the API service.

CREATE TABLE IF NOT EXISTS jargon_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional: inspect registered users
-- SELECT u->>'email' AS email, u->>'name' AS name
-- FROM jargon_state, jsonb_array_elements(data->'users') AS u
-- WHERE id = 'main';
