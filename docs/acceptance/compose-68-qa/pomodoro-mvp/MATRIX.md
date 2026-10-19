# Pomodoro MVP QA matrix — Mock-only

| Area | Evidence | Result | Classification |
|---|---|---:|---|
| Natural-language request -> trusted `/api/ai/generate` envelope | `interactive-browser-results.json`, `tests/trusted-interactive/browser.cjs` | PASS, 2 viewports | Mock provider fixture; real local HTTP route |
| Auth/admission and idempotency boundary | `tests/generation/principal-entry.test.mjs`, `principal-gateway-http.test.mjs` | 14/14 PASS | Mock transport; synthetic session; no paid call |
| AppSpec v2 pomodoro schema | `src/model/appSpec.test.cjs`, trusted-interactive tests | PASS | offline deterministic |
| Entity/field/block binding | `interactive-*-b.png`; inspector tests | PASS; no data binding, CRUD editor absent | Mock fixture |
| B mode select/configure | `browser/b-*.png`, `interactive-*-b.png` | PASS at 1440x900 and 390x844 | Mock fixture |
| C start / countdown | `browser/c-running-*.png`, interactive C screenshots | PASS; starts below 25:00 | Mock fixture |
| Pause stability | browser scripts | PASS after 1.1s wait | Mock fixture |
| Reset | browser scripts | PASS to `25:00` / 1500s | Mock fixture |
| B/C round trip state anchor | interactive browser + race traces | PASS | Mock fixture |
| Invalid schema / provider failure | trusted server tests + browser | PASS; owner snapshot retained | Mock provider |
| Timeout / disconnect / budget exhaustion | principal-gateway-http 14-case subset | PASS; 504/uncertain, 503, zero egress as asserted | Mock transport |
| ZIP | trusted tests/browser | PASS refusal: `暂不支持 React ZIP 导出` | Pomodoro capability says unsupported |
| External network | browser request guards | PASS; zero non-loopback requests | local-only |
| Live DeepSeek | none authorized | UNVERIFIED | no key / no paid API |
