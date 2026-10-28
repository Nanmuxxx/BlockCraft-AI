# Image Phase 2 — HTTP MOCK integration

Update: independent QA at f325e2f issued REWORK for R1/R2. See [focused rework and new verification](../image-http-rework/README.md); original evidence below is historical, not final acceptance.

Developer self-test: isolated HTTP MOCK loop PASS. Production authorization BLOCKED; durable image budget ledger BLOCKED; REAL MODEL NOT_RUN; INDEPENDENT_QA PENDING. This is not completion/acceptance of the real-provider milestone #91.

## Scope and provenance

Base main `bcb6c1a7402ad4b4514feb4865c38d769d7244d1`. Original Draft #94 `79080e450ff667eae7c2c8acd700b7b367752f12` and #96 `906cdea3558b1ae4f7ec2e54795033be02949966` are preserved as ancestors via isolated local candidate merges, not merged on GitHub. Worktree `BlockCraft-AI-image-http-phase2`; branch `feat/image-http-integration-20261028`; agent `codex-owner-image-integration-20261028` (/root, owner's live Codex chat). Original provider.ts and Mock adapter contributions retained; neither source branch rewritten. #97 untouched.

Review/merge order, only after owner approval: #94 and #96 (independent of each other), then this integration Draft, with fresh combined CI/QA after dependency state changes. A single Draft was chosen to preserve both original histories; incremental commits separate contract, coordinator, frontend, no-network supplier preparation and acceptance. Do not squash/rebase original contributors without agreement. Before dependencies merge the base-to-head diff intentionally includes their work; `git diff 00a2653be1cabe480c5d6b2f5599112eb313497d..HEAD` isolates this integration.

- P0: fresh remote source/claims/check-run audit, [Gap Analysis](GAP.md), combination baseline checks.
- P1: executable versioned JSON [RFC](../image-http-contract/RFC.md), bounded request/result/error envelopes and state/identity/idempotency/uncertain-cost rules.
- P2: Mock-only handler, create/read/cancel, isolated identity/membership injection, scoped idempotency, resource limits, late-result fencing, byte/CRC/inflate PNG checks, audit metadata, safe errors. Handler is absent from app startup. Ephemeral fixture state is never a production ledger.
- P3: DEV-only explicit selector, per-exchange10s/overall120s polling, status/cancel, native decode and existing confirm/adopt/save. Canvas/fixed Mock and ProjectAsset/IndexedDB/JSON/ZIP schemas retained.
- P4: actual loopback server requests in desktop and390px UI, plus faults and regression results below. Mock success responses are not fabricated by Playwright routing; only network-fault H10 aborts a connection. M06–M13/W01–W02 reuse existing local module fault tests; H01–H11 specifically exercise HTTP adapter/server integration.
- P5: [official-source preflight](REAL-PREFLIGHT.md), pure no-network supplier schema + fixed invented responses, child-safety/size/budget/reconciliation/rollback design. General supplier decoder, durable billing, moderation and trusted authority remain unimplemented.
- P6: Draft publication and #92 report; independent QA checklist below. No final ACCEPT from the implementer.

## Reproduce safely

Node24, npm11, dependencies from package-lock. `npm ci --ignore-scripts --no-audit --no-fund`; `node tools/project-zip-export/prepare.mjs`; `npm run test:image-http-contract`.

Isolated manual demo: `npm run dev:image-http-fixture`, then open `http://127.0.0.1:5178/ai-create`, choose the gallery fixture and “打开离线图库”, select “HTTP Mock 隔离测试（非 AI）”. All other APIs denied by that harness. Stop with Ctrl-C. The fixture's explicit `fixture-owner`/`fixture-project` are test-only identities; they are not authentication for app users. Do not expose this test harness publicly.

Automated browser: isolated Playwright1.62.1 + Chromium installed separately, `NODE_PATH=<isolated-tools>/node_modules GALLERY_TEST_PROVIDER=HTTP_MOCK GALLERY_EVIDENCE_DIR=.cache/image-http node tests/gallery-generation/browser.cjs`; repeat with `GALLERY_VIEWPORT_WIDTH=390`. Use `GALLERY_EXPECTED_SHA=$(git rev-parse HEAD)` to bind reports. Production: `VITE_IMAGE_HTTP_FIXTURE=1 npm run build` then `NODE_PATH=… node tests/image-http-integration/production.cjs` proves option absent/routes404 despite flag. `.dockerignore` includes only the shared contract for frontend compilation; fixture coordinator/provider/test server do not enter the runtime image.

The reused #94 fixture is a **1×1 white PNG (68 bytes)**, so the candidate/gallery appears white. This is expected test imagery, not prompt-dependent output or a model-quality demonstration; #96's original fixed landscape remains separately selectable. Screenshots were visually inspected for labels/control overflow and B/C bytes, not aesthetic model output.

