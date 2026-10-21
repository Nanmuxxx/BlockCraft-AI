# Owner-approved real DeepSeek local product smoke

Tested code SHA: `e4d65ac77e02d41668d260c082dc2788c64b5975`.
Main baseline: `4a95cae50f772cd242d932cdbd93366381d1df74`.
Time: 2026-10-20 02:21 Asia/Shanghai. Public deployment: NOT VERIFIED.

Result: **REAL AI PASS — LOCAL ONLY**. One fresh natural-language UI request:
“帮我做一个 25 分钟番茄钟”. No upstream Mock, replay or Fixture was injected.
The backend used the native fixed `https://api.deepseek.com/chat/completions`
transport, model `deepseek-flash`; validated AppSpec v2 automatically opened B.
Runtime C showed 25:00, counted down, paused, retained state across B/C, and reset.
Browser external requests: 0. Anonymous generation: HTTP 401.

Commands (owner authorization required; never run in ordinary CI):
```sh
node server/local-owner-secret-start.mjs
BLOCKCRAFT_RUN_APPROVED_REAL_SMOKE=1 node tests/generation/owner-real-browser.mjs
```
The first command reads the owner's existing 0600 private file only inside the
controlled backend. The browser test never reads any Secret. It enforces a single
UI POST and refuses a nonempty prior smoke ledger. Ctrl-C stopped the backend
after the test. The durable ledger and idempotency claims are retained privately
under `~/.blockcraft-ai-local-smoke-20261020`; they are not part of these artifacts.

Hard backend limits: 3 total calls, output <=2048 tokens, concurrency 1, no retries,
worst-case conservative cap <=CNY 0.50, fail closed on uncertain usage/state.
This run: one settled entry, prompt 551 + completion 65 = 616 tokens.
Estimated cost CNY 0.001622; retained reservation CNY 0.036658.
The dedicated account's actual balance was NOT queried or independently verified;
20 minus estimated cost is CNY 19.998378, an estimate only. Price snapshot expires
2026-10-21 00:00 Asia/Shanghai. Never reset the ledger or renew policy silently.

Artifacts: report.json (sanitized ledger fields), validated-appspec.json,
four UI screenshots and the browser WebM recording. No request headers, cookies,
credential values, raw upstream errors or private state files are included.

Independent preflight: Tech Lead #57 comments 6274125996 and 6274172943;
actual principal Gateway Mock browser PASS; targeted security/profile tests PASS;
HTTP composition 6/6 PASS after test-only cap alignment. Broader legacy regression
still has failures and is NOT claimed green. This evidence grants neither merge,
ModelScope deployment, public paid access nor production readiness.

Remaining: publish candidate and independent evidence review; prepare Docker
candidate with server-side identity and persistent single-instance private POSIX
state; obtain separate owner deployment/public approval; run public E2E. BP/video
may describe only this verified local scope until public evidence exists.
