# B / C layout order MVP

Baseline: `origin/main` at `4a95cae` (2026-10-21). This PR is independent of the Mochi field-planning PR.

## Behavior

- A completed B-mode drag, stack move, detach or arrange persists the resolved canvas coordinates and `CustomProject.renderOrder` in the existing atomic layout transaction.
- Reading order is ascending Y, then ascending X. Exact ties keep the previous order. Missing legacy coordinates use the center until a layout is committed.
- The production C-mode viewer already consumes `renderOrder`, so it immediately reflects the saved B-mode order.
- The complete resolved scene is saved after a gesture. This matters on narrow screens, where collision recovery can visually reflow otherwise overlapping saved coordinates. Resize alone does not change project state.
- Field and record changes retain order. Revision checks, read-only checks, custom state, schema and records keep their existing ownership and validation.
- Persistence means the existing v2 project snapshot / JSON serialization, including project export. This does not add browser storage: the application's existing refresh-clears-page behavior is unchanged.

## Independent verification

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:layout-order
npm run build
NODE_PATH=/path/to/playwright/node_modules npm run test:layout-order:browser
```

Verified 2026-10-21: 205 existing regression tests, 33 layout/adapter tests, production build, and real Chromium pointer drags at 1366px and 390px. The browser test checks C headings, a single revision, B/C switching and a JSON parse round trip. Mixed builtin/custom movement, stable ties, stale writes, invalid positions and read-only rejection are covered in the independent unit suite.

Browser evidence is generated under `.cache/layout-order/` (ignored by Git). Test setup initially imported a nonexistent stylesheet; it now uses `src/styles.css`. Initial pointer selection needed to settle before dragging, and a narrow-screen collision correctly rejected an occupied drop. The passing test uses a free destination and validates the saved resolved scene.

Troubleshooting reference: [Playwright mouse input and dragging](https://playwright.dev/docs/input). Missing TypeScript in an empty dependency directory was fixed by the lockfile-based install above, following [Node module resolution](https://nodejs.org/api/modules.html). Node v24.22.0 / npm 11.19.1; no secrets or paid calls used by this PR's tests.
