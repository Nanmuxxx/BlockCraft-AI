# Night Agent B Frozen Candidate

Date: 2026-10-19 (Asia/Shanghai). Candidate GO; feature development frozen; independent QA pending. This report replaces the earlier duplicated and overstated summary.

## Integrity and Publication

Remote main: `4044fb185a2720eead0dc6710b0d38a215439b98`, verified through GitHub. Four original local commits form a continuous chain from main; diff whitespace check passes; tracked files are clean. Original local HEAD: `c9ccb4226dcfad7085f2914fb12d7932a12c39fb`; tree: `6a206aaca65e91dc57cd795b29ef1bc8381532e3`. The untracked development node_modules symlink is excluded.

HTTPS and SSH Git authentication fail. Publication uses the connected GitHub Git-object API: every blob and each of the four trees matches its local SHA exactly. API-generated commit metadata changes commit SHAs:

| Original Local Commit | Published Commit |
|---|---|
| `4f57471574a207490bec40b0f49b34b39d7c80a4` | `acb8c8d3f2a1f0e2947bd81876aa2c5e2b6f8ae3` |
| `742c8a324d3e7aec5fa7ee6b4022bd0d53683794` | `a5b09e1e98993b7e93cfbc77e3a1a00c5d7cabf1` |
| `b905e81d92aa6e7b6a4c0fa697d4b4719c1c9c37` | `33793fe9a8600053dc5b91dabf5419ab9357cbc9` |
| `c9ccb4226dcfad7085f2914fb12d7932a12c39fb` | `3e522c429ef9053d50a096079562bad440697081` |

Remote branch agent-b/react-zip-night-20261019 was checked absent before creation. No force push, merge, deployment or main update occurred. A subsequent handoff commit changes documentation and preserves existing evidence only.

## Update and Compatibility

Lists expose Edit and load the selected record. Saving maps the existing array by ID rather than appending, retains the original ID and hidden fields, and removes explicitly cleared optional fields. Cancel does not write. Deleting the active row clears editing state. Empty lists render an empty message; unknown IDs cannot create records, and missing edit/save targets produce an error. Successful Create clears its form.

No AppSpec/record schema migration was added. Existing v1 snapshots retain IDs, values and render order; hidden required values survive list edits. Only configured list fields are editable. Text/number/boolean/date/select use their corresponding inputs and value types. Data remains in memory; reload restores the exported snapshot, as documented. Unsupported v2 exports still reject the whole ZIP.

## ZIP and Installation

Preserved artifact: `docs/acceptance/night-agent-b/standalone/builtin.zip`.
SHA-256: `7addcbe181c10f3fdd0b9c5e73f01873fa067de349c134255d4ea1acfca70315`.
Size: 39,112 bytes; system `unzip -t` passes all entries. Lockfile v3 is included; dependencies are not bundled.

Exact 15-file manifest:

```text
README.md
index.html
package-lock.json
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

Pins: React/React DOM 19.3.1, React types 19.3.0, TypeScript 5.9.3, Vite 8.3.4; Node >=22.16.0.

Clean extraction: /tmp/blockcraft-agent-b-install-pZqU/app, with a fresh cache. Online command: `npm ci --ignore-scripts --no-audit --no-fund --userconfig /dev/null --globalconfig /tmp/blockcraft-agent-b-install-pZqU/global.npmrc --registry https://registry.npmjs.org --cache /tmp/blockcraft-agent-b-install-pZqU/cache`. Result: 23 packages in 6 seconds. `npm run build` passed TypeScript and Vite. Then `npm ci --offline --ignore-scripts --no-audit --no-fund --userconfig /dev/null --globalconfig /tmp/blockcraft-agent-b-install-pZqU/global.npmrc --cache /tmp/blockcraft-agent-b-install-pZqU/cache` installed 23 packages from that cache in 265ms.

Logs are preserved alongside the ZIP. Online and cached-offline checks are distinct and use no repository node_modules. Lifecycle scripts were disabled: an exact unflagged README npm ci run is not claimed. Offline installation requires a complete cache, which is not in the ZIP.

## Browser Evidence and Limits

Chromium 156.0.8078.4 used isolated temporary storage, without a personal profile or sandbox expansion.

`docs/acceptance/night-agent-b/workshop/browser-report.json` and screenshots cover actual /ai-create at 1366 and 390 widths: UI-initiated builtin/custom ZIP downloads, CRC/central-directory, exact snapshot/revision/props/source/provenance checks, Workshop Create/Read/Update/Delete, stale download rejection and unsupported state refusal PASS. Ordinary-dev/production endpoint disablement PASS. This is the local-export route with fixed intercepted generation responses, not deployed-site acceptance or a real DeepSeek call. Font requests emitted Vite allow-list warnings because development dependencies are symlinked; filesystem permissions were not broadened.

`docs/acceptance/night-agent-b/standalone/trusted-browser-report.json` records three fixed developer fixtures building and starting in dev and production. Runtime interactions occur at 650px; 1366px screenshots then verify layout. Create/Read/Delete, metrics and custom component behavior PASS. Representative production screenshots are preserved. Sample ZIP hashes differ from the plain builtin artifact because fixtures add boundary records/blocks or custom components.

Correction: the standalone browser script does not exercise Update, cancel, delete-active-edit, invalid-ID UI, reload or startup-failure handling. Those, plus a full 390px standalone CRUD run, remain for Agent C. Workshop Update is not a substitute for standalone Update acceptance. The generated update function is behavior-tested for preserved ID/hidden fields, optional clearing, unchanged other rows, no mutation, empty lists, invalid IDs and prototype-name fields.

## Checks and QA Handoff

- Export unit tests: 63/63 PASS.
- Workshop HTTP/boundary tests: 9/9 PASS.
- Root tests: 192/192 PASS; root TypeScript/Vite build PASS.
- Earlier CustomBlock/B/C/Workshop regression run: 224/224 PASS.
- ZIP determinism/path/size/CRC safety and unchanged refusal policy: covered by export tests.
- Standalone Create/Read/Delete: browser PASS. Update: implementation/unit PASS, standalone browser PENDING.
- Full P3 edge cases and exact unflagged README install: PENDING independent QA.

Only exporter/templates, export tests, docs and evidence are published. DeepSeek, Mochi, trusted-interactive, Docker/CI/deployment and videos are untouched. No confirmed P0 implementation defect is asserted; full GO requires Agent C acceptance. Final Draft PR and remotely fetchable handoff SHA are supplied in the chat after publication.
