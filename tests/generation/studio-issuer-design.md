# Studio one-time issuer — implemented candidate, Mock only

Implementation base: PR75 `c29b134a34e47c247e9f48d1a5e1ec640acde9e9`.
Technical design released for implementation by TL review #57 comment6275063739.
The optional issuer is now implemented in studio-launcher.mjs. It remains
default-closed without independently provisioned private grant AND state AND
existing Gateway ledger. This patch provisions none of them in a real environment.
Independent implementation review and production authorization remain pending.

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

Page/POST responses: Cache-Control:no-store,
X-Content-Type-Options:nosniff, CSP denying scripts/external resources and
restricting form-action to self and frame-ancestors to none. Serve only fixed
markup; no reflected credentials/errors. Browser password input is cleared by
navigation. Proxy/body/header logging and browser capture remain separate gates.
Implementation/browser finding: Chromium native form POST under no-referrer
sends Origin:null, so GET uses Referrer-Policy:same-origin to preserve the exact
required Origin; no off-site Referer is sent. POST responses use no-referrer.
There are no credentials in the fixed login URL or Referer. Origin validation
was not relaxed. Local HTTPS browser acceptance covers this adjustment.

## Trust root and durable state

Keep existing private Owner approval as mandatory root. Add one explicit issuer
grant in it (reviewed schema): grant ID, credential SHA256,
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

- Default closed; private grant/state missing, wrong policy/app,
  unsafe permissions, symlink, HMAC/version mismatch: no issuer startup.
- GET does not mint; wrong/missing/duplicate Origin, query, bad method/type,
  duplicate field, oversized/slow body fail without token disclosure.
- Valid one-time exchange sets exact secure cookie attributes, fixed redirect,
  no token in URL/body/log; resulting cookie reaches actual Studio v2 Mock200.
- Wrong/replayed/expired/revoked credential denies (redemption expiry is distinct
  from session expiry; it need not prevent restart); five attempt cap survives
  restart; simultaneous identical exchanges issue at most one cookie/session.
- Restart resolves committed session; live revoke/expiry/duplicate cookie deny.
- Fault injection before/after each write/fsync/rename: no uncommitted cookie;
  consumed-but-response-lost credential remains burned; corrupt/missing state
  refuses; concurrent instance cannot acquire lock.
- Shutdown while reading/committing drains before lock release. Three paid Mock
  calls max and prior idempotency/restart tests remain intact after login.
- Actual browser form/cookie test uses local test HTTPS or reviewed TLS fixture;
  HTTP raw-header tests alone do not prove browsers accept Secure cookies.

## Canonical v1 provisioning format (review contract, not activation approval)

The optional approval `issuer` object has exactly these fields, with no extras:
`id`, `credentialHash`, `principal`, `appId`, `issuedAt`, `expiresAt`,
`sessionExpiresAt`, `revoked`. ID/principal are strings matching
`[A-Za-z0-9_-]{1,128}`; credentialHash is lowercase SHA256 hex of the canonical
43-character credential string (not its decoded bytes); appId is literal
`pomodoro`; timestamps are safe integer Unix milliseconds; revoked is boolean.
Principal must differ from all existing session principals; when issuer is
present existing sessions are limited to255 so the merged allowlist stays<=256.

Grant canonical bytes are UTF8 of JSON.stringify of a new object with properties
in exactly the order above. Thus input JSON property ordering is irrelevant.
`grantDigest = lowercase hex SHA256(grantCanonicalBytes)`.

State canonical bytes are UTF8 of JSON.stringify over a new object in order:
`version`, `grantDigest`, `attempts`, `consumed`, `sessionHash`,
`sessionExpiresAt`. No whitespace/BOM/newline; version=1, attempts integer0..5,
consumed boolean. Before consumption the two session fields are null; afterward
hash is lowercase SHA256 hex of the opaque cookie string, expiry equals the
grant's explicit sessionExpiresAt and attempts>=1.

