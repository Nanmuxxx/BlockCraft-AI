# Migration and compatibility contract

**PROPOSED / NOT_IMPLEMENTED.** Every migration is staged, validated and reversible without overwriting its input. No schema/database migration is run by this RFC.

## Version allocation (D3)

Do not confuse these independent version domains:

| Domain | Current source at #99 | Proposed provenance-capable writer |
|---|---|---|
| AppSpec (blocks/entities/relations) | `spec.version:1|2` | Remains 1/2; no new block semantics |
| ProjectState asset entry | strict id/name/altText?/mimeType/dataUrl, no schema field | `ProjectAsset.schemaVersion:2`, with content/provenance/lifecycle/migration |
| CustomProject | `formatVersion:2` | `formatVersion:3`, required `requiredCapabilities:["portable-image-provenance/1"]` |
| Project JSON | `format:"blockcraft-project",formatVersion:1` | Same format, `formatVersion:2`; exact envelope keys format/formatVersion/project/artifacts |
| Project ZIP manifest | `format:"blockcraft-project-package",formatVersion:1` | Same format, `formatVersion:2`; embedded `blockcraft-package-project` formatVersion 2, CustomProject 3 |
| IndexedDB | `blockcraft-project-backups`, version 2 | Version 3, **new provenance workspace store**, preserve projects/current-workspace stores untouched |
| Image wire | `image-generation/1` strictly Mock | Separate `image-generation.real/2` and `image-generation.http-mock/2` |

CustomProject3 exact keys: existing formatVersion/revision/base/custom/renderOrder + requiredCapabilities; no generic arbitrary extension bag. Required capabilities are unique sorted identifiers; initial only the one above. New readers accept known versions/capabilities only. Its base has existing spec/records/blockPositions/timers?/assets? but **ProjectState validation is selected by enclosing project format**, never by an attacker-controlled `asset.schemaVersion` alone. Legacy standalone ProjectState commands use a negotiated runtime schema capability; old commands cannot silently cast new assets. AppSpec v1/v2 need not become v3. Both resource codecs and runtime owner/project projection must carry project format/capability; current `projectBuiltinChange`/validators require deliberate review to preserve this gate.

ZIP v2 retains existing manifest/resource descriptors, with exact descriptor `{id,path,mimeType,byteLength,sha256}` and strict paths. Provenance stays in corresponding asset metadata inside `project.json`; binary resource replaces only dataUrl with resourcePath. Required capability is in CustomProject3; no new sidecar/path extension. Existing package metadata `projectFormatVersion` becomes 3, AppSpec version unchanged. Import checks manifest metadata equals embedded project, hash/length/MIME/path equals decoded content and metadata, and signature matches those same bytes. Rebuild canonical base64 for JSON/IDB. Reject any missing/extra resource/duplicate path or mismatched metadata. Explicit codec versions must be frozen before implementation; no blind spread that drops fields.

## Current caps retained; proposal must satisfy all

| Boundary | Actual current limit (not a new grant) |
|---|---|
| Project assets | 32; each <=524288 bytes; sum decoded <=1048576 bytes |
| Project JSON/IDB text | <=4000000 UTF-8 bytes; JSON aggregate text <=2000000 units; depth32, nodes100000, keys2048, array10000 |
| String values | Ordinary <=262144 UTF-16 units; asset dataUrl approved paths <=699100 |
| ZIP | <=34 files; each <=4000000 bytes; uncompressed total <=5100000; ZIP <=5200000 bytes |
| Adoption receipts | <=128 per current workspace; no automatic eviction |
| New metadata | Proposed <=4096 UTF-8 bytes per image, counted in all JSON/text/ZIP limits |
| New REAL image | PNG <=524288 bytes, sides<=1024, pixels<=1048576; no implicit historical-upload widening |

These caps are independent. The task brief's “project JSON about 1MiB” is corrected by source: **1MiB is decoded asset aggregate; JSON is 4,000,000 bytes**. Do not change either to hide incompatibility. ZIP v2 uses 2 JSON files + <=32 assets, preserving 34-file maximum. New metadata can push an otherwise valid project past a bound; reject transactionally, keep original, offer export/explicit removal of other content, never drop provenance or trigger a paid retry. JSON whitespace can differ, decoded bytes/semantic metadata cannot.

## Old/new compatibility matrix

