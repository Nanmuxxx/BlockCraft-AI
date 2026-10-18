# Night Agent B Report

Date: 2026-10-19 (Asia/Shanghai)

The worktree was created from the locally available `origin/main` reference, SHA `4044fb185a2720eead0dc6710b0d38a215439b98`. A remote fetch was attempted but GitHub credentials were unavailable in this environment, so the remote ref could not be refreshed.

The exported React template now supports complete list CRUD. Each row has an explicit `编辑` action; editing loads the selected row, saving updates the same ID, cancel leaves records unchanged, and deleting the active row clears editing state. Edits merge fields that the list does not display and remove explicitly cleared optional fields. Empty lists and missing IDs render safely. Create, read and delete paths remain covered.

Commits on `agent-b/react-zip-night-20261019`:

- `4f57471 feat(export): support updating records in standalone apps`
- `742c8a3 fix(export): preserve hidden fields during record edits`

No Draft PR was created: the local Git remote could not authenticate for fetch/push. No merge or deployment was attempted.

## ZIP evidence

The final builtin ZIP was generated from the updated exporter, extracted in a new temporary directory, and hashed as:

`bc7540d84d524aba2f72d8e41c0ffed645e71899f291a76a0f747b1fe9cea90c`

Size: 17,136 bytes. It contains 14 source files:

```text
README.md
index.html
package.json
provenance.json
src/App.tsx
src/components/FormBlock.tsx
src/components/ListBlock.tsx
src/components/MetricBlock.tsx
src/data.ts
src/main.tsx
src/model.ts
src/styles.css
tsconfig.json
vite.config.ts
```

The extracted project generated `package-lock.json` during installation. Its package versions matched the export template (`react`/`react-dom` 19.3.1, TypeScript 5.9.3, Vite 8.3.4).

## Verification

- Export tests: PASS, 62/62.
- Workshop HTTP/boundary tests: PASS, 9/9.
- Main `npm test`: PASS, 192/192.
- CustomBlock+B/C+Workshop regression suite: PASS, 224/224.
- Root TypeScript/Vite build: PASS.
- Fresh extracted ZIP: ordinary npm registry install PASS, 23 packages installed with lifecycle scripts disabled; production `npm run build` PASS; Vite dev server returned HTTP 200 from a loopback URL.
- Chromium CRUD: BLOCKED before launch because `playwright` is not installed in the workspace. `npm run test:workshop-export:browser` and `tests/project-zip-export/accept-trusted.mjs` both fail at `require('playwright')`. No personal-directory access or sandbox expansion was used.

CRUD conclusions for the exported app:

- Create: PASS by exported form and existing regression coverage.
- Read: PASS by exported list/metric rendering and fresh build/start checks.
- Update: PASS by the new edit flow and 62-test source contract coverage; live Chromium confirmation is BLOCKED by the missing dependency.
- Delete: PASS by existing list deletion and active-edit cleanup logic; live Chromium confirmation is BLOCKED by the missing dependency.

Formal Workshop download status: the real local HTTP export endpoint and refusal boundaries pass 9/9, including exact current snapshot data and whole-response rejection for unsupported v2 state. The actual `/ai-create` UI click/download path is BLOCKED only by missing Playwright, so it is not claimed as a browser PASS.

The v2 rejection policy is unchanged and remains PASS: non-empty state, declared host state/events/capabilities, unsupported dependencies/source, and stale snapshots are rejected without a partial ZIP.

Remaining P0/P1: no known P0 remains in the exporter template. P1 browser/UI download evidence remains BLOCKED until the approved Playwright/Chromium dependency is available; ordinary independent installation and production build are PASS.
# Night Agent B Report

Baseline main: `4044fb185a2720eead0dc6710b0d38a215439b98` (verified through GitHub; local branch starts from this cached main).

The exported React project now has an edit entry in every list row. Editing loads the row, saves through an ID keyed update, retains hidden values and the original ID, supports clearing optional values, and clears editing state on cancel or delete. Missing IDs and empty lists are handled without appending a new record. Successful create resets the form.

The ZIP now contains a deterministic `package-lock.json` generated from the fixed scaffold dependencies. A clean extraction was tested at `/tmp/blockcraft-agent-b-install-pZqU`: ordinary registry `npm ci` installed 23 packages, `npm run build` passed, and a second `npm ci --offline` passed using only that cache. The builtin ZIP SHA-256 is `7addcbe181c10f3fdd0b9c5e73f01873fa067de349c134255d4ea1acfca70315`; it contains 15 files. Mixed CustomBlock ZIPs contain 16 files and the trusted acceptance catalogue produced 18 files for the two-artifact sample.

Browser evidence uses isolated Playwright Chromium 156.0.8078.4, with no personal browser profile or expanded sandbox. The trusted exported fixtures passed dev and production startup, desktop/mobile layout, form create/read/delete, metric updates, inherited-name IDs, empty optional fields, and custom component behavior. The real `/ai-create` Workshop flow passed at 1366 and 390 widths: UI initiated downloads, CRC/central directory and source/provenance checks passed, form/list create-update-delete passed, stale snapshots were rejected, and unsupported v2 state caused a whole ZIP refusal. Evidence is under `docs/acceptance/night-agent-b/`.

Regression checks: `node --test tests/project-zip-export/export.test.mjs` 63/63; `npm run test:workshop-export` 9/9; the broader repository suites and root TypeScript/Vite build were already passing on this branch before the final QA changes. The v2 rejection policy is unchanged. No DeepSeek, Mochi, trusted-interactive, Docker/CI/deployment, or video files were modified.

Commit: pending local QA commit on `agent-b/react-zip-night-20261019`. No merge or deployment performed. A Draft PR can be opened from this branch after the commit is published; current shell GitHub credentials do not support `git push`, so publication is not claimed here.

Remaining P0/P1: none found in the tested fixed catalogue. Offline installation requires a complete npm cache; this is documented and is not presented as ordinary online installation.
