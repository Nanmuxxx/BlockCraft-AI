# Controlled Phase 2 DeepSeek gateway

## Principal-aware request runtime (Mock integration API)

`createPrincipalPaidGenerationRuntime({ env, bindingKey, fetchImpl, timeoutMs })`
is an explicit opt-in export from `runtime.mjs`. It opens one durable ledger and
one directory-wide idempotency sidecar for a single process/replica. `bindingKey`
is a stable server-managed `Buffer` of at least 32 random bytes, distinct from
`DEEPSEEK_API_KEY`. The HTTP owner must authenticate and resolve a stable,
opaque principal before calling `forRequest`; there is no default activation.

```js
const requestOptions = paidRuntime.forRequest({
  principal, idempotencyKey,
  payload: { idea: validatedIdea, protocol: 'v1' },
})
await generate(validatedIdea, requestOptions)
```

Each call returns frozen `{ apiKey, model, fetchImpl }` options whose transport
captures that request's immutable principal, idempotency key, and semantic
payload. Never store a principal globally or share request options. Payload keys
are limited to `idea` and optional `protocol`; protocol defaults to `v1`. The
claim binds a canonicalized copy of the actual fixed-model provider request. A
request context is one-shot. The sidecar claim is durably written before the
single ledger reservation; the returned reservation ID is passed to the
provider and no second reservation is made. Same-key replay returns
`IDEMPOTENCY_REPLAY`, changed payload returns `IDEMPOTENCY_CONFLICT`; both map
to HTTP 409. Invalid principal maps 401, invalid key/payload 400, provider
deadline 504. Disconnect aborts transport and should produce no synthetic
response. Unknown upstream outcomes halt the ledger. Other configuration,
price-expiry, budget, storage and lock failures map to opaque 503. Core must
serialize only its fixed safe error, never the error message/cause.

The runtime shares one concurrency gate across transports. `close()` throws
`RUNTIME_BUSY` while upstream work remains active. The server must stop
admission, finish or abort in-flight requests, call runtime `close()` (sidecar
then ledger), and only then release process resources. Stale locks are never
automatically removed. This contract supports one process on a persistent POSIX
volume; it makes no cross-instance or network-filesystem consistency claim.

`paidGatewayHttpStatus(error)` returns the status mapping above. Production
pricing expiry uses native `Date.now()`. Tests freeze time only inside their
test scope and separately verify native-time expiry denies before reservation
and egress. No production pricing window or budget is extended by this API.

The ordinary executable denies legacy v1 and v2 before Provider access because it starts without `generationAccess`; Origin/CORS never grant identity. PR #44's local evaluator was a single-operator loopback test harness and is not present in current `main`. Mochi remains disabled and CustomBlock native egress is blocked. Trusted injected transports are server-code configuration, not a browser-controlled permission.

The historical PR #44 evaluator read the developer's primary repository `server/.env` in process and fixed model `deepseek-flash`; it was not production configuration. Never expose a local evaluator/proxy as a public service.

Pricing verified 2026-10-19: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ . Peak cache-miss input ¥2 / million tokens, output ¥8 / million. Cache/discount savings are ignored. Thinking disabled, JSON mode, max_tokens <=8192, no tools, retries=0, redirects rejected, concurrency=1, timeout <=30s. The pricing snapshot expires before the next day; later use requires explicit re-verification.

One canonical private ledger under the common workspace parent is shared across worktrees. Atomic fsync-before-network reservations and an exclusive process lock protect it. Crash leases are never automatically removed; an incomplete/uncertain call halts the ledger. Missing, corrupt or over-bound usage halts automatic calls. All reservations remain charged to the internal allowance even after trustworthy cheaper usage. Audit retains only request hash, time, model pricing, reservation, usage and estimated cost; no request text or credentials.

User authorization is ¥10 total with ¥8 auto-stop. This implementation is more conservative: at most ¥1 reserved and six attempts, and never reserves across ¥8/¥10. Input reservation uses UTF-8 bytes plus 8192 framing tokens; this is a conservative software bound, not a tokenizer proof or supplier-side hard spending limit. Usage is checked against the reservation. Software cannot control supplier price changes, provider accounting defects, other account users or arbitrary code bypassing this trusted runner. No claim of a supplier hard limit is made. Unknown results stop rather than refund/retry; operator must reconcile the provider account before any future authorization.

