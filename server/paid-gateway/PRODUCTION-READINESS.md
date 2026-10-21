# DeepSeek paid-generation readiness

## Decision

**NO-GO for real paid production traffic on current `main` (`4a95cae`).** Keep the route disabled. The provider and budget primitives are implemented, but the executable does not compose them with a trusted identity service or persistent deployment storage. Adding `DEEPSEEK_API_KEY` alone does not enable generation: the route returns `401 UNAUTHORIZED` because `generationAccess` is absent, and native provider egress fails closed.

The P0 candidate adds `createPaidGenerationRuntime` as the server-side composition boundary and `startServer` as the lifecycle owner. The helper refuses to start without all three inputs: `DEEPSEEK_API_KEY`, `DEEPSEEK_BUDGET_LEDGER_PATH`, and a deployment-owned `resolveIdentity` function. `startServer` only composes that helper when a trusted identity function is explicitly injected; the ordinary executable supplies none and stays closed. Shutdown first stops accepting requests, drains handlers, aborts remaining connections after a bounded grace period, waits for handlers to settle their ledger outcomes, and only then releases the ledger lock. Startup failures also close an opened runtime. This does not provide a production identity service or a distributed ledger.

## Security inventory

Implemented in current `main` and covered by offline tests:

- Both legacy and `trusted-interactive/1` generation require an injected server identity callback. Missing, throwing, late, or non-boolean-true results deny access. Origin, Host, X-Forwarded-For, and body fields do not grant identity.
- The DeepSeek transport pins the HTTPS completion endpoint, approved model, JSON response format, disabled thinking, finite output, bounded body/time, no tools, no redirects, one active call, and zero retries.
- The file ledger reserves and fsyncs the maximum cost before network egress, uses an exclusive process lease, persists atomically, and never refunds a reservation. The ¥1 conservative cap, six-call cap, and price snapshot expiry are stricter than the documented ¥8 stop/¥10 authorization.
- Startup with an unresolved reservation marks the ledger halted. A leftover crash lock also prevents startup. Concurrent processes cannot open the same ledger. Timeout, disconnect, malformed upstream response, or unknown usage retains the reservation and halts later calls. Settled usage remains auditable even if later response validation fails.
- Provider response output is allowlisted; prompt text, API key, and upstream headers are not written to the ledger.

Test-only or local-only behavior:

- Tests inject mock `fetchImpl` implementations, fake identity callbacks, and temporary file ledgers. These establish boundary behavior; they are not production identity or a supplier-side spending cap.
- PR #44's loopback evaluator uses an ephemeral local bearer and reads a developer-local `.env`. It is explicitly single-operator test tooling, not a public-site authentication design.
- The executable still has no production identity resolver and therefore does not compose the paid runtime. `startServer` supports explicit injection for a deployment-owned embedding process; its lifecycle is tested only with temporary ledgers and Mock transports.

Production blockers:

- No authenticated user/session provider is connected to `generationAccess`. A browser bearer, Origin check, static frontend token, or user-controlled approval field is not an acceptable substitute.
- No production mount is configured for `DEEPSEEK_BUDGET_LEDGER_PATH`. The current JSON ledger is suitable only for a single process on a persistent local POSIX filesystem with the documented permissions and locking semantics. Do not share it across replicas or assume network filesystems provide the required exclusive-create/fsync semantics.
- No trusted production identity resolver is supplied to the CLI or a deployment entrypoint. The CLI remains anonymous and generation returns 401. Production activation still requires a deployment-owned resolver and verified persistent storage.
- The ¥1/¥8/¥10 ledger is a conservative application accounting ceiling, not a DeepSeek supplier account hard limit. Provider pricing and the external account balance must be verified at deployment; current price approval expires at the configured snapshot timestamp.
- Docker/runtime packaging must preserve the secret as a server-only environment variable and mount a private persistent budget directory. The deployment owner must confirm this without exposing either value in image layers, logs, or frontend build variables.

## Core Agent integration contract

The Core Agent owns the route composition and lifecycle in `server/index.mjs`. The available explicit embedding shape is:

```js
const { server, shutdown } = await startServer({
  host: '127.0.0.1', port: 3001,
  resolveIdentity: verifiedSessionAccess,
})
installShutdownHandlers(shutdown)
```

