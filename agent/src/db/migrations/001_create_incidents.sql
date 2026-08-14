CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW(),
  raw_logs TEXT,
  root_cause TEXT,
  confidence INT,
  proposed_fix TEXT,
  action_type TEXT
);
