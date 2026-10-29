# Independent acceptance and approval gates

This is a **test specification**, not executed feature tests. Actual documentation commands and real reviewer responses are in [review-record](review-record.md). No generated example is REAL evidence. Current deployment/REAL pipeline is BLOCKED / NOT_VERIFIED.

## Gate order and authority

| Gate | Required proof / sole decision owner | What it permits |
|---|---|---|
| G0 RFC | Actual Backend/Workshop/QA/Cost-Security responses to exact document revision, closed shared-contract objections, Resource-Contract final version freeze | Separately assigned offline implementation only; no paid calls |
| G1 Infrastructure | Backend + deployment owner prove trusted principal/registered project ACL, transactional store/backup/fencing and production deny-by-default | Backend offline/fault tests with fake provider; no live transport |
| G2 Resource migration | Resource-Contract/Workshop codecs and IDB/B-C paths pass old/new/no-loss tests at exact SHA | Offline integration using explicit Mock2/fake REAL test fixture |
| G3 Security | Cost-Security verifies official fixed provider/model/region/price/currency, upper bound, output compatibility, usage/idempotency/cancel/reconciliation, safe isolation and least privilege | Reviewable inactive transport only; no credentials/network activation |
| G4 Independent offline QA | QA independently checks full diff and negative cases at literal feature HEAD, matching test/code SHA and CI attribution | Request bounded paid acceptance; not automatic permission |
| G5 Explicit paid authorization | Budget owner names provider/model/region/currency/max cost/max calls/expiry/exact SHA/scope; secret owner provisions capability separately | Only that bounded live test on preserved ledger; never automatic retry |
| G6 Real acceptance | Separate QA verifies actual job, dispatch receipt, validated content/proof, real usage/cost, failure/unknown handling and B/C portable round-trip at same SHA | Report narrow REAL ACCEPT; merge/deployment still separate |
| G7 Release | Explicit responsible owner MERGE and DEPLOY approvals plus all required CI/security gates | Only approved release; no automatic merge/public rollout |

No gate is satisfied merely because its predecessor passed. This docs task grants G0 drafting/review only (`approval_needed=NONE`). Price/auth/infra/quality/live CDN facts remain NOT_VERIFIED. Mock may exercise shapes but cannot prove supplier exactly-once, real payment, real model quality or real AI acceptance.

## Proposed executable offline/fault tests (all NOT_RUN in this RFC)

