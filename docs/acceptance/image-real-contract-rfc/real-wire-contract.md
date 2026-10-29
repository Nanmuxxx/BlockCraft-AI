# RFC 1 — Versioned REAL and Mock wire

**PROPOSED / NOT_IMPLEMENTED.** Baseline v1 remains unchanged; see [source audit](source-audit.md). Normative words below describe future requirements, not current capability.

## Closed types and authority

| Lane | Exact version | Exact response kind | Route prefix |
|---|---|---|---|
| Existing v1 | `image-generation/1` | `HTTP_MOCK` (image `MOCK`) | `/api/image-generations` (unchanged) |
| Proposed Mock v2 | `image-generation.http-mock/2` | `HTTP_MOCK` | `/api/image-generations/v2/http-mock` |
| Proposed REAL v2 | `image-generation.real/2` | `REAL` | `/api/image-generations/v2/real` |

Both proposed prefixes support `POST /jobs`, `GET /jobs/{jobId}`, `POST /jobs/{jobId}/cancel`, `POST /recover`. Prefix/version/kind mismatch is rejected. No unknown enum fallback, automatic version negotiation, v1 REAL, URL-derived source claim or `as MOCK` coercion. Mock v2 is fixture-only with `billing.status=NONE`, `authorizationId=null`, `attestation=null`; it cannot share a REAL admission ledger or produce a REAL proof. A REAL server installation is enabled only after all [gates](acceptance-matrix.md) pass. Frontend `kind`, env flags and local budgets have no authority.

All routes require trusted HTTPS same-origin session, origin/CSRF checks for POST, JSON content type, no cookies/credentials forwarded upstream, and `Cache-Control: no-store`. Foreign/unknown job returns the same 404. Reauthorize project operation at every read/cancel/recovery/content read. No signed supplier URL leaves server. Successful REAL means authenticated server job plus validated byte hash and server attestation, not a browser-supplied label. Offline imports use separate trust verification.

## Identifiers, types and bounded serialization

All JSON objects have exact keys for their variant (unknown fields rejected); integers are safe nonnegative integers. Timestamps are integer UTC epoch milliseconds. UUIDs use canonical lowercase UUID v4; project IDs retain `[A-Za-z0-9_-]{1,128}` but are resolved in a server registry. Hashes are lowercase hex SHA-256 (64 chars).

| Field | Type / meaning |
|---|---|
| `requestId` | Server-created UUID per HTTP attempt, including errors. Not part of idempotency or a supplier key |
| `jobId` | Server UUID, one durable job per scoped idempotency key; stable across retries/restarts |
| `authorizationId` | Server-selected opaque image approval ID (8–128 alnum/underscore/hyphen), not a bearer secret; never chosen by client |
| `Idempotency-Key` | Exactly one header, 16–128 alnum/underscore/hyphen, generated once before first create and persisted locally until resolved |
| `requestDigest` | SHA-256 of UTF-8 `JSON.stringify([version, projectId, prompt.trim()])`; no NFC/case folding. Recomputed server-side after validation; not authority |
| `authorizationDigest` | Server-only hash of principal, ACL revision, approval and pricing/policy snapshot; cannot be supplied by client |
| `jobRevision` | Monotone safe integer CAS revision; clients ignore lower revisions and responses owned by a different pending operation |
| `dispatchAttemptId` | Server-only UUID for the sole fenced egress attempt; supplier request ID recorded separately when available |

Idempotency uniqueness: `(version, principalId, projectId, Idempotency-Key)` across approval changes and restarts. Digest excludes authority: an approval rotation must never turn an old key into a new charge. Same key + same digest returns the original job after **current read ACL** check; no additional reservation or dispatch. Same key + different digest: 409 `IDEMPOTENCY_CONFLICT`. Client lost response must reuse the same key/body or use recovery; never invent another key to escape uncertainty. Request digest is private authorized job data, not portable public provenance or a raw-prompt log.

## Create

