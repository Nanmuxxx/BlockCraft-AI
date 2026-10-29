# Independent QA — image phase-two preparation

Date: 2026-10-29 Asia/Shanghai. Agent: `/root/independent_qa`; independent from implementation and Cost/Workshop research. **Verdict: ACCEPT, limited to the added, currently unconnected download/PNG preparation modules at the exact source below.** REAL Provider and real end-to-end acceptance remain BLOCKED / NOT_RUN.

```text
[REPORT]
role: QA
base_sha: 77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad
head_sha: 26a97e3eac2ff5f816621c2265b29e4ae4a0a804
pr: NONE (local pinned candidate at review time)
status: VERIFIED
completed: Independent detached checkout; source review; new preparation tests 11/11; independent adversarial probes 9/9; prepared existing provider/HTTP contracts 26/26; root typecheck PASS. ACCEPT only preparation modules, not REAL Provider or UI integration.
tests: Darwin arm64, Node v24.22.0, npm11.19.1; OFFLINE/HTTP_MOCK. Exact commands and exits below. Real provider, secret access, paid requests, remote image downloads and external test egress NOT_RUN.
blockers: REAL auth/project mapping/durable image expense ledger, approved provider/model/budget, complete output normalization, provenance schema and real HTTP/UI protocol remain missing or unapproved.
next: Supervisor preserve tested source hashes, attach report to reviewable proposal/PR, keep real routes disabled.
approval_needed: NONE
```

## Exact checkout and scope

Worktree `/Users/nanmuxun/BlockAI/BlockCraft-AI-image-phase2-qa-20261029`, detached at literal `26a97e3eac2ff5f816621c2265b29e4ae4a0a804`. `git status --short` empty before preparation and no tracked product edits. Five added files only relative to base: `server/image-generation/preflight/{download,png}.mjs` and `tests/image-preflight/{download.test,png.test,fixtures}.mjs`. No changes to appSpec, current wire contract, front-end adoption flow, storage, exports, budget configuration or production routing.

`rg` import/call-site search confirms only new tests and the new downloader reference these helpers. No production startup or browser import consumes them. Prior PR98 acceptance is not reused as evidence for these helpers.

Hashes:

- `download.mjs`: `5cc6c02c2b5f220aecfdea546df6d568ec8e9d51ea323e8f7339a8e95f7e015a`
- `png.mjs`: `7af2a5e9b15a1410f282f14927f9a3f7ad0d9b3d3da458f4dd03762e0f0f92d9`

## Reproduced results

Commands run from the detached worktree unless shown otherwise. Evidence directory is `/Users/nanmuxun/BlockAI/qa-evidence/image-phase2-preparation-20261029`.

| Command | Exit / evidence |
|---|---|
| `node --test --test-timeout=5000 tests/image-preflight/*.test.mjs` | 0; 11 pass, 0 skipped; `preflight.log` |
| `node --test --test-timeout=5000 /Users/nanmuxun/BlockAI/qa-evidence/image-phase2-preparation-20261029/independent.mjs` | 0; initial 8 pass (`independent.log`), extended 9 pass (`independent-native.log`); not counted cumulatively |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | 0; `install.log`; cached install, no network |
| `npm --prefix server run build` | 0; `server-build.log` |
| `node --test --test-timeout=10000 tests/image-backend/provider.test.mjs tests/image-http-contract/*.test.mjs` after build | 0; 26 pass, 0 skipped; `contracts-prepared.log` |
| `node node_modules/typescript/bin/tsc -b` | 0; `typecheck.log` |

Independent probes are outside the product checkout and use independently constructed PNGs/transport event sequences:

1. A valid PNG exactly **524288 bytes** is admitted; +1 byte is rejected. Legal empty IDAT chunks allow exact boundary construction without trailing garbage.
2. Duplicate IHDR, unsupported metadata interrupting image structure, high-bit chunk-name byte with valid CRC, >5MiB inflate against a 1x1 header, and concatenated zlib streams are rejected.
3. 1024x1024 raster and exact SHA256 succeed; 1025-high raster and false claimed dimensions fail.
4. Cancellation before headers rejects promptly; a late response is destroyed and cannot supply a candidate.
5. Truncated stream/`complete=false` fails with safe error text and one dispatch.
6. Request close before response fails rather than hanging or accepting bytes.
7. Successful bytes do not free capacity until the actual request close event; a second call gets DOWNLOAD_BUSY.
8. Abort during DNS resolution retains the slot until resolution completes; late public address causes zero request calls.
9. Native `node:https.request` consumes the prepared pinned lookup address. The independent wrapper returns a deliberate DNS error before opening any remote socket; error sanitization and final slot release pass. This verifies Node's lookup integration, **not a live certificate handshake or real CDN compatibility**.

New committed tests additionally exercise URL allowlist/default-closed behavior, all private/special IPv4 categories, IPv6 denial, mixed-public/private DNS answers, original TLS hostname and certificate verification option, no custom agent/credentials/cookies, no redirect/retry, MIME/compression/content-length/stream limits, timeout and stuck cleanup, canonical Base64, CRC, PNG color/filter subsets, and cancellation.

Existing tests independently confirm current production image POST is 404 with zero provider calls and preserve fixed Mock/HTTP ownership, idempotency, cancellation, unknown settlement and Worker resource behavior. Browser desktop/390px, JSON/ZIP UI round-trips and complete app build were **not rerun by this QA agent** because source change is disconnected from these paths; the Supervisor must attribute any other executions separately. This does not close the full stage-two acceptance matrix.

## Limits and non-claims

- Downloader is a reusable library with explicit server-owned allowlist, not a Provider dispatch or authorization system. Production does not import it. No real image was downloaded or generated.
- This is a restrictive static PNG subset, not an arbitrary supplier-image decoder/transcoder. Palette, metadata, interlace, JPEG/WebP, bigger images and IPv6-only/dual-stack DNS answers are intentionally denied. Native certificate enforcement options are inspected; real provider/CDN handshake and output compatibility remain unverified.
- The 4,195,328-byte scanline limit bounds inflate output, **not whole-process RSS**. Chunks, input copies and buffers add overhead. There is no OS process-memory quota in this module; CPU deadline is not a preemptive synchronous decoder kill switch. General normalization still needs isolated resource controls.
- Output bytes are owned copies, but Buffer contents remain mutable by trusted consumers. Do not treat the object wrapper as a security boundary against malicious caller mutation.
- Unknown generation cost is not handled here. Abort/download failure never proves supplier cancellation or refunds. No billing inference from validation success.
- Native transport injected functions are trusted server code; arbitrary hostile injected transports are not an SSRF sandbox.
- No main modification, merge, push, deploy, credentials, budget or supplier API calls occurred in this QA task.

## Preserved setup failure and diagnosis

The first existing-contract command ran before service build and exited 1: 20 tests passed and the provider test file could not load. Full trace preserved in `contracts.log`, beginning:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<isolated-worktree>/server/.generated/appSpecValidation.js' imported from '<isolated-worktree>/server/trusted-interactive.mjs'
```

The actual full local paths and stack remain in the local log; no credential data was present. Read-only inspection of `server/tsconfig.json` (`outDir:.generated`), `server/package.json` and `server/README.md:23` confirmed the ignored build output is required. Official [Node ECMAScript module resolution documentation](https://nodejs.org/api/esm.html) corroborates missing-file resolution semantics; the documentation lookup used only the generic error/tool name. Then offline dependency installation and the existing server build generated the artifacts. The unchanged source subsequently passed all 26 tests. No source/test assertions were altered to conceal the setup failure.
