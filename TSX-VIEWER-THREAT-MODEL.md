# TSX Viewer Threat Model — Phase 2

**Status:** Initial architecture audit; not a security approval.  
**Baseline:** `Nanmuxxx/BlockCraft-AI` main at audit start: `25773e6d65e4e5a2b29d125baa2510f4a10aa343`.  
**Related candidate:** PR #40 (`692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`), open Draft at audit time.  
**Security posture:** Arbitrary generated TSX execution remains DENIED. This document does not authorize enabling it.

## 1. Assets and trust boundaries

- Host editor DOM, JavaScript realm, application state, and project/session objects.
- Authentication material: cookies, local/session storage, in-memory tokens, API keys, and authenticated same-origin endpoints.
- User project/artifact data, generated TSX, compiler output, dependency metadata, and renderer state.
- Availability of the host tab and its UI thread, memory, CPU, network, and storage.
- Integrity of messages exchanged between host and viewer.

Trust zones:
1. **Host application:** trusted application code; owns auth and project mutation authority.
2. **Artifact ingress/installer:** accepts untrusted JSON/source and validates shape, ownership, revision, and capability constraints. Validation is not proof that source is safe to execute.
3. **Compiler/build stage:** parses untrusted source. Treat parser, plugins, transforms, package resolution, and build output as attack surfaces.
4. **Viewer realm:** untrusted code execution zone; must have no host credentials or host object references.
5. **Network/dependency boundary:** all fetched modules and runtime services are explicit capabilities, not ambient authority.

## 2. Threats and required controls

| Threat | Example / impact | Required mitigation and evidence |
|---|---|---|
| Host DOM access | `parent.document`, DOM traversal, UI spoofing, key capture | Dedicated origin where possible; iframe sandbox without `allow-same-origin`; never combine `allow-scripts` and `allow-same-origin` for same-origin content; verify in a real browser that parent DOM access throws. |
| Cookie/auth access | Reading host cookies, localStorage, sessionStorage, in-memory tokens, or authenticated endpoints | Viewer must not share host origin; opaque-origin sandbox where practical; no credentials in messages, props, source maps, or build payloads; use `credentials: 'omit'` for permitted fetches. Verify each storage surface in browser. |
| Network exfiltration | `fetch`, XHR, WebSocket, EventSource, beacon, image/form navigation exfiltrate source or secrets | Strict CSP `default-src 'none'`; explicit `connect-src`, `img-src`, `form-action`, `navigate-to` policy; block unneeded network in the harness; CSP is defense-in-depth, not a substitute for origin separation. |
| Malicious dependencies | Typosquatting, install scripts, transitive dependency compromise, import-time side effects | No arbitrary package installation or runtime bare imports; compile only against a fixed, reviewed dependency allowlist and pinned artifacts; reject dynamic import and external URLs. |
| Import escape | `node:fs`, `process`, `vite`, absolute paths, URL imports, dynamic import | Parse AST and allow only explicit module specifiers; reject computed/dynamic imports, re-exports outside allowlist, and import attributes unless explicitly supported. String scanning alone is insufficient. |
| Resource exhaustion | Infinite loop, recursion, memory blow-up, huge DOM, timer flood | A same-thread iframe does **not** guarantee CPU isolation: an infinite loop can still freeze the tab/browser process. Until a reproducible browser test proves host responsiveness under hostile loops, production execution stays disabled. Consider a separately-originated, separately-process browser context; enforce source/output/DOM/time quotas, while recognizing timers cannot interrupt a synchronous loop in the same renderer process. |
| Message spoofing/replay | Any window sends fake ready/error/result messages; stale messages mutate host state | Strict schema and version checks; validate `event.source` against the exact iframe WindowProxy, expected origin (or documented opaque-origin `null` case plus source identity and nonce), session nonce, request ID, sequence, size and message type; reject stale/replayed messages. Never trust payload-provided origin fields. |
| Protocol confusion | Invalid schemes, `javascript:`, `data:`, `blob:`, malformed URL or unexpected content type | Parse with URL API against an explicit allowlist; reject dangerous schemes and redirects; use exact origin/path policy; never place untrusted source in a host-origin script URL or HTML string. |
| Renderer/compiler compromise | Malformed TSX exploits compiler/plugin or React renderer | Pin versions, minimize compiler features/plugins, no server-side execution, isolate compilation where possible, cap source and output sizes, patch promptly. |
| Error escape | Exception/rejection tears down host or leaks internals | Catch compile and render errors in viewer; bounded, sanitized error messages; host-side protocol handler must itself be defensive. Errors are not a security boundary. |
| Navigation/popups | Viewer navigates top, opens windows, submits forms, downloads files | Minimal sandbox tokens; no top-navigation/popups/forms/downloads; CSP `form-action 'none'`; validate any navigation request explicitly. |
| Storage persistence | Viewer writes persistent data or reads another tenant's state | Opaque origin / dedicated origin; disable storage APIs by architecture where possible; do not grant shared origin; browser-test access failures. |
| Cross-origin assumptions | Same-origin iframe mistakenly treated as isolated | Document actual origins and sandbox flags; inspect `location.origin`, `document.domain`, storage behavior and parent access in browser. iframe presence alone is not evidence. |

## 3. Current audit observations

- PR #40 describes Generated Artifact installation as `build: not-attempted` and `execution: denied`; the installer source also states that generated installs cannot grant host capabilities or events.
- The installer validates artifact structure, captures JSON before asynchronous validation, checks project/session authorization and revision, and uses a session-bound confirmation ticket. These are integrity controls for installation, not a safe TSX execution sandbox.
- The repository package manifest at the audit baseline includes React/React DOM and Vite, but the reviewed build setup alone does not establish a safe arbitrary-TSX runtime.
- PR #40's own evidence says `test:trusted-interactive:browser` was blocked because Playwright was missing and no cases ran. Do not interpret archived fixture screenshots or offline tests as proof of arbitrary TSX isolation.
- No successful hostile-source browser test has yet been established in this audit. CSP, iframe flags, origin layout, and message protocol must be verified against the actual viewer entry point before any execution claim.

## 4. Non-negotiable launch gates

1. No arbitrary generated TSX in the host JS realm.
2. No host auth/project objects or credentials cross the boundary.
3. Dependency and import allowlists are enforced structurally.
4. CSP and sandbox are tested in a real browser, including storage, DOM, navigation and network denial.
5. Message origin/source/nonce/schema/replay checks have adversarial tests.
6. A hostile infinite-loop test demonstrates the host remains responsive in the intended deployment architecture. If not, execution remains disabled.
7. Repeated mount/unmount tests show listeners, timers, workers, blob URLs and iframe resources are cleaned up.
8. Counter, Todo and Pomodoro fixtures pass real interaction tests; screenshots alone are insufficient.
9. Security reviewer explicitly approves before C-mode integration or production enablement.

## 5. Safe fallback

When any gate is missing, keep the viewer unavailable and render source as inert text or a non-executing preview. Do not silently fall back to `eval`, `new Function`, host-side transpilation followed by execution, or an iframe without tested origin and resource boundaries.
