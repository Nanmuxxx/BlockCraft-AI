# Agent B Night Queue

Baseline: `origin/main` at `4044fb185a2720eead0dc6710b0d38a215439b98`.
Branch: `agent-b/react-zip-night-20261019`.

| Task | Result | Evidence | Commit |
|---|---|---|---|
| P0 export CRUD Update | PASS | `node --test tests/project-zip-export/export.test.mjs` (63/63); behavior-level update function covers ID/hidden fields/empty and invalid IDs; UI supports edit/save/cancel/delete-current | `4f57471`, `742c8a3`, pending QA commit |
| P1 independent install | PASS | Clean `/tmp` extraction: online `npm ci` (23 packages), `npm run build`, then `npm ci --offline` from the captured cache; ZIP SHA `7addcbe181c10f3fdd0b9c5e73f01873fa067de349c134255d4ea1acfca70315` | `NIGHT-AGENT-B-REPORT.md` |
| P2 Workshop HTTP/export boundary | PASS | `npm run test:workshop-export` (9/9); real `/ai-create` browser download passed at 1366/390; v2 whole-ZIP refusal remains PASS | `docs/acceptance/night-agent-b/workshop/` |
| P3 Chromium CRUD | PASS | Isolated Chromium 156: dev/production exported apps passed desktop/mobile render and CRUD fixtures; Workshop UI passed real download and form/list create-update-delete | `docs/acceptance/night-agent-b/` |
| P4 regression/quality | PASS | deterministic bytes, ZIP path/CRC bounds, lockfile consistency, root build and regression suites pass; no Docker/deployment/protocol files changed | `NIGHT-AGENT-B-REPORT.md` |

Next action after environment support is available: install/use the approved existing Playwright + Chromium test dependency, run both `tests/project-zip-export/accept-trusted.mjs` and `npm run test:workshop-export:browser`, then update the report without changing the v2 rejection policy.
