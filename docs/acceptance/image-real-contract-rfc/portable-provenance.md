# RFC 2 — Portable resource provenance

**PROPOSED / NOT_IMPLEMENTED.** Current ProjectAsset has only id/name/altText?/mimeType/dataUrl; strict validators reject new properties. Proposed fields cannot be added to production before the [version migration](migration-matrix.md) is implemented and reviewed.

## Resource schema 2

ProjectAsset2 is a closed object with existing `id,name,altText?,mimeType,dataUrl` plus required `schemaVersion:2,content,provenance,lifecycle,migration`. Existing id/name/altText constraints remain. Imported data is untrusted and must be validated before any getters, decoding, writes or badge assignment.

| Field | Exact type / invariant |
|---|---|
| `content` | `{sha256:string,width:integer,height:integer,byteLength:integer}`; digest over decoded **stored bytes**, not base64, display URL, file name or entire project |
| `provenance` | Discriminated source variants below, exact keys; metadata <=4096 UTF-8 bytes including proof and any opted-in prompt |
| `lifecycle` | `{state:"ADOPTED",review:"SOURCE_VERIFIED"|"SOURCE_UNVERIFIED"|"LEGACY_UNKNOWN",adoptedAt:number|null}`; authoritative persisted assets are adopted, not pending candidates |
| `migration` | `{origin:"NATIVE_V2"|"LEGACY_V1",transform:"NONE",fromSchema:1|null}` for initial profile; migration never invents an unknown source or creation timestamp |

`id` is project-local stable identity, not a content key or server-project authority. Duplicate bytes may retain separate IDs/provenance when jobs differ; no automatic content dedup can erase charge history. `adoptedAt` describes local adoption (null for unknown legacy), not supplier generation time.

Source variants:

| `provenance.source` | Required fields and interpretation |
|---|---|
| `USER_UPLOAD` | `source,importedAt,prompt:{policy:"OMITTED"}`; explicit current upload action, not a default for migrated unknown data |
| `FIXED_MOCK` | `source,fixtureId,fixtureVersion,prompt:{policy:"OMITTED"}`; only known fixture bytes/explicit history can establish this claim; no provider/receipt |
| `REAL` | `source,provider,model,region,generatedAt,receiptId,prompt,attestation`; provider/model/region/time/receipt must exactly equal verified attestation claims |
| `LEGACY_UNKNOWN` | `source,migratedFrom:1,prompt:{policy:"OMITTED"}`; old assets had no provenance; do not infer Mock from a filename or upload from absence of fields |

`provider,model,region,fixtureId,fixtureVersion,receiptId,keyId` are bounded nonempty ASCII identifiers <=128 chars; stable literal model version is required (no “latest” alias). `generatedAt/importedAt/adoptedAt` are safe UTC epoch milliseconds; future timestamps beyond agreed clock skew fail review. Attestation validates generation time, not user-edited adoption time. Proposed signer clock-skew tolerance 5 minutes; backend/QA must enforce an authoritative server clock, not client time.

### Example: adopted REAL resource shape

The data/hash/signature below are intentionally non-validating placeholders, **not** REAL evidence or a parser fixture:

```json
{"schemaVersion":2,"id":"image_example","name":"Generated image.png","altText":"A blue square","mimeType":"image/png","dataUrl":"data:image/png;base64,iVBORw0KGgo=","content":{"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","width":1024,"height":1024,"byteLength":123456},"provenance":{"source":"REAL","provider":"example-provider","model":"example-fixed-version","region":"example-region","generatedAt":1793289610000,"receiptId":"receipt_example","prompt":{"policy":"OMITTED"},"attestation":{"profile":"blockcraft-image-proof/1","keyId":"example_key","claims":{"source":"REAL","provider":"example-provider","model":"example-fixed-version","region":"example-region","generatedAt":1793289610000,"receiptId":"receipt_example","mimeType":"image/png","width":1024,"height":1024,"byteLength":123456,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","transform":"NONE"},"signature":"EXAMPLE_NOT_A_SIGNATURE"}},"lifecycle":{"state":"ADOPTED","review":"SOURCE_VERIFIED","adoptedAt":1793289620000},"migration":{"origin":"NATIVE_V2","transform":"NONE","fromSchema":null}}
```

Never trust persisted `review=SOURCE_VERIFIED` by itself. Recompute hash and reverify proof against a trusted key registry on import/restore. Missing/unknown/revoked key or invalid proof produces `SOURCE_UNVERIFIED` in an isolated inspection view, no REAL verified badge and no adoption into the active project. Original import remains downloadable unchanged. Unknown source fields/versions are quarantined/rejected, never stripped. User-upload and Mock claims can be displayed as such with an “unverified import” indicator; they are not a server grant.

## Proof profile and trust boundary

D6 proposes Ed25519 signing with domain separation. Signature is canonical base64url without padding of the 64-byte signature. Signed bytes are UTF-8 JSON serialization of an array in this exact order:

```json
["blockcraft-image-proof/1","REAL","example-provider","example-fixed-version","example-region",1793289610000,"receipt_example","image/png",1024,1024,123456,"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","NONE"]
```

No ambiguous key ordering/floats/Unicode normalization: these identifiers are ASCII, integers exact; sign the specified array, verify equality with all claim and asset content fields. Parser bounds <=4096 bytes, allowlisted algorithm fixed by profile, no algorithm from untrusted input, no remote key URL resolution. Trust key registry maps `(profile,keyId)` -> public key, validity interval, revocation policy, issuer; only reviewed application/server trust configuration can add keys. Importing a project never adds a trusted key. Missing trust infrastructure is B4 and blocks verified portable REAL, not a reason to skip verification. Private signer access is a separate secret approval; this task generates no key. Test keys must be distinguishable, untrusted by production and offline only.

