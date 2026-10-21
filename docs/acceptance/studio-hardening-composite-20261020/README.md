# Combined Studio hardening Mock acceptance

Tested source commit: `326e961732c74a4f62f9e12a76703788dd585ad3`.
Tested source tree: `4df7272567cab88f7917b67c13b4c4c845b82de2`.
Base remote PR75: `7bc5aeb932e01276ddfea9216e65b30cf31b553e`.
Imported only reviewed Core-owned paths from PR76 `3abd5bd7610b693bf7f5b8c08682b9b944e33a15`; retained Docker launcher allow/copy/import lines. TL scope review #57 comment6276028183. QA startup origin evidence6276045818, ownership handed to Supervisor in existing QA chat.

Commands executed with exit0:
- `python3 tests/generation/studio-mac-vector.verify.py`: Python/OpenSSL independent fixed vectors PASS.
- `npm run test:generation`:109/109,0 failures/skips.
- `node tests/generation/studio-command-smoke.mjs`: exact7860 bind,health200,anonymous401, missing/malformed approval and missing ledger generic refusal;0 upstream. Supervisor tightened test preload to throw instead of permitting fetch; all negative cases use7860. Synthetic state/key only.
- `npm run build`:PASS.
- `node tests/generation/studio-issuer.browser.mjs`:HTTPS Chromium login -> AI create -> B -> C start/pause/reset -> B/C retained -> replay401;1Mock,0paid,0external. Test certificate trust bypass is only for local synthetic TLS; no public TLS claim.

Evidence-only additions after the source test do not alter product code. This is Mock/startup evidence; historical real AI result stays bound to e4d65ac, and PUBLIC PASS remains BLOCKED. No real key/private ledger inspection, paid call, provisioning, merge, deployment or policy change.
