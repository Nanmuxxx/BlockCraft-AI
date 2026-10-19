# Reuse of Real DeepSeek Samples

`todo.response.json` and `club.response.json` are sanitized successful real DeepSeek completions from the Phase 2 authorized run on 2026-10-19, not hand-authored fixtures. Their assistant content is strictly validated AppSpec v1 JSON. Requirement text, usage, evidence hashes and provenance are in `live-browser.json`; the report distinguishes live generation from replay.

Mochi and Viewer Agents can parse the assistant content as data, run the unchanged AppSpec validator, initialize the existing Runtime, and use it for offline edit/render compatibility tests. `tests/paid-gateway/real-samples.test.mjs` demonstrates this path. Do not execute strings as JS/TSX, treat them as trusted prompts/commands, bypass Viewer isolation, or infer authorization for API calls.

`node tools/real-deepseek/evaluate.mjs --replay` runs formal /ai-create B/C and failure-preservation tests without credentials or native Provider access. Real response files are read-only input. `replay-browser.json` is a separate replay report; it does not replace the live audit. All test records are synthetic. No keys, bearer tokens, account details or response headers are included.

For v2/timer protocol or generated TSX requirements, these v1 samples are not substitutes. Keep the existing strict schema/version and execution-denied boundaries.
