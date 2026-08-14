const AdmZip = require("adm-zip");

const API = "https://api.github.com";

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };
}

function resolveTarget(owner, repo) {
  return {
    owner: owner || process.env.GITHUB_OWNER,
    repo: repo || process.env.GITHUB_REPO,
  };
}

async function ghFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Phase 1: fetch logs for a failed GitHub Actions run.
 * Requires GITHUB_TOKEN with 'repo' + 'actions:read' scope.
 * Docs: https://docs.github.com/en/rest/actions/workflow-runs
 */
async function fetchFailedRunLogs({ runId, owner, repo }) {
  const { owner: targetOwner, repo: targetRepo } = resolveTarget(owner, repo);

  const res = await fetch(
    `${API}/repos/${targetOwner}/${targetRepo}/actions/runs/${runId}/logs`,
    { headers: authHeaders() }
  );

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  // This endpoint returns a ZIP containing one .txt file per job step.
  // Extract every entry and concatenate them, labeled by filename, so the
  // model sees which step each chunk of output came from.
  const arrayBuffer = await res.arrayBuffer();
  const zip = new AdmZip(Buffer.from(arrayBuffer));

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);

  if (entries.length === 0) {
    throw new Error("GitHub logs ZIP contained no entries");
  }

  return entries
    .map((entry) => `----- ${entry.entryName} -----\n${zip.readAsText(entry)}`)
    .join("\n\n");
}

/** Phase 3: get a file's current content + blob sha (needed to update it). */
async function getFileContent({ owner, repo, path, ref }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  const data = await ghFetch(
    `/repos/${o}/${r}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`
  );
  return { content: Buffer.from(data.content, "base64").toString("utf-8"), sha: data.sha };
}

/** Phase 3: get the commit sha a branch currently points at. */
async function getBranchSha({ owner, repo, branch }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  const data = await ghFetch(`/repos/${o}/${r}/git/ref/heads/${branch}`);
  return data.object.sha;
}

/** Phase 3: create a new branch pointing at fromSha. */
async function createBranch({ owner, repo, branch, fromSha }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  return ghFetch(`/repos/${o}/${r}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  });
}

/** Phase 3: commit a new version of a file to a branch. */
async function updateFileContent({ owner, repo, path, message, content, sha, branch }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  const data = await ghFetch(`/repos/${o}/${r}/contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha,
      branch,
    }),
  });
  return data.commit.sha;
}

/** Phase 3: open a PR proposing the fix branch against base (never auto-merged here). */
async function createPullRequest({ owner, repo, title, head, base, body }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  return ghFetch(`/repos/${o}/${r}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, head, base, body }),
  });
}

/** Phase 3: merge a PR — only called after a verification rerun passes. */
async function mergePullRequest({ owner, repo, pullNumber }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  return ghFetch(`/repos/${o}/${r}/pulls/${pullNumber}/merge`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merge_method: "squash" }),
  });
}

/** Delete a branch — used to clean up fixer/incident-* branches after merge or rollback. */
async function deleteBranch({ owner, repo, branch }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  await ghFetch(`/repos/${o}/${r}/git/refs/heads/${branch}`, { method: "DELETE" });
}

/** Phase 3: close a PR without merging (used on rollback) and delete its branch. */
async function closePullRequestAndBranch({ owner, repo, pullNumber, branch }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  await ghFetch(`/repos/${o}/${r}/pulls/${pullNumber}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "closed" }),
  });
  await deleteBranch({ owner, repo, branch });
}

/** Phase 3: trigger the workflow on a branch to verify a fix, before it's merged. */
async function triggerWorkflowDispatch({ owner, repo, workflowFile, ref }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  await ghFetch(`/repos/${o}/${r}/actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref }),
  });
}

/**
 * Phase 3: workflow_dispatch doesn't return a run id, so poll the runs list
 * for a run on `ref`, then poll that run until it completes. Throws if none
 * appears within the timeout.
 *
 * Deliberately does NOT use the API's own `?branch=` filter — that filter
 * was observed to miss a run that had, by the time we checked moments later,
 * already completed (likely eventual-consistency lag on GitHub's side).
 * Fetching the general recent-runs list and filtering by head_branch
 * client-side avoids depending on that filter's freshness. This is safe to
 * match on head_branch alone (no timestamp check needed) because each
 * incident gets its own uniquely-named fixer/incident-<id> branch, so at
 * most one workflow_dispatch run can ever exist for a given ref.
 */
async function waitForWorkflowRun({ owner, repo, ref, timeoutMs = 180000 }) {
  const { owner: o, repo: r } = resolveTarget(owner, repo);
  const deadline = Date.now() + timeoutMs;

  let run = null;
  while (Date.now() < deadline && !run) {
    const data = await ghFetch(`/repos/${o}/${r}/actions/runs?event=workflow_dispatch&per_page=20`);
    run = (data.workflow_runs || []).find((r2) => r2.head_branch === ref);
    if (!run) await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  if (!run) throw new Error(`No workflow run appeared for ref ${ref} within ${timeoutMs}ms`);

  while (Date.now() < deadline) {
    const data = await ghFetch(`/repos/${o}/${r}/actions/runs/${run.id}`);
    if (data.status === "completed") return { id: data.id, conclusion: data.conclusion };
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`Workflow run ${run.id} did not complete within ${timeoutMs}ms`);
}

module.exports = {
  fetchFailedRunLogs,
  getFileContent,
  getBranchSha,
  createBranch,
  updateFileContent,
  createPullRequest,
  mergePullRequest,
  deleteBranch,
  closePullRequestAndBranch,
  triggerWorkflowDispatch,
  waitForWorkflowRun,
};
