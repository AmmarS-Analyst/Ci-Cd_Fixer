## Eval results

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
