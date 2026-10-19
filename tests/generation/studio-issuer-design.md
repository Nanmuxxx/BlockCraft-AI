# Studio one-time issuer — proposal awaiting TL review

Review base: PR75 `250a3bc649d0e007f4469c7b5479198e09dedb13`.
This document adds no endpoint, cookie issuance, secret, approval or paid call.
Implementation is pending TL cross-review as requested by Supervisor.

## Unified budget / migration gate

Existing production POLICY allows three calls. Supervisor already settled ONE
local real call; a new empty Studio ledger is NOT a fresh authorization or a
reset of the unified ¥20 ceiling. This proposal authorizes only Mock work and
zero additional real calls. Before any production activation, Gateway/TL/Owner
must reconcile the previous local-smoke ledger/profile and idempotency state
with the production profile, document cumulative spend and remaining calls
(nominally at most two, subject to reconciliation), and approve an exact durable
continuity/migration plan. Do not copy incompatible profiles, hand-edit entries,
subtract budgets ad hoc, delete locks, or initialize a new ledger to bypass it.
No migration is implemented and no real ledger is read or changed by this patch.
Until this is resolved, Studio paid activation remains BLOCKED even if issuer
and HTTPS/browser tests pass. Deployment approval material must disclose this.

## Minimal browser flow

1. Owner independently provisions one short-lived grant, using 32 cryptographic
   random bytes encoded as canonical base64url (43 characters). It is distinct
   from the DeepSeek key and binding key. Owner delivers it through a separately
   approved private channel; it never appears in a URL, query, fragment or log.
2. Browser opens fixed `GET /studio/sign-in`, an inert same-origin HTML form.
   Password input, no third-party resources, no localStorage/sessionStorage,
   no analytics. Form submits only to fixed `POST /studio/session`. Visiting
   the page grants nothing. No token prefill or URL-based bootstrap.
3. POST requires exactly one matching HTTPS Origin, no query, exact method and
   content type; bounded form body (1KiB), one `credential` field, canonical
   syntax, no duplicates, body read deadline and bounded concurrency. Reject
   cross-site Fetch Metadata when present; it never grants identity. No CORS.
4. Verify digest with timing-safe comparison against the private grant. Re-read
   Owner approval and grant revocation/expiry at commit. Never accept a client
   principal, session ID, appId, redirect target or expiry. Fixed app `pomodoro`
   only; constrain the existing approval/session appId to this value before
   enabling issuer, per Gateway review6274909013. No general multi-app claim.
5. Generate independent random opaque session bytes. Durably commit BOTH
   grant consumption and session hash in ONE atomic private state replacement.
   Only after file+directory fsync succeeds return303 to fixed `/ai-create` with
   `Set-Cookie: __Host-bc_session=<opaque>; Secure; HttpOnly; SameSite=Strict;
   Path=/; Max-Age=<bounded remaining lifetime>`. No Domain attribute. Token is
   never returned in HTML/JSON, Location, error text or logs.

Page/POST responses: Cache-Control:no-store, Referrer-Policy:no-referrer,
X-Content-Type-Options:nosniff, CSP denying scripts/external resources and
restricting form-action to self and frame-ancestors to none. Serve only fixed
markup; no reflected credentials/errors. Browser password input is cleared by
navigation. Proxy/body/header logging and browser capture remain separate gates.

## Trust root and durable state

Keep existing private Owner approval as mandatory root. Add one explicit issuer
grant in it (schema change requires TL agreement): grant ID, credential SHA256,
fixed principal, appId=`pomodoro`, issuedAt/expiresAt/revoked and session expiry.
No plaintext credential/session token is stored. Credential lifetime at most
10 minutes; session lifetime at most30 minutes and never beyond grant's explicit
session expiry, Owner approval or PRICING expiry. Runtime does not create grants.
Only Owner can provide/replace a grant; replacing approval requires restart.

Separate `studio-issuer-state.json` in the existing private directory contains
version, approval/grant digest, cumulative attempt count, consumed flag and
issued session hash/expiry. Bind it to the stable binding key using HMAC over
canonical contents. Only mode0600, same UID, single-link regular files; directory
mode0700, canonical paths. No symlinks, no untrusted same-UID writers. Unknown,
missing, malformed or mismatched state denies issuer startup, never initializes
or resets. Owner must separately preprovision the initial state under the
reviewed contract. Retain consumed grant history for this bounded single grant.
No recovery route or automatic unlink/rollback.

