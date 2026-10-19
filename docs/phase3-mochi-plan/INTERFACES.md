# Phase 3 Mochi PlanProvider interface contract

Status: default OFF; no production route/UI registration. Independent security GO is required before enablement. REAL_MODEL_CALLS=0.

## Ownership and authority

Core owns `server/mochi-plan/*` and `httpPlanProvider.ts`. Gateway owner owns `server/paid-gateway/*`; its PR #53 patch is included unchanged. The shared `server/index.mjs` remains under its existing owner's exclusive control and is unchanged. Workshop retains `unavailablePlanProvider`; its owner must explicitly inject the HTTP provider into the existing effect-owned Mochi Host only after acceptance. No second Host, Runtime, Confirm endpoint, TSX executor or mock fallback exists here.

## Trusted server adapters (required, not provided by this candidate)

`createMochiPlanHandler({ enabled:false, approval, transport, authenticate, resolveProject, acquireAdmission, allowedOrigin, timeoutMs })` is an explicit mount seam. It returns false for unrelated routes. An enabled mock harness does not enable the application.

- `authenticate(req,{signal}) -> {sessionId,subjectId}|null`: current server-side session authority, not client-supplied identity. Each authentication is bounded by two seconds and the whole request deadline. Authentication exceptions fail closed. No raw adapter error is returned.
- `resolveProject(access,binding,{signal}) -> {ownerId,appId,instanceId,revision,selectedBlockId,readOnly:false,snapshot}`: retrieve canonical project state and selection for the authenticated principal, not the client's project snapshot. It must enforce storage access. The handler copies and validates the ProjectState, exact owner/app/instance/revision/selection, and selected built-in form/list/metric binding.
- `acquireAdmission(access,binding,{signal}) -> lease`: acquire live authoritative admission; asynchronous acquisition is bounded and late results are released. `lease.assertCurrent()` MUST synchronously return literal true only while session, subject, owner, project instance, revision, selection and writable state remain authorized. The implementation must bind the expected authority epochs, not refresh itself to silently accept a new revision or session. A stale boolean, cached access object or a Promise is insufficient. `release()` must be synchronous, idempotent and nonthrowing. Release terminates the lease, not model quota.

The live lease is required even after async reauthentication. Its guard is captured once, passed as the third (server-only) transport argument, and run before reservation and immediately before actual network invocation. There is no await between the final guard and invocation. The adapter must hold/read authoritative state synchronously. Distributed identity/project authorities require a real locking/lease/epoch protocol with synchronously observable revocation; this candidate cannot make an arbitrary async remote lookup atomic. No such production adapter is claimed implemented or accepted.

After model validation: reauthenticate -> resolve canonical project again -> compare copied snapshots -> synchronous lease guard -> return candidate. No await follows that last guard. Changes after response are independently rejected by Host binding/lifecycle and final Runtime CAS.

## HTTP and client

POST `/api/mochi-plan`, exact configured Origin, application/json, identity encoding, <=16KiB, whole deadline <=30s. Body has exactly `{appId,instanceId,selectedBlockId,revision,requestId,prompt}`. IDs are bounded, revision nonnegative safe integer, prompt <=2000 chars. No records, snapshot, owner token, key, model, URL, guard or capability grant is accepted from the client.

`createHttpPlanProvider({enabled:false,...})` returns unavailablePlanProvider by default; when explicitly enabled it uses fixed same-origin path, credentials same-origin and redirect error. It reuses createModelPlanProvider's minimal context/deadline/cancellation; response <=64KiB. Errors do not produce a fallback plan. HTTP has no execution authority.

## Gateway / budget

Only exact `isPaidTransport` AND `supportsPaidAdmission` WeakSet-branded instances are accepted. Wrappers and property branding fail. Every Phase 3 call passes `{assertCurrent}`; deployments may also construct the shared gateway with `requireAdmission:true`. Share the canonical durable ledger/transport with other services; never open a fresh production ledger to reset quota. Legacy v1 omission remains compatible in the owner patch; this does not remove the Phase 3 per-request requirement.

Model source/allowed value is solely `PRICING.model` (`deepseek-flash` at this baseline). Fixed official endpoint, two system/user messages, JSON mode, stream false, max_tokens 2048. No environment/client override. Gateway retains input/output caps, pricing expiry, six-attempt and monetary ceilings, timeout, no retry/redirect, cancellation and audit protections.

Before actual fetch: failed live guard/abort produces durable `not-sent` if a reservation exists. `releasedNano === reserveNano`, estimated cost zero, attempt/hash/original amount retained. Retained money is `sum(reserveNano-(releasedNano??0))`; attempts are `entries.length`. No pre-reservation rejection adds an entry. Once fetch is invoked, even synchronous throw is conservatively sent; unknown usage remains uncertain+halted, settled usage is never refunded. Old ledger readers reject not-sent, so rollback fails closed. Failed persistence also fails closed and needs owner investigation; no quota reset/retry is authorized.

## Plans and execution

The existing AppChangeCandidate contract and existing Engine preview validation allow only addField, configureBlockFields, configureBlockPresentation, addBlock, removeBlock, scoped to the selected block and bound entity. No scripts/TSX/data/permissions/replacement runtime. Server checks requestId/baseRevision and returns validated candidate only. A disposable read-only planner facade has no Runtime execute/dispatch or owner.

The existing browser Host must independently validate and show PREVIEW. Only explicit user Confirm can reach the existing planner/Host authorization and Runtime CAS. Revocation/revision/selection/lifecycle changes invalidate pending work. No automatic confirm and no server apply endpoint are added.

## QA handoff

Rebuild trusted validators with `node server/mochi-plan/build.mjs`, then run `node --experimental-transform-types --test tests/mochi-plan/provider.test.mjs`. Gateway tests require `npm --prefix server run build` and `node server/custom-block/build-protocol.mjs` first. Fixtures use fake transport, temporary private ledgers and no paid keys. Formal browser enablement, deployment auth adapter, Docker packaging and real model quality remain outside the passed mock evidence.
