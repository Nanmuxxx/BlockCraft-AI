# PR #49 Mochi targeted remediation — 2026-10-19

**Independent QA NO-GO remains in effect. Overall status: BLOCKED pending dependency-backed tests and Workshop/Provider coordination.** The exact command-contract defect is patched and native regression evidence is available for re-QA. This report does not declare PR #49 GO.

## Baseline and remote uncertainty

- Local remediation starts from `0c45cf5feebcb4d7778c51490cb97cc8aac5e0ad`, branch `phase2/mochi-editing-main-candidate`; initial worktree clean.
- Its parent/main is `d644835bc915528fddc873e2687c84471f22ec52`. Original `2148e7444b9f4e9a2a6994f0c93c804b3efcf885` and old bundles remain preserved; original worktree's uncommitted report/test are untouched.
- `git ls-remote origin refs/pull/49/head refs/heads/phase2/mochi-editing-main-candidate refs/heads/main` failed: `Could not resolve host: github.com`. Local origin/pr49 does not exist. **Actual remote PR HEAD/base/file list could not be verified**. The known local candidate is not asserted to equal today's remote PR HEAD.
- No blind push, repeated fetch, duplicate PR, reset/clean/rebase/force push, shared UI change or deployment. New commit must descend from the local candidate; a publisher must verify the actual remote before non-force updating existing PR #49.

## A/B. Fifth command authority, failure root cause, exact fix

The newly added fifth member is **configureBlockPresentation** (third position in the array; “fifth” means the additional command beyond the original four). Its feature-scope authorization comes from the user's original Phase 2 instruction: “首先以 AppSpec/CustomBlock 为目标” and “至少支持：修改按钮文字；修改受支持的视觉属性；修改允许范围内的组件参数”. Subsequent Tech Lead main migration PASS/offline QA authorization and this targeted remediation authorize preserving that bounded implementation. This does **not** authorize enabling a paid/production provider or grant a plan a Runtime token.

Definition/registration/path evidence in the existing candidate, unchanged in this remediation:

1. `src/model/appSpec.ts` BlockPresentation/AppCommand defines only the typed patch command. `appSpecValidation.ts` presentation/block/assertCommandRequest restricts nonempty known keys, nonblank text ≤120, hex colors and integer radius 0–32.
2. `src/integrations/mochi/modelPlanProvider.ts` APP_SPEC_EDIT_INSTRUCTION/createModelPlanProvider accepts bounded unknown JSON, not authority. `appChangePlan.ts` AI_CHANGE_COMMANDS is the exact frozen five-member list, then assertCommandRequest/validateScope/validateTargets verify schema and trusted block/entity scope. Model-supplied capability IDs cannot grant authorization.
3. `host.ts` onRequestPlan binds snapshot, selection, requestId/epoch and authorization; preview is pure. projection displays actual diff. onConfirm accepts only the owned planId and rechecks context. `createAppChangePlanner.confirm` submits the original request and captured token.
4. `appRuntime.ts` executeCommand performs processCommand, revision checks and atomic publish through `customProjectSession.ts` commitBuiltin to the existing owner.compareAndSwap. Owner checks writable state, captured authorization identity, expected snapshot and next revision. `appCommands.ts` merge occurs on the transaction clone; no DOM write.

The stale test at `src/model/appChangePlan.test.cjs` asserted exactly four names. Its assertion was reproduced directly against production AI_CHANGE_COMMANDS with the Node native loader: **exit 1, AssertionError**, actual includes configureBlockPresentation. Log: `.cache/pr49-remediation/old-allowlist-reproduction.log`. This isolated reproduction is not described as a successful execution of the dependency-blocked CJS suite.

Fix: rename the test to describe five commands, replace the outdated expected literal with the exact frozen five-command set, and assert Object.isFrozen. Keep **all** previous updateField/removeField/undo/unknown-command rejection loops and state/notification assertions. No production allowlist is expanded, no wildcard is added, no old rejection is removed, and no test is skipped. The isolated corrected exact assertion passes (`new-allowlist-contract.log`).

Add 10 native rejection/order regressions to the existing safety file: exact frozen set; forbidden updateField/removeField/undo/unknown; Preview has zero writes and forged Confirm fails; trusted-scope rejection; read-only and no-selection rejection before invoking Provider; unavailable production Provider failure with explicit code. Full snapshot/owner identity, full state JSON and undo availability are asserted unchanged on refusals. Success checks full expected AppSpec/records/layout and owner revision.

## C/D. Formal entry and ownership

Formal AppSpecWorkshop currently creates one Host with unavailablePlanProvider (`AppSpecWorkshop.tsx:35`) and supplies AI_MODIFICATION_DISABLED. This remains **intentionally disabled**. Conversation is advice-only and requires modificationsEnabled=false; enabling chat must not imply edit permission.

