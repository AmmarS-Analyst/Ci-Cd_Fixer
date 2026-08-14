#!/bin/bash
# Quick local test — sends a fake broken pipeline log straight to the agent,
# bypassing GitHub entirely. Use this first before wiring up real webhooks.

curl -X POST http://localhost:3000/webhook/pipeline-failed \
  -H "Content-Type: application/json" \
  -d '{
    "rawLogs": "npm ERR! missing script: build\nnpm ERR! A complete log of this run can be found in: /root/.npm/_logs/2026-08-14T10_00_00_000Z-debug.log\nError: Process completed with exit code 1."
  }'
