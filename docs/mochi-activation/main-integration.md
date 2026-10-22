# Mochi activation: main compatibility integration

As of 2026-10-23. Local review branch: `release/mochi-activation-main-20261023`.
Baseline: `231324d5528ee3de671dde2dfca0bfd0f2c49e52`.

## Scope and ownership

This change integrates the deployment candidate's Studio principal/session entry,
durable cumulative budget, idempotency and Mochi consent protocol into current
main. The parent deployment agent exclusively owns cloud writes, deployment,
merge and final acceptance. This local integration has made no upstream writes,
deployments, credential reads, or real AI calls.

It preserves main's app model, Host, Dockerfile, deployment manifest, package
manifests, proactive sampling configuration and custom-provider defaults. The
AiCreate UI receives only Studio status/unlock wiring and safe cumulative-budget
presentation; its existing generation modes, examples and navigation remain.
Work on the next Mochi editing-contract stage is outside this change.

## Preserved main behavior

- `PRICING` and `POLICY` remain main's original production defaults. Historical
  Studio and smoke metadata use isolated explicit profiles.
- Production ledger and transport injection retain the supplied model, rates,
  tighter policy and clock, including compatibility when reopening a ledger.
- Production request bounds remain validated before network dispatch. The
  transport exposes its validated output-token limit through a private brand.
- Legacy trusted-interactive reservations retain main's original input-byte
  plus output allowance. Principal-mode interactive calls use their explicit
  bounded output-token allowance.
- The lifetime Studio authorization is cumulative: CNY 5 and at most 100 calls,
  without time expiry. Historical usage is preserved. Inner historical profile
  metadata does not authorize resetting or increasing this outer allowance.
- The Studio budget calculation uses its isolated pricing snapshot rather than
  the default production pricing helper.

## Verification

Environment: Node `v24.22.0`, Python `3.14.7`, macOS arm64. All test transport
responses are fixtures; real AI calls made by this integration agent: **0**.

| Check | Result |
| --- | --- |
| Root `npm run build` | Passed |
| `npm --prefix server run build` | Passed |
| `node server/custom-block/build-protocol.mjs` | Passed |
| `node tools/project-zip-export/prepare.mjs` | Passed |
| All 110 `.test.{mjs,cjs,ts}` files under `src` and `tests`, with `node --experimental-transform-types --test` | 1568 passed; zero failures/skips |
| `npm --prefix server test` | 37 passed; zero failures/skips |
| Live quote verification, status refresh, legacy history, continuity, cumulative budget and main production compatibility | 36 passed |
| Safe cumulative-budget status SSR regression | 2 passed (included in full run) |
| Legacy trusted-interactive HTTP tests | 8 passed |
| `git diff --check` | Passed |

Full test log: `/tmp/main-integration-pricing-refresh-full-tests.log`. Server log:
`/tmp/main-integration-pricing-refresh-server-tests.log`. Focused regression log:
`/tmp/main-integration-pricing-refresh-tests.log`. Build log:
`/tmp/main-integration-pricing-refresh-build.log`. Logs are local execution evidence, not
deployment acceptance or a substitute for browser acceptance.

### Local test prerequisites

The compiler test's package cache was initially absent in this worktree. Its
lockfile was byte-identical to the existing deployment candidate. Only ignored
local `.packages` and `node_modules` directories were copied from that candidate.
The existing offline verifier then checked archive SRI, the complete installed
package trees, host TypeScript bytes and compiler binary successfully. No
verification rules or dependency manifests were changed.

Two native TypeScript test files use parameter properties and explicitly require
Node's `--experimental-transform-types` flag. The first unflagged test pass
reported those syntax errors and the absent compiler-cache errors. The complete
rerun with the documented flag and verified cache passed. Attempts to retrieve
official troubleshooting pages through the built-in search returned no usable
source result; the diagnosis relies on exact local errors, test instructions and
the existing integrity verifier, not an inferred network explanation.

## Signed legacy-history repair integrated locally

Applied candidate commits `5cb9a97` (sanitized diagnostics) and
`b66d6d99f8661179e1af9853f6ca8641f509279e` (verified historical debt).
The repair validates the exact signed Oct 21 marker, attempt 1 and response 1,
its time range and non-overlap with known local samples, the original empty
historical scope and continuous receipt filenames. It retains the original
receipt bytes and primary entries, and permanently charges one call and
212,992,000 nano-CNY. The checkpoint and paired manifest bind the original
evidence hash; a changed or missing record fails closed on restart.

