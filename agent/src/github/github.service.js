const AdmZip = require("adm-zip");

/**
 * Phase 1: fetch logs for a failed GitHub Actions run.
 * Requires GITHUB_TOKEN with 'repo' + 'actions:read' scope.
 * Docs: https://docs.github.com/en/rest/actions/workflow-runs
 */
async function fetchFailedRunLogs({ runId, owner, repo }) {
  const targetOwner = owner || process.env.GITHUB_OWNER;
  const targetRepo = repo || process.env.GITHUB_REPO;

  const url = `https://api.github.com/repos/${targetOwner}/${targetRepo}/actions/runs/${runId}/logs`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });

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

module.exports = { fetchFailedRunLogs };
