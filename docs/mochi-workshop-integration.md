# Mochi × Phase A Workshop integration: design and implementation report

## Verified upstream and review sequence

- 2026-10-18: PR #18 merged at 08:38:11 UTC. The independent worktree starts from main `65e1f813949ceb1bc74064d338a04f99351c244e`.
- PR #17 was open/unmerged at verification, head `e6f94fa591aea3111bbc811c7b20c98a74f45cdf`. Its exact Git commit was integrated locally; no other Agent working directory was read or copied.
- [PR #20](https://github.com/Nanmuxxx/BlockCraft-AI/pull/20) targets #17's branch with the formal component contract and browser-discovered corrections. Review #20 into #17 first, then #17 into main; this integration is dependent and must be reconciled/retested against that merged main. This integration branch includes the committed dependency so the result can be reviewed now.
- No GitHub PR was merged and nothing was deployed by this task.

## Ownership and lifecycle

The generated-app caller still creates the only AppRuntime. AppSpecWorkshop acquires one MochiHost for that Runtime in an effect above both B/C surfaces, then disposes it on replacement/unmount. Acquisition happens after React commit: StrictMode's setup/cleanup replay disposes its first instance and acquires a fresh live instance, without a leaked subscription or reusing a disposed host. B/C switches never create a host or Runtime.

MochiWorkshop subscribes to the host's stable external snapshot. Mode and selectedBlockId come from that snapshot. Canvas selection calls host.setSelection; B/C navigation calls host.setMode. Both existing canvas and renderer stay mounted as before. The old static AppSpecMochiPanel is replaced at this mount point by one MochiAssistant. Original Demo remains unchanged.

All four callbacks use the shared MochiCallbacks contract: onRequestPlan(prompt, uiContext): Promise<void>; onConfirm(planId): Promise<void>; onCancel(planId): void; onIgnore(suggestionId): void. UI sends display context only. Host ignores that second argument and independently derives the current selection, entity binding and revision. UI catches callback failures and retains failed drafts. The host alone owns plans, permissions, cancellation, request epochs and receipts.

## Preview and commit boundary

The unchanged #18 adapter uses Phase A's preview against an isolated state, zero AppRuntime writes. Host checks instance/request/revision binding and confines direct command targets to the selected block. Shared entity schema effects remain explicitly disclosed in preview. The original private plan object is retained by Phase A; the UI only sees its planId and display diff.

Selection, mode or Runtime revision changes invalidate pending plans and abort in-flight providers. Cancelled/foreign/stale plans cannot execute. Confirm locks before synchronous Runtime notification, then delegates to Phase A's atomic commit. Repeat confirmation is idempotent. Real committedRevision is displayed as a system receipt, never a fabricated assistant response. Provider failure preserves the committed app, records and receipt. Ignore only dismisses the corresponding local suggestion fingerprint.

## Production capability and data egress

AI modification is **not enabled**. Production imports unavailablePlanProvider, which rejects with AI_MODIFICATION_DISABLED and has no network transport. Composer and suggestion draft buttons are disabled with an explicit explanation that the DeepSeek modification-plan API is not connected. Existing initial app generation is a separate capability and is not advertised as modification planning.

Mock planner is imported only by tests/mochi/fixture.tsx and existing unit tests; there is no production Mock route, environment flag or fallback. Browser fixture is served solely by a test-created Vite middleware. Its visible banner says fixed Mock, no natural-language understanding, no AI. Production JS was checked for absence of Mock field label, Mock function and test fixture global.

PlanRequest.snapshot remains an in-process read-only provider input from #18, not a network DTO. The new toMinimalPlanInput is an explicit future transport allowlist: requestId, baseRevision, prompt, selected block metadata, and its bound entity's field id/name/type. It excludes records, record values, unrelated blocks/entities, app/instance identifiers and arbitrary extra properties. No network adapter exists yet. Prompts and schema names are user data too; a future API must call this projection deliberately after a user request and enforce its own server-side limits/validation. Never JSON.stringify the provider request/snapshot/context as an outbound payload.

## Anchor, interaction and visual behavior

Host measures selected DOM blocks relative to the actual positioned Workshop. InstanceId, revision, selection and epoch bind each measurement. ResizeObserver, selected-block style/class observation and captured scroll events schedule one animation-frame measurement; unchanged measurements do not republish. Mode/revision changes clear the anchor. Offscreen blocks hide the decoration. At 390px it uses the original noninteractive right-bottom fallback. CSS variables fix #17's inline left/top overriding that fallback. Overlay pointer events remain disabled.

Chat is outside canvas drag handlers and stops pointer/key propagation. Real pointer tests confirm chatting cannot move blocks, while canvas dragging still commits a layout revision. History follows new entries only at the bottom; reading older entries preserves scroll position. Existing reduced-motion rules stop avatar and overlay animations. No branding, Demo, Mochi asset, block canvas logic, CustomBlock executor or Docker code changed.

## Validation and evidence

- `npm test`: **156/156** passed, including the inherited 24 host security tests, Phase A/Runtime tests, component tests and new fail-closed/data-minimization tests.
- `npm run build`: passed. Production JS excludes Mock planner and browser fixture.
- `git diff --check`: passed.
- `NODE_PATH=<Playwright module directory> npm run test:mochi:browser`: real headless Chromium, **1366×900 and 390×900**, all checks passed. See [structured report](mochi-workshop-audit/browser-report.json). Zero page errors, asset HTTP errors or external network calls.
- Real-browser checks at both widths: production disabled state; one chat entry; StrictMode/B/C subscription stability and unmount cleanup; preview zero writes; cancel/reselection/mode invalidation; duplicate confirmation; real Runtime receipt; B/C schema/record consistency; suggestion ignore; chat drag isolation; canvas dragging; failure after commit preserves app and draft; history anchor; overlay anchor/fallback; reduced motion; no horizontal page overflow.
- Existing `tests/generation/browser.cjs`: passed with 7 distinct offline apps, records/aggregates, B inspector edits/C data, edit/delete, 5 failures retaining old app, retry; 13 local HTTP requests using injected DeepSeek responses, zero paid calls.
- Screenshots and full browser report: `/tmp/blockcraft-mochi-audit/production-1366.png`, `production-390.png`, `integrated-1366.png`, `integrated-390.png`, `report.json`. Screenshots were visually inspected. Initial dependency symlink blocked font files in Vite; replaced with a clean worktree-local `npm ci --ignore-scripts` and reran both browser suites with fonts/assets passing.

These checks use a real browser and Runtime with a fixed Mock candidate; they do not establish model planning quality, a live DeepSeek modification endpoint, Safari behavior or physical touch-device behavior.

## Next requirements

1. Tech Lead review and explicit authorization for the #20 → #17 → integration merge sequence; refresh/retest on merged main if upstream changes.
2. Implement a real server-side DeepSeek modification-plan API with the minimal DTO, cancellation/timeout/error contract, unknown JSON validation, credentials kept server-side, and no record egress by default. Return requestId/baseRevision binding; never execute commands server-side on behalf of UI.
3. Add real API success/failure/timeout and malicious-output integration cases before replacing unavailablePlanProvider. Keep preview/confirm and trusted Phase A scope unchanged; enable the composer only when that production capability actually exists.
