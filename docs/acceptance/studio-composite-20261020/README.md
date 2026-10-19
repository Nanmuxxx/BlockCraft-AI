# Studio composite acceptance — Mock only

Combines PR75 packaging source 7fd6a6836aee5795ee5448264d0e74fcec880ddd
with only the issuer source/test/docs paths from PR76
20aa0266225011a373991578d2a759de806b14ec. Dockerfile and .dockerignore
retain the three previously accepted launcher packaging lines.

Supervisor independently tested the exact PR76 archive first, then this combined
working tree: `npm run test:generation` (107/107), `npm run build`,
`node tests/generation/studio-issuer.browser.mjs`. All passed.
Local logs are included alongside this document. These commands use synthetic
temporary state and an injected Mock provider only; zero paid requests.

Actual local Chromium HTTPS form login emitted a Secure/HttpOnly/SameSite Strict
cookie, redirected to the UI, generated the fixed Pomodoro AppSpec, entered B,
then C with 25:00, start, pause, B/C state retention and reset. Replay401,
zero external browser requests and zero page errors were asserted. TLS used a
self-signed ephemeral certificate with browser trust bypass. This does not
verify public TLS, ModelScope identity/Secrets ACL, persistent POSIX storage,
physical crash durability, budget continuity or deployment authorization.

Independent reviews: issue57 comments6275595987/6275647695 (Tech Lead),
6275646608 (QA),6275654780 (Gateway). Supervisor decision6275677404.
Exact combined-image cloud CI must be checked separately after publication.

Historical LOCAL REAL PASS remains ONE request at tested code
e4d65ac77e02d41668d260c082dc2788c64b5975; see sibling local-real-20261020.
No new live call was made for this composition. PUBLIC remains BLOCKED.
Do not initialize/reset/migrate real accounting as part of this candidate.