The fixture reproduces 73 current primary entries + 1 legacy request + 8 known
local calls = 82 calls, leaving 18 calls under the cumulative 100-call cap.
Evidence corruption, status/time/pricing/scope mismatch, extra or missing
receipts, a second legacy request and migration-copy loss are exercised offline.

Only the specified deployment, launcher, runtime, ledger, cumulative budget,
related tests and deployment documentation were edited for this repair.
Candidate patch context differed in runtime because main already injects
profile pricing. `git apply --check` rejected that file without applying the
repair. Read-only inspection confirmed the mismatch; the two historical-debit
parameter additions were applied explicitly while retaining all existing main
pricing arguments. Built-in official-document search produced no usable result;
no external command or unsupported workaround was used.

## Safe cumulative status and quote refresh

Candidate `2d76a7a85257a88c68ce7803bfd0eb33bf0cad82` fixes the authenticated
homepage crash when a cumulative budget lacks legacy `estimatedCny`. The shared
StudioAccessStatus component handles both response shapes and shows cumulative
reserved/remaining money and calls without replenishing historical usage.

Candidate `3c2a1e27d2c1affdb6a1d170e3e2df1ffdc1a71a` fixes status becoming
permanently unconfigured after the official quote cache's 15-minute lifetime.
An otherwise configured, valid cumulative deployment now awaits the same live
verifier used by paid requests. Concurrent verification is single-flight. An
8-second deadline covers fetch, body and cleanup; failures remain closed, late
responses cannot mark the quote fresh, and retries still require verification.
The exact official URL, table validation, response-size bound, original pricing
and monetary authorization are unchanged.

Seven new offline regressions cover refresh at the exact freshness boundary,
concurrent refresh, invalid pricing, recovery, unconfigured deployment, and late
fetch/body/cleanup. The HTTP fixture first records one successful synthetic
Mochi request, then compares every persisted byte through successful and failed
refreshes: budget checkpoints, receipts and entries remain unchanged; no second
provider request occurs.

The main adaptation retains STUDIO_PRICING aliases in both runtime files and the
new status fixture. A preimage assertion caught those deliberate import
differences before writes; local unified diffs established the cause, and the
four-file parity check passes after import-name normalization. A built-in search
for official diagnostic documentation returned no results; this conclusion is
based on local source evidence. No allowance, credential or deployment changes
were used to diagnose the mismatch.

## Integration file inventory

| Area | Included source and supporting tests |
| --- | --- |
| Trusted generation entry | server/index.mjs, aiGenerationPrompt.mjs, trusted-interactive.mjs, mochi-plan.mjs; principal-entry, principal-gateway-http, lifecycle and protocol-prompt tests |
| Paid runtime and durability | paid-gateway ledger, pricing, provider, runtime, idempotency-sidecar, mochi-budget, studio-budget and live-pricing; runtime, principal-runtime/smoke, smoke-profile, idempotency, budget, pricing and main-compatibility tests |
| Studio bootstrap/session | studio-launcher.mjs, studio-deployment.mjs; issuer, launcher, supplemental-budget, cumulative continuity, signed legacy-history, status-pricing and Mochi activation fixtures/tests |
| Scoped Mochi consent | server/mochi-ai index/service and frontend mochi-ai protocol/client/type declarations; project-consent and host-compatibility tests |
| Homepage access | AiCreate.tsx, StudioAccessStatus.tsx and two SSR regressions |
| Review documents | This integration report and legacy-history-migration.md |

Fixtures include only synthetic credentials and published known-answer HMAC
vectors; no live credentials, ledgers, archives, dependency trees, temporary logs
or generated artifacts belong in the commit.

## Deployment acceptance completed

The parent verified Studio master `319a6c30339d9f43410e3ea641bff53a3ed0f868`
is Running, with build image `370136-319a6c30-2026-10-23-02-17-34` and unchanged
free hardware. Browser status unlocked with the original cumulative 85/100 calls
and CNY 0.9063 conservative charge. A fresh original-project JSON download after
ZIP restoration is exactly equal to the predeployment v23 backup. Prior cloud
acceptance covered proactive suggestion preview/confirmation, gallery asset
preview and byte-exact ZIP project/asset restoration. The quote fix additionally
passed seven offline regressions without paid calls.

Independent final safety review passed 181/181 targeted tests and found no
release blocker. This continuation used zero real AI calls. Evidence is stored
in the parent workspace at `deployment-evidence/mochi-proactive-activation-20261023/`.
The next editing-contract stage was held throughout deployment acceptance.
