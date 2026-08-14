const { fetchFailedRunLogs } = require("../github/github.service");
const { diagnoseLogs } = require("../ollama/ollama.service");
const { saveIncident } = require("../db/db");

/**
 * Phase 1 core loop:
 * 1. Get logs (real GitHub run, or raw logs passed directly for local testing)
 * 2. Send to Ollama for diagnosis
 * 3. Save everything to Postgres
 * 4. Return the diagnosis (no auto-fix yet — Phase 2+)
 */
async function handlePipelineFailure({ runId, owner, repo, rawLogs }) {
  const logText = rawLogs || (await fetchFailedRunLogs({ runId, owner, repo }));

  const diagnosis = await diagnoseLogs(logText);

  await saveIncident({
    rawLogs: logText,
    rootCause: diagnosis.root_cause,
    confidence: diagnosis.confidence,
    proposedFix: diagnosis.proposed_fix,
    actionType: diagnosis.action_type,
  });

  return diagnosis;
}

module.exports = { handlePipelineFailure };
