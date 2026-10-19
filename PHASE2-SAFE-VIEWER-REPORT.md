# Phase 2 Safe TSX Viewer — Engineering Report

**Report state:** IN PROGRESS — audit baseline confirmed; implementation and browser security acceptance NOT complete.  
**Branch:** `phase2/safe-tsx-viewer`  
**Base commit:** `25773e6d65e4e5a2b29d125baa2510f4a10aa343`  
**PR #40:** `https://github.com/Nanmuxxx/BlockCraft-AI/pull/40` (open Draft; head `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc` at inspection).

## Verified during this session

- GitHub repository metadata confirms `main` is the default branch and the repository is writable by the connected identity.
- Commit search returned `25773e6d65e4e5a2b29d125baa2510f4a10aa343` as the merge commit for PR #41, matching the supplied baseline.
- PR #40 is open and Draft, based on `4044fb185a2720eead0dc6710b0d38a215439b98`, with head `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`. It has not been merged.
- Read `src/integrations/generated-artifact/install.ts`: the installer preview explicitly records `build: 'not-attempted'` and `execution: 'denied'`; generated install rejects requested host capabilities and events; confirmation is session/revision/authorization-bound.
- Read `src/integrations/generated-artifact/ui.ts`: imported files are size-bounded and shape-validated; accepted artifacts are not automatically built or executed.
- Read `package.json` and `vite.config.ts`: React, React DOM, TypeScript and Vite are present, but no existing package script in the inspected manifest proves arbitrary TSX isolation.
- PR #40's description records that `npm run test:trusted-interactive:browser` was blocked by missing Playwright and no cases ran. This is a blocker, not a pass.

## Safety threat model

See `TSX-VIEWER-THREAT-MODEL.md` for the detailed assets, trust boundaries, threat/control matrix, and launch gates.

## Work performed and limitations

- Created the remote working branch `phase2/safe-tsx-viewer` from the supplied current-main SHA.
- This session has GitHub repository APIs but no verified local checkout/worktree or executable browser session. Therefore a physical local Git worktree has **not** been created, and no source code has been built or tested in Chromium/Firefox/WebKit during this session.
- The repository file-content endpoint returned 404 for `README.md` at the inspected ref; this alone is not evidence that the repository is missing. Specific source paths were fetched successfully.
- No viewer implementation is being declared safe based solely on iframe sandboxing or static review.

## Current gate status

| Gate | Status |
|---|---|
| Main / PR #40 baseline inspection | PARTIAL PASS — refs and relevant installer files inspected |
| Full viewer/CSP/import/message audit | BLOCKED — viewer entry points and headers still need systematic inspection |
| Independent experimental viewer module | NOT IMPLEMENTED |
| Counter / Todo / Pomodoro real interactive browser tests | NOT RUN |
| Host DOM and auth storage isolation tests | NOT RUN |
| External network and invalid import tests | NOT RUN |
| Forged/replayed `postMessage` tests | NOT RUN |
| Infinite-loop host responsiveness | NOT RUN; production execution MUST remain disabled |
| C-mode / Workshop integration | NOT STARTED; requires owner interface agreement and independent security acceptance |
| Build / test / lint | NOT RUN in this session |
| Merge / deployment / paid calls | NOT PERFORMED |

## Next actions

1. Continue code inventory of viewer-unavailable logic, TSX storage, compiler/import resolution, C-mode and server security headers.
2. Implement the isolated experiment in a separate module without replacing the production viewer. Prefer a separately-originated execution surface; do not claim CPU isolation from an iframe alone.
3. Add a pinned, reviewed import allowlist and strict versioned message protocol with source/origin/nonce/request validation and replay rejection.
4. Add reproducible real-browser tests, including hostile infinite-loop behavior. If the host can be blocked, keep execution disabled and redesign the isolation boundary.
5. Run Counter, Todo and Pomodoro interaction tests plus mount/unmount leak checks in the supported browser matrix.
6. Agree Artifact → Viewer and Viewer → Workshop state contracts with the respective owners before C-mode integration.
7. Commit/push only the isolated feature branch and open a Draft PR. Never merge, deploy, invoke paid APIs, or weaken existing gates without explicit authorization.
