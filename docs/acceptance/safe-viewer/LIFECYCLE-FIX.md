# Safe Viewer process lifecycle hardening

2026-10-19. Draft only; no merge, deployment, real model call or production C-mode activation.

## Baseline and branch

| Item | Value |
| --- | --- |
| Current `main` | `d644835bc915528fddc873e2687c84471f22ec52` |
| Branch | `fix/safe-viewer-process-lifecycle` |
| Port commit | `f80d1143deaaf2970880ff723d06e41f80ae2871`, tree `62675d98f02a0ea8192acaf69a783465c92d16b7` |
| P2 fix commit | `cf00d786032cf9a12ccf63225bcb912c4f53578b`, tree `02a6ffc1b78b226748159cd32815c43738042ea4` |
| Draft PR | #50, target `main` |

Current `main` did not contain `server/safe-viewer`, `tests/safe-viewer` or `src/integrations/safe-viewer`. The reviewed files were deliberately ported onto the current main tree; PR #43/#48 branch history was not merged and `main` was not modified.

## P2-A: durable cleanup state

- Known esbuild identities are retained in a `createProcessRegistry()` record after a failed cleanup.
- Every later cleanup re-inspects PID plus creation/start identity before killing; an unknown or mismatched identity is never killed.
- `dispose()` retries retained identities with the reaper's bounded wait and is idempotent.
- A shared registry keeps a new compiler in `COMPILER_QUARANTINED` until all unresolved records are confirmed gone.
- `stats()` now reports `rootProcesses`, `knownChildProcesses`, `confirmedExitedProcesses`, `unresolvedProcesses`, `terminationState` and waiter counts separately. `fused` is not treated as proof that a process exited.
- `createSafeViewerService()` exposes the registry so trusted recovery can reuse it instead of silently starting with a fresh state.

## P2-B: waiter-local cancellation

- Each caller has a waiter object and its own cancellation state.
- One waiter cancelling no longer aborts a shared job while another waiter is active.
- The shared job is aborted only when every waiter is cancelled, the job times out, or the service is disposed.
- Waiters and abort listeners are removed on settlement. A cancellation after completion does not replace the completed result.

## Executed evidence

Environment: Windows 11 `10.0.26300`, Node `24.19.0`, npm `11.17.0`.

| Command | Result | Exit |
| --- | --- | --- |
| `npm ci` | 28 packages, 0 vulnerabilities | 0 |
| `npm run test:safe-viewer` | 22 tests, 22 pass | 0 |
| `node --test tests/safe-viewer/compiler-process.test.mjs` | 15/15, three consecutive rounds | 0 each |
| `npm test` | 194 default + 22 Safe Viewer, 0 fail | 0 |
| `npm run build` | TypeScript + Vite build passed | 0 |
| `npm run test:safe-viewer:browser` | Chromium `153.0.8010.12`, 14/14 | 0 |

GitHub Actions run `39198421779` on head `cf00d786032cf9a12ccf63225bcb912c4f53578b`:

- Linux Ubuntu 24.04, conclusion `success`.
- Safe Viewer: 22 tests, 21 pass, 1 skip (Windows-only `taskkill` fixture).
- POSIX process-group timeout/cancel/dispose and both waiter tests passed.
- Default tests 194/194; generation 37/37; server 34/34; Mochi host 57/57; trusted-interactive 31/31; trusted-pomodoro 2/2; Workshop export 9/9.
- Docker build, final-image ESM resolution, health check and HTTP smoke tests passed.

## Not run / limitations

- Windows `taskkill` failure is covered locally only; no Windows GitHub CI job exists.
- Firefox, Safari and macOS were not run.
- Browser tests are not part of CI.
- The GitHub token has `gist`, `read:org` and `repo` scopes, but no `workflow` scope; no workflow file was changed.
- An identity that cannot be read remains quarantined and cannot be killed safely. A fresh registry is not evidence that the old tree is clean.
- The inspect-to-kill interval still has a theoretical PID-reuse race; the implementation re-inspects immediately before kill but does not use pidfd/handle-based signaling.
- A host-process crash can leave the detached compile process tree outside this cleanup path.
- Formal C mode remains `unavailable`; the Safe Viewer remains default-off.
