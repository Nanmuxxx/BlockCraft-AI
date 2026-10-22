# Studio legacy history continuity

The Oct 21 bootstrap used a temporary primary ledger. The persisted, signed outer attempt and response remain authoritative evidence of one historical request. The migration accepts only the exact Oct 21 marker, signed attempt 1 / response 1, response 200, non-overlap with known local samples, an empty validated historical scope, and exact continuous receipt filenames. Any inconsistency keeps paid calls disabled.

The one request is counted permanently as a conservative debt of 212,992,000 nano-CNY (the original bounded transport ceiling), without fabricating token usage or altering historical receipts or primary entries. The signed budget manifest and ledger checkpoint bind the original evidence bytes by SHA-256. Restart requires the same evidence and does not replenish the cumulative 100-call / CNY 5 authorization.

Expected existing deployment seed: 73 settled primary entries + 1 historical conservative debt + 8 known local calls = 82 calls. No real AI calls were made for this repair.

Main integration validation as of 2026-10-23: 36 focused tests passed, including quote-refresh and main compatibility checks; all 110 test files / 1568 tests passed with zero failures, skips or cancellations using Node --experimental-transform-types. The 37 server tests and frontend build passed. The HTTP quote-refresh fixture preserves all cumulative ledger and receipt bytes through refresh failures and recovery. Cloud receipt verification and functional acceptance remain required before declaring deployment success; the parent deployment agent owns that acceptance.
