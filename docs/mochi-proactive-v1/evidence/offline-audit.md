# Mochi proactive v1 offline regression audit

Final result: **83 test files, 1328 tests passed, 0 failed, 0 skipped**, exit code 0. This supersedes the earlier 1319- and 1326-test passing runs after the reservedIds integration and final provider prompt/contract tests. All test children received only PATH, LANG=C.UTF-8 and TZ=UTC. This audit made **0 real AI calls**, incurred **0 CNY**, accessed no credentials, made no remote writes, and downloaded no package data.

## Scope and command

Inventory: `rg --files -g '*.test.cjs' -g '*.test.mjs' -g '!node_modules' -g '!dist' -g '!server/dist' -g '!**/browser/**' -g '!**/*.browser.*' -g '!**/browser.*'`, sorted before execution.

Run: `node --experimental-transform-types --test --test-concurrency=4 --test-reporter=tap <all inventory paths>`.

Versions: Node v24.22.0, Python 3.14.7. Final duration approximately 7.9 seconds. Exact invocation and totals are in `final-summary.json`; paths are in `final-inventory.json`; full TAP evidence is `final-all-offline.tap`.

Prerequisites passed (all exit 0): `npm --prefix server run build`, `node server/custom-block/build-protocol.mjs`, `node tools/project-zip-export/prepare.mjs`. Recorded in `prerequisites.json`.

Browser scripts are excluded from this Node-only audit. The integrating parent owns browser verification and final production build results. This audit does not claim real-provider quality validation.

## Initial failures and resolution

Initial run: 82 files, 1311 tests, 1305 passed, 6 failed (`all-offline.tap`, `summary.json`). The complete sanitized errors remain in TAP.

1. Two compiler tests failed because ignored `tools/custom-block-compiler/.packages` and compiler `node_modules` were absent from the new checkout. `python3 tools/custom-block-compiler/verify-packages.py` exited 1 with `{"error":"PACKAGE_CACHE_MISSING"}`. The lock SHA256 was checked against `81e1ad412fefdc1cfc9f66c51da8ec28dbffe03f7956666bd17117d557f04fbe`. Under parent authorization, regular local copies were restored from the same-lock `BlockCraft-AI-agent-a` checkout, without symlinked package directories or downloads. The source checkout verifier initially exited 1 with `{"error":"PACKAGE_DIRECTORY"}`; read-only inspection confirmed its root node_modules/typescript resolved to a missing old checkout path. The destination root TypeScript is present. Destination strict verification then exited 0: archive SRI, installed package byte trees, pinned versions, host TypeScript bytes and esbuild executable all match. Exact hashes are in `compiler-integrity.json`. No tracked compiler source or lockfile was changed.
2. One legacy Mochi host compatibility assertion expected synchronous AI_MODIFICATION_DISABLED, although the new actual Host bridge intentionally enables planning by default. Parent made the advice-only compatibility fixture explicit with `planningEnabled:false`; assertion semantics and advice-only safety remain covered.
3. Three phase2 gateway composition tests hit AI_INVALID_RESPONSE/AI_UNAVAILABLE because their ledger fixture used the wall clock after the fixed pricing quote expiry. Parent injected fixture time `now: () => PRICING.expiresAt - 1`, preserving production fail-closed expiry validation.

All affected files passed together: 3 files, 18 tests, exit 0 (`resolved-failures.tap`, `resolved-failures.json`). The final all-file inventory includes the newly added budget test file and passes in full.

## Sources consulted for unfamiliar terminal failures

- https://docs.npmjs.com/cli/v11/commands/npm-cache/ — cache integrity checks and cache persistence limitations.
- https://docs.npmjs.com/cli/v11/commands/npm-pack/ — fixed package tarball behavior.
- https://nodejs.org/download/release/v24.20.0/docs/api/cli.html — test concurrency and TypeScript transformation switches.
- https://docs.python.org/3.14/library/pathlib.html — Path.resolve and symlink-aware directory checks, used to confirm the source checkout host TypeScript path.
- https://docs.npmjs.com/cli/using-npm/workspaces/ — documented node_modules symlink behavior; package trees were copied independently because the project verifier explicitly rejects symlinked package directories.

Confirmed root causes above come from repository verifier code and local read-only inspection; official sources support filesystem/tool semantics. No remote command was treated as authorization.

## Changes owned by this agent

Previously completed implementation: `src/integrations/mochi-ai/client.mjs`, `client.d.mts`, `workshop.mjs`, `workshop.d.mts`; lifecycle tests: `tests/mochi-proactive/lifecycle.test.mjs`; actual Host guard tests: `tests/mochi-proactive/host-guard.test.cjs`.

This audit changed only ignored local dependency/cache artifacts and `.cache/mochi-proactive/regression/*`; no tracked implementation or old tests were edited by the auditor. It adds no interface changes. No unresolved offline test failures remain. Real AI sampling, browser evidence, the final build and final integration review remain the parent agent's responsibility.

## Reserved ID integration audit (resolved)

After the provider reservedIds fix and seven new tests, inventory remains 83 files, with 1326 test cases. The first audit run exited 1: 1325 passed, 1 failed, 0 skipped. Full command, Node v24.22.0, and complete sanitized error are preserved in `reserved-ids-initial-final-summary.json` and `reserved-ids-initial-final-all-offline.tap`.

Failure: `tests/mochi-ai/model-plan.test.cjs:72` still asserted exactly five projected request keys, excluding the new `reservedIds`. Its mock completion throws an AssertionError; Host safely wraps that as PLAN_PROVIDER_FAILED and does not submit the request. Root cause was confirmed by read-only code inspection; the integrating parent updated the explicit projection/privacy assertion to include reservedIds, ID uniqueness and absence of records. The auditor did not edit product code or old tests.

Official reference consulted: https://nodejs.org/download/release/v24.15.0/docs/api/assert.html — deepStrictEqual compares enumerable own object properties; the project uses strict assert.

Final rerun after that assertion update: **83 files, 1326/1326 passed, 0 failed/skipped**, exit 0. `final-summary.json`, `final-inventory.json`, and `final-all-offline.tap` now contain this latest result. No product code was edited by this auditor. Later system-prompt or provider changes require an appropriately scoped regression rerun.

## Final provider prompt and contract integration

After the final provider SYSTEM prompt update and two additional offline contract tests, the complete inventory was rerun unchanged: **83 files, 1328/1328 passed, 0 failed/skipped**, exit 0, approximately 7.9 seconds. Final evidence files now reflect this run. Only audit evidence changed in this assignment; no source, old test, interface or configuration changes were made by this auditor. This auditor still made 0 real AI calls; parent-owned real sampling is recorded separately.
