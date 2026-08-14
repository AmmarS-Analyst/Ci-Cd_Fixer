DevOps Agent — Full Project Context
Read this fully before doing anything. This file is the persistent memory for this project — refer back to it any time you're unsure why something is being built or what "done" means.
WHO THIS IS FOR AND WHY (don't skip this — it shapes every decision below)
The developer is a self-taught full-stack dev (React/Next.js, Node/Nest.js, PHP/Laravel, WordPress, Odoo, Python/Flask, data analytics) with ~2 years of formal work experience, no degree, based in Bahrain. Strong range across stacks, but full-stack alone is an increasingly crowded market because AI tools have made basic CRUD/app-building trivial.
The strategic bet: specialize in building reliable AI agent systems — not prompt wrappers, but agents with real tool-use loops, guardrails, rollback logic, and evals. This is a genuine engineering discipline most developers haven't gone deep on, and it directly targets companies like Anthropic that need people who understand production AI reliability, not just "can call an LLM API."
This project is the portfolio artifact for that bet. It exists to prove, concretely, that the developer can:

1. Build a genuine agent loop (observe → reason → act → verify → retry/rollback) from scratch, not through a no-code abstraction.
2. Add real guardrails around an agent that takes consequential actions (touching CI/CD pipelines).
3. Handle failure — including the agent's own failures — gracefully.
4. Measure whether the agent actually works, via a real eval suite, not vibes.
5. Make deliberate cost/capability tradeoffs (e.g. local Ollama vs paid APIs) and explain them.

What "done" looks like, ultimately: a demo where someone deliberately breaks a CI/CD pipeline, the agent detects it, correctly diagnoses the cause, proposes a fix, a human approves it, the pipeline passes, and a dashboard shows the full incident trail with cost/accuracy stats. Plus a published eval table (15-20 known failure types, showing what the agent got right, wrong, and correctly refused to touch) — that table is the actual artifact that matters most for a portfolio/hiring conversation, more than the agent itself.
Every implementation decision should serve that end goal. When in doubt about scope, favor whatever makes the eventual eval table and demo more credible over whatever is fastest to build.
FULL ROADMAP (5 phases — do not skip ahead, do not skip guardrails to "save time")
Phase 1 — Core loop (DONE — verified 2026-08-14)

* Trigger: webhook on a failed GitHub Actions run (or raw logs passed directly for local testing)
* Fetch logs for the failed job
* Send logs to the model (currently Ollama, local, free) → get back structured JSON: `{ root_cause, confidence, proposed_fix, action_type }`
* Log every input/output to Postgres — every run, even bad/low-confidence ones
* No auto-apply yet. Just diagnose and log.
* Definition of done for Phase 1: 5-10 different fake broken builds (bad env var, missing dependency, failed test, wrong Docker tag, bad port, missing script, etc.) run through the loop, each producing a sensible diagnosis logged correctly in Postgres.

Phase 2 — Guardrails (the part that matters most — do not rush this) — DONE (verified 2026-08-14)

* Dry-run mode by default — agent proposes a diff/fix, never auto-merges
* Human-approval gate before any fix touches `main` or gets applied for real
* Hard cap: max 2 retry attempts per incident
* Cost ceiling per incident (log $ or token-cost spent per diagnosis)
* Confidence threshold — if below a set %, escalate to human instead of acting
* Definition of done: every guardrail above is implemented and has a test case proving it actually blocks the unsafe action (not just present in code but unverified).

Phase 3 — Rollback logic — DONE (verified 2026-08-14, against a real GitHub Actions run)

* After applying an approved fix, rerun the pipeline
* If it still fails, or fails differently, auto-revert the fix
* Log the full before/after/rollback chain per incident
* Definition of done: a deliberately bad "fix" (seeded on purpose) gets detected and rolled back automatically, with the full chain visible in the incident log.

Phase 4 — Eval suite (the actual proof artifact) — DONE (2026-08-14)

* Build 15-20 deliberately broken pipelines covering distinct failure categories
* Run the agent against all of them
* Score three outcomes: correctly diagnosed / correctly fixed / correctly refused-and-escalated (refusing when appropriate is a GOOD outcome, not a failure — this is what proves judgment, not just capability)
* Publish this table in the repo README — this is the single most important deliverable in the whole project
* Definition of done: a markdown table in the repo showing all 15-20 cases and outcomes, committed and readable without running anything.

Phase 5 — Observability dashboard — DONE (2026-08-14)

* Simple dashboard on top of the Postgres incident log: incidents handled, auto-fixed vs escalated, avg cost/incident, avg time-to-fix
* This is the screenshot that goes in the portfolio/resume
* Definition of done: a working dashboard (simple web page or artifact is fine) rendering real data from the incidents table.

CURRENT STATE (update this section yourself as you make progress — keep it accurate)

* `docker compose up -d --build` works. Three containers: `devops-agent` (Node/Express app), `ollama`, `agent-db` (Postgres).
* Model `qwen2.5-coder:7b` is pulled into the `ollama` container, running CPU-only.
* **Phases 1, 2, and 3 are all done and verified against a real GitHub Actions run**, not just synthetic `rawLogs` tests. A sacrificial test repo exists at `github.com/AmmarS-Analyst/cicd-fixer-test-target` (private) for exactly this — deliberately breakable workflows to exercise the real fetch → diagnose → apply → verify → merge/rollback path. Do not touch the developer's other repos; this one is fair game for repeated destructive testing.
* **Phase 1**: 8 distinct fake broken builds via `rawLogs`, plus a real GitHub Actions run (missing `left-pad` dependency), all produced correct diagnoses logged in Postgres.
* **Phase 2 guardrails, each verified by deliberately tripping it:**
  - Confidence threshold + retry cap: set `CONFIDENCE_THRESHOLD=101` → incident escalated with `escalated_reason=low_confidence_after_max_retries`, `retry_count=2` (3 total diagnosis attempts).
  - Cost ceiling: set `COST_CEILING_USD=0.0000001` → escalated with `cost_ceiling_exceeded` on the very first attempt despite 95% confidence.
  - Human-approval gate: an incident with no real GitHub run context correctly routes to `approved_manual_action_required` on approval rather than attempting anything; double-approving an already-resolved incident is rejected with a 400.
  - Reject endpoint works (`POST /webhook/incidents/:id/reject`).
* **Phase 3 apply/verify/rollback, both paths proven for real against the test repo:**
  - Success path: real "missing dependency" diagnosis → approved → agent created branch `fixer/incident-N`, committed the fix to `package.json`, opened a PR, triggered `workflow_dispatch` to rerun CI on that branch, rerun passed, PR auto-merged, branch deleted. Confirmed on GitHub (package.json on `main` updated, PR shows `merged: true`).
  - Rollback path: a genuine model misdiagnosis (log clearly said `Cannot find module 'is-odd'`, model diagnosed `'left-pad'` — already installed, doesn't fix anything) was approved, applied, verified via rerun (which correctly failed), and automatically rolled back — PR closed unmerged, branch deleted, `main` untouched. This is the mechanism working as designed: even a wrong diagnosis can't reach `main` because the fix is verified before merge, not trusted blindly.
  - Auto-apply is intentionally narrow: only `action_type: "dependency"` diagnoses with a real GitHub run get auto-applied (a named package added to `package.json`). Everything else correctly falls back to `approved_manual_action_required` — refusing to fabricate a capability the agent doesn't safely have (see Phase 4 philosophy below).
* **DB schema extended** (`agent/src/db/db.js`) with guardrail/apply/rollback columns: `status`, `escalated_reason`, `retry_count`, `prompt_tokens`, `completion_tokens`, `cost_usd`, `github_owner`, `github_repo`, `run_id`, `approved_by`/`approved_at`, `rejected_by`/`rejected_at`, `fix_commit_sha`, `fix_branch`, `applied_at`, `rerun_run_id`, `rerun_conclusion`, `rolled_back_at`, `rollback_reason`. Added via `ALTER TABLE ADD COLUMN IF NOT EXISTS` in `initDb()`, not baked into `CREATE TABLE`, because `docker-entrypoint-initdb.d` also runs `001_create_incidents.sql` directly against a fresh Postgres volume — that path must stay idempotent regardless of which one creates the base table.
* **New env vars** (see `.env.example`): `CONFIDENCE_THRESHOLD`, `MAX_RETRIES`, `COST_CEILING_USD`, `COST_PER_1K_{PROMPT,COMPLETION}_TOKENS_USD`, `DRY_RUN` (defaults to `true` — must be explicitly set `false` to allow real GitHub writes), `OLLAMA_TIMEOUT_MS`, `OLLAMA_MAX_LOG_CHARS`.
* **New endpoints**: `POST /webhook/incidents/:id/approve` (body: `{approvedBy}`), `POST /webhook/incidents/:id/reject` (body: `{rejectedBy}`).
* **New files**: `agent/src/config/guardrails.js` (thresholds + cost estimation), `agent/src/fix/fix.service.js` (apply/verify/rollback orchestration for the "dependency" case).

**Bugs found and fixed this session (all were silently breaking things — worth knowing about if something regresses):**
1. `fetchFailedRunLogs()` was treating GitHub's logs ZIP as raw text — fixed with `adm-zip` extraction.
2. `node-fetch@3.3.2` is ESM-only; `require("node-fetch")` in CJS returned a non-callable object, so every `fetch()` call was silently broken. Removed the dependency, use Node 20's native global `fetch`.
3. Ollama's non-streaming API (`stream: false`) sends nothing — not even response headers — until generation fully completes. On this CPU-only machine (observed as slow as ~1.6-2 tokens/sec under load), that regularly exceeded undici's internal 5-minute `headersTimeout`, which fires regardless of any `AbortSignal` passed to `fetch()` — it's a socket-level setting, not a fetch-call setting. Fixed by switching to `stream: true` (headers arrive immediately) AND installing `undici` directly to get a custom `Agent` with both `headersTimeout`/`bodyTimeout` raised via `OLLAMA_TIMEOUT_MS` (default 10 min). Pin `undici@6` — `undici@8`'s latest release uses Node APIs newer than what Node 20 provides (`webidl.util.markAsUncloneable is not a function`).
4. Ollama's NDJSON stream chunks don't align with network chunk boundaries — a naive per-chunk `split("\n")` can cut a JSON line in half and throw. Fixed by buffering any trailing partial line across chunks.
5. The model would occasionally rewrite thousands of tokens instead of stopping at the ~100-token JSON schema (observed 2,600+ tokens on one real log) — at CPU inference speed alone that can exceed any reasonable timeout. Fixed with `options: { num_predict: 300 }` in the Ollama request to hard-cap output length.
6. On messy real-world GitHub Actions logs (full of ISO timestamps, ANSI codes, `##[group]` folding markers), the model would sometimes ignore the JSON schema entirely and produce a generic log transcript/summary instead. Fixed two ways: (a) `cleanLogText()` strips that noise and takes the **tail** of the log rather than the head — CI failures are almost always near the end, not in the runner-setup boilerplate; (b) tightened the system prompt to explicitly forbid narration/summarizing and require finding the actual error near the end.
7. The model sometimes names the missing package in `proposed_fix` using a generic placeholder like `<module_name>` instead of the real name, which breaks `fix.service.js`'s `extractPackageName()` (it needs a quoted literal). Fixed by requiring in the prompt that "dependency" diagnoses name the exact package in single quotes in `root_cause`.
8. `waitForWorkflowRun()` originally used the GitHub API's own `?branch=` filter on the runs list, which was observed to miss a run that had, moments later, already completed successfully (likely eventual-consistency lag) — the whole apply attempt threw "no run appeared" even though the fix had actually worked. Fixed by fetching the general recent-runs list and filtering by `head_branch` client-side instead (safe without a timestamp check too, since each incident gets a uniquely-named `fixer/incident-<id>` branch).
9. If `applyFix()` throws after partially succeeding (e.g. branch/PR created but the verification poll fails), that partial GitHub state was not being recorded anywhere in the incident log — a human would have no idea a branch/PR existed. Fixed: `fix.service.js` attaches whatever progress was made to the thrown error, and `approveIncident()` persists it as `status: "apply_error"` with the partial `fix_branch`/`fix_commit_sha`/etc. filled in.
10. `agent/node_modules` (787 files) was accidentally committed in the initial commit — `.gitignore` only had `/.env` and `/PROJECT.md`. Fixed and untracked; see PR history.

**Known minor issue (not blocking):** the model doesn't always strictly follow the `action_type` enum — normalization in `ollama.service.js` now clamps any invalid value to `"other"` rather than saving garbage.

**Phase 4 eval suite — done (2026-08-14), 15/19 passed:**
* 19 cases in `agent/eval/cases.js`: 5 real GitHub Actions fixture failures (one per action_type — dependency/dockerfile/test/env_var/permissions, each a dedicated `workflow_dispatch`-only workflow in the test repo so they're stable and re-triggerable), 13 synthetic `rawLogs` cases, plus 1 case citing the real applied+merged fix from Phase 3 testing (incident #19) as the concrete `correctly_fixed` proof point.
* Results published in README.md between `<!-- EVAL_RESULTS_START/END -->` markers — regenerate via `node agent/eval/run-eval.js` (writes `agent/eval/results.json` + `agent/eval/RESULTS.md`), then paste `RESULTS.md`'s content into the README between those markers.
* **The 4 misses are the actual finding, not a bug to fix away:** cases 14 and 15 fed the model a log with *no real error at all* (a cancelled job; garbled binary content) and it still returned a confident 95-100% diagnosis instead of the low-confidence escalation the guardrails are designed to catch. That's a genuine overconfidence-on-noise failure mode in `qwen2.5-coder:7b`, not an infra bug — worth citing directly if asked about this project's honesty about model limitations. Cases 10 and 17 are simpler wrong-category picks at high confidence (port conflict → "permissions" instead of "other"; OOM kill → "permissions" instead of "other").
* Two YAML gotchas hit while building the 5 fixture workflows, worth knowing if adding more: (a) an unquoted colon-space (`"AssertionError: expected..."`) inside a plain YAML scalar gets parsed as a mapping separator and can silently corrupt the whole file — confirmed by GitHub's workflow-list API falling back to the raw file path as the display name when this happens; (b) newly-pushed workflow files can take several seconds before `workflow_dispatch` recognizes them (a 422 "does not have workflow_dispatch trigger" error right after pushing doesn't necessarily mean the YAML is wrong — retry once first).

**Phase 5 dashboard — done (2026-08-14):**
* `GET /dashboard` (HTML page) and `GET /dashboard/stats` (JSON) added — `agent/src/dashboard/dashboard.service.js` (SQL aggregation) + `dashboard.controller.js` (routes + embedded HTML/CSS/JS, no build step, no external deps).
* Shows: total incidents, auto-fixed & merged count, escalated count, avg cost/incident, avg time-to-fix (for `applied` incidents), a status breakdown bar chart (status-tinted: green=applied, amber=escalated, orange=rolled_back, gray=everything else), an action_type breakdown bar chart (single blue hue — pure magnitude comparison, no semantic color needed), and a recent-incidents table. Light/dark via `prefers-color-scheme`, following the dataviz skill's palette/mark-spec/status-color rules.
* Verified in-browser against real data (39 incidents by the time this ran): confirmed no console errors, no horizontal overflow at desktop or mobile widths, dark mode correctly picks up the palette's dark surface tokens.
* One real bug caught during verification: Postgres returns `NUMERIC` columns (`cost_usd`) as strings via `node-pg`, not JS numbers — the frontend's `fmtMoney()` called `.toFixed()` on a string and threw. Fixed by casting `cost_usd::float8` in the SQL query rather than defensively parsing client-side.

**Not yet done:** nothing — all 5 phases complete.

Keep this section current. After every work session, update it so a future session (or a different Claude Code instance) picks up accurately without re-discovering state from scratch.
FOLDER STRUCTURE

```
devops-agent/
├── docker-compose.yml
├── .env.example          # copy to .env, never commit .env
├── CLAUDE.md               # this file
├── PROJECT.md              # condensed roadmap (kept in sync with this file)
├── README.md
├── scripts/test-webhook.sh
└── agent/
    ├── Dockerfile
    ├── package.json
    ├── eval/
    │   ├── cases.js                       # Phase 4 eval case definitions (19 cases)
    │   ├── run-eval.js                     # runs all cases, scores, writes results.json + RESULTS.md
    │   ├── results.json                    # generated — raw per-case results
    │   └── RESULTS.md                      # generated — paste into README.md between the EVAL_RESULTS markers
    └── src/
        ├── main.js
        ├── webhook/webhook.controller.js   # POST /webhook/pipeline-failed, /incidents/:id/{approve,reject}
        ├── webhook/webhook.service.js       # core loop + guardrail pipeline + approve/reject
        ├── github/github.service.js         # fetch/extract logs, branch/commit/PR/dispatch/poll for Phase 3
        ├── ollama/ollama.service.js         # sends logs to model (streaming), parses JSON diagnosis
        ├── config/guardrails.js             # thresholds + cost estimation, all env-overridable
        ├── fix/fix.service.js               # apply/verify/rollback orchestration ("dependency" only)
        ├── dashboard/dashboard.controller.js # GET /dashboard (HTML), GET /dashboard/stats (JSON)
        ├── dashboard/dashboard.service.js   # SQL aggregation for the dashboard
        └── db/db.js                          # postgres pool, saveIncident()/getIncident()/updateIncident()

```

All 5 phases are done — this tree is the final shape unless new work is explicitly requested.
CONSTRAINTS AND PREFERENCES (apply throughout, not just Phase 1)

* No Kubernetes. Single-server docker-compose is a deliberate choice, not a limitation to "fix" later unless explicitly asked.
* Ollama first. Free, local, currently `qwen2.5-coder:7b`. Claude API or Groq/Llama may be swapped in later, per model, if diagnosis quality proves insufficient — don't switch preemptively, and don't switch without flagging it clearly, since the cost/capability tradeoff is itself something to document for the portfolio.
* Windows machine, PowerShell. Prefer PowerShell-compatible commands; note clearly when Git Bash or WSL is required instead.
* Test after every change. Don't batch multiple unverified changes together — this is a project meant to demonstrate careful, verifiable engineering, so the process should reflect that too.
* Guardrails are not optional busywork. They are the point of the project as much as the agent's raw capability. Do not skip, stub, or simplify away Phase 2 to move faster.
* Refusal is a valid, good outcome. When building the eval suite in Phase 4, an agent correctly declining to act on a low-confidence diagnosis should be scored as a success, not treated as something to eliminate.
* Document tradeoffs as you go, ideally in README or commit messages — the reasoning behind decisions (e.g. "capped retries at 2 because X") is part of what makes this a credible portfolio piece, not just working code.

HOW TO WORK IN THIS PROJECT

1. Always check the "CURRENT STATE" section above before starting, and update it after finishing a session.
2. Don't skip ahead to a later phase until the current phase's "Definition of done" is actually met and verified by a real test, not assumed.
3. If something is ambiguous, prefer the interpretation that produces a more credible, demonstrable artifact (real test output, real logged data, real dashboard) over the fastest path to "it runs."
4. If you're blocked on something only the developer can decide (e.g. GitHub repo/token setup, which real pipeline to target), ask directly rather than stubbing around it silently.
