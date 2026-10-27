# Execution failures, evidence and minimal remediation

Environment and versions: see README. No credentials were read for troubleshooting; commands/searches contained no keys. No certificate validation was disabled. Full actionable test failure stacks remain in logs; the following records setup failures from the tool transcript.

1. Command `git status --short --branch && git remote -v && git rev-parse HEAD && gh --version && node --version && npm --version`, cwd `/Users/nanmuxun/BlockAI`, exit **128**:
   ```text
   fatal: not a git repository (or any of the parent directories): .git
   ```
   Read-only directory inspection located `BlockCraft-AI/`; `git status` there succeeded (0). Parent is a workspace container, not a missing repository. No `git init`/reset performed. [Git -C / repository documentation](https://git-scm.com/docs/git).

2. Command `gh --version && git --version && node --version && npm --version && uname -sm`, exit **127**:
   ```text
   zsh:1: command not found: gh
   ```
   `command -v` and standard binary path checks confirmed no usable gh in this shell. [Official macOS installation documentation](https://github.com/cli/cli/blob/trunk/docs/install_macos.md) consulted. No installation/authentication change made. Used verified-TLS curl for public GitHub reads and already-authenticated Safari UI for issue comments / PR creation; no credential extraction.

3. Python 3.14.7 `urllib.request.urlopen` reading the public GitHub comments API, exit **1**, causal error:
   ```text
   ssl.SSLCertVerificationError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1082)
   urllib.error.URLError: <urlopen error [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1082)>
   ```
   This proves the Python TLS chain could not be verified; the specific local trust-store cause was not exhaustively diagnosed. [Python 3.14 macOS installation documentation](https://docs.python.org/3.14/using/mac.html) describes the certificates installation step. Did not alter global trust configuration. Switched to system curl's functioning certificate-verified HTTPS (exit 0); Python only parsed local/stdin JSON thereafter. Failed urllib stack was preserved in the tool transcript, no repeated urllib networking.

4. Broad discovery requested nonexistent optional `src/ai` / `tests/unified-budget` directories. `rg` reported `No such file or directory (os error 2)`; those discovery pipelines were not acceptance tests. Actual files were enumerated and audited under `server/paid-gateway`, `tests/paid-gateway`, `tests/generation`. No claim those absent directories existed.

5. First Gateway run, Node v24.22.0, exit **1**, full failure in `logs/gateway-tests.log`:
   ```text
   Error: Cannot find module './.generated/custom-block/index.js'
   Require stack:
   - server/custom-block/protocol.mjs
   code: 'MODULE_NOT_FOUND'
   ```
   [Official Node module resolution](https://nodejs.org/api/modules.html) searched before remediation. Read-only inspection of `server/custom-block/build-protocol.mjs`, `tsconfig.json` and package scripts confirmed this is a generated protocol prerequisite; ordinary `server build` only builds AppSpec validation. Ran existing `node server/custom-block/build-protocol.mjs` (exit 0), then the same Gateway suite (exit 0, 109 passed). Only ignored generated build artifacts produced; no source validator changes. Initial failure retained, never relabelled pass.

6. Web reader twice timed out retrieving Alibaba pricing; a separate certificate-verified `curl -fsSL --max-time 30` GET succeeded, exit 0, HTML parsed locally and relevant rows recorded with retrieval hash. No model API or console was accessed. A guessed OpenAI `/guides/deprecations` URL returned 404 through the web reader; it was not used as evidence. Lifecycle comments in the cost study use actually read image/pricing pages.

7. Authorized feature-branch `git push -u origin audit/image-backend-cost-20261027`, exit **128**:
   ```text
   fatal: could not read Username for 'https://github.com': Device not configured
   ```
   Stopped shell push retries. [GitHub authentication troubleshooting](https://docs.github.com/en/desktop/installing-and-authenticating-to-github-desktop/authenticating-to-github-in-github-desktop?platform=mac) consulted; it does not prove which credential mechanism this shell lacks. Read-only Desktop Accounts UI confirmed an existing Nanmuxxx login. Selected this isolated worktree, verified its branch/commit, then used the already-authorized normal Desktop Publish branch action. `git ls-remote` independently verified remote head `ee2f49a344ea1952fcd3a90ed97777ae57f05031`; no credentials read/exported and no account/config change. Subsequent publication likewise uses Desktop, not speculative shell authentication fixes.

No unexpected terminal failures were resolved by speculative paid writes, ledger resets, deletion, production configuration changes or weakening security. Feature branch publication is separately authorized by the user's PR instruction.
