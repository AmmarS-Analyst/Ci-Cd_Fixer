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

Phase 2 — Guardrails (the part that matters most — do not rush this)

* Dry-run mode by default — agent proposes a diff/fix, never auto-merges
* Human-approval gate before any fix touches `main` or gets applied for real
* Hard cap: max 2 retry attempts per incident
* Cost ceiling per incident (log $ or token-cost spent per diagnosis)
* Confidence threshold — if below a set %, escalate to human instead of acting
* Definition of done: every guardrail above is implemented and has a test case proving it actually blocks the unsafe action (not just present in code but unverified).

Phase 3 — Rollback logic

* After applying an approved fix, rerun the pipeline
* If it still fails, or fails differently, auto-revert the fix
* Log the full before/after/rollback chain per incident
* Definition of done: a deliberately bad "fix" (seeded on purpose) gets detected and rolled back automatically, with the full chain visible in the incident log.

Phase 4 — Eval suite (the actual proof artifact)

* Build 15-20 deliberately broken pipelines covering distinct failure categories
* Run the agent against all of them
* Score three outcomes: correctly diagnosed / correctly fixed / correctly refused-and-escalated (refusing when appropriate is a GOOD outcome, not a failure — this is what proves judgment, not just capability)
* Publish this table in the repo README — this is the single most important deliverable in the whole project
* Definition of done: a markdown table in the repo showing all 15-20 cases and outcomes, committed and readable without running anything.

Phase 5 — Observability dashboard

* Simple dashboard on top of the Postgres incident log: incidents handled, auto-fixed vs escalated, avg cost/incident, avg time-to-fix
* This is the screenshot that goes in the portfolio/resume
* Definition of done: a working dashboard (simple web page or artifact is fine) rendering real data from the incidents table.

CURRENT STATE (update this section yourself as you make progress — keep it accurate)

* `docker compose up -d --build` works. Three containers: `devops-agent` (Node/Express app), `ollama`, `agent-db` (Postgres).
* Fixed a Postgres race condition: `docker-compose.yml` has a healthcheck on `db`, `agent` depends on `db: condition: service_healthy`. `db.js` also retries `initDb()` internally.
* Model `qwen2.5-coder:7b` is pulled into the `ollama` container.
* **Phase 1 core loop is verified working end-to-end (2026-08-14)** via the `rawLogs` test path: 8 distinct fake broken builds (missing npm script, missing dependency, failing test, bad Docker tag, port conflict, DB connection refused, missing env var, Git SSH permission failure) were sent through `POST /webhook/pipeline-failed` and each produced a sensible diagnosis with reasonable confidence (85-95%), correctly logged in the `incidents` Postgres table. Verified via `docker exec agent-db psql -U postgres -d agent -c "SELECT ..."`.
* **Two real bugs fixed on 2026-08-14, both were silently breaking the entire loop:**
  1. `agent/src/github/github.service.js` — `fetchFailedRunLogs()` was treating GitHub's logs ZIP response as raw text. Fixed: now uses `adm-zip` to extract all log entries and concatenates them (labeled by filename) before sending to the model. NOT yet tested against a real GitHub Actions run — `GITHUB_TOKEN`/`GITHUB_OWNER`/`GITHUB_REPO` in `.env` are still empty, so this path is unverified against live GitHub. Extraction logic itself was unit-tested against a synthetic ZIP and works correctly.
  2. `node-fetch@3.3.2` is ESM-only — `require("node-fetch")` in CJS code returns a non-callable module namespace object, not the `fetch` function. Every `fetch()` call in `github.service.js` and `ollama.service.js` was throwing `"fetch is not a function"` at runtime — this is why Phase 1 had never actually been confirmed working end-to-end before now. Fix: removed `node-fetch` entirely and switched to Node 20's native global `fetch` (no import needed).
* **Known minor issue (not blocking):** the model doesn't always strictly follow the `action_type` enum in the system prompt — one test case returned `"permissions|test"` instead of a single value. Worth tightening the prompt or adding response validation before Phase 4's eval suite, since eval scoring will need a clean enum to bucket against.
* Phases 2-5 are not started.

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
    └── src/
        ├── main.js
        ├── webhook/webhook.controller.js   # POST /webhook/pipeline-failed
        ├── webhook/webhook.service.js       # core loop
        ├── github/github.service.js         # fetches + extracts GitHub Actions log ZIPs
        ├── ollama/ollama.service.js         # sends logs to model, parses JSON diagnosis
        └── db/db.js                          # postgres pool, saveIncident(), initDb() with retry

```

As later phases add files (guardrails, rollback, eval runner, dashboard), extend this tree and keep it accurate.
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
