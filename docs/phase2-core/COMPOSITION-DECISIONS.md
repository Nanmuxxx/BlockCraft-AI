# main + #42 + #44 composition decisions

Status: BLOCKED. No merge/deploy approval. REAL_MODEL_CALLS=0 for this Core task.

## Source versions and single writer

- main: b56a26a9803718d806bac3ddbd7fbe19e0c495c6.
- #42: 764f2dd023d3e3ca54af755f6291e142e0ccb915.
- #44 original: da212774b7022f95c036b1167ae2d204f65080bc.
- #44 model-contract follow-up: 8ddac045125506f7129593b9d07fb0d50f9d72d3.
- #44 audit-boundary follow-up: 032ffa19adcdc20b066e0d5fcee70136f4492119 (owner local 0ec82cf07a16f6a9e0ed9124e7133b4ace51d2e8).
- #40 remains historical, never an additional integration input.
- server/index.mjs single writer: existing security/entry owner (thread 01a1501f-b28a-7e63-8558-744b4866cfaa). Core composes their patch, does not independently author entry changes. Docker files remain deployment-owner scope; QA owns its independent tests/evidence.

Formal gateway source, not merely prose, was read at the original #44 SHA. FORMAL-SECURITY-SOURCE.json records all eight blobs checked against the initial candidate. Original entry conflict and exact owner patch are retained. Entry composition preserves main/#35 static routes, PublicOrigin and production listening and #42 disconnect/admission cancellation/finally cleanup. Its exact resulting blob is 8e2e04d764c53aae217875b593a22f3c90c4e67c. No full-file ours/theirs conflict overwrite.

## Provider and configuration boundaries

No parallel gateway or Runtime was introduced. Entry generation and Mochi share injected apiKey/model/fetchImpl. Separate CustomBlock use requires explicit allowPaid. CLI and ordinary server startup do not enable a paid transport. Browser requests cannot provide generationAccess, transport functions, credentials or ledger paths.

Paid composition requires an explicit exact PRICING.model plus the same branded createPaidTransport and canonical shared ledger for all consumers. Historical/offline defaults remain deepseek-v4-flash. The gateway rejects legacy names before network/reservation, without silent alias conversion. Owner patch OWNER-MODEL-CONTRACT.patch adds only deepseek-flash to CustomBlock construction; it neither activates CustomBlock nor executes its generated source. Local code commit a8ba5062066bb2bfae354337233ddecda554ab01 retains Core cancellation code and makes only that single production-line change after 6319729.

requireControlledEgress rejects captured native fetch, but arbitrary injected server functions are trusted code and may bypass it. Thus guards are not a malicious-server-code sandbox. Endpoint access is checked separately; branding is provenance, not authorization. Tests inject mock functions deliberately. A deployment must use the exact audited gateway instance and proper session identity; local bearer/loopback access is not multi-user production authentication.

## Tests and unresolved boundaries

Offline gateway-composition covers authenticated v1/v2, anonymous zero egress/reservation, durable six-call exhaustion, strict validation, model mismatch and Mochi advice. Owner model-contract covers all three consumers sharing one audited ceiling; synthetic CustomBlock source remains inert. Existing protocol, abort/late response, owner/revision/CAS, #36 and #41 suites are retained.

Independent QA completed browser generation, B/C, cancel/late responses, chat, trusted offline timer, ZIP and standalone CRUD on 6319729. Formal Mochi mutation remains disabled; modification evidence is Fixture Host only. New provider allowlist requires targeted QA mapping. #44 real-response replay means recorded response reuse, not new real calls by Core/QA.

Independent QA additionally reproduced two gateway defects against original source: unbounded onResponse audit wait, and upstream model echo forwarding a fake key sentinel to the audit callback. These are synthetic reproductions, not evidence of a real secret leak. The security owner delivered local commit 0ec82cf with OWNER-AUDIT-BOUNDARY.patch and four independent tests. Core applied the exact patch in code commit 2d6f8ce2c282803e9f39270252e8395d3b6e77cb: approved fixed model metadata, shared audit timeout/signal and late-result rejection. Forty relevant Core tests pass; independent QA re-execution remains required. The historical failing QA logs remain intact.

Docker context whitelist and both COPY stages omit ai-abort and paid-gateway closure. Static audit exit1 is retained; no container success is claimed. Deployment-owner handoff is SERVER-PACKAGING-HANDOFF.md and was routed to Tech Lead. Independent final QA and Docker acceptance are required before changing BLOCKED.

## Final #45 + #46 freeze

Docker owner PR #46 exact 278b13008fcbd90eb874e067ca3ffc1b33fef664 merged without conflict in 9d7e31b45ce69fe33e5a9264f170796aac54ed8f. Dockerfile, .dockerignore and Docker Acceptance workflow are byte-identical to owner source. No direct Docker edits. The old COPY-only auditor exits2 for curated runtime-server staging; this is an auditor limitation, not a remaining proven missing-file failure or container PASS.

Final local production freeze: 47a0c45bc95834d575a07e986b0b3987a9accff7. Owner f21a1249aa7cf4813291333d351039906112bdfd delivered contextual default-model patch and explicitly verified COMPOSED-DEFAULT-ENTRY.patch. An initial zero-context draft had positional drift against Core; diff review caught and corrected it before code execution/commit. The draft is replaced by the owner's contextual delivery in OWNER-DEFAULT-MODEL.patch; use that file, not old positional instructions. Actual entry blob bdab61b76c92fa775c286edeb39e70b88467fdda. No admission/abort/static hunk changed.

Model sources in precedence order: explicit constructor model; entry/Mochi DEEPSEEK_MODEL when present; otherwise defaultModelForTransport(fetchImpl). CustomBlock intentionally has no environment read. Exact branded gateway defaults PRICING.model (deepseek-flash); other adapters retain deepseek-v4-flash. CustomBlock constructor allows deepseek-flash/deepseek-v4-flash/deepseek-chat; the paid gateway only accepts the exact priced model, rejects all legacy/invalid names before reserve/network. No alias rewriting, new authorization, cap/expiry changes or native egress. Final regression812 and build exit0; gateway43 exit0. Independent QA and exact combination Docker CI remain mandatory.

#42 scope already included: strict v1/v2 validation, generation ingress/abort/late response, Generated Artifact installer/storage, CustomBlock source validation/adapters, Runtime owner/revision/CAS, Mochi lifecycle/context/plans and B/C fixtures/tests. Existing formal arbitrary-TSX execution and formal Mochi source modification remain unclaimed. #44 scope included: access/egress/pricing/ledger/provider, three provider native guards, branded provenance, money/security tests, model-contract and audit remediations. Its live evaluator, private ledger/credentials and historical live evidence runner are deliberately excluded. Do not additionally merge #42/#44 as independent shared-entry inputs after accepting this candidate; review their corresponding extracted scope through #45. #40 is historical only.