`startServer` defaults to the ordinary closed server when `resolveIdentity` is omitted. It composes the paid runtime only for an explicitly injected trusted callback. On shutdown it stops new application requests, lets existing handlers finish until the bounded drain deadline, closes remaining connections to cancel their upstream requests, waits for handler/provider cleanup, then releases the runtime ledger lock. Repeated shutdown calls share one promise. A startup or listen error closes the runtime before surfacing the error.

`verifiedSessionAccess(req, { signal })` must consult a trusted server-side session or a verified upstream identity assertion and return exactly `true` only for an authorized user. It must honor `signal` for cancellation where its provider supports that. It must not trust browser-supplied Origin, Host, X-Forwarded-For, approval fields, or an unauthenticated identity header. No such production resolver currently exists in this repository.

The gateway integration keeps the existing v1 endpoint:

```http
POST /api/ai/generate
Content-Type: application/json
```

Request:

```json
{"idea":"A task list with a completion count"}
```

Only `idea` is accepted for v1. The success body is the validated AppSpec v1 JSON directly. If an explicitly integrated caller sends `{"idea":"...","protocol":"trusted-interactive/1"}`, the success body is `{ "protocol":"trusted-interactive/1", "spec": <AppSpec>, "provenance": {"source":"deepseek","model":"deepseek-flash"} }`; this protocol additionally requires its existing independent admission gate and must not be enabled by this helper alone.

Current HTTP errors are `{ "error": { "code": "...", "message": "..." } }`. Relevant statuses are `401 UNAUTHORIZED`, `403 ORIGIN_REJECTED`, `400 INVALID_INPUT`, `413 INPUT_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `429 RATE_LIMITED`, `503 SERVER_BUSY` / `AI_NOT_CONFIGURED` / paid gateway denials, `502 AI_INVALID_SPEC` / `AI_INVALID_RESPONSE` / `AI_UNAVAILABLE`, and `504 AI_TIMEOUT`. Gateway budget, ledger, pricing, concurrency and egress failures map to `503` with stable internal codes such as `BUDGET_EXHAUSTED`, `BUDGET_HALTED`, `LEDGER_UNAVAILABLE`, `PRICING_EXPIRED`, or `EGRESS_DENIED`; startup configuration errors fail startup. A paid transport timeout maps to `504 AI_TIMEOUT`. On client disconnect there is no synthetic response; upstream cancellation is signaled and the budget is halted if outcome is uncertain.

## Trusted deployment setup

1. Obtain the DeepSeek key through the deployment secret manager. Inject it only as server process `DEEPSEEK_API_KEY`; never use `VITE_*`, frontend `.env`, Docker `ARG`, source control, command-line arguments, or logs. Do not print or echo its value during setup or diagnosis.
2. Provision a persistent directory for the single server instance. Set directory ownership to the service account and mode `0700`. Set `DEEPSEEK_BUDGET_LEDGER_PATH` to an absolute file path inside that directory; relative paths are rejected. The ledger file and lock are created mode `0600`. The parent directory must already exist and must not be a symlink.
3. Configure exactly one server process/replica against that local persistent volume. Restarting with a clean settled ledger preserves limits. Restarting with an unresolved reservation halts the ledger; a stale lock is a manual incident requiring reconciliation, not automatic deletion or reset.
4. Have the identity owner provide a trusted `resolveIdentity` callback to the embedding process. The code offers explicit composition and graceful shutdown, but the current CLI intentionally supplies no resolver. Keep generation disabled until identity and deployment storage are independently verified.
5. Before enabling a real paid request, have the Tech Lead approve the exact test request and fixed spend ceiling. Confirm the ledger is new only through an approved operational procedure, verify supplier-side account limits independently, and run one controlled smoke call. No live paid call is authorized by this patch.

## Offline verification

Run `npm --prefix server run build`, `node server/custom-block/build-protocol.mjs`, `node --test tests/paid-gateway/*.test.mjs`, and `node --test tests/generation/lifecycle.test.mjs` from the repository root. These tests use synthetic credentials, temporary ledgers, mock upstream responses, and no live network. They cover closed-by-default start, explicit runtime composition, startup/listen failure cleanup, SIGINT/SIGTERM wiring, bounded drain/abort, lock retention until request settlement, and ledger closure after settlement. They do not exercise a production identity provider, persistent deployment volume, Docker packaging, or a real supplier call.
