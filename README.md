# DevOps Agent — Phase 1

Autonomous CI/CD failure diagnosis agent. Watches for failed pipelines, diagnoses
the root cause using a local LLM (Ollama), and logs every diagnosis to Postgres.

Phase 1 only: diagnosis, no auto-fix, no rollback yet. See PROJECT.md for the full roadmap.

## Folder structure

```
devops-agent/
├── docker-compose.yml       # 3 containers: agent, ollama, db
├── .env.example             # copy to .env before running
├── PROJECT.md                # full 5-phase roadmap
├── README.md                 # this file
├── scripts/
│   └── test-webhook.sh       # fires a fake broken build at the agent
└── agent/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── main.js                       # express entrypoint
        ├── webhook/
        │   ├── webhook.controller.js     # POST /webhook/pipeline-failed
        │   └── webhook.service.js        # core loop: fetch -> diagnose -> save
        ├── github/
        │   └── github.service.js         # fetches real failed-run logs from GitHub
        ├── ollama/
        │   └── ollama.service.js         # sends logs to local model, parses JSON diagnosis
        └── db/
            ├── db.js                     # postgres pool + saveIncident()
            └── migrations/
                └── 001_create_incidents.sql
```

## Run it (local, no server needed for Phase 1)

```bash
cp .env.example .env
docker compose up -d
docker exec -it ollama ollama pull qwen2.5-coder:7b

# test without needing real GitHub Actions yet:
bash scripts/test-webhook.sh

# see what it logged:
curl http://localhost:3000/incidents
```

## Expose it publicly for a real GitHub webhook (optional, later)

```bash
# Cloudflare Tunnel (free, no card):
cloudflared tunnel --url http://localhost:3000
```
Point your GitHub Actions webhook at the generated URL + `/webhook/pipeline-failed`.

## Next steps
1. Get 5-10 clean diagnoses logged via `test-webhook.sh` with different fake broken logs.
2. Wire up real GitHub Actions logs (finish the ZIP extraction in `github.service.js` — the
   GitHub logs endpoint returns a zip, current code is a placeholder).
3. Once diagnosis quality is reliable, move to Phase 2 (guardrails) — see PROJECT.md.