| Input / operation | New reader/writer required behavior | Old reader behavior / downgrade |
|---|---|---|
| Legacy AppSpec/ProjectState v1/v2 no assets | Use existing explicit legacy parser, validate and wrap CustomProject; stage new format only after user chooses save/migrate | Original legacy file remains readable by old reader |
| Current JSON envelope1 / CustomProject2 assets | Read unchanged first; explicit copy migration creates schema2 assets with LEGACY_UNKNOWN, measured hash/dimensions/bytes, adoptedAt null and original IDs/references preserved | Old reader continues original copy; no in-place rewrite |
| Current Mock asset with name “Mock…” but no proof | LEGACY_UNKNOWN; filename not evidence. Optional separate explicit history-based import can establish FIXED_MOCK only with known fixture evidence | No inferred REAL/Mock metadata |
| New JSON envelope2 / CustomProject3 | Require known capabilities + closed resource schema; validate full project, bytes/proof and exact component artifacts before staging | Existing envelope/version validation rejects; never advertise forward readability |
| New ZIP2 | Validate bounded ZIP, paths/manifest, version/capabilities, metadata/byte hash/proof, decoder and project reference closure; then stage | Existing package version gate rejects |
| New format unknown future source/proof/capability | Reject/quarantine original file; no active-project replace or field stripping; no trust-key fetch from import | Unsupported version; no lossy fallback |
| New REAL with bad/unknown key/proof or modified bytes | Inspection only SOURCE_UNVERIFIED; do not adopt or reclassify as USER_UPLOAD/MOCK; retain original | Cannot export as legacy project pretending provenance does not exist |
| New upload/fixture proven lineage | Preserve appropriate source, content digest, timing/version and migration fields | Legacy export blocked whenever it would lose schema2 metadata |
| New JSON -> ZIP -> JSON | Byte-identical decoded images, same IDs/gallery refs/content/provenance/proof/prompt policy/lifecycle/migration/required capabilities/artifacts; base64 canonicalized | No automatic v1 downconversion |
| Prompt omitted on export | Create an export copy with prompt.policy OMITTED, proof unchanged, active project unchanged; source retained | Not a schema downgrade; use new format |
| Out-of-budget metadata/image/project | Fail before active DB/project write; no truncation, alternate Mock kind or paid regeneration | Original file/project remains |
| Browser refresh / B<->C | Restore one authoritative CustomProject3 owner, verified assets and references; both modes read same base asset registry; candidate not auto-adopted | No separate React/localStorage provenance cache |

Original input byte preservation is required on rejected/quarantined files. Known invalid REAL proof cannot be “fixed” by saving as upload inside the same migration; an explicit separate user upload of a standalone image is a new action with separate truthful lineage, never the original project's automatic downgrade.

## Atomic adoption and IDB upgrade

Current database v2 stores old backups and one current workspace. Proposed v3 adds a distinct store `provenance-workspaces`, with the same head+receipt CAS semantics and a validated versioned row; original `projects` and `current-workspace` remain read-only migration sources. IDB upgrade is structural only; no heavy decoding or project rewrite inside onupgradeneeded. `onversionchange` closes old connections. A blocked upgrade/time limit/storage denial leaves DB intact and blocks write; no fallback to localStorage or overwrite of the old store.

Migration sequence:

1. Read original complete source/saved sequence; obtain explicit migration/save intent and a backup/export where available. Freeze a staged copy; no active state mutation.
2. Use bounded parsers and image validation/decoding to measure bytes/dimensions/hash. Unknown legacy source remains unknown; preserve exact image bytes and all IDs/gallery/custom block/artifact references. No transcoding/guessing creation times. If the old asset cannot safely decode within limits, fail and retain original.
3. Validate new project/JSON2/ZIP2/proof/secret scanning/caps **before** opening write transaction; compare expected owner/auth/revision again. New-format validators and prepared digest must include provenance/capability.
4. One strict IDB transaction checks new-store generation, legacy source sequence/checksum if migrating, and confirmation receipt uniqueness; writes new-store head+receipt and migration-source reference. No source delete or old-store overwrite. CAS conflict, quota exceeded or abort leaves source and active project unchanged.
5. Only committed storage result permits one authoritative owner publish to B and C. Lost completion/read uncertainty or saved-before-publish failure enters recovery with writes/adoption blocked; reconcile durable head+receipt first, never repeat blind adoption or replace newer state. Same confirmation+digest returns duplicate; same ID/different digest conflicts.
6. Restore validates stored text/schema/proof again before switching active project. User can choose intact legacy copy to roll back; never force old application to open a new-only record. Existing v2 opener will encounter VersionError on v3 DB; explicitly document “newer storage version” and preserve it, not delete/recreate. An old release cannot be made forward-compatible by this RFC.

An IDB browser upgrade cannot be reversed automatically. Safe rollback is use preserved legacy **export** in a separate profile/new DB or a reviewed reader that understands v3; never lower DB version, delete new stores, or replace current REAL assets with a metadata-free copy. Deployment rollback requires a capable reader or disabling new writes; document this before release. Retaining a legacy source does not mean old code can open a v3 database.

## Round-trip and no-loss invariants

For every supported route (JSON2, ZIP2, IDB restore, B/C switch, undo/redo), assert stable resource IDs, exact decoded SHA/byteLength/dimensions/MIME and source/provider/model/region/generationTime/receipt/proof/prompt policy/migration fields; gallery imageIds valid and unique; custom artifacts at exact digests; only explicitly declared revision/adoption/export-prompt fields may change. Revalidate source proof; no persisted boolean grants trust. Local job/candidate/review state and server finance records are separate from portable assets.

Negative paths must assert original project snapshot, original input/export and old DB source are unchanged. Exceeding receipts or size requires an explicit new workspace/import workflow under existing permission rules, not auto-clearing receipts. Tests must cover legacy timer v2, CRUD/custom renderOrder and resource projections so a provenance version gate does not regress non-image B/C content. Rollback may disable new generation/adoption without hiding UNKNOWN fees or deleting their server records.
