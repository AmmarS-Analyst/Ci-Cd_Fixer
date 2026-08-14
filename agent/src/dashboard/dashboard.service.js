const { pool } = require("../db/db");

async function getStats() {
  const [totalRes, byStatusRes, byActionTypeRes, costRes, timeToFixRes, recentRes] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS total FROM incidents"),
    pool.query(
      "SELECT status, COUNT(*)::int AS count FROM incidents GROUP BY status ORDER BY count DESC"
    ),
    pool.query(
      "SELECT action_type, COUNT(*)::int AS count FROM incidents GROUP BY action_type ORDER BY count DESC"
    ),
    pool.query("SELECT AVG(cost_usd)::float8 AS avg_cost FROM incidents"),
    pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (applied_at - created_at)))::float8 AS avg_seconds,
              COUNT(*)::int AS n
       FROM incidents
       WHERE status = 'applied' AND applied_at IS NOT NULL`
    ),
    pool.query(
      `SELECT id, created_at, status, action_type, confidence, cost_usd::float8 AS cost_usd, root_cause
       FROM incidents ORDER BY created_at DESC LIMIT 20`
    ),
  ]);

  const byStatus = byStatusRes.rows;
  const autoFixed = byStatus.find((r) => r.status === "applied")?.count || 0;
  const escalated = byStatus.find((r) => r.status === "escalated")?.count || 0;

  return {
    totalIncidents: totalRes.rows[0].total,
    autoFixed,
    escalated,
    avgCostUsd: costRes.rows[0].avg_cost || 0,
    avgTimeToFixSeconds: timeToFixRes.rows[0].avg_seconds,
    avgTimeToFixSampleSize: timeToFixRes.rows[0].n,
    byStatus,
    byActionType: byActionTypeRes.rows,
    recentIncidents: recentRes.rows,
  };
}

module.exports = { getStats };
