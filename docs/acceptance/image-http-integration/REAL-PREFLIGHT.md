# P5 — no-payment provider preparation

Reviewed 2026-10-28 Asia/Shanghai. REAL MODEL: NOT_RUN. No API key/account access or model call. Production is NOT ready merely upon spend approval: project authority, durable image ledger, bounded supplier normalization/download and content moderation remain engineering gates.

## Official evidence and candidates

Qwen pinned `qwen-image-2.0-2026-03-03`: documented synchronous multimodal generation; static PNG via 24-hour result URL; Chinese/English text and layout capabilities are supplier claims, unmeasured here. International list $0.035/image; Singapore limit 2 requests/second. Region-specific workspace endpoint and credentials required. Prepared request fixes 1024²/n=1, disables prompt expansion, preserves visible watermark. [API/schema](https://www.alibabacloud.com/help/en/model-studio/qwen-image-api), [current pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing), [limits](https://www.alibabacloud.com/help/en/model-studio/rate-limit).

Alternative Gemini Nano Banana 2.1 `gemini-nano-banana-2.1`: current guide favors it over 3.1 Flash Image; inline image generation/editing and SynthID provenance. Standard 1K output $0.0336, plus input $1.50/M and text/thinking $7.50/M. For 1000 input +1000 output text tokens estimate $0.0426, not a worst-case bound. Actual account rate quota/region and output quality unverified. Do not silently migrate old aliases. [Image guide](https://ai.google.dev/gemini-api/docs/image-generation), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [safety](https://ai.google.dev/gemini-api/docs/safety-settings).

Qwen prototype schema is pure `buildQwenRequest` / `inspectQwenResponse`, no network or credentials. Tests use fixed invented supplier responses and `.invalid` URLs. References stay server-side and UNRECONCILED; a successful schema parse is not an image/safety/payment result. No operational supplier adapter is enabled.

## Admission proposal, not approved/configured

Conditional Qwen isolated test: 3 attempts maximum, $0.25 total, reserve $0.05/attempt (nominal 3×$0.035=$0.105; reserved $0.15), concurrency1, per-job120s, no automatic retry/failover. Proposed future limits: $1/global UTC-day, $0.25/principal UTC-day, $0.50/project lifetime, $5/owner-grant lifetime. All values require owner approval and durable transactional enforcement; they do not change existing budgets or cover other clients/taxes. Recheck exact model/region prices within 24h before any approved test. Supplier rate limits do not enforce spend. See RFC durable design for crash/restart/uncertain-cost reconciliation.

## Child learning safety and resource plan

Before dispatch: reject personal contact/location/account identifiers and disallowed sexual, exploitative, graphic violent or self-harm instructional prompts; offer a short age-appropriate rewrite without echoing sensitive details. Do not send children's faces, reference uploads or inferred identity in initial trial. Requires separately tested age/consent/data-retention policy; substring filters alone are insufficient.

Preserve provider safety filters, map refusal to safe local guidance, never weaken filters to make a test pass. Supplier input/output controls vary by model and may cost extra: [Alibaba guardrails](https://help.aliyun.com/en/model-studio/content-security). Independent image moderation must approve normalized pixels before publication; unavailable/uncertain moderation fails closed. Supplier watermarks/SynthID establish provenance, not child safety. Audit only opaque job/receipt/policy IDs and outcomes, no raw prompt/URL/query/credential. Restrict result retention/deletion and human review access.

Future Qwen download: exact owner-reviewed hostname policy, HTTPS only, block private/reserved DNS and pin resolved public destination, deny redirects, bounded streaming (proposal8MiB), no credential forwarding; never pass signed URL to browser. Sandbox decoder with explicit CPU/deadline/memory/pixel limits; remove metadata, downscale once to bounded dimensions, normalize PNG <=512KiB and existing <=1MiB/32-asset total. Current fixture validator accepts only a narrow normalized PNG subset and rejects oversized supplier results; it does not implement this general conversion. Reject if conversion cannot fit; never regenerate automatically. Retain incurred charge on unsafe/malformed/oversized output or download/adoption failure.

## Isolated REAL acceptance and rollback (not executed)

After engineering gates and independent security QA, owner must specify supplier, exact model/region/account eligibility, USD cap/attempts, approved isolated environment, moderation/data policy, authorized test user/project and secret injection owner. The implementer must not read keys. Use synthetic nonpersonal prompts, record immutable price/policy, job+supplier request IDs, before/after reserve/settlement and actual reconciled charge (including ambiguous failures). Inject pre/post-egress crash, timeout, moderation rejection, invalid/oversize bytes and restart; show no duplicate dispatch/debt reset. Independent QA assesses quality, child safety, normalized asset fidelity and B/C/refresh/export. On any uncertainty halt, retain reserve, reconcile receipt; disable adapter/close isolated listener and preserve audit. Merge/public deployment require separate approval.

Readiness: REAL_PROVIDER=NOT_RUN; engineering BLOCKED. Do not label READY_FOR_OWNER_APPROVAL until missing engineering gates are verified. Approval fields for that later gate: supplier/model/region, attempts and currency cap, environment, data/moderation policy. Current Draft review needs NONE.