`POST {prefix}/jobs`, `Idempotency-Key: 6bdf90f6-0c28-44dd-8ac9-d668e35845ad`:

```json
{"version":"image-generation.real/2","projectId":"project_demo","prompt":"A blue square"}
```

These are the **only** input keys. Provider/model/region, `n=1`, output policy, approval, concurrency and price come from the trusted server policy. Prompt must be nonempty after trim, <=500 UTF-16 units and <=2000 UTF-8 bytes, no control characters U+0000–001F/U+007F. Reject duplicate JSON object keys and duplicate idempotency headers, not last-key-wins parsing.

202 after durable admission (all examples are synthetic documentation, no execution evidence):

```json
{"version":"image-generation.real/2","kind":"REAL","requestId":"1e1f3bb0-8555-4a55-841b-e5d0800a58ce","jobId":"4d1b300f-0277-4866-9bb3-bb3cd648fc17","projectId":"project_demo","authorizationId":"image_approval_example","requestDigest":"fba8220537fe964e7cd44f40cdd52688b77b36f1a72fc1e9b777b731588e8783","jobRevision":1,"status":"QUEUED","cancelRequested":false,"billing":{"status":"RESERVED","currency":"CNY","reservedNano":"100000000","settledNano":null},"image":null,"error":null,"createdAt":1793289600000,"updatedAt":1793289600000,"imageExpiresAt":1793290500000}
```

The example 0.1 CNY reservation is **illustrative, not a price or approval**. Queued job is already durable. The HTTP response can be lost without losing the job. A replay returns 200 with `Idempotency-Replayed: true` and current job state; first admission is 202. If current ACL/session expired, replay fails closed without dispatch. Expired image bytes never authorize a new charge.

## Status and image evidence

`GET {prefix}/jobs/{jobId}` returns 200 same envelope; query strings rejected. Response always echoes a fresh `requestId`, stable `jobId`, digest and current `jobRevision`. `billing` always has exactly `status,currency,reservedNano,settledNano`. REAL currency is CNY or USD, decimal integer nano strings <=30 digits; `settledNano` null until proven, `reservedNano` retained as historical bound even after release. Mock has currency null, reserved `"0"`, settled `"0"`, status NONE.

`image` is null until validated and publishable; otherwise exactly:

```json
{"mimeType":"image/png","encoding":"base64","data":"iVBORw0KGgo=","width":1024,"height":1024,"byteLength":123456,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","attestation":{"profile":"blockcraft-image-proof/1","keyId":"example_key","claims":{"source":"REAL","provider":"example-provider","model":"example-fixed-version","region":"example-region","generatedAt":1793289610000,"receiptId":"receipt_example","mimeType":"image/png","width":1024,"height":1024,"byteLength":123456,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","transform":"NONE"},"signature":"EXAMPLE_NOT_A_SIGNATURE"}}
```

This image **shape illustration is deliberately not a valid PNG/proof**; implementations/tests must reject it. Acceptance fixtures must supply real matching bytes/dimensions/hash and a test-only key. Signature profile and verification are specified in [provenance](portable-provenance.md). Attestation proves server-authorized source/content, not artistic quality, copyright, safety or supplier final payment. Provider URLs, prompts, private principal/project/approval IDs and supplier response bodies are excluded from portable proof.

A full success response is the create envelope with higher revision, `status=SUCCEEDED`, `billing.status=SETTLED`, proven `settledNano`, image object and updated timestamps. `SUCCEEDED + UNKNOWN` is also legal if bytes are valid but settlement is unproven: candidate preview may show “REAL source verified / fee unresolved”; **adoption and new paid dispatch under that approval remain blocked**. Do not collapse the axes. Only known SETTLED or proven RELEASED/zero-charge success permits adoption, after current project write authorization and all local capacity checks. Never substitute a Mock preview for REAL.

## Separate state machines

| Task state | Entry / permitted next states |
|---|---|
| QUEUED | Atomic admission committed; -> RUNNING, CANCELLED (before dispatch), FAILED (known local failure), UNCERTAIN (recovery cannot prove dispatch) |
| RUNNING | Durable fenced dispatch intent exists; -> SUCCEEDED, FAILED, CANCELLED or UNCERTAIN |
| UNCERTAIN | Outcome cannot be established; no autonomous retry; -> SUCCEEDED/FAILED/CANCELLED only with authoritative recovered evidence |
| SUCCEEDED | Validated content/proof persisted; terminal task result |
| FAILED | Known generation/download/validation/policy failure; terminal task result; charge can still be UNKNOWN or SETTLED |
| CANCELLED | Local execution stopped or predispatch cancellation committed; terminal local task result; **not** a provider no-charge assertion |

Terminal task callbacks cannot overwrite the result; late supplier billing evidence may update billing only, with audited revision. A user timeout/disconnect does not itself create FAILED; the server execution deadline enters UNCERTAIN if outcome is unknown. Late recovered image after CANCELLED cannot automatically adopt or change it to SUCCEEDED.

| Charge state | Entry and only legal automatic transitions |
|---|---|
| NONE | Mock only, permanently NONE |
| RESERVED | Atomic maximum-cost reservation before egress; -> RELEASED only if no dispatch intent exists and transaction proves no egress, or -> DISPATCHED |
| DISPATCHED | Durable intent recorded before possible egress (not proof supplier received it); -> SETTLED with trustworthy evidence, RELEASED with authoritative zero-charge evidence, or UNKNOWN |
| UNKNOWN | Ambiguous dispatch/charge/cancellation/settlement, full reservation held and approval frozen; no automatic resend/release; -> SETTLED or RELEASED only through authorized evidenced reconciliation |
| SETTLED | Exact trusted usage/invoice and fixed price reconciled; terminal. Overspend inconsistency freezes approval and escalates; never clip to bound |
| RELEASED | Authoritative zero-charge or proven predispatch no-send; terminal. No call-count reset or key reuse |

Cancellation never transitions DISPATCHED -> RESERVED. UNKNOWN is not a refund. A process crash after intent but before socket write is conservatively UNKNOWN. Network exactly-once is not promised. Supplier idempotency/reconciliation can be used only after Cost-Security verifies official semantics, not assumed from a header name.

## Cancel and recovery

`POST {prefix}/jobs/{jobId}/cancel` body exactly `{"version":"image-generation.real/2"}`. Reauthorize `image:cancel`; no body-supplied user/project/approval. Repeat is idempotent. Return 200 current envelope for already terminal or predispatch CANCELLED/RELEASED; 202 for `cancelRequested=true` while stop is pending. Inflight transport cancellation sets local CANCELLED once resources actually stop; without authoritative no-charge evidence billing becomes UNKNOWN and freezes approval. Failure to stop stays UNCERTAIN and retains concurrency until proven resources cease. A cancellation race is serialized against dispatch CAS: either no-send + RELEASED, or intent + UNKNOWN/settlement. A stale callback cannot clear another job's pending state.

`POST {prefix}/recover` body exactly:

```json
{"version":"image-generation.real/2","projectId":"project_demo","idempotencyKey":"6bdf90f6-0c28-44dd-8ac9-d668e35845ad","requestDigest":"fba8220537fe964e7cd44f40cdd52688b77b36f1a72fc1e9b777b731588e8783"}
```

200 returns existing envelope after session/current project read ACL and digest comparison. 404 means no *visible* record; it is not permission to send a new request. If authenticated authoritative storage confirms absence (no transient DB/read-replica/retention ambiguity), it additionally returns `{"version":"image-generation.real/2","kind":"REAL","requestId":"1e1f3bb0-8555-4a55-841b-e5d0800a58ce","recovery":"ABSENT","retrySameKey":true}` with 200. Client may replay **same original body/key only**, subject to fresh create authorization; not a new paid operation. Conflicting digest 409. Tombstone returns 410 `EXPIRED` with safe job/billing summary, never absence. Recovery never dispatches by itself. Session expiry returns 401 and preserves pending state. On refresh, reconcile pending keys before new creates; per-project local Web Lock + operation ownership prevents double-click races but server DB uniqueness is authoritative across devices.