Signer issues proof only after durable authorized task linkage and validation of stored bytes. Receipt lookup stays server-private, keyed to the job/authorization/audit; portable `receiptId` is random unguessable correlation, **not** authority to query a private task. Proof deliberately excludes raw prompt, principal ID, private project ID, approval ID, supplier request IDs and signed CDN URLs. Source verification does not imply safe content, payment settlement or ownership of copyrighted material. Any independent safety/content review requires its own evidence; no `SAFE` boolean fabricated from signing.

Imported REAL may be source-verified offline while its charge is unavailable locally; a portable signature never authorizes a new call, refund or server job read. For current-session candidate adoption, require authenticated current job plus reconciled billing per wire contract. Future derivative/transcoding must allocate a new signed transform profile with input/output digests and policy version; cannot reuse proof for modified bytes.

## Prompt privacy and logging

Default: raw prompt is retained **only encrypted in the private server job while needed** (<=15 minutes); no plaintext durable audit/log. Browser input may be in current memory while authoring but is not automatically stored with project/receipt. Jobs need short-lived prompt material to run queued work after restart; if encryption/key service is unavailable, fail closed rather than write plaintext. No credential reading or key provisioning is part of this RFC.

Portable prompt union:

- `{"policy":"OMITTED"}` default for REAL, upload, fixture and legacy.
- `{"policy":"USER_INCLUDED","schemaVersion":1,"text":"A blue square"}` only explicit per-export/user save opt-in; same input size/control limits; not signed by source proof and clearly marked user-supplied, not authenticated source history.

Export preview defaults to OMITTED even when a user saved a prompt locally. Excluding it must not mutate the active project. Explicit inclusion may fail the 4096 metadata/project file cap; never silently truncate or auto-drop another field. The source attestation does not change when optional prompt is omitted. Do not export raw prompt hashes: predictable prompts can be dictionary matched. Internal request digest is restricted job data, never public provenance. Optional user redaction is a new text value with explicit inclusion, not a claim that hashing anonymizes it.

Logs allow only bounded job/request/receipt IDs, state transitions, event IDs, safe error code, SHA/code SHA and charge accounting references in restricted audit; omit prompt, image/base64 bytes, supplier raw response, signature URL, session cookie, tokens and private keys. Redact transport exceptions before logging. Public project export contains neither private ledger data nor credentials. Resource/ZIP secret scanner must be extended and tested for the new schema without treating arbitrary nested extra fields as safe.

## Image and project admission

Current verified limits are **32 assets, 524288 decoded bytes each, 1048576 decoded bytes total**, not a 1MiB JSON limit. Project JSON is 4000000 bytes with a 2000000 aggregate string-unit ceiling and ordinary-string cap 262144; each approved asset data URL <=699100 units. ZIP limits are listed in [migration](migration-matrix.md). Base64 expands bytes by `4*ceil(n/3)` plus MIME prefix. A 524288-byte asset uses 699052 base64 chars; two such assets use roughly 1.4MiB of base64, before project/artifact/provenance overhead. Other caps can reject a project below the decoded total; all must pass.

Initial REAL profile: PNG only, <=1024 width/height, <=1048576 pixels, <=524288 file bytes, <=4195328 inflated scanline bytes; strict 8-bit non-interlaced IHDR/IDAT/IEND subset supported by #99. CRC, complete deflate consumption, dimensions and decoder result must agree. Current base asset upload support for JPEG/WebP/GIF remains for legacy/upload; it does not broaden REAL. #99 preparation does not prove an OS memory sandbox or live supplier compatibility.

**Chosen initial policy: REJECT, no automatic normalization.** An oversized/unsupported/metadata-bearing PNG fails `OUTPUT_INCOMPATIBLE`/INVALID_IMAGE. Task can fail after provider has charged: keep settlement/UNKNOWN, never call again automatically. Do not pre-reserve less than maximum cost on the assumption most output fits. Unknown official output-size compatibility is a Cost-Security/Backend blocker before real acceptance. A later local deterministic conversion must have reviewed CPU/RSS/deadline limits, metadata removal behavior, signed transform chain and new tests. It would be a separate policy, not a paid retry or this RFC's implemented feature.

Before showing a candidate as adoptable, validate proposed whole-project count/decoded total, canonical JSON serialization bytes/text/depth/nodes, package count/size/paths/hashes/decoding, metadata cap and current owner/ACL. Preflight local capacity before create reduces avoidable spend but is **not** budget or future-capacity authority. If another tab changes the project after generation, keep a recoverable private job result until expiry; require new explicit preview/confirmation, never auto-adopt to another gallery/project.

Candidate state is separate ephemeral `PENDING -> READY -> ADOPTED|DISCARDED|STALE|EXPIRED`; `PENDING -> FAILED|CANCELLED|UNCERTAIN`. Only READY contains a fully validated immutable draft, exact source proof and target revision. A candidate is not a ProjectAsset entry until explicit confirm. Local confirmation receipt `{confirmationId,digest,assetId,revision}` is adoption evidence, not supplier billing. Proposed adoption digest binds workspace, target, full prepared project including provenance, and server job/proof. Atomic save precedes single-owner B/C publish. Discard removes local candidate bytes, not charge evidence. The server cost lifecycle never depends on UI adoption/discard.