Offline tests never read `.env`, never call the native network transport and use separate temporary ledgers. Persisted real responses are allowlisted and scanned; only AppSpec JSON is interpreted by the existing strict validator and trusted renderer. Generated TSX is never executed.

## Model/configuration contract (integration owner handoff)

Paid composition MUST explicitly supply `model: PRICING.model` (`deepseek-flash` in this dated price snapshot) to `createAppServer`, and to any separately authorized Mochi/CustomBlock Provider. Supply the exact same `fetchImpl` returned by `createPaidTransport` and canonical shared ledger; do not construct a ledger per consumer. The entry also requires `generationAccess` (default deny); v2 additionally requires its existing admission gate. Provider identity/configuration does not replace endpoint authentication. CustomBlock additionally requires its existing explicit `allowPaid` gate. This contract does not authorize enabling those features or executing generated TSX.

Historic defaults (`deepseek-v4-flash`) and offline legacy configurations are preserved. They deliberately do NOT imply gateway compatibility or paid authorization. Do not rely on the default or merely inject a gateway while leaving the model unspecified. The gateway accepts ONLY the exact price-snapshot model, rejects old aliases before reservation/network and never silently rewrites them; selecting an arbitrary DEEPSEEK_MODEL cannot change its price approval. CustomBlock's construction allowlist includes exact `deepseek-flash`, while older names remain available only to explicitly trusted offline adapters. The snapshot expires at its recorded time; this patch does not extend it, raise any cap, reset the canonical ledger or approve more real calls.

`requireControlledEgress` is a guard against accidental direct use of the captured native fetch. It is NOT a sandbox or proof that every injected function is budget-controlled: arbitrary injected functions (including wrappers around native fetch) are trusted server code and can bypass it. The audited path requires the exact branded `createPaidTransport` instance; `isPaidTransport` is provenance, not endpoint authorization. Browser requests cannot inject a transport; anyone able to modify server code can also remove guards. Do not claim protection from malicious server code.

`createPaidGenerationRuntime` in `runtime.mjs` is the server-only composition helper. It requires a verified `resolveIdentity` callback, `DEEPSEEK_API_KEY`, and `DEEPSEEK_BUDGET_LEDGER_PATH`; it returns `appServerOptions` and a `close()` lifecycle hook. It does not install an identity service, activate the CLI, or make the JSON ledger distributed. Current public/multi-user authentication and deployment-volume composition remain unimplemented/BLOCKED. See [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md) for the exact API contract, blockers and trusted deployment setup. The helper is not a deployment approval.

The current generation endpoint has no integrated idempotency key. Repeating the same request, including after a client loses a successful response, is a separate paid attempt and consumes another durable reservation. Clients must not automatically retry paid generation. If an attempt times out or disconnects before trustworthy usage is persisted, the ledger halts; do not delete a lock, reset the ledger, or retry to recover.

`idempotency-sidecar.mjs` is an isolated prototype and is not wired into `createPaidGenerationRuntime` or any HTTP route. It requires the open ledger lease and colocates `.paid-idempotency.json` with that ledger. It writes a durable claim before calling `ledger.reserve`; claims are never cleared, so a crash between claim and reservation conservatively blocks that key. The supplied binding key must be a stable secret of at least 32 bytes kept outside the claim directory; a persisted HMAC key check rejects accidental key rotation rather than silently treating old claims as new. The sidecar stores HMAC tags for principal/key and a SHA-256 payload hash, not the raw principal or key. Its syntax check cannot prove client key entropy, and callers must provide canonical payload bytes and a trusted opaque principal.

SECRET-2 ownership fix: opening a sidecar acquires `.paid-idempotency.json.lock` with exclusive create before loading any claims. There is exactly one active store owner for the actual directory, including different ledger filenames, path aliases and other processes. A second opener fails with `IDEMPOTENCY_LOCKED`; it cannot keep a stale snapshot. `close()` invalidates the handle and releases only its own lease, and the next opener reloads persisted claims. Closing the ledger alone does not release the sidecar lease. Shutdown must first drain/abort and settle or mark uncertain all requests, then close the sidecar, then close the ledger. Crash/stale sidecar locks are never automatically removed. This OS lock still requires the same trusted single-instance POSIX persistent-volume deployment as the ledger, not a distributed filesystem.