On server restart: durable QUEUED with no intent can be claimed under a fresh fence after reauthorization. Any unfinished dispatch intent becomes UNCERTAIN/UNKNOWN and freezes approval; stale leases are fenced, not automatically resent. [Ledger](trusted-project-ledger.md) defines the durable boundaries.

## Errors, limits and retention

Error envelope exact `version,kind,requestId,error`; error exact `code,action` with no upstream text, prompt, URL, image bytes or keys. Example:

```json
{"version":"image-generation.real/2","kind":"REAL","requestId":"1e1f3bb0-8555-4a55-841b-e5d0800a58ce","error":{"code":"BILLING_UNCERTAIN","action":"RECONCILE_EXISTING_JOB"}}
```

| HTTP / code | Deterministic client behavior |
|---|---|
| 400 INVALID_INPUT / VERSION_MISMATCH | Fix input/version; no reservation |
| 401 UNAUTHORIZED | Reauthenticate normally; preserve old operation, then recover |
| 403 FORBIDDEN / BUDGET_DENIED / APPROVAL_FROZEN | Stop affected operation; no key substitution or budget fallback |
| 404 NOT_FOUND | No visible record; do not infer refund/absence |
| 409 IDEMPOTENCY_CONFLICT / CONTEXT_CONFLICT | Preserve original job; inspect ownership/digest, never redispatch |
| 410 EXPIRED | Bytes unavailable, safe authorized summary only; key tombstone persists |
| 413 PAYLOAD_TOO_LARGE / 415 UNSUPPORTED_MEDIA | No dispatch; refuse input |
| 429 CAPACITY | Before admission: retry same key after bounded delay; existing job lookup precedes capacity |
| 502 PROVIDER_FAILED / INVALID_IMAGE | Task FAILED can still have settled/unknown charge; inspect job, never automatically regenerate |
| 503 IMAGE_DISABLED / ACL_UNAVAILABLE / LEDGER_UNAVAILABLE / BILLING_UNCERTAIN | Fail closed; preserve pending state; do not switch provider or ledger |
| 504 TIMEOUT | HTTP attempt timeout only; recover same key; cannot infer task or charge outcome |

No public response contains stack traces or raw supplier errors. Post-admission failures primarily use a 200 status envelope with task `error={code,action}`; transient HTTP errors do not erase that durable job.

Proposed caps (not budgets granted): input 4096 bytes; JSON status/create response 710000 bytes **including proof**; cancel 256 bytes; recovery 1024 bytes; response headers 16384 bytes; per HTTP attempt 10000 ms; execution deadline 120000 ms including transport/download; poll interval >=1000 ms, <=120 attempts then unresolved review; no automatic paid retry. Image PNG <=524288 bytes, <=1024 each side, <=1048576 pixels, inflated scanlines <=4195328; base64 <=699052 chars. Proof/metadata <=4096 UTF-8 bytes per image; enforce total response cap with serialization, never truncate proof. Downloader has no redirects/proxy/cookies, strict HTTPS/host/DNS/TLS and stream bounds as audited #99; no additional download/CDN access authorized here.

Hard future concurrency ceilings: global <=4, principal <=1, project <=1; effective cap is the minimum of these and approval policy, default **0 until configured/approved**. Persist slots atomically; provider resource capacity and durable jobs are distinct counters. Image and raw encrypted prompt retention <=15 minutes after creation; after that purge bytes/prompt and keep safe job/billing summary for >=90 days (longer if unresolved or legally required, owner decision before activation). Idempotency tombstones persist for the project/approval history, including across backup restore; unresolved entries never expire automatically. If durable capacity/tombstones fill, reject new creates; never evict to permit repeat charging. Import/export deletion cannot clear server idempotency or billing. Content deletion does not refund a charge.

