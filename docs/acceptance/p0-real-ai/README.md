# P0 real AI generation acceptance

- Base: `8cfa37f5112adaab1e0adbb4cb4086240111d436` (`origin/main`, fetched 2026-10-19)
- Feature branch: `p0/real-ai-generation-20261019`
- PR #44 HEAD reviewed: `aa7766615e0b6bddfe9c72a6f1709a302d3629ca`.
- Paid DeepSeek calls: **0**. Generation tests inject local responses only.

## Verification

| Area | Result | Evidence |
|---|---|---|
| AppSpec schema, binding and completeness | Mock PASS | `npm run test:generation` (35/35) |
| B/C Runtime CRUD and metrics | Mock PASS | `npm test` (205/205) and browser run |
| Fitness, study duration, personal tasks, personal finance | Mock PASS | `tests/generation/fixtures.mjs` and quality fixtures |
| Secure gateway composition and durable budget | Mock PASS | `node --test tests/paid-gateway/*.test.mjs` (22/22) |
| Budget/config status mapping | Mock PASS | `server/server.test.mjs` |
| Startup/shutdown lifecycle | Mock PASS | `node --test tests/generation/lifecycle.test.mjs` (6/6): closed default, explicit runtime, in-flight drain/abort, lock ordering, startup/listen failure cleanup, SIGINT/SIGTERM idempotence |
| Production build | PASS | `npm run build` |
| Browser B/C flow | Mock PASS | 1366px and 390px, B edits, C records/metrics, failed generations preserve old state |
| Real DeepSeek generation | NOT TESTED | Explicit approval and production identity/ledger required |
| Real export ZIP acceptance | NOT TESTED in this P0 run | Export subsystem unchanged |

Browser screenshots are from the injected offline acceptance run: `generated-b-1366.png`, `generated-c-1366.png`, `generated-b-390.png`, and `generated-c-390.png`.

`server/paid-gateway/runtime.mjs` composes a paid transport only with a verified identity resolver, server-only key, and private persistent ledger path. The default server remains fail-closed. The runtime is single-process/single-instance; distributed identity and shared budget storage still require deployment work.

Rollback is to stop using this feature branch/runtime composition and deploy the prior `main` build.