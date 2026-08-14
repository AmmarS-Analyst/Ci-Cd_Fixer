// Phase 4 eval runner. Run against the live agent (docker compose up):
//   node agent/eval/run-eval.js
//
// Runs every case in cases.js sequentially through the real
// POST /webhook/pipeline-failed endpoint, classifies the actual outcome,
// scores it against what the case expected, and writes both a raw JSON
// results file and a markdown table (eval/RESULTS.md) — the latter gets
// pasted into the main README per Phase 4's definition of done.
//
// Sequential, not parallel: this machine runs a single CPU-bound Ollama
// instance, so concurrent requests would just queue behind each other
// while making failures harder to attribute to a specific case.

const fs = require("fs");
const path = require("path");
const { ALL_CASES } = require("./cases");

const BASE_URL = process.env.AGENT_URL || "http://localhost:3000";

function classifyBucket(incident) {
  if (incident.status === "escalated") return "refused_escalated";
  return "correctly_diagnosed";
}

function scoreCase(testCase, incident) {
  const actualBucket = classifyBucket(incident);
  const actionTypeOk =
    !testCase.expectedActionTypes || testCase.expectedActionTypes.includes(incident.action_type);
  const bucketOk = testCase.expectedBucket.includes(actualBucket);
  const pass = bucketOk && (actualBucket === "refused_escalated" || actionTypeOk);

  return { actualBucket, actionTypeOk, bucketOk, pass };
}

async function runCase(testCase) {
  const body = testCase.runId ? { runId: testCase.runId } : { rawLogs: testCase.rawLogs };
  const start = Date.now();

  const res = await fetch(`${BASE_URL}/webhook/pipeline-failed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const elapsedMs = Date.now() - start;
  const data = await res.json();

  if (!res.ok) {
    return {
      id: testCase.id,
      label: testCase.label,
      error: data.error || `HTTP ${res.status}`,
      elapsedMs,
      pass: false,
    };
  }

  const incident = data.incident;
  const score = scoreCase(testCase, incident);

  return {
    id: testCase.id,
    label: testCase.label,
    incidentId: incident.id,
    actionType: incident.action_type,
    confidence: incident.confidence,
    rootCause: incident.root_cause,
    status: incident.status,
    escalatedReason: incident.escalated_reason,
    expectedActionTypes: testCase.expectedActionTypes,
    expectedBucket: testCase.expectedBucket,
    ...score,
    elapsedMs,
  };
}

function toMarkdownTable(results) {
  const header =
    "| # | Case | Expected | Actual | Confidence | Result |\n" +
    "|---|------|----------|--------|------------|--------|";

  const rows = results.map((r, i) => {
    const expected = r.expectedBucket
      ? r.expectedActionTypes
        ? `${r.expectedActionTypes.join("/")} → ${r.expectedBucket.join("/")}`
        : r.expectedBucket.join("/")
      : "—";
    const actual = r.error
      ? `error: ${r.error}`
      : `${r.actionType} → ${r.actualBucket}${r.status === "escalated" ? ` (${r.escalatedReason})` : ""}`;
    const result = r.error ? "⚠️ ERROR" : r.pass ? "✅ PASS" : "❌ FAIL";
    return `| ${i + 1} | ${r.label} | ${expected} | ${actual} | ${r.confidence ?? "—"}% | ${result} |`;
  });

  return [header, ...rows].join("\n");
}

// The eval loop above only exercises diagnosis quality (correctly_diagnosed
// vs refused_escalated) — none of its 18 cases go through the human-approval
// + apply step, since Phase 3 already proved that mechanism works for real
// against this same test repo. Rather than re-run it live here (slow, and
// redundant), pull the actual historical incident that did go all the way
// through apply → verify → merge, so "correctly_fixed" in the results table
// is backed by a real queryable record, not an unverified claim.
async function fetchCorrectlyFixedProof(incidentId) {
  const res = await fetch(`${BASE_URL}/incidents`);
  const rows = await res.json();
  const incident = rows.find((r) => r.id === incidentId);
  if (!incident || incident.status !== "applied") return null;
  return {
    id: "real-dependency-applied",
    label: `Real: dependency fix applied + verified + merged (incident #${incident.id})`,
    incidentId: incident.id,
    actionType: incident.action_type,
    confidence: incident.confidence,
    rootCause: incident.root_cause,
    status: incident.status,
    actualBucket: "correctly_fixed",
    expectedActionTypes: ["dependency"],
    expectedBucket: ["correctly_fixed"],
    pass: true,
    note: `fix_commit_sha=${incident.fix_commit_sha}, rerun_conclusion=${incident.rerun_conclusion}`,
  };
}

async function main() {
  console.log(`Running ${ALL_CASES.length} eval cases against ${BASE_URL}...\n`);
  const results = [];

  for (const [i, testCase] of ALL_CASES.entries()) {
    process.stdout.write(`[${i + 1}/${ALL_CASES.length}] ${testCase.id}... `);
    try {
      const result = await runCase(testCase);
      results.push(result);
      console.log(result.error ? `ERROR: ${result.error}` : result.pass ? "PASS" : "FAIL", `(${(result.elapsedMs / 1000).toFixed(1)}s)`);
    } catch (err) {
      results.push({ id: testCase.id, label: testCase.label, error: err.message, pass: false });
      console.log(`EXCEPTION: ${err.message}`);
    }

    // Persist after every case so a crash/interrupt doesn't lose progress.
    fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(results, null, 2));
  }

  const fixedProof = await fetchCorrectlyFixedProof(19);
  if (fixedProof) results.push(fixedProof);

  const passed = results.filter((r) => r.pass).length;
  const errored = results.filter((r) => r.error).length;
  const summary = `**${passed}/${results.length} passed** (${errored} error${errored === 1 ? "" : "s"})`;

  const markdown = `## Eval results\n\n${summary}\n\n${toMarkdownTable(results)}\n`;
  fs.writeFileSync(path.join(__dirname, "RESULTS.md"), markdown);

  console.log(`\n${summary}`);
  console.log(`Written to ${path.join(__dirname, "results.json")} and ${path.join(__dirname, "RESULTS.md")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
