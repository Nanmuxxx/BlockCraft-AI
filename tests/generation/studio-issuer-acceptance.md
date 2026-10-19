# Studio issuer candidate acceptance — Mock only

Base: PR75 `c29b134a34e47c247e9f48d1a5e1ec640acde9e9`.
Scope: `server/studio-launcher.mjs` and `tests/generation/studio-*` only.
TL design release: #57 comment6275063739; Gateway handoff6275127558.

## Observed results

| Check | Result | Evidence |
| --- | --- | --- |
| Full generation suite, including existing Studio regressions | Mock PASS,105/105 | studio-issuer-generation.log |
| New issuer cases | Mock PASS,30/30 (included above) | studio-issuer.test.mjs |
| Attempt/consume commit fault boundaries | Mock PASS,20 cases | same suite;10 hooks x2 commits |
| Frontend production build | PASS | `npm run build` |
| Native form and cookie in actual Chromium over local HTTPS | Mock PASS | studio-issuer-browser.log; studio-issuer-evidence/report.json |
| Actual UI request -> automatic B -> C start/pause/reset -> B/C retention | Mock PASS | same browser run; b.png/c.png |
| Real DeepSeek, public TLS/routing, production storage/ACL | NOT TESTED | no production claim |
| Independent Gateway/TL implementation security review | PENDING | exact committed HEAD provided in #57 |

Browser reproduction after normal dependency setup: `npm run build`, then
`npm --prefix server run build`, then `node tests/generation/studio-issuer.browser.mjs`.
Requires local Chromium/Playwright and openssl. It creates ephemeral self-signed
test TLS material in a temporary directory and deletes it afterward; browser
ignores certificate trust only. A loopback HTTPS proxy forwards to the actual
Studio launcher. One synthetic temporary ledger and one injected Mock provider
response are used; zero paid calls or external browser resources. This is not
certificate-chain/public-platform acceptance. Both screenshots are post-login
and contain no credential/token. The existing UI provider badge describes the
branded runtime path; under transport injection it does NOT prove a real call.

## Security behavior reviewed by implementation author

- No flags/Origin/XFF/client principal grant identity. Optional private grant,
  private keyed state and pre-existing ledger are mandatory. Runtime lease is
  acquired and state verified before listen; failure closes acquired resources.
  Missing/invalid ledger/state never initializes or resets that canonical file.
- Versioned fixed-order grant SHA256 + state HMAC-SHA256; private file/dir modes,
  UID, single-link and canonical paths checked. HMAC domain separation from
  Gateway claims. Exact provisioning format is in studio-issuer-design.md.
- Durable attempt before comparison, maximum5 across restart. Maximum2 bounded
  body readers,1KiB body, actual2-second deadline, abort/disconnect coverage.
  Wrong Origin/method/type/query/encoded path denies; no reflected errors/secrets.
- Serialized synchronous transitions in one process; exclusive Gateway lease
  prevents another instance. Concurrent valid redemption yields exactly one
  cookie/session. Consumed state + hash are persisted/fsynced before cookie.
- Fault hooks before/after exclusive open, write, file fsync, rename and parent
  fsync, for both commits: no cookie on any exception; issuer halts. Restart
  respects observed canonical consumed state, including response-lost/burned
  grant cases. Corrupt/missing/HMAC-invalid state refuses. These are exception
  boundary simulations, not process-kill or physical power-loss experiments.
- Opaque session identifier (session hash) is distinct from stable principal;
  app scope is literal pomodoro. Live revoke/expiry and duplicate cookies deny.
  Session may outlive redemption expiry only up to its explicit approved expiry.
- Secure/HttpOnly/Strict/Path=/ __Host cookie; token only in Set-Cookie, no URL,
  body or logs. Fixed303 /ai-create. Login page has no scripts/third-party URLs,
  no-store, nosniff and restrictive CSP. Native Chromium requires login GET
  Referrer-Policy:same-origin to preserve non-null Origin; POST uses no-referrer.
  This observed compatibility change does not weaken exact Origin enforcement.
- Combined shutdown stops Core admission, drains/aborts issuer reads and finishes
  admitted commits, then Core drains generation/settlement before lease release.
  Tests cover both slow body shutdown and shutdown inside synchronous commit.

## Explicit NO-GO boundaries

No real key, real ledger, policy, index, Gateway, Docker, local-owner or Mochi
provider was edited/read by this patch. Existing production POLICY max3 is not
permission for three fresh calls: Supervisor's prior local real smoke already
settled ONE call. Cumulative spend/call reconciliation, canonical ledger/profile
continuity and remaining authority require Owner/Gateway/TL written approval.
There is no migration/reset/provisioning implementation here. Paid/public
activation, merge and deployment remain NO-GO.

Trusted Owner credential delivery and provenance, Secret ACL, log redaction at
proxy/platform, backend isolation, public TLS/origin, stable UID, single replica
and persistent private POSIX exclusive-create/rename/fsync must be independently
verified. Restoring an old authentic HMAC snapshot by a privileged storage
administrator is outside the anti-replay claim. Orphan temp files are inert;
no automatic cleanup/recovery/remint endpoint exists. Attempt exhaustion is an
explicit bounded denial-of-service tradeoff, requiring separately approved
owner action, never automatic reset. Current schema keeps1..255 preprovisioned
sessions alongside the optional single issuer; issuer-only empty allowlists
are deliberately not added by this patch.

Four original Form/List/Metric scenarios are not newly run by this fixed
Pomodoro issuer patch; earlier evidence remains separate. No new four-scenario
real DeepSeek, ZIP export or public acceptance result is inferred from it.

Rollback: stop admission and drain the candidate; return to prior default-closed
entry. Preserve ledger, sidecars, locks, binding key, approval and issuer state
for review. Never roll back durable consumed/attempt state, restore old snapshots,
delete locks or initialize a fresh budget to regain access. No deployment occurred.

#57 checks/reporting are manual in this session; automatic polling/wakeup is not
connected. New decisions must be read before further work or activation review.