`mac = lowercase hex HMAC-SHA256(binding.key raw32 bytes,
UTF8("blockcraft-studio-issuer-v1\n") || stateCanonicalBytes)`.
The domain includes one actual LF byte. On disk the JSON has precisely those
six state properties plus `mac` (seven total), all mandatory. Property ordering
in the input state file is irrelevant; MAC computation rebuilds fixed order.
There is no implicit initial state, recovery, grant rotation or budget migration
endpoint. Tests provision synthetic initial state only in temporary directories.

### Independent byte-level known-answer vector

The complete domain bytes are hex
`626c6f636b63726166742d73747564696f2d6973737565722d76310a`.
Implementation and fixture append explicit `Buffer.from([0x0a])` after the ASCII
domain; a literal backslash+n suffix (`5c6e`) is invalid. The source at historical
PR76 `20aa026` and PR75 `7bc5aeb` already contained one JavaScript source escape
`\n`, which evaluates to LF, as confirmed from raw Git blob bytes and JS runtime.
The explicit byte form removes display-escaping ambiguity; no existing-state
migration or compatibility reset is introduced or authorized.

`studio-mac-vector.json` fixes a synthetic key `00..1f`, grant and canonical
state bytes. Expected digests were calculated with Python stdlib HMAC/SHA256
and independently cross-checked using OpenSSL, without importing JS fixtures:

- Initial actual-LF MAC:
  `38f416ffacc3ad7d2b0a68b832dbb02bdec0c2dde2111756780ef419eb66c207`.
- Alternate literal-backslash+n MAC (must reject before listen):
  `0b92fe915842d165a13f2bdfd542ed199c04c6b485978c7f10c8a05c9a888776`.
- Actual-LF attempt1 MAC written by production transition:
  `8e79dea0f446a341c39b616f73bb494e397644214a991df7d81f81acc0d2df21`.

Run `python3 tests/generation/studio-mac-vector.verify.py` to reproduce the
independent Python/OpenSSL checks using only these synthetic public vectors.
JS tests load the fixed grant/state/key and digests directly: correct state
starts, a failed credential writes exactly the known attempt1 state, and the
alternate MAC rejects with zero calls to `net.Server.listen`, no state change,
no remaining Gateway lock and no provider call. No MAC compatibility fallback.

Both attempt and consumption commits write a same-directory exclusive0600
random temp file, loop on short writes, fsync it, close, rename, fsync parent.
Any injected/actual commit failure halts the issuer in that process and emits
no cookie. Uncommitted temp files are left inert for owner review; they are
never promoted or loaded. Restart reads only the canonical state path. If an
attempt commit failed before rename, no comparison happened and no attempt is
claimed as durable. If consumption rename occurred but final fsync/response
failed, observed consumed state stays burned; corrupt/missing canonical state
refuses startup. Hook tests model boundary exceptions, not physical power loss.

Grant redemption expiry does not invalidate an already issued session: the
distinct session expiry does. Startup may accept an expired/revoked redemption
grant to resolve still-valid committed state or deny requests; it never mints
from that grant. Live revocation denies session resolution. Explicit ownership
startup is: private existing ledger precheck -> Gateway validates/acquires its
lifetime lease -> issuer validates existing state -> listen. Never initialize
a missing issuer ledger. Shutdown stops Core admission, stops/drains issuer
reads/transitions, then invokes Core drain/settlement and releases Gateway lease.

## Outstanding review and platform gaps

TL/Gateway must independently cross-review the implemented trust root, single-record consumption,
five-attempt fail-closed tradeoff, startup state provisioning and combined drain
before activation. The launcher-only boundary permits fixed HTML/form
without a frontend account system, but requires a bounded durable writer inside
the launcher; boundary fault/restart tests and actual HTTPS browser Mock results
are recorded in studio-issuer-acceptance.md. No production PASS is claimed.

Owner credential delivery, Secret ACL, no request-body/Set-Cookie logging, TLS
termination, backend isolation, one replica and persistent private POSIX fsync /
atomic rename behavior remain NOT VERIFIED. Endpoint must stay disabled until
independently reviewed and explicitly authorized. No real secret/state accessed,
no deployment or paid request is part of this design.
