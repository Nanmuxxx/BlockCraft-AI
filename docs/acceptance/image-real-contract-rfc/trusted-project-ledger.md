# RFC 3 — Trusted projects and durable image expenses

**PROPOSED / NOT_IMPLEMENTED.** Existing private session parsing and text unified ledger are real code, not a production image ACL or image ledger. No initialization/migration/configuration is performed by this document.

## Authority chain and revocation

`trusted session -> stable server principal -> registered server project ACL -> operation grant -> image approval -> durable job`.

Server registry proposed records: `Project{id,ownerPrincipalId,aclRevision,status}`, `Membership{projectId,principalId,operations,validUntil}`, and authenticated user/session mapping. Browser IDs/localStorage, B/C owner objects, workspace ID, imported projects, prompt contents and frontend budget are never proof of membership. Import creates local content only; registering/linking a server project requires authenticated explicit ownership flow. Never auto-register any browser-supplied `projectId` to bypass ACL.

Operations: `image:create,image:read,image:cancel,image:adopt`; reconciliation is a separate privileged `image:reconcile` role. Check session expiry/revocation and operation grant at admission, immediately before dispatch, immediately before publishing bytes/proof, every status/recovery/cancel/content request, and at the explicit adoption-authorization transaction. That server commit is its ACL boundary; it cannot atomically commit browser IDB. Later revocation blocks new server operations and known-revoked pending local saves, but cannot retract already authorized/downloaded local copies; wire specifies this limitation. Local save permission is additionally required. No ACL resolver/database or ambiguous principal -> 503 ACL_UNAVAILABLE, **egress zero**; do not substitute existing `authorizeContext:()=>true`.

Foreign job, old owner or unknown project receives indistinguishable 404 for job routes. Known project with denied create operation may receive 403. Session expiration ->401, retains task/charge. Project transfer/revocation increments ACL revision, invalidates old grants and removes byte access. QUEUED/no-intent job can be cancelled/released atomically; inflight job is stopped if possible, otherwise UNKNOWN/settled by server reconciliation. Old principal never gains read access from knowing job/idempotency/receipt IDs; new owner does not inherit private prompt/history by default. Original job remains charged to captured accounting owner and project, not retroactively billed to recipient; explicit finance-approved transfer would be separate. Reconciler can resolve charges without returning assets to revoked users. ACL change and dispatch serialize on the project revision lock; after that boundary revocation cannot undo already possible egress, so resulting charge is reconciled, not waived.

## Data model and amount units

Proposed relational schema; PostgreSQL is a design choice requiring infrastructure approval, not an installed dependency:

| Durable record | Required fields / constraints |
|---|---|
| Approval | `id,principal/project scope,provider,modelVersion,region,priceVersion,currency,expiresAt,maxCalls,maxNano,status,revision`; status ACTIVE/FROZEN/REVOKED/EXPIRED; no client authority |
| BudgetBucket | `(epoch,scopeType,scopeId,currency)` unique; scope GLOBAL/USER/PROJECT/APPROVAL, `ceilingNano,heldNano,settledNano,calls`; no cross-currency netting |
| Job | UUID, principal/project/ACL revision, approval and immutable policy/price snapshots, requestDigest, admissionGrantId, task/charge states, reserved/settled nano, cancellation flag, revision, timestamps/deadlines/retention, private encrypted prompt reference, validated artifact/proof refs |
| AdmissionGrant | `id,originatingSessionRef,principalId,projectId,aclRevision,operations,issuedAt,expiresAt,revokedAt,revision`; opaque server session registry reference, never raw cookie/token; lookup/revocation store required |
| AdoptionAuthorization | unique `(jobId,principal,confirmationId)`, original session grant ref, preparedDigest/content hash, ACL revision, issuedAt/expiresAt<=30s, authorization ID; localPersistence remains NOT_ATTESTED |
| Idempotency | unique `(version,principal,project,keyHash)` plus requestDigest/jobId; tombstone retained; hash protects raw key storage, not authority |
| Dispatch | unique jobId (one attempt in initial profile), UUID, fence token/lease owner, dispatch intent timestamp, transport evidence, supplier request ID if known, stop/actual-exit evidence |
| Journal | immutable eventId/jobId/approvalId/old->new states/money/currency/evidenceHash/reconciler/at; unique evidence IDs prevent double settlement |
| Concurrency | atomically allocated global/user/project/approval slots associated with job/fence; capacity released only with appropriate no-egress or actual resource-stop evidence |

