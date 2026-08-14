const github = require("../github/github.service");
const { guardrails } = require("../config/guardrails");

// Auto-apply is intentionally narrow: only "dependency" diagnoses on a real
// GitHub run (not rawLogs test mode) get a real, mechanical fix — add the
// named package to package.json. Every other action_type is a natural-
// language suggestion a human has to read and act on; pretending to
// auto-apply those would be fabricating a capability the agent doesn't
// have. Correctly declining is a good outcome, not a shortcut — see
// CLAUDE.md's Phase 4 philosophy on refusal.
const AUTO_APPLICABLE_ACTION_TYPES = ["dependency"];

function extractPackageName(diagnosis) {
  const text = `${diagnosis.root_cause || ""} ${diagnosis.proposed_fix || ""}`;
  const match = text.match(/['"]([a-zA-Z0-9@][a-zA-Z0-9@/_.-]*)['"]/);
  return match ? match[1] : null;
}

function isAutoApplicable(incident) {
  if (!AUTO_APPLICABLE_ACTION_TYPES.includes(incident.action_type)) return false;
  if (!incident.github_owner || !incident.github_repo || !incident.run_id) return false;
  return !!extractPackageName(incident);
}

/**
 * Applies a fix for a "dependency" incident: adds the missing package to
 * package.json on a new branch, opens a PR, reruns the workflow on that
 * branch via workflow_dispatch to verify, then either merges (success) or
 * closes the PR and deletes the branch (rollback) — never touches main
 * directly, and never runs at all unless dryRun is explicitly false.
 */
async function applyFix(incident) {
  const packageName = extractPackageName(incident);
  const owner = incident.github_owner;
  const repo = incident.github_repo;
  const branch = `fixer/incident-${incident.id}`;

  if (!packageName) {
    return { applied: false, reason: "could_not_extract_package_name" };
  }

  if (guardrails.dryRun) {
    return {
      applied: false,
      dryRun: true,
      wouldDo: `Add "${packageName}" to dependencies in package.json on branch ${branch}, open a PR against main, rerun CI to verify, then merge if green or roll back if not.`,
    };
  }

  // Partial progress (branch/commit/PR created but not yet verified) must
  // still show up in the incident log if something below throws — otherwise
  // a real branch/PR exists on GitHub with zero trace of it in our records.
  // Everything after each step gets attached to `progress` before the next
  // step runs, and re-thrown on failure via a tagged error.
  const progress = { branch };

  try {
    const baseSha = await github.getBranchSha({ owner, repo, branch: "main" });
    await github.createBranch({ owner, repo, branch, fromSha: baseSha });

    const { content, sha } = await github.getFileContent({
      owner,
      repo,
      path: "package.json",
      ref: branch,
    });
    const pkg = JSON.parse(content);
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies[packageName] = pkg.dependencies[packageName] || "latest";

    progress.commitSha = await github.updateFileContent({
      owner,
      repo,
      path: "package.json",
      message: `fix: add missing dependency "${packageName}" (incident #${incident.id})`,
      content: JSON.stringify(pkg, null, 2) + "\n",
      sha,
      branch,
    });

    const pr = await github.createPullRequest({
      owner,
      repo,
      title: `Fix: add missing dependency "${packageName}"`,
      head: branch,
      base: "main",
      body: `Automated fix proposed by devops-agent for incident #${incident.id}.\n\nRoot cause: ${incident.root_cause}\nConfidence: ${incident.confidence}%\n\nThis PR is verified via a CI rerun on this branch before merge. It will be closed automatically if verification fails.`,
    });
    progress.prUrl = pr.html_url;
    progress.prNumber = pr.number;

    await github.triggerWorkflowDispatch({ owner, repo, workflowFile: "ci.yml", ref: branch });
    const rerun = await github.waitForWorkflowRun({ owner, repo, ref: branch });
    progress.rerunRunId = rerun.id;
    progress.rerunConclusion = rerun.conclusion;

    if (rerun.conclusion === "success") {
      await github.mergePullRequest({ owner, repo, pullNumber: pr.number });
      await github.deleteBranch({ owner, repo, branch });
      return {
        applied: true,
        merged: true,
        branch,
        commitSha: progress.commitSha,
        prUrl: pr.html_url,
        rerunRunId: rerun.id,
        rerunConclusion: rerun.conclusion,
      };
    }

    await github.closePullRequestAndBranch({ owner, repo, pullNumber: pr.number, branch });
    return {
      applied: true,
      merged: false,
      rolledBack: true,
      branch,
      commitSha: progress.commitSha,
      prUrl: pr.html_url,
      rerunRunId: rerun.id,
      rerunConclusion: rerun.conclusion,
      rollbackReason: `verification rerun concluded "${rerun.conclusion}", not "success"`,
    };
  } catch (err) {
    err.incidentProgress = progress;
    throw err;
  }
}

module.exports = { applyFix, isAutoApplicable, extractPackageName };