Existing Gateway lifetime exclusive ledger lock is acquired BEFORE issuer can
accept traffic. A second instance refuses startup; no extra independent ledger
or paid budget is introduced. Serialize all issuer state transitions within the
single process. Before credential comparison reserve an attempt in durable state
(same-directory exclusive temp0600, fsync, atomic rename, parent fsync). Maximum
5 attempts total for the grant, including successes, across restarts. This fixed
global cap avoids trusting XFF or adding an unbounded per-IP map. It accepts the
explicit denial-of-service tradeoff: attacker can exhaust attempts; only Owner
can issue a separately approved replacement grant, never automatic reset.

For success, consume+sessionHash are written together in one durable state
transition before Set-Cookie. For wrong input, persist consumed attempt and
return generic denial. For replay/expired/revoked grant, no session is minted.
Malformed/oversize/header-invalid requests get cheap rejection without reading
the grant; concurrent body reads have a fixed small ceiling and deadline.

Crash/write failure semantics: deny/stop issuer, never send cookie on uncertain
commit. Crash after consumed commit but before browser receives cookie burns the
grant; replay cannot recover it. Owner must review state before replacement.
Power loss before acknowledged fsync is NOT a successful issuance. Missing or
corrupt state after restart stays closed. HMAC cannot detect an Owner/privileged
actor restoring an old authentic snapshot; anti-rollback against privileged
storage administrators is a platform trust assumption, not claimed protection.

Session resolution merges only the committed issuer session hash with its
original active approved grant, fixed principal/app scope and expiry, using the
existing opaque resolver. Re-read revocation on each request. No requester can
select between principals/apps. Session ID and appId are not added to Gateway
idempotency claims in this patch: fixed principal+Pomodoro only, existing durable
budget remains authoritative and does not reset on login/logout/restart.

## Drain and resource ownership

Issuer handlers inserted ahead of Core's request handler are NOT automatically
counted by Core's existing activeHandlers. Implementation must explicitly count
issuer handlers/body reads/state commits, stop issuer admission on shutdown,
drain/abort bounded reads, finish committed transitions, THEN delegate to the
existing shutdown that releases Gateway lock. Do not claim existing Core drain
alone covers a new interceptor. Register signal hooks on the combined shutdown,
not directly on the inner startServer.shutdown. Any startup failure closes only
resources acquired by this candidate and never deletes persistent state.

## Mock acceptance before any activation

- Default closed; private grant/state missing, expired, wrong policy/app,
  unsafe permissions, symlink, HMAC/version mismatch: no issuer startup.
- GET does not mint; wrong/missing/duplicate Origin, query, bad method/type,
  duplicate field, oversized/slow body fail without token disclosure.
- Valid one-time exchange sets exact secure cookie attributes, fixed redirect,
  no token in URL/body/log; resulting cookie reaches actual Studio v2 Mock200.
- Wrong/replayed/expired/revoked credential denies; five attempt cap survives
  restart; simultaneous identical exchanges issue at most one cookie/session.
- Restart resolves committed session; live revoke/expiry/duplicate cookie deny.
- Fault injection before/after each write/fsync/rename: no uncommitted cookie;
  consumed-but-response-lost credential remains burned; corrupt/missing state
  refuses; concurrent instance cannot acquire lock.
- Shutdown while reading/committing drains before lock release. Three paid Mock
  calls max and prior idempotency/restart tests remain intact after login.
- Actual browser form/cookie test uses local test HTTPS or reviewed TLS fixture;
  HTTP raw-header tests alone do not prove browsers accept Secure cookies.

## Outstanding review and platform gaps

TL/Gateway should cross-review the trust root, single-record consumption,
five-attempt fail-closed tradeoff, startup state provisioning and combined drain
before implementation. The launcher-only boundary permits fixed HTML/form
without a frontend account system, but requires a bounded durable writer inside
the launcher; that writer needs crash/fault tests and cannot be represented by
an in-memory consumed Set. No implementation PASS is claimed here.

Owner credential delivery, Secret ACL, no request-body/Set-Cookie logging, TLS
termination, backend isolation, one replica and persistent private POSIX fsync /
atomic rename behavior remain NOT VERIFIED. Endpoint must stay disabled until
independently reviewed and explicitly authorized. No real secret/state accessed,
no deployment or paid request is part of this design.