`Money={currency:"CNY"|"USD",amountNano:string}`. Nonnegative canonical decimal integer string (`0` or `[1-9][0-9]{0,29}`); calculations use arbitrary-precision integers, never JS floating point. One unit = 10^-9 named currency units; CNY and USD are independent accounts. This is accounting precision, not a claim about supplier invoice minor units. Example `{"currency":"CNY","amountNano":"100000000"}` means 0.1 CNY only; cannot be used as 0.1 USD or converted automatically. Bound computation uses official worst-case fixed n/size/model policy, rational arithmetic rounded **up** to nano; evidence precision/rounding rules must be approved per provider. No current supplier price or budget approval is inferred.

Unknown held reservations count at their full upper bound in every relevant bucket. Check `held + settled + newReserve <= ceiling` for global/user/project/approval **within the same currency**, plus independent maxCalls and concurrency. Optional global multi-currency aggregate cap is unsupported without an explicit conservative FX policy; a missing currency bucket denies, never treats USD as free. Calls are consumed on admission and never silently reset/replenished on cancellation or expiry. Budget replenishment/new approval requires explicit owner authority; new approval cannot hide an unresolved old approval or reuse its key.

Current unified text ledger uses token-price nano-CNY and two server-selected accounts with private locked durable file. It does not have project/global image buckets, image jobs, output receipts, supplier monetary reconciliation or image concurrency transactions. Its `uncertain()` retains reserve but does not itself freeze an account; missing usage differs from inconsistent usage. Target image UNKNOWN must freeze affected approval in the same transaction. **Do not change or reuse that ledger/policy as an image approval.** Existing historical pricing expirations remain unchanged.

## Admission transaction T1 (before all real egress)

Use a single authoritative DB transaction with serializable semantics and explicit row locks in deterministic order (global -> user -> project -> approval), unique indexes and revision CAS. Serialization conflict rolls back locally and retries a bounded database transaction only, never supplier transport. Proposed local retry cap 3 then 503; no retries if commit outcome is unknown.

1. Authenticate, strictly parse/validate bounded request; resolve project/current ACL and image approval server-side. Compute canonical digest. Persist a bounded admissionGrant referencing the originating trusted server session and ACL revision, operations and expiry. Dispatcher/restart looks up that session reference and grant in the authoritative revocation store; expired/revoked/missing/unavailable grant or session cannot dispatch. A newly logged-in session does not silently renew a pending dispatch grant; fresh admission is a separate explicit decision after resolving the existing key, never an automatic regrant/resend.
2. Lock/read scoped idempotency **first**. Existing same digest -> reauthorized read of existing job; differing digest ->409; no new fee/call/concurrency.
3. Lock project/ACL revision and all applicable buckets/approval. Require active/unexpired exact provider/model/region/price/currency approval, not frozen; verified max-cost bound; no unresolved job forbidden by that approval. Check all caps and quotas.
4. Atomically insert job QUEUED/RESERVED, idempotency claim, full reservations, call counts, slots, journal and dispatchable outbox record; persist encrypted prompt reference under the same durability boundary (external blob preparation is private temporary and not dispatchable until committed).
5. Commit durably. Only then acknowledge HTTP admission. Disk/DB/encryption/commit uncertainty -> no egress; recover by authoritative key lookup. A successful in-memory mutation or log write is insufficient. No Map/file/anonymous fallback.

Unique inserts enforce correctness across devices and instances, not only Web Locks. Pending capacity allocation must not start network work before durable approval. Existing key replay works even when capacity/budget now exhausted, subject to current read authorization.

## Fenced dispatch T2 and its unavoidable network gap

A dispatcher claims committed QUEUED outbox via locked CAS; fresh fence/lease prevents stale workers. Under project/approval/bucket lock, recheck expiry/revocation/ACL/amount bound and commit task RUNNING plus charge DISPATCHED and immutable **DISPATCH_INTENT** before giving the one-use capability to the isolated transport. Provider transport cannot select a different policy/model, spawn retries or access DB write credentials. Supervisor/worker/process ownership does not grant payment authority. The trusted dispatcher is the sole egress issuer.

A durable outbox **does not guarantee exactly-once supplier execution**. Crash between intent and first byte may falsely classify an unsent request as possible dispatch; crash after send may lose supplier ID. In both cases: no second automatic send, task UNCERTAIN/charge UNKNOWN, freeze approval and retain full reservation. Reclaiming an outbox row/lease must never resend a job with an intent. If supplier offers verified idempotent lookup, reconciler may query under a separate read-only evidence policy; unsupported/unknown capability requires manual provider/finance evidence, not a guessed resend.

