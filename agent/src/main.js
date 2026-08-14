require("dotenv").config();
const express = require("express");
const { pool, initDb } = require("./db/db");
const { handlePipelineFailure } = require("./webhook/webhook.service");

const app = express();
app.use(express.json());

// POST /webhook/pipeline-failed
// Body: { runId, owner, repo } — or in test mode, { rawLogs } directly
app.use("/webhook", require("./webhook/webhook.controller"));
app.use("/dashboard", require("./dashboard/dashboard.controller"));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/incidents", async (req, res) => {
  const result = await pool.query("SELECT * FROM incidents ORDER BY created_at DESC LIMIT 50");
  res.json(result.rows);
});

const PORT = process.env.PORT || 3000;

initDb().then(() => {
  app.listen(PORT, () => console.log(`devops-agent listening on :${PORT}`));
});
