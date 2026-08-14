const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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
  console.log("DB ready");
}

async function saveIncident({ rawLogs, rootCause, confidence, proposedFix, actionType }) {
  await pool.query(
    `INSERT INTO incidents (raw_logs, root_cause, confidence, proposed_fix, action_type)
     VALUES ($1, $2, $3, $4, $5)`,
    [rawLogs, rootCause, confidence, proposedFix, actionType]
  );
}

module.exports = { pool, initDb, saveIncident };