Revoked/expired QUEUED jobs without intent can be CANCELLED/RELEASED with no send. Lease expiry before intent permits a new claim after fencing. Lease expiry after intent never does. Heartbeat absence is not proof the old transport stopped; retain execution slot until fenced process/resource shutdown is established. Freeze affected dispatch on supervision/storage failure. Session loss does not erase a bill.

## Evidence settlement T3 and crash matrix

Settlement is a single transaction: validate trusted supplier usage/invoice mapped to exact attempt/model/currency/price, ensure evidence not reused, append immutable journal, update job/approval/all buckets and counters together. Validated image success alone is not settlement evidence. If lower proven actual cost, move that amount held->settled and release only the proven remainder. Proof of zero charge permits RELEASED. Invalid/missing usage, inconsistent currency/model, costs above bound or ambiguous invoice -> UNKNOWN and FROZEN; hold full reserve, record discrepancy and require owner resolution. Never clip actual cost, treat usage image dimensions as price evidence, or silently increase budget. Real overrun is recorded as discrepancy/debt and blocks further spend pending explicit accounting resolution.

| Crash/failure boundary | Recovery / egress / cost |
|---|---|
| Before T1 commit | Authoritative absent claim -> retry same key only; zero egress |
| T1 commit acknowledgement lost | Lookup same key on primary; no new claim, keep reservation |
| T1 committed, no intent | Reauthorize and safely dispatch once, or cancel/release |
| T2 commit result unknown | Stop; primary lookup. Intent absent proved -> reauthorize; unresolved -> UNKNOWN/freeze; no socket until confirmed committed |
| T2 intent committed before/after network send | If no terminal reliable result -> UNCERTAIN/UNKNOWN; no automatic send; full held amount |
| Provider generated; download/PNG validation failed | FAILED, separately SETTLED or UNKNOWN; no regeneration/refund |
| Image persisted; charge evidence missing | SUCCEEDED/UNKNOWN, authenticated preview only, portable proof null; no adopt/import bypass/new paid task under approval |
| Cancel/timeout/disconnect during dispatch | Stop request where possible; local outcome and charge assessed independently; UNKNOWN unless proven |
| T3 commit acknowledgement lost | Recover unique evidence/event and job revision; no second settlement |
| Disk full, DB unavailable/corrupt | Disable dispatcher/admission; preserve unresolved operation; no memory reset |
| Backup restore / split brain | Quiesce egress; compare durable epoch/journal and external outstanding attempts. Fence old epoch; unknown records freeze approvals; never restore a lower spent total and resume automatically |

Reconciliation journal includes actor, evidence hash/reference, reason and exact before/after balances. Manual reconciliation is authenticated accountable finance/security work; user “discard”, HTTP cancellation, absent image, or elapsed retention is never sufficient. Unfreezing requires all related UNKNOWN entries resolved and explicit audited approval revision; cannot clear freeze with a restart.

## Isolation, retention and operational limits

Real transport must have only narrowly scoped provider capability and explicit egress host policy, bounded bodies/time/resources; no GitHub write credentials, arbitrary shell, task-controlled scripts or shared member auth. Node worker_threads with env={} and heap limits are useful containment, **not an OS sandbox**. #99 downloader is a bounded helper, not a full provider or sandbox/ACL/ledger. Deployment isolation, DNS/egress policy, TLS/CDN compatibility, signing/encryption key custody and cancellation/actual-exit tests remain NOT_VERIFIED.

Queue/active job hard limits and TTL are in wire contract. Encrypted prompts/results purge after <=15 min; authoritative jobs/journal/tombstones outlive result bytes. Unresolved charges survive indefinitely pending explicit evidence-based handling; bounded storage exhaustion fails closed. ACL-secured minimal summaries retained >=90 days; actual retention/privacy/legal policy owner must approve before activation. Cryptographic receipts remain verifiable with historical public keys under reviewed revocation policy. Do not drop accounting tombstones when a project is deleted.

Rollback of a future implementation: stop admission/dispatch, preserve DB/journal/approval freeze, fence old workers, reconcile outstanding intents, retain export/backups. Switching back to Mock must use its distinct protocol and never relabel or reset REAL jobs. No down migration that loses spend/provenance is allowed. Infrastructure recovery must be independently demonstrated before production readiness.
