# DevOps Agent

Autonomous CI/CD failure diagnosis agent. Watches for failed pipelines, diagnoses
the root cause using a local LLM (Ollama), proposes a fix behind a human-approval
gate, and — for the narrow case it can safely automate — applies the fix, verifies
it with a real CI rerun, and rolls back automatically if the rerun fails.

**Status:** All 5 phases done and verified (including against a real GitHub
Actions repo, not just synthetic test logs). See [PROJECT.md](PROJECT.md) for
the full roadmap and [CLAUDE.md](CLAUDE.md) for detailed project context and
session history.

## Eval results

15/19 eval cases passed — 5 against real GitHub Actions runs, 13 synthetic, plus
1 case citing the real applied-and-merged fix from Phase 3 testing. The 4 misses
are kept in the table rather than removed: they're the actual point of running an
eval. See `agent/eval/` to reproduce.

<!-- EVAL_RESULTS_START -->
**15/19 passed** (0 errors)

| # | Case | Expected | Actual | Confidence | Result |
|---|------|----------|--------|------------|--------|
| 1 | Real: missing npm dependency | dependency → correctly_diagnosed | dependency → correctly_diagnosed | 90% | ✅ PASS |
| 2 | Real: bad Docker image tag | dockerfile → correctly_diagnosed | dockerfile → correctly_diagnosed | 100% | ✅ PASS |
| 3 | Real: failing assertion | test → correctly_diagnosed | test → correctly_diagnosed | 95% | ✅ PASS |
| 4 | Real: missing required env var | env_var → correctly_diagnosed | env_var → correctly_diagnosed | 100% | ✅ PASS |
| 5 | Real: insufficient GITHUB_TOKEN permissions | permissions → correctly_diagnosed | permissions → correctly_diagnosed | 95% | ✅ PASS |
| 6 | Missing npm script | other → correctly_diagnosed | other → correctly_diagnosed | 90% | ✅ PASS |
| 7 | Missing dependency (lodash) | dependency → correctly_diagnosed | dependency → correctly_diagnosed | 90% | ✅ PASS |
| 8 | Failing test assertion | test → correctly_diagnosed | test → correctly_diagnosed | 90% | ✅ PASS |
| 9 | Bad Docker image tag | dockerfile → correctly_diagnosed | dockerfile → correctly_diagnosed | 95% | ✅ PASS |
| 10 | Port already in use | other → correctly_diagnosed | permissions → correctly_diagnosed | 95% | ❌ FAIL |
| 11 | DB connection refused (deliberately ambiguous) | permissions/test/other → correctly_diagnosed/refused_escalated | permissions → correctly_diagnosed | 95% | ✅ PASS |
| 12 | Missing required env var (API_KEY) | env_var → correctly_diagnosed | env_var → correctly_diagnosed | 100% | ✅ PASS |
| 13 | Git SSH permission denied | permissions → correctly_diagnosed | permissions → correctly_diagnosed | 90% | ✅ PASS |
| 14 | REFUSAL: no actual error in the log | refused_escalated | other → correctly_diagnosed | 100% | ❌ FAIL |
| 15 | REFUSAL: garbled/corrupted log content | refused_escalated | other → correctly_diagnosed | 95% | ❌ FAIL |
| 16 | REFUSAL(ideally): transient network timeout during install | refused_escalated/correctly_diagnosed | other → correctly_diagnosed | 95% | ✅ PASS |
| 17 | Process OOM-killed (exit 137) | other → correctly_diagnosed | permissions → correctly_diagnosed | 90% | ❌ FAIL |
| 18 | Ambiguous: missing dependency AND failing test in same log | dependency/test → correctly_diagnosed | dependency → correctly_diagnosed | 95% | ✅ PASS |
| 19 | Real: dependency fix applied + verified + merged (incident #19) | dependency → correctly_fixed | dependency → correctly_fixed | 95% | ✅ PASS |
<!-- EVAL_RESULTS_END -->

**What the misses actually show:** cases 14 and 15 are the concerning pattern —
logs with *no real error at all* (a cancelled job, garbled binary content) still
got a confident 95-100% diagnosis instead of the low-confidence escalation the
guardrails are designed to trigger. That's the local `qwen2.5-coder:7b` model's
real failure mode: overconfidence on signal-free input, not underconfidence on
genuine failures. Cases 10 and 17 are simpler wrong-category picks at high
confidence (port conflict → "permissions", OOM kill → "permissions") where "other"
would've been the honest answer. None of these reached `main` — every case here
only exercises diagnosis, and the human-approval gate (Phase 2) stands between any
diagnosis and an actual applied fix regardless of confidence.

## Architecture

```
devops-agent/
├── docker-compose.yml       # 3 containers: agent, ollama, db
├── .env.example              # copy to .env before running
├── CLAUDE.md                 # full project context + session history
├── PROJECT.md                # 5-phase roadmap
├── README.md                 # this file
├── scripts/
│   └── test-webhook.sh       # fires a fake broken build at the agent
└── agent/
    ├── Dockerfile
    ├── package.json
    ├── eval/
    │   ├── cases.js           # Phase 4 eval case definitions
    │   ├── run-eval.js         # runs all cases, scores, writes RESULTS.md
    │   └── RESULTS.md          # generated — source of the table above
    └── src/
        ├── main.js                          # express entrypoint
        ├── webhook/
        │   ├── webhook.controller.js        # POST /webhook/pipeline-failed, /incidents/:id/{approve,reject}
        │   └── webhook.service.js           # diagnose -> guardrail pipeline -> approve/reject
        ├── github/
        │   └── github.service.js            # fetch/extract logs; branch/commit/PR/dispatch/poll for apply+verify
        ├── ollama/
        │   └── ollama.service.js            # streams diagnosis from local model, parses/normalizes JSON
        ├── config/
        │   └── guardrails.js                # thresholds + cost estimation, all env-overridable
        ├── fix/
        │   └── fix.service.js               # apply/verify/rollback (narrow: "dependency" only)
        ├── dashboard/
        │   ├── dashboard.controller.js       # GET /dashboard (HTML), GET /dashboard/stats (JSON)
        │   └── dashboard.service.js          # SQL aggregation over the incidents table
        └── db/
            ├── db.js                        # postgres pool + incident CRUD
            └── migrations/
                └── 001_create_incidents.sql
```

## Guardrails (Phase 2)

- **Dry-run by default** (`DRY_RUN=true`) — a fix is never actually applied to
  GitHub unless explicitly turned off.
- **Human-approval gate** — nothing is applied without `POST /webhook/incidents/:id/approve`.
- **Confidence threshold** (`CONFIDENCE_THRESHOLD`, default 70) — below this, the
  agent retries the diagnosis rather than acting on a guess.
- **Retry cap** (`MAX_RETRIES`, default 2) — bounded, so a stubborn low-confidence
  case escalates instead of looping.
- **Cost ceiling** (`COST_CEILING_USD`, default $0.05/incident) — Ollama itself is
  free, so this is enforced against an estimated cost modeled on paid-API pricing;
  real and testable today, meaningful the day a paid model gets swapped in.

Every guardrail above has a test that proves it actually trips — see CLAUDE.md's
CURRENT STATE section for how each was verified.

## Apply + rollback (Phase 3)

Auto-apply is intentionally narrow: only diagnoses with `action_type: "dependency"`
on a real GitHub run get auto-applied — the missing package gets added to
`package.json` on a new branch, a PR is opened, the workflow is rerun via
`workflow_dispatch` to verify the fix actually works, and only then does it merge.
If the rerun fails (wrong fix, or a correct-looking fix that doesn't actually
work), the PR is closed and the branch deleted automatically — nothing reaches
`main` without passing a real verification step. Every other `action_type`
correctly falls back to `approved_manual_action_required` rather than fabricating
a fix-application capability the agent doesn't safely have.

## Dashboard (Phase 5)

`GET /dashboard` — a live view over the Postgres incident log: total incidents,
auto-fixed & merged count, escalated count, avg cost/incident, avg time-to-fix,
a breakdown by outcome and by diagnosed category, and a recent-incidents table.
No build step, no external chart library — plain HTML/CSS/JS served straight
from Express, reading `GET /dashboard/stats` for the underlying JSON.

## Run it locally

```bash
cp .env.example .env
docker compose up -d --build
docker exec -it ollama ollama pull qwen2.5-coder:7b

# test without needing real GitHub Actions:
bash scripts/test-webhook.sh

# see what it logged:
curl http://localhost:3000/incidents

# approve or reject a pending incident:
curl -X POST http://localhost:3000/webhook/incidents/1/approve -d '{"approvedBy":"you"}' -H "Content-Type: application/json"
```

To exercise the real GitHub Actions path, set `GITHUB_TOKEN`/`GITHUB_OWNER`/`GITHUB_REPO`
in `.env` and send `{"runId": <a failed run id>}` to `/webhook/pipeline-failed`
instead of `rawLogs`.

## Run the eval suite

```bash
docker compose up -d
node agent/eval/run-eval.js
```

Writes `agent/eval/results.json` (raw) and `agent/eval/RESULTS.md` (the table
above). Real-run cases hit the live GitHub API and can take several minutes each
under CPU-only Ollama inference; synthetic cases are much faster.

## Next steps

All 5 phases are complete — see PROJECT.md and CLAUDE.md for the full history
of what was built and verified at each stage.