## Evidence

Darwin arm64/macOS26.6; Git2.50.1, Node24.22.0, npm11.19.1, TypeScript5.9.3, Playwright1.62.1, Chromium151.0.7922.34. Fresh contexts only, no personal storage; model calls0, external requests0, page errors0.

`logs/baseline.json` binds combination baseline to `00a2653be1cabe480c5d6b2f5599112eb313497d`. `logs/final-results.json` binds full regression to `7011425b2c891d674a0ad59d73856d958c27d236`; all15 commands exit0: root/server/provider types, production build, server37, original-provider+contract20, default224, resource/JSON/ZIP/custom-block/export117, generation144, production-disabled browser, HTTP desktop/mobile26 each, fixed Mock16, Canvas14, ZIP browser4. Existing production bundle-size warning remains.

Additional test-only commit `16143d1791b294ebd121f81b538f555fd04e55c2` adds three scoped concurrent jobs and actual HTTP-asset JSON import/save/reload: `logs/supplement-results.json` + current browser reports bind that exact SHA, original-provider+contracts21 and HTTP desktop/mobile27 each, exit0. `git diff 7011425 16143d1 -- src server .dockerignore package.json` is empty: production source unchanged after the full regression. Later evidence/docs-only commits do not alter tested functional source. CI workflow `image-http-mock.yml` checks literal PR HEAD (not implicit merge ref), records SHA, runs both browser widths plus original modes and production disabled check; remote CI status must be read at the final published HEAD.

Committed `evidence/` holds JSON reports, synthetic portable ZIP and representative screenshots; complete local traces/downloads remain under `.cache/http-mock/`, and CI uploads artifacts. Logs retain the original test-only timeout-fixture failure and its correction, not hidden failures. Local Docker NOT_RUN: no docker executable/app at standard paths. Existing Docker CI must pass for the final PR HEAD; previous #94/#96 Docker results are not this composition's result.

## Known engineering gates and rollback

Trusted server project membership/revocation and image-specific transactional identity/dispatch/result/budget store do not exist. Text identity/ledger and browser WriteAuthorization do not satisfy them. Fixture budget rejection/uncertain settlement tests establish safe wire behavior, not durable paid accounting. No multi-process/crash-recovery/real moderation or arbitrary supplier-image conversion claim. Future REAL integration requires those engineering gates and owner approval; not READY_FOR_OWNER_APPROVAL yet. Browser Safari/real mobile-device acceptance NOT_RUN.

Rollback: keep Draft unmerged or close it; stop test listener. No migrations, production route, budget/secret changes or paid work. Remove HTTP selector/adapter/coordinator if needed; previously adopted static PNGs remain compatible. Preserve #94/#96 code/history. If later real dispatch is ever authorized, unresolved reservations must survive disabling the adapter and be reconciled rather than reset.

## Independent QA checklist (not performed by this developer)

- [ ] Fetch final Draft base/head and #94/#96 full SHAs, verify unchanged source/commit ancestry and exact-head CI; no PR merge authorization implied.
- [ ] Reproduce root/server types/build/default37/224 and resource117/generation144 suites as applicable; inspect logs and warnings.
- [ ] Reproduce contract21 tests, deny anonymous/forged/other owner/revoked result retrieval; scoped same key, changed payload conflict, concurrent distinct keys, no duplicate dispatch.
- [ ] HTTP desktop/mobile27 each: actual POST/GET server audit, preview/discard/adopt, B/C equality, duplicate adopt, indexed save/refresh, ZIP byte-identical roundtrip and JSON import/save/reload.
- [ ] Verify H01–H10 actual HTTP forbidden/provider failure/bad image/cancel/late/deadline/request timeout/dispose/quota/network failure; prior project/storage preserved. Inspect test-only identity and distinguish local M/W faults from HTTP H faults.
- [ ] Rerun original fixed Mock16/Canvas14 and old ZIP/JSON4; inspect desktop/390px screenshots and labels. White1px fixture is expected; no claim of generated art.
- [ ] Build with VITE_IMAGE_HTTP_FIXTURE=1 and prove production selector absent/all image routes404/zero upstream. Validate final Docker CI with curated contract inclusion and no fixture runtime modules.
- [ ] Review UNCERTAIN no-result/no-auto-retry, input/response/PNG/inflate limits, no raw error/prompt/credential logging; inspect missing paid engineering gates honestly.
- [ ] Record actual independent identity/session, commands, environment, full SHA, results/limitations; only independent QA/owner can issue ACCEPT. Keep REAL NOT_RUN and authority/ledger BLOCKED until implemented and separately verified.
