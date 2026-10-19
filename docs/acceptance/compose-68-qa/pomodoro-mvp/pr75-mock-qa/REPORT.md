# PR #75 exact HEAD Mock QA

- Product HEAD: `b2063e7c6ca83b55557924279501b2b6e9f2b158`
- Tree: `dca46d41d99617e4db3869c1ca54cfeaf31e632e`
- Base/main reference: `4a95cae50f772cd242d932cdbd93366381d1df74`
- Upstream: synthetic Mock only; `paidCalls=0`
- QA snapshot: `/tmp/bc-qa-pr75-vsZnGw`; source/build manifest in `snapshot.json`

## Result

**Scoped Mock integration PASS.** Exact PR #75 was independently frozen and rebuilt. The actual local launcher bootstrapped an HttpOnly/SameSite=Strict cookie; browser HTTP reached the actual principal runtime, idempotency sidecar and durable temporary local-smoke ledger. The only substituted component was the provider fetch. No Key, owner environment, private ledger or sensitive log was read. No source file was edited by QA.

Both 1440x900 and 390x844 runs passed. Each generated a valid AppSpec v2 Pomodoro, entered B automatically, displayed/selected the single block, entered C, started countdown, paused with a stable value, retained state across B/C, and reset to 25:00. Invalid schema generation retained the previous app. Each run recorded 3 Mock calls and 3 settled temporary ledger entries; the fourth/repeated request returned admission `429 BUDGET_EXHAUSTED` before sidecar, so no fourth provider call or reservation occurred. This is distinct from sidecar idempotency replay; the latter is covered by the targeted tests.

## Commands and results

- `npm run build`: PASS
- `npm --prefix server run build`: PASS
- `node server/custom-block/build-protocol.mjs`: PASS
- `node --test tests/paid-gateway/*.test.mjs`: **53/53 PASS**
- `node --test tests/generation/principal-gateway-http.test.mjs tests/generation/principal-entry.test.mjs tests/generation/local-owner-launcher.test.mjs`: PASS; auth, HTTP mapping, launcher and configured cap assertions
- Browser: `node gateway-browser.mjs`, sequentially at 1440x900 and 390x844: PASS

Native pricing expiry is explicitly covered by `principal-runtime.test.mjs` (`native clock is never extended...`): expiry rejects with `PRICING_EXPIRED`/HTTP 503, zero reserve and zero provider egress. Idempotency tests cover same-key single use, replay/conflict, persistence across restart, and no second reservation. Principal HTTP tests cover anonymous 401 and the configured 3-call cap followed by rejection.

## Evidence

- `desktop/b.png`, `desktop/c.png`, `mobile/b.png`, `mobile/c.png`: browser screenshots
- `desktop.log`, `mobile.log`: sanitized browser reports
- `paid-gateway-full.log`: unfiltered 53/53 output
- `generation-security.log`: targeted auth/cap/launcher output
- `snapshot.json`: exact commit/tree and SHA256 source/build manifest
- `SHA256SUMS`: evidence file hashes

The UI's branded `deepseek-flash` label is not evidence of a live model call. This run is Mock-only and does not upgrade the separate local REAL AI or public deployment status. No merge, deployment, secret change, real paid request, or destructive ledger action occurred.
