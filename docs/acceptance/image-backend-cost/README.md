# Image backend / cost-security audit — 2026-10-27

Agent: `codex-image-backend-cost-20261027` (Supervisor + Image-Backend + Cost-Security).
Base: `bcb6c1a7402ad4b4514feb4865c38d769d7244d1`, freshly fetched and independently matched with `git ls-remote origin refs/heads/main`.
Branch: `audit/image-backend-cost-20261027`. See the PR / final #92 report for the full committed head (a commit cannot embed its own hash).

Claim: [#92 report](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-6445008814).
Interface proposal: [#92 proposal, awaiting Workshop ACK](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-6445068279).
Scope: T1/T2 completed within the backend remit; T4 only an isolated typed Mock seam and design. **REAL integration remains BLOCKED.** No image endpoint was registered, paid adapter created, production configuration changed, or existing frontend/resource contract edited.

## Evidence and environment

Darwin arm64; Git `2.50.1 (Apple Git-155)`; Node `v24.22.0`; npm `11.19.1`; TypeScript `5.9.3`; Python `3.14.7`; curl `8.7.1` with certificate validation enabled.
Dependencies installed in the fresh worktree using `npm ci --ignore-scripts --no-audit --no-fund` (exit 0, 26 packages). No `.env` read and no live runner invoked. Existing test fixtures inject synthetic credentials and temporary ledgers; those are not production authorization.

| Actual command | Type | Exit / outcome |
|---|---|---|
| `node node_modules/typescript/bin/tsc -p server/tsconfig.json --noEmit` | OFFLINE | 0 |
| `npm --prefix server run build` | OFFLINE | 0 |
| `node node_modules/typescript/bin/tsc -b` | OFFLINE | 0 |
| `npm run build` | OFFLINE | 0; bundle size warning, no build error |
| `npm --prefix server test` | MOCK | 0; 37 passed |
| `node --test --test-timeout=30000 tests/paid-gateway/*.test.mjs` (first run) | MOCK | 1; 83 passed, 3 test-file load failures |
| `node server/custom-block/build-protocol.mjs` | OFFLINE | 0; missing generated protocol prepared |
| `node --test --test-timeout=30000 tests/paid-gateway/*.test.mjs` (prepared run) | MOCK | 0; 109 passed |
| `npm run test:generation` | MOCK | 0; 144 passed |
| `npm test` | OFFLINE | 0; 224 passed |
| `node node_modules/typescript/bin/tsc -p server/image-generation/tsconfig.json` | OFFLINE | 0 |
| `node --test tests/image-backend/provider.test.mjs` | MOCK | 0; 6 passed |
| `python3 .github/scripts/test_supervisor_monitor.py` at exact PR93 head, separate worktree | OFFLINE | 0; 2 passed |

Baseline commands tested the unchanged base source; new provider tests tested this PR's new source. The logs and `logs/baseline-results.json` preserve real command arguments, outputs and exits, including the initial failure. Mock tests use loopback HTTP where needed. No claim of OS network isolation is made. No browser/ZIP acceptance was performed by this backend agent; Workshop/independent QA own that work. No REAL test was performed.

## Confirmed architecture

| Evidence in main | Finding and consequence |
|---|---|
| `src/integrations/gallery-generation/offline.ts` | Browser `ImageProvider.generate(prompt, signal): Promise<string>` is explicitly offline-only; draws a 320×240 PNG on Canvas. It does not call a model. |
| `src/integrations/gallery-generation/controller.ts` | 1–500 code-unit prompt; 10s controller deadline; static PNG data URL <=699100 characters; APNG rejection and browser decode before candidate adoption. Generation and explicit adopt/save are separate. A future 120s provider will not fit this deadline unchanged. |
| `src/model/appSpecValidation.ts` | Existing `ProjectAsset` caps: 32 images, 512 KiB per image, 1 MiB aggregate; accepts raster signatures. Server normalization must fit those caps. No schema edits here. |
| `server/index.mjs` | `/api/ai/generate` accepts `idea` and optional trusted-interactive protocol, returns AppSpec. Principal resolution is server-owned, bounded, default deny; Origin is additional protection, not identity. No `/api/image-generations` route. |
| `server/index.mjs`, `server/studio-launcher.mjs` | Opaque session / reviewed local Studio identity mechanisms exist. Local app/session approval does not establish server-verifiable membership of arbitrary IndexedDB project IDs. No general project membership authority found in audited server paths. |
| `server/paid-gateway/provider.mjs`, `runtime.mjs` | Fixed DeepSeek chat endpoint, strict text payload/model and text-token pricing; no automatic retries, redirects rejected, reservations precede fetch. Image requests and image prices are incompatible. |
| `server/paid-gateway/ledger.mjs`, `idempotency-sidecar.mjs` | Useful durable write/lock/claim patterns exist. Primary ledger's unresolved reservations halt. Sidecar claims prevent duplicate spend; this is rejection, not cached-result replay. They do not implement image user/project/day accounting. |
| `server/paid-gateway/unified-ledger.mjs`, `unified-runtime.mjs` | Unified accounts split customer vs agent-test, not per user/project/day. Some uncertain requests remain fully charged while further calls are allowed (existing test explicitly covers this). That policy must not be inherited as the image uncertainty-halt policy required by #91. |
| `server/paid-gateway/pricing.mjs` | Dated DeepSeek prices/approvals exist; old static snapshots have expired. Other trusted entry points may use live verification. None is approval for images; no budget or price constants were changed. |

The server's existing `tsconfig` checks two model validation files, **not all `.mjs` server code**. Its passing build is not a comprehensive server type-safety claim. New provider types are checked with their separate strict config.

## Delivered T4 subset and release blockers

`server/image-generation/provider.ts` defines a typed **MockImageProvider**, stable safe errors, strict prompt validation, cancellation, explicit Mock opt-in, browser guard and a fresh fixed 1×1 PNG fixture per result. No URL, model, key, identity or budget may be supplied through the request. It does not infer authorization, reserve money, decode arbitrary upstream images or provide durable idempotency. It is unconnected to application startup and frontend imports. The browser guard is an accidental-use check, not a bundler or malicious-code sandbox.

Before any live adapter: (1) Workshop ACK of the candidate contract and timeout; (2) trusted project authority; (3) atomic persistent image budget/idempotency/result store; (4) bounded decoder/re-encoder and content checks; (5) approved provider/model/region/price envelope and isolated environment. See [design](design.md) and [cost study](providers.md).

Unique next action: Image-Workshop acknowledges or amends the proposal in #92; then Image-Backend can implement the mock HTTP coordinator against an explicit project authority and persistent store contract. Current approval_needed: **NONE**. REAL calls later require PAID_API + BUDGET + isolated-environment approval; deployment and merging are separate.

## Supervisor review

See [related-pr-review.json](related-pr-review.json) and [open-pr-snapshot.json](open-pr-snapshot.json) for exact remote heads, target refs, merge bases and check-runs. GitHub's PR `base.sha` is the target tip; it is not necessarily the historical merge base. Review uses the compare API's `merge_base_commit.sha` and `behind_by` to identify stale branches.

PR #93 head `285e061a7820f2b2022bd31d4c1040aa4e1be32d` remains unmerged. Its 2 tests pass locally; exact-head check-runs returned zero. The only recent successful main runs observed were Supervisor snapshots, e.g. [40511234373](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40511234373); the gallery/Docker CI successes observed were bound to `0c4062957a1e69488811a1ecf0819c6ab35db55c`, not the current main commit. These are not REAL image acceptance.

PR93 review risks: role matching uses a single `role: <role>` substring plus `break`, so a combined role report like this agent's is counted only as Supervisor. `pages()` caps at 400 oldest comments and can omit recent reports in a busy issue. A report link is not validated evidence or agent liveness; checks/CI are not fetched by the script. These limitations are absent from its two happy-path tests. No monitor changes were made here; request follow-up tests before merge.

Legacy #56/#61/#63/#68/#75/#76/#77 are audit-only until rebased/reviewed against main. Their existing heads and scoped CI evidence cannot validate the new image milestone. File overlap risk is highest in `server/index.mjs`, `server/paid-gateway/**`, generation code and tests; this branch avoids edits to those files. No separate Image-Workshop PR/ACK was present at initial inspection, so its work remains UNREPORTED rather than inferred complete. This report is a scoped dependency/security audit, not full line-by-line approval of every legacy diff.

Rollback: unmerged PR can be closed; the new provider is unreachable from running application code. A later merged rollback can remove these new files without state migration. No production ledger or project data was touched.
