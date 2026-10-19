# PR #49 — Mochi modification entry contract (coordination required)

This document does not enable a provider or change UI. Editing Engine owns the planner/Host contracts and its tests. Workshop owns AppSpecWorkshop, WorkshopMochi, Conversation panels and B card mapping. No shared UI, server, Runtime or owner file is changed by this remediation.

## Existing wiring and exact coordination point

- `src/components/app-builder/AppSpecWorkshop.tsx:30–40`: one effect-owned Host per runtime; line 35 creates it with unavailablePlanProvider. Runtime replacement disposes the old Host. Production currently supplies AI_MODIFICATION_DISABLED to the composition.
- The internal MochiWorkshop test seam receives the existing Host and Runtime; it is not a second production entry.
- WorkshopMochi forwards onRequestPlan/onConfirm/onCancel and displays HostPreview/receipt. It does not acquire authority from UI context.
- MochiConversationPanel → createWorkshopMochiConversation uses the same Host for structural context and focus. Its advice client explicitly requires modificationsEnabled=false. Advice availability must not be interpreted as modification authorization.
- Before changing production wiring, Workshop must coordinate an approved PlanProvider injection at the existing Host factory and consistent planningDisabledReason. The current public Workshop props do not expose a provider injection API; renderMochi is a display slot, not a provider/owner authority API. This remediation does not introduce such a prop or enable production Mock fallback.

## Conditions for an enabled request composer

Trusted composition must have one live Runtime/customProject owner, a valid current project, a supported selected builtin form/list/metric with valid binding, writable authorization and a separately approved PlanProvider. Plan support must be established from the strict command schema and trusted target scope. CustomBlock/pomodoro modification remains disabled by current Host policy.

Production provider absent, read-only authorization, unsupported selection or unavailable owner must keep modification requests disabled with a clear reason. A configured provider or enabled chat is not proof of write authority. Explicit offline fixtures may inject deterministic Mock completion into the internal test composition and must be visibly identified as fixtures; do not silently substitute Mock in production.

The entry conditions are preflight feedback, not a new authorization state machine. The existing Host still captures project snapshot, requestId, selection/epoch and authorization at request time; validates the returned plan; and publishes only Preview. Only a user confirmation of the owned planId triggers planner.confirm and Runtime.executeCommand with the captured token. Before and during confirmation the existing Host/planner/owner recheck project/revision, selection/context and authorization generation. The existing owner validates captured identity and expected snapshot/revision. Never refresh the plan's revision/token to make an obsolete plan pass.

## Controlled command and B/C contract

The new fifth member of the exact five-command set is configureBlockPresentation. Request schema is `{type:'configureBlockPresentation', blockId, presentation: nonemptyPartialObject}`. It supports only buttonText (form, nonblank string ≤120), backgroundColor/textColor (#RRGGBB strings), borderRadius (integer 0–32 px). No unknown keys, arbitrary CSS/TSX/events, record edits, scope or authorization fields. Omitted keys preserve existing values. Defaults are display-only: submit text 提交; missing colors/radius keep CSS (C section white/16px); existing-record edit text remains 保存修改. Null/deletion/reset is not supported.

B must consume builtin item.block.presentation from its existing subscribed owner snapshot. C reads the same Runtime block in BuiltinBlockRenderer; colors/radius apply to its container, not all child controls. B currently lacks this mapping. Workshop must implement it; do not create a parallel state store or DOM patch.

## Joint acceptance requirements

Use a controlled provider fixture with the real Workshop path: B selection → prompt → exact Preview with unchanged snapshot/revision → explicit Confirm → authorized Runtime/CAS receipt and revision +1 → B values and C text/computed container style agree. Verify return to B, two partial updates, radius 0, defaults, denied/stale plans leaving both views unchanged, selection/project change, request cancellation and late responses. Keep selection/drag/focus behavior intact. Pure Runtime snapshot checks are engine evidence, not browser acceptance.

Open coordination request: Workshop must confirm the single-Host provider seam and own its UI implementation; the provider owner must establish production adapter security approval. Editing Engine can supply the bounded candidate schema, fixtures and Runtime receipts. Until that coordination and browser acceptance complete, production modification entry remains disabled; PR #49 is not declared GO.
