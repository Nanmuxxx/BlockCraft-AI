# Gallery stability runner

This is additive evidence on #55 `a5392394b44c1d5702888af6f80e25195a3cc137`. It does not replace #60 baseline CRUD/Inspector evidence. There is no source/state instrumentation: inputs, buttons and touch events operate the production-built page. DOM reads only assert observable state. The existing fixture TS import hook supplies expected initial data.

Prerequisites: Node 24, repository dependencies matching package-lock.json, Playwright 1.62.1 available through normal resolution or NODE_PATH, and installed Microsoft Edge. Playwright is test tooling only; no package/lockfile change is required. To use another installed Chromium, set GALLERY_BROWSER_PATH to its executable. Versions/browser differences may affect results.

From the evidence checkout, with dependencies already available:

```powershell
# Only needed when Playwright lives outside the repository's node_modules:
$env:NODE_PATH = 'C:\path\to\test-tooling\node_modules'
node tests/gallery-stability/run.cjs
```

On a new machine, install the repository dependencies with `npm ci` and provision Playwright 1.62.1 in a separate tooling directory first. These provisioning steps were not rerun in this evidence session. For a non-Edge Chromium installation, also set GALLERY_BROWSER_PATH before running.

The runner builds with tsc and Vite, starts a local production preview on 127.0.0.1:5217, launches headless Edge, and saves commands/exit codes/raw stdout+stderr and a JSON case ledger under docs/acceptance/gallery-stability. A nonzero build/test exit fails the runner. Close any other listener using port 5217 first. New runs overwrite evidence; preserve the committed evidence when comparing runs.

No API process, key, budget ledger or server configuration is needed. All browser API calls are intercepted; generation never reaches a backend. Local static GETs are real. New model generation requests are deliberately denied unless they match a Mock fault. Static content is loaded before the context-offline test; this does not test PWA cold start. The browser's own background services are not a provider integration claim.

Each viewport uses one continuous page for three six-fixture cycles. Each cycle checks invalid empty submit, valid rapid double submit, B/C preservation, Cancel, same-fixture reset and no contamination. Other cases cover whitespace/nonfinite numeric input, already-loaded offline operation, six response/network faults and Gallery fallback, pending duplicate generation/cancel, refresh and a separate tab in the same browser context. The 390px path uses touch taps; it is not a physical handset test.

Expected application/network failure states are captured as mock-*.png. Actual assertion failures produce FAIL-*.png and nonzero exit. A run without failed assertions has no product-failure screenshot. Browser transport messages from the deliberate disconnected/503/504 cases are retained and allowlisted narrowly; any other console error or pageerror fails the runner.