| ID | Fixture / fault | Expected observable assertion | Primary owner / independent QA |
|---|---|---|---|
| W1 | v1 + REAL, v2 wrong prefix/version/kind, unknown properties/duplicate JSON keys/headers | Reject before any reservation/provider call; no fallback/cast | Resource-Contract / QA |
| W2 | Mock2 success/failure/cancel/restart | Always NONE/null approval/no REAL proof; real route stays disabled | Backend / QA |
| W3 | Same key/digest concurrent devices and instances; rotate approval | One durable job/reservation/call/attempt; replay still original, no new approval scope | Backend / QA |
| W4 | Same key changed prompt/project? | Same scope+changed prompt ->409; changed project is new scope but must pass its ACL/budget; no cross-project replay leak | Backend / QA |
| W5 | Create response lost before job ID, refresh/recover; DB unavailable | Same key/body resolves job; absence only authoritative; unavailable != absent; zero duplicate paid dispatch | Backend+Workshop / QA |
| W6 | Lower-revision/old-job callback after a newer pending request | Cannot clear newer UNKNOWN or publish stale candidate; cross-tab atomic admission | Workshop / QA |
| W7 | Queued cancellation vs dispatch CAS, repeat cancel, terminal callback | Exactly no-send+RELEASED or possible-send+UNKNOWN/SETTLED; terminal task not overwritten | Backend / QA |
| W8 | Timeout/disconnect after upstream send; generated image download/PNG failure; discard | Independent task/fee states, no automatic paid retry/refund; hold max and freeze approval | Backend / QA |
| W9 | SUCCEEDED+UNKNOWN, FAILED+SETTLED, CANCELLED+UNKNOWN | UI labels faithfully, no adopt for unknown; no boolean success/no-charge collapse | Workshop / QA |
| W10 | 4096/+1 request, 710000/+1 response incl proof, prompt units/UTF8/control, proof cap, deadline/poll exhaustion | Reject/bound exactly, unresolved review retained, no truncation | Resource-Contract+Backend / QA |
| A1 | Forged localStorage user/project/budget, arbitrary project ID/imported ID | Server requires registered ACL and approval; upstream zero | Backend / QA |
| A2 | Session expiry, revoked membership, project transfer before dispatch/publish/read/cancel | Reauth denies, old-owner byte/history access zero, captured charge owner retained | Backend / QA |
| A3 | Missing/unavailable project ACL | 503 ACL_UNAVAILABLE, no memory or authorize-all fallback | Backend / QA |
| L1 | Global/user/project/approval budget boundaries exact/+1, n/model/region tamper | All bucket reservations atomic; no implicit provider choice or cap expansion | Backend+Cost-Security / QA |
| L2 | CNY/USD, fractional calculation rounding, huge decimal string, missing currency | Exact nano arithmetic, round upper bound up; no FX/mixed currency/float | Cost-Security / QA |
| L3 | Crash at every T1/T2/T3 step, acknowledgement loss, disk full/serialization conflict | Durable unique claim/evidence, intent never resent, UNKNOWN freezes same approval | Backend / QA |
| L4 | Lease expiry, stale dispatcher callback, no actual resource exit, process sleep | Fence rejects stale updates/egress; execution capacity retained, no fake running/released state | Backend / QA |
| L5 | Missing/inconsistent/excess usage, wrong invoice currency/model, duplicate evidence | No false settlement; overrun discrepancy recorded, approval frozen, no clipping/reuse | Cost-Security+Backend / QA |
| L6 | Restore old backup, split-brain/multi-instance concurrent reserve | Egress fenced/quiesced, unknown frozen, no restored free budget or key reuse | Backend / QA |
| L7 | Retention expiry/project deletion/storage full | Prompt/image purge separately, summary/tombstone/unknown holds preserved; new admission denies if full | Backend / QA |
| P1 | 524288/+1 PNG, 1024/+1 side, inflate bomb/CRC/trailing data/metadata/APNG, SSRF/redirection/DNS mix | Reuse reviewed bounds; reject incompatible output; never paid regeneration | Backend / QA |
| P2 | Tampered bytes/hash/model/region/signature, test key in prod, unknown/revoked key, remote key URL | No verified REAL badge/adoption; no untrusted key fetch | Resource-Contract+Cost-Security / QA |
| P3 | Legacy Mock-looking filename, absent provenance, user-upload explicit | LEGACY_UNKNOWN vs known FIXED_MOCK vs actual upload kept distinct | Resource-Contract / QA |
| P4 | Prompt OMITTED/default, explicit include/export exclusion, sensitive input | No prompt/digest in public proof/log by default; source retained and live project unchanged | Resource-Contract+Workshop / QA |
| M1 | Legacy JSON1/CustomProject2, standalone v1/v2, no assets, timer/custom components | Read old first; migration copy validates all references, no fabricated source/time | Resource-Contract / QA |
| M2 | JSON2->ZIP2->JSON2->IDB->refresh->B/C->undo | Exact bytes/semantic provenance/artifacts; revision rules explicit; one owner | Resource-Contract+Workshop / QA |
| M3 | New project into old reader, unknown capability/schema/source/proof | Explicit reject/inspection without data-loss fallback or REAL->MOCK | Resource-Contract / QA |
| M4 | DB v2->v3 blocked upgrade/quota/abort, source CAS change, duplicate confirm, lost completion, saved-before-publish | Preserve source; atomic head+receipt; recovery blocks duplicate adopt; no delete/recreate | Workshop / QA |
| M5 | 32/+1 assets, 1MiB decoded total, 4MB JSON/text budget, ZIP34/size limits, receipt128/+1 | Whole-project adoption denied atomically; no metadata eviction | Resource-Contract+Workshop / QA |
| S1 | Transport task tries env/key/GitHub credentials, arbitrary script/network host, auth failure | Isolation denies, sanitized safe logs, no success receipt or broader permission | Backend+Cost-Security / QA |

Fault injection must control deterministic boundary gates/clock/DNS/transport/actual process exit and authoritative storage outcomes, not merely sleep until a race passes. Fake supplier counters must assert **0 or 1** sends and distinct reserve/settle/adopt counts. A fake REAL fixture is visibly OFFLINE test-only and signed with untrusted test keys; it must never be enabled through a production client switch.

## Required evidence format and verdict

Each future implementation report records role/session, base/head/test **full SHA**, immutable diff, command argv/environment/exit code/output location, protocol mode, task/worker/session/job/authorization/attempt IDs where non-sensitive, actual request/dispatch count, job+charge timeline, image SHA/byte count/dimensions/proof, journal/bucket consistency, exact CI run/job/checkout SHA (merge-ref distinguished), observed original failure and retest. No prompt, API key, auth files, private invoice data or signed URLs in GitHub. Logs are redacted before publication; evidence hashes/restricted refs can stand in for confidential source documents.

Independent QA uses its own clean detached checkout at exact HEAD; cannot accept author's claims or stale SHA tests. **ACCEPT** only the bounded scope evidenced. **REWORK** specifies deterministic failing condition, responsible owner, minimal assigned files and retest requirements. **BLOCKED** specifies missing authority/infrastructure/evidence and a single next owner/action; independent safe offline work may continue within authorization. Any contract/version/ownership change invalidates affected earlier ACK and requires renewed review. Documentation ACK is never implementation ACCEPT.

For this draft, reviewers are actual newly delegated review roles in this session; they are not impersonated standing project members. Their real session IDs and written responses must be retained. Not available/no reply -> WAITING. Do not infer ACK from availability, silence, old #99 bounded ACK, or this checklist.