## Failure/recovery snapshots

These mutually exclusive synthetic snapshots show the same response schema; they are not a single task history or actual runs. A recovery/status read returns the matching current snapshot (with a fresh requestId); unknown freezes approval. A failed download or cancellation never zeros a settled charge.

### Generated but invalid PNG; charge proven

```json
{"version":"image-generation.real/2","kind":"REAL","requestId":"1e1f3bb0-8555-4a55-841b-e5d0800a58ce","jobId":"4d1b300f-0277-4866-9bb3-bb3cd648fc17","projectId":"project_demo","authorizationId":"image_approval_example","requestDigest":"fba8220537fe964e7cd44f40cdd52688b77b36f1a72fc1e9b777b731588e8783","jobRevision":3,"status":"FAILED","cancelRequested":false,"billing":{"status":"SETTLED","currency":"CNY","reservedNano":"100000000","settledNano":"100000000"},"image":null,"error":{"code":"INVALID_IMAGE","action":"DO_NOT_REGENERATE"},"createdAt":1793289600000,"updatedAt":1793289610000,"imageExpiresAt":1793290500000}
```

### Inflight cancellation; supplier charge unknown

```json
{"version":"image-generation.real/2","kind":"REAL","requestId":"1e1f3bb0-8555-4a55-841b-e5d0800a58ce","jobId":"4d1b300f-0277-4866-9bb3-bb3cd648fc17","projectId":"project_demo","authorizationId":"image_approval_example","requestDigest":"fba8220537fe964e7cd44f40cdd52688b77b36f1a72fc1e9b777b731588e8783","jobRevision":3,"status":"CANCELLED","cancelRequested":true,"billing":{"status":"UNKNOWN","currency":"CNY","reservedNano":"100000000","settledNano":null},"image":null,"error":{"code":"CANCELLED","action":"RECONCILE_EXISTING_JOB"},"createdAt":1793289600000,"updatedAt":1793289610000,"imageExpiresAt":1793290500000}
```

### Execution deadline after possible send

```json
{"version":"image-generation.real/2","kind":"REAL","requestId":"1e1f3bb0-8555-4a55-841b-e5d0800a58ce","jobId":"4d1b300f-0277-4866-9bb3-bb3cd648fc17","projectId":"project_demo","authorizationId":"image_approval_example","requestDigest":"fba8220537fe964e7cd44f40cdd52688b77b36f1a72fc1e9b777b731588e8783","jobRevision":3,"status":"UNCERTAIN","cancelRequested":false,"billing":{"status":"UNKNOWN","currency":"CNY","reservedNano":"100000000","settledNano":null},"image":null,"error":{"code":"TIMEOUT","action":"RECONCILE_EXISTING_JOB"},"createdAt":1793289600000,"updatedAt":1793289610000,"imageExpiresAt":1793290500000}
```

### Queued cancellation with durable no-intent proof

```json
{"version":"image-generation.real/2","kind":"REAL","requestId":"1e1f3bb0-8555-4a55-841b-e5d0800a58ce","jobId":"4d1b300f-0277-4866-9bb3-bb3cd648fc17","projectId":"project_demo","authorizationId":"image_approval_example","requestDigest":"fba8220537fe964e7cd44f40cdd52688b77b36f1a72fc1e9b777b731588e8783","jobRevision":3,"status":"CANCELLED","cancelRequested":true,"billing":{"status":"RELEASED","currency":"CNY","reservedNano":"100000000","settledNano":"0"},"image":null,"error":null,"createdAt":1793289600000,"updatedAt":1793289610000,"imageExpiresAt":1793290500000}
```

Mock v2 request is the same three-key shape with `version=image-generation.http-mock/2`. Its response uses the job envelope with `kind=HTTP_MOCK`, authorizationId null, billing `{status:NONE,currency:null,reservedNano:"0",settledNano:"0"}`, and image.attestation null. Request digest is recomputed using its own version. Mock does not use REAL proof or cost states. No runtime route is enabled by these examples.
