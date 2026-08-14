-- Base Phase 1 schema. Runs automatically against a fresh Postgres volume via
-- docker-entrypoint-initdb.d. Phase 2/3 columns are added separately by
-- db.js's initDb() (ALTER TABLE ADD COLUMN IF NOT EXISTS) so they apply
-- whether the base table was created here or by initDb() itself.
CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW(),
  raw_logs TEXT,
  root_cause TEXT,
  confidence INT,
  proposed_fix TEXT,
  action_type TEXT
);
