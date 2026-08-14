const express = require("express");
const router = express.Router();
const { handlePipelineFailure } = require("./webhook.service");

// Phase 1: accept either a real GitHub run reference or raw logs directly for local testing
router.post("/pipeline-failed", async (req, res) => {
  try {
    const { runId, owner, repo, rawLogs } = req.body;

    const diagnosis = await handlePipelineFailure({ runId, owner, repo, rawLogs });

    res.json({ status: "diagnosed", diagnosis });
  } catch (err) {
    console.error("Error diagnosing pipeline failure:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
