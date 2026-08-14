# DevOps Agent — Project Context

Persistent project memory: what this is, what's done, and what to check before
picking up more work on it.

## What this is

An autonomous CI/CD failure diagnosis agent: watches for a failed GitHub
Actions run, diagnoses the root cause with a local LLM (Ollama), proposes a
fix behind a human-approval gate, and — for the one narrow case it can safely
automate — applies the fix, verifies it with a real CI rerun, and rolls back
automatically if the rerun fails. Every incident is logged to Postgres
regardless of outcome, which feeds both a published eval suite and a live
dashboard.

## Roadmap (all 5 phases complete)

1. **Core loop** — webhook → fetch logs → diagnose via Ollama → log to Postgres.
2. **Guardrails** — dry-run by default, human-approval gate, confidence
   threshold + retry cap, per-incident cost ceiling.
3. **Apply + rollback** — approved "dependency" fixes get applied on a new
   branch, verified via a real CI rerun, then merged or automatically rolled
   back if the rerun fails.
4. **Eval suite** — 19 cases (5 real GitHub Actions runs, 13 synthetic, 1
   citing a real applied+merged fix), scored correctly-diagnosed /
   correctly-fixed / correctly-refused-and-escalated. Results published in
   README.md.
5. **Dashboard** — `GET /dashboard`, live stats over the incident log.

See README.md for the technical writeup of each phase and how to run
everything. This file is project-state notes, not a user-facing readme.

## Current state

- `docker compose up -d --build` runs three containers: `devops-agent`
  (Node/Express), `ollama` (CPU-only, `qwen2.5-coder:7b`), `agent-db`
  (Postgres).
- All 5 phases verified against a real GitHub Actions repo (a private
  sacrificial test repo used for destructive testing — see README/k8s docs),
  not just synthetic test logs.
- DB schema (`agent/src/db/db.js`): incidents carry status, escalation
  reason, retry count, token/cost tracking, GitHub run context, approval
  metadata, and the full apply/rollback chain (commit sha, branch, rerun
  result, rollback reason). Columns are added via
  `ALTER TABLE ADD COLUMN IF NOT EXISTS` in `initDb()` rather than baked into
  the base `CREATE TABLE`, since Postgres's `docker-entrypoint-initdb.d` also
  runs the migration file directly against a fresh volume — that path has to
  stay idempotent regardless of which one creates the table first.
- Auto-apply is deliberately narrow: only `action_type: "dependency"`
  diagnoses on a real GitHub run get auto-applied. Everything else correctly
  falls back to `approved_manual_action_required` rather than fabricating a
  capability the agent doesn't safely have.
- Known model limitation, not an infra bug: the local model can return a
  confident diagnosis on a log with no real error at all, instead of
  escalating — see the eval results table in README.md (cases 14/15) for the
  concrete example. Worth keeping in mind if extending the eval suite.
- Kubernetes (`k8s/`) was added afterward as a second, learning-oriented
  deployment path — raw YAML targeting minikube, not part of the original
  5-phase scope. `postgres` and `agent` verified reaching `Running`; the
  `ollama` pod's live-running state was not confirmed in the session that
  built it (see k8s/README.md and git history for what was tried).

## Folder structure

```
devops-agent/
├── docker-compose.yml
├── .env.example
├── CLAUDE.md              # this file
├── README.md
├── scripts/test-webhook.sh
├── k8s/                   # minikube deployment path — see k8s/README.md
└── agent/
    ├── Dockerfile
    ├── package.json
    ├── eval/               # Phase 4 eval suite — see README.md
    └── src/
        ├── main.js
        ├── webhook/        # core loop + guardrail pipeline + approve/reject
        ├── github/         # GitHub API: logs, branch/PR/merge, workflow dispatch+poll
        ├── ollama/         # diagnosis: streaming, cleaning, JSON normalization
        ├── config/         # guardrail thresholds + cost estimation
        ├── fix/            # apply/verify/rollback ("dependency" only)
        ├── dashboard/       # GET /dashboard (HTML) + /dashboard/stats (JSON)
        └── db/              # postgres pool + incident CRUD
```

## Working conventions

- Test after every change — don't batch multiple unverified changes together.
- Guardrails are not optional busywork; they're as much the point of this
  project as the agent's raw capability.
- Refusal is a valid, good outcome — an eval case where the agent correctly
  escalates instead of guessing should be scored as a success.
- Prefer the interpretation that produces a verifiable artifact (real test
  output, real logged data) over the fastest path to "it runs."
- Windows/PowerShell machine — prefer PowerShell-compatible commands, note
  clearly when Git Bash or WSL is required instead.