The minimum shared coordination point is approved provider injection into the **existing** effect-owned Host factory plus consistent disabled feedback; current renderMochi is a display slot, not a provider seam. Editing Engine did not change those Workshop-owned files or create another Host, Runtime owner or state machine. No safe production provider approval is evidenced, so it is not enabled by this remediation.

The handoff contract `docs/mochi-pr49-entry-contract.md` specifies project/selection/binding/owner/provider preconditions, request versus commit authority, runtime replacement/dispose, confirm-time generation/revision/CAS revalidation, explicit Mock-only fixture policy, and exact B/C property/default semantics. Workshop owns AppSpecWorkshop/WorkshopMochi/Conversation/B card mapping; Editing Engine owns these model/Host contracts and tests. Workshop must confirm and implement UI wiring; provider owner must obtain separate security approval. This document is a coordination artifact, not evidence of delivered UI or a sent cross-chat message.

## E. Actual validation

Environment: Node v24.22.0, isolated worktree has no node_modules; npm registry https://registry.npmjs.org/. Current native DNS lookup returns ENOTFOUND. No original-project dependency link, global config change or permission expansion.

All logs below are in `.cache/pr49-remediation/`:

| Actual command | Actual result / log |
| --- | --- |
| `npm test` | exit 1; 9 file startup failures, missing TypeScript; npm-test.log. Root suite **not passed**. |
| `npm run test:mochi-host` | exit 1; missing TypeScript, 0 pass/1 startup fail; mochi-host.log. |
| `node --test src/model/appChangePlan.test.cjs src/model/appRuntime.test.cjs tests/mochi/presentation.test.cjs` | exit 1; missing TypeScript, 0 pass/3 startup failures; planner-runtime-ssr.log. Includes the repaired legacy test but cannot execute it here. |
| `node --experimental-transform-types --test --test-reporter=tap --test-reporter-destination=.cache/pr49-remediation/engine.tap tests/mochi/presentation-native.test.mjs` | **19/19 PASS**, engine.tap. |
| Same native command using safety.tap and tests/mochi/editing-safety-native.test.mjs | **56/56 PASS**, safety.tap. |
| `node --experimental-transform-types --test --test-reporter=tap --test-reporter-destination=.cache/pr49-remediation/native.tap tests/mochi/presentation-native.test.mjs tests/mochi/editing-safety-native.test.mjs` | **75/75 PASS**, 0 failures/skips/cancellations; native.tap. |
| CAS/revision checks within the full safety run | Two planner races, two actual owner CAS candidate orders, simultaneous Host confirmation, real stale-token rejection all PASS; no mocked CAS substitute. Existing stale revision, cancellation, late response, project lifecycle and atomic failure tests retained. |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 1, missing TypeScript module; typecheck.log. |
| `npm run build` | exit 1, tsc not recognized; build.log. Vite build not executed. |
| JS syntax checks and `git diff --check` | PASS; not a replacement for typecheck/root suite. |

Sequence evidence from the new actual test is REQUESTING → provider → PREVIEW → CONFIRMING → executeCommand → Runtime notification → APPLIED. At PREVIEW executions=0, receipt=null and Runtime/owner state unchanged. Forged planId remains zero writes. Valid confirmation forwards the exact captured token once and yields revision 1; duplicate confirmation produces no further execution or state change. B/C data share that Runtime, but B card visual mapping and actual product browser E2E remain unaccepted.

## F/G/H. Commit, bundle and unresolved items

Intended local fix increment relative to `0c45cf5...` contains exactly five files: repaired appChangePlan.test.cjs, extended editing-safety-native.test.mjs, the new entry-contract document, this remediation report, and a latest-status preface in PHASE2-MOCHI-EDITING-REPORT.md. **Zero production-code changes.** New commit SHA is the final git rev-parse HEAD / bundle list-heads result, not a self-referential value embedded in this report.

Because remote PR #49 HEAD/base cannot be verified, do not push automatically. Prepare a complete self-contained trusted bundle of the remediation branch with SHA256, verify/list-heads, empty-repository import and strict fsck. The publisher must first query PR #49 base/head/ref, ensure its current head is the expected parent (or establish the appropriate descendant relationship), and non-force update that same PR branch; never create another PR or overwrite a changed remote. If remote HEAD differs, stop for Tech Lead reconciliation.

Unresolved: full CJS/root test execution, TS/build/browser; separately approved production Provider; Workshop single-Host wiring and B presentation projection. Local command-contract regression is corrected and native results are ready for independent review; **overall BLOCKED, not PR #49 GO**. Independent QA/Tech Lead retain the decision.
