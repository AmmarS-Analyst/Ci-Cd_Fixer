// Phase 4 eval suite case set. Each case gets scored into one of three
// buckets after running through the real diagnosis pipeline:
//   - "correctly_diagnosed"  — confident, on-target diagnosis (human still
//     approves before anything is applied; most action_types aren't
//     auto-applicable at all, which is itself correct — see fix.service.js)
//   - "correctly_fixed"      — the narrow "dependency" case that was also
//     actually applied, verified via a real CI rerun, and merged
//   - "refused_escalated"    — correctly low-confidence, routed to a human
//     instead of guessing. This is a GOOD outcome, not a failure.
//
// `expectedBucket` may be an array when a case is legitimately ambiguous —
// any bucket in the list counts as a pass.

const REAL_CASES = [
  {
    id: "real-dependency",
    label: "Real: missing npm dependency",
    runId: 31802440473,
    expectedActionTypes: ["dependency"],
    expectedBucket: ["correctly_diagnosed"],
    note: "Package name is deliberately fake (doesn't exist on npm) so a real auto-apply would legitimately fail and roll back — see Phase 3's rollback proof (incident #20) for that path. This case only scores diagnosis quality. The real, successful correctly_fixed proof point is incident #19 (real 'left-pad' fix, applied+verified+merged) from Phase 3 testing.",
  },
  {
    id: "real-dockerfile",
    label: "Real: bad Docker image tag",
    runId: 31802443645,
    expectedActionTypes: ["dockerfile"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "real-test",
    label: "Real: failing assertion",
    runId: 31802599115,
    expectedActionTypes: ["test"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "real-envvar",
    label: "Real: missing required env var",
    runId: 31802448490,
    expectedActionTypes: ["env_var"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "real-permissions",
    label: "Real: insufficient GITHUB_TOKEN permissions",
    runId: 31802451931,
    expectedActionTypes: ["permissions"],
    expectedBucket: ["correctly_diagnosed"],
  },
];

const SYNTHETIC_CASES = [
  {
    id: "syn-missing-script",
    label: "Missing npm script",
    rawLogs: "npm ERR! missing script: build\nError: Process completed with exit code 1.",
    expectedActionTypes: ["other"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "syn-missing-dependency",
    label: "Missing dependency (lodash)",
    rawLogs:
      'Error: Cannot find module "lodash"\nRequire stack:\n- /app/src/index.js\nError: Process completed with exit code 1.',
    expectedActionTypes: ["dependency"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "syn-failing-test",
    label: "Failing test assertion",
    rawLogs:
      "FAIL src/tests/user.test.js\n  ✕ should create a user (12 ms)\n  Expected: 200\n  Received: 500\nTests: 1 failed, 5 passed\nError: Process completed with exit code 1.",
    expectedActionTypes: ["test"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "syn-bad-docker-tag",
    label: "Bad Docker image tag",
    rawLogs:
      "Error response from daemon: manifest for myapp:v2.1.0 not found: manifest unknown\nError: Process completed with exit code 1.",
    expectedActionTypes: ["dockerfile"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "syn-port-conflict",
    label: "Port already in use",
    rawLogs:
      "Error: listen EADDRINUSE: address already in use :::8080\nError: Process completed with exit code 1.",
    expectedActionTypes: ["other"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "syn-db-connection-refused",
    label: "DB connection refused (deliberately ambiguous)",
    rawLogs:
      "Error: connect ECONNREFUSED 127.0.0.1:5432\nat TCPConnectWrap.afterConnect\nError: Process completed with exit code 1.",
    expectedActionTypes: ["permissions", "test", "other"],
    expectedBucket: ["correctly_diagnosed", "refused_escalated"],
    note: "Genuinely ambiguous — could be a missing service, a config/permissions issue, or a flaky test. Any of several action_types is defensible; this case exists to see whether the model picks a sane single value or (as observed earlier) returns something like 'permissions|test' that the normalizer has to clamp.",
  },
  {
    id: "syn-missing-env-var",
    label: "Missing required env var (API_KEY)",
    rawLogs:
      '##[error]Missing required input "api_key" for action\nEnv var API_KEY is not set\nError: Process completed with exit code 1.',
    expectedActionTypes: ["env_var"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "syn-git-ssh-permission",
    label: "Git SSH permission denied",
    rawLogs:
      "Permission denied (publickey).\nfatal: Could not read from remote repository.\nError: Process completed with exit code 128.",
    expectedActionTypes: ["permissions"],
    expectedBucket: ["correctly_diagnosed"],
  },
  {
    id: "syn-no-clear-error",
    label: "REFUSAL: no actual error in the log",
    rawLogs: "Job cancelled by user request.\nWorkflow run cancelled.\nCleaning up orphan processes.",
    expectedActionTypes: null,
    expectedBucket: ["refused_escalated"],
    note: "There is nothing here for the agent to diagnose — it was cancelled, not broken. A confident diagnosis here would be a fabrication.",
  },
  {
    id: "syn-garbled-log",
    label: "REFUSAL: garbled/corrupted log content",
    rawLogs: "\\x00\\x01\\xFF\\xFE##$$%%^^&&**((__++==\\n\\x00\\x00 corrupt stream segment 0x7f3a\\n\\xDE\\xAD\\xBE\\xEF",
    expectedActionTypes: null,
    expectedBucket: ["refused_escalated"],
    note: "No coherent signal to diagnose from at all.",
  },
  {
    id: "syn-transient-network",
    label: "REFUSAL(ideally): transient network timeout during install",
    rawLogs:
      "npm ERR! network timeout at: https://registry.npmjs.org/react\nnpm ERR! network This is a problem related to network connectivity.\nnpm ERR! network In most cases you are behind a proxy or have bad network settings.\nnpm ERR! network Please try again later, or use a different network.\nError: Process completed with exit code 1.",
    expectedActionTypes: null,
    expectedBucket: ["refused_escalated", "correctly_diagnosed"],
    note: "Genuinely hard case: a transient infra flake isn't fixable by a code change — 'retry the job' isn't a diagnosis this agent can act on. Ideally this escalates rather than confidently proposing a fix for a problem that will resolve itself. If the model instead confidently misdiagnoses this as a real dependency/config problem, that's a real, useful negative data point for the table, not a bug in the eval.",
  },
  {
    id: "syn-oom-killed",
    label: "Process OOM-killed (exit 137)",
    rawLogs:
      "Killed\nnpm ERR! code ELIFECYCLE\nnpm ERR! errno 137\nnpm ERR! Exit status 137\nError: Process completed with exit code 137.",
    expectedActionTypes: ["other"],
    expectedBucket: ["correctly_diagnosed"],
    note: "Doesn't map to any of our five specific categories — 'other' plus a root_cause that correctly names OOM is the right answer here, not a wrong-category guess.",
  },
  {
    id: "syn-ambiguous-multi-cause",
    label: "Ambiguous: missing dependency AND failing test in same log",
    rawLogs:
      "Error: Cannot find module \"axios\"\nRequire stack:\n- /app/src/api.js\nFAIL src/tests/api.test.js\n  ✕ should fetch data\nError: Process completed with exit code 1.",
    expectedActionTypes: ["dependency", "test"],
    expectedBucket: ["correctly_diagnosed"],
    note: "Two plausible root causes in one log (the missing module is almost certainly upstream of the test failure). Either action_type is defensible as long as the root_cause text is coherent.",
  },
];

module.exports = { REAL_CASES, SYNTHETIC_CASES, ALL_CASES: [...REAL_CASES, ...SYNTHETIC_CASES] };
