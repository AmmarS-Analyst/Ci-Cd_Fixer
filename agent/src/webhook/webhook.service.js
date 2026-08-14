const { fetchFailedRunLogs } = require("../github/github.service");
const { diagnoseLogs } = require("../ollama/ollama.service");
const { saveIncident, updateIncident, getIncident } = require("../db/db");
const { guardrails, estimateCostUsd } = require("../config/guardrails");
const { applyFix, isAutoApplicable } = require("../fix/fix.service");

/**
 * Phase 1 + 2 core loop:
 * 1. Get logs (real GitHub run, or raw logs passed directly for local testing)
 * 2. Send to Ollama for diagnosis, retrying up to guardrails.maxRetries times
 *    if confidence is below threshold — bounded by both a retry cap and a
 *    per-incident cost ceiling so a stubborn low-confidence case can't loop
 *    forever or run up unbounded spend.
 * 3. Log every attempt's cost to Postgres; the incident lands as either
 *    "pending_approval" (confident enough to act on, still needs a human
 *    before anything touches main) or "escalated" (guardrail tripped —
 *    a good, correct outcome, not a failure).
 */
async function handlePipelineFailure({ runId, owner, repo, rawLogs }) {
  const logText = rawLogs || (await fetchFailedRunLogs({ runId, owner, repo }));

  // Only attach GitHub context when this incident is actually tied to a real
  // run — a pure rawLogs test call has no run to apply a fix against, and
  // recording owner/repo anyway would misrepresent that in the incident log.
  const githubContext = runId
    ? { githubOwner: owner || process.env.GITHUB_OWNER, githubRepo: repo || process.env.GITHUB_REPO, runId }
    : { githubOwner: null, githubRepo: null, runId: null };

  let diagnosis = null;
  let attempt = 0;
  let cumulativeCost = 0;
  let cumulativePromptTokens = 0;
  let cumulativeCompletionTokens = 0;
  let escalatedReason = null;

  while (true) {
    const result = await diagnoseLogs(logText);
    diagnosis = result.diagnosis;

    const attemptCost = estimateCostUsd({
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });
    cumulativeCost += attemptCost;
    cumulativePromptTokens += result.promptTokens;
    cumulativeCompletionTokens += result.completionTokens;

    if (cumulativeCost > guardrails.costCeilingUsd) {
      escalatedReason = "cost_ceiling_exceeded";
      break;
    }

    if (diagnosis.confidence >= guardrails.confidenceThreshold) {
      break; // good enough, stop retrying
    }

    if (attempt >= guardrails.maxRetries) {
      escalatedReason = "low_confidence_after_max_retries";
      break;
    }

    attempt += 1;
  }

  const status = escalatedReason ? "escalated" : "pending_approval";

  const incident = await saveIncident({
    rawLogs: logText,
    rootCause: diagnosis.root_cause,
    confidence: diagnosis.confidence,
    proposedFix: diagnosis.proposed_fix,
    actionType: diagnosis.action_type,
    status,
    escalatedReason,
    retryCount: attempt,
    promptTokens: cumulativePromptTokens,
    completionTokens: cumulativeCompletionTokens,
    costUsd: cumulativeCost,
    ...githubContext,
  });

  return incident;
}

/**
 * Phase 2 human-approval gate: nothing gets applied until this is called.
 * Phase 3: once approved, if the incident is auto-applicable (a known-safe
 * "dependency" fix on a real GitHub run) we apply it — dry-run by default —
 * and verify + rollback as needed. Anything else lands as
 * "approved_manual_action_required": a human approved the diagnosis, but
 * the agent doesn't have a safe automated way to act on it.
 */
async function approveIncident(id, approvedBy) {
  const incident = await getIncident(id);
  if (!incident) throw new Error("incident not found");
  if (incident.status !== "pending_approval") {
    throw new Error(`incident ${id} is not pending approval (status=${incident.status})`);
  }

  const approvalFields = { approved_by: approvedBy || "unknown", approved_at: new Date() };

  if (!isAutoApplicable(incident)) {
    return updateIncident(id, { ...approvalFields, status: "approved_manual_action_required" });
  }

  let result;
  try {
    result = await applyFix(incident);
  } catch (err) {
    // A real branch/commit/PR may already exist on GitHub even though this
    // threw (e.g. the verification rerun never appeared) — record whatever
    // progress was made so the incident log reflects reality, not a blank.
    const progress = err.incidentProgress || {};
    return updateIncident(id, {
      ...approvalFields,
      status: "apply_error",
      escalated_reason: err.message,
      fix_branch: progress.branch || null,
      fix_commit_sha: progress.commitSha || null,
      rerun_run_id: progress.rerunRunId || null,
      rerun_conclusion: progress.rerunConclusion || null,
    });
  }

  if (result.dryRun) {
    return updateIncident(id, { ...approvalFields, status: "approved_dry_run" });
  }

  if (result.merged) {
    return updateIncident(id, {
      ...approvalFields,
      status: "applied",
      fix_commit_sha: result.commitSha,
      fix_branch: result.branch,
      applied_at: new Date(),
      rerun_run_id: result.rerunRunId,
      rerun_conclusion: result.rerunConclusion,
    });
  }

  if (result.rolledBack) {
    return updateIncident(id, {
      ...approvalFields,
      status: "rolled_back",
      fix_commit_sha: result.commitSha,
      fix_branch: result.branch,
      applied_at: new Date(),
      rerun_run_id: result.rerunRunId,
      rerun_conclusion: result.rerunConclusion,
      rolled_back_at: new Date(),
      rollback_reason: result.rollbackReason,
    });
  }

  return updateIncident(id, {
    ...approvalFields,
    status: "apply_failed",
    escalated_reason: result.reason || "unknown_apply_failure",
  });
}

async function rejectIncident(id, rejectedBy) {
  const incident = await getIncident(id);
  if (!incident) throw new Error("incident not found");
  if (incident.status !== "pending_approval") {
    throw new Error(`incident ${id} is not pending approval (status=${incident.status})`);
  }
  return updateIncident(id, { status: "rejected", rejected_at: new Date(), rejected_by: rejectedBy || null });
}

module.exports = { handlePipelineFailure, approveIncident, rejectIncident };
