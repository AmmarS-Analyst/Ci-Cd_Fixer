const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Columns beyond the Phase 1 base table. Added via ALTER TABLE (not baked into
// the CREATE TABLE below) because docker-entrypoint-initdb.d also runs
// 001_create_incidents.sql directly against a fresh Postgres volume — on that
// path CREATE TABLE IF NOT EXISTS here is a no-op, so new columns must be
// added explicitly to stay idempotent regardless of which path created the table.
const PHASE_2_3_COLUMNS = [
  ["status", "TEXT DEFAULT 'diagnosed'"],
  ["escalated_reason", "TEXT"],
  ["retry_count", "INT DEFAULT 0"],
  ["prompt_tokens", "INT DEFAULT 0"],
  ["completion_tokens", "INT DEFAULT 0"],
  ["cost_usd", "NUMERIC(10, 6) DEFAULT 0"],
  ["github_owner", "TEXT"],
  ["github_repo", "TEXT"],
  ["run_id", "BIGINT"],
  ["approved_by", "TEXT"],
  ["approved_at", "TIMESTAMP"],
  ["rejected_by", "TEXT"],
  ["rejected_at", "TIMESTAMP"],
  ["fix_commit_sha", "TEXT"],
  ["fix_branch", "TEXT"],
  ["applied_at", "TIMESTAMP"],
  ["rerun_run_id", "BIGINT"],
  ["rerun_conclusion", "TEXT"],
  ["rolled_back_at", "TIMESTAMP"],
  ["rollback_reason", "TEXT"],
];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW(),
      raw_logs TEXT,
      root_cause TEXT,
      confidence INT,
      proposed_fix TEXT,
      action_type TEXT
    );
  `);

  for (const [name, def] of PHASE_2_3_COLUMNS) {
    await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS ${name} ${def};`);
  }

  console.log("DB ready");
}

async function saveIncident({
  rawLogs,
  rootCause,
  confidence,
  proposedFix,
  actionType,
  status,
  escalatedReason,
  retryCount,
  promptTokens,
  completionTokens,
  costUsd,
  githubOwner,
  githubRepo,
  runId,
}) {
  const result = await pool.query(
    `INSERT INTO incidents
       (raw_logs, root_cause, confidence, proposed_fix, action_type,
        status, escalated_reason, retry_count, prompt_tokens, completion_tokens, cost_usd,
        github_owner, github_repo, run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      rawLogs,
      rootCause,
      confidence,
      proposedFix,
      actionType,
      status || "diagnosed",
      escalatedReason || null,
      retryCount || 0,
      promptTokens || 0,
      completionTokens || 0,
      costUsd || 0,
      githubOwner || null,
      githubRepo || null,
      runId || null,
    ]
  );
  return result.rows[0];
}

async function getIncident(id) {
  const result = await pool.query(`SELECT * FROM incidents WHERE id = $1`, [id]);
  return result.rows[0];
}

async function updateIncident(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return getIncident(id);

  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
  const values = keys.map((key) => fields[key]);

  const result = await pool.query(
    `UPDATE incidents SET ${setClause} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return result.rows[0];
}

module.exports = { pool, initDb, saveIncident, getIncident, updateIncident };
