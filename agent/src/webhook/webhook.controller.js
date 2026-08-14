const express = require("express");
const router = express.Router();
const { handlePipelineFailure, approveIncident, rejectIncident } = require("./webhook.service");

// Phase 1: accept either a real GitHub run reference or raw logs directly for local testing
router.post("/pipeline-failed", async (req, res) => {
  try {
    const { runId, owner, repo, rawLogs } = req.body;

    const incident = await handlePipelineFailure({ runId, owner, repo, rawLogs });

    res.json({ status: incident.status, incident });
  } catch (err) {
    console.error("Error diagnosing pipeline failure:", err);
    res.status(500).json({ error: err.message });
  }
});

// Phase 2: human-approval gate — nothing gets applied without hitting this first.
router.post("/incidents/:id/approve", async (req, res) => {
  try {
    const incident = await approveIncident(req.params.id, req.body.approvedBy);
    res.json({ status: incident.status, incident });
  } catch (err) {
    console.error("Error approving incident:", err);
    res.status(400).json({ error: err.message });
  }
});

router.post("/incidents/:id/reject", async (req, res) => {
  try {
    const incident = await rejectIncident(req.params.id, req.body.rejectedBy);
    res.json({ status: incident.status, incident });
  } catch (err) {
    console.error("Error rejecting incident:", err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