The exported prototype API is `openIdempotencySidecar({ ledger, directory, bindingKey, maxClaims = 1000 })`. It returns `reserve({ principal, idempotencyKey, payload, inputBound, outputBound, requestHash })`, `snapshot()` and idempotent `close()`. `reserve` is synchronous and returns a ledger reservation ID; the transport must use that reservation, never reserve a second time, and retain normal ledger settle/uncertain handling. `principal` is the verified opaque server identity (1–256 UTF-8 bytes); `idempotencyKey` matches `[A-Za-z0-9_-]{32,128}`; `payload` is canonical `Buffer`/`Uint8Array` bytes. The adapter must derive those bytes from the validated semantic request so equivalent payloads bind identically. Never include credentials or the principal in the payload/upstream request. Lock/storage/key configuration errors are startup/service-unavailable failures, not permission to fall back to a non-idempotent or in-memory path.

The prototype maps repeated same-payload claims to `IDEMPOTENCY_REPLAY` and same-key/different-payload claims to `IDEMPOTENCY_CONFLICT`; a route adapter should map both to HTTP 409 and must not return a cached generation response. Store corruption, capacity exhaustion, key mismatch, or persistence errors fail closed before reservation. A persistence error poisons that in-process sidecar because rename may have completed before directory fsync reported failure. This does not establish production identity, storage durability, multi-process safety, or production readiness. AI-Core ACKed the proposed `resolvePrincipal(req, { signal })` contract in Issue #57 comment 6271050998; integration still requires the explicit server adapter and Mock tests. The existing boolean resolver cannot authorize principal-aware claims.

## Server-side key configuration contract

The only supported DeepSeek credential variable is `DEEPSEEK_API_KEY`, read by the server process when the explicitly enabled runtime is composed. In production, only the project owner may create or change it through ModelScope Studio Secrets. Do not put it in browser/Vite variables, source control, `.env` files included in an image, build arguments, command-line arguments, responses, logs, or acceptance artifacts. This gateway does not read, print, validate against, or otherwise access the real production secret during development.

Supplying this variable alone must never enable generation. The current runtime also requires a trusted server-side identity adapter and an absolute `DEEPSEEK_BUDGET_LEDGER_PATH`; Core's principal-aware composition additionally requires the verified opaque principal resolver, durable claim store and controlled paid transport preflight. Missing or invalid configuration must leave the endpoint default-deny with zero reservation and zero egress. Offline tests use synthetic keys only. Setting, rotating, or injecting the production variable is outside this PR and requires a separate owner authorization.

### Separate idempotency binding key lifecycle

`bindingKey` is a second server-side sensitive configuration, not the DeepSeek API key. The prototype accepts a `Buffer` of at least 32 bytes; it intentionally defines no environment variable, automatically generated fallback or Secrets injection mechanism. An approved deployment adapter must specify its encoding and reject malformed/short/missing configuration before opening the store. Only the project owner may provision a production key after separate approval, using a cryptographically secure random source; never derive it from the DeepSeek key, a user/session token, request data or a public value. Development uses synthetic values exclusively.

Keep one stable binding key for the entire lifetime of a claim directory, outside the ledger/claim files and outside source, image layers, build arguments, browser bundles, HTTP, logs and acceptance artifacts. Restrict runtime access to the service identity and authorized owner; anyone who can change server code can potentially read runtime secrets. Keep an access-controlled recovery copy paired with the associated volume backup. The sidecar copies the caller buffer, persists only a keyed check and HMAC tags, and clears its own key buffer on close; the caller remains responsible for its copy.

Do not rotate or regenerate on restart. A wrong key fails with `IDEMPOTENCY_KEY_MISMATCH`; a lost key means stop paid traffic and restore the original key with the matching durable claims. Restoring an older claim/ledger snapshot can erase paid history and permit replays, so recovery requires reconciliation of the complete history before any re-enable. The prototype has no safe online key rotation, claim garbage collection, cap reset or automatic lock recovery. Any rotation/migration requires a separately reviewed, owner-approved offline procedure that preserves all prior claims and budget history. Never delete the check/store/lock or create a fresh volume to make a mismatched key start successfully. Provisioning, recovery, rotation and production injection are not performed or authorized by this PR.

Offline evidence: `tests/paid-gateway/model-contract.test.mjs` rejects both old aliases through all three consumers with zero reservations/network, then composes all three with the exact priced model and one shared six-call audit ceiling. Synthetic CustomBlock output remains inert text. The monetary ceiling, cancellation and unknown-usage halt remain covered by the eleven independent security tests. No live calls are used.
