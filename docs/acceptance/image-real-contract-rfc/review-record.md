# Actual review and execution record

Mode OFFLINE. No application/model/provider tests executed; acceptance-matrix is NOT_RUN future specification. REAL_PROVIDER=NOT_RUN. Reviews below were real independently delegated roles in this session, not an assertion of standing project member approval. Root alone edited files.

## First pass — REWORK

Exact draft: `32c2fb85fcbdd2821b7d590a989d90422752183e`; base: `bebe6f8e9a14e67752c6898b909ada3fd742e352`.

| Actual reviewer session | Actual verdict | Findings and response |
|---|---|---|
| `/root/image_backend_review` | REWORK | Missing adopt interface; 410 closed error/summary contradiction; restart session revocation has no persistent grant reference; queue bounds absent. Added exact adopt API, closed410, AdmissionGrant/sessionRef, hard capacity caps. |
| `/root/image_workshop_review` | REWORK | Adopt authority missing; remote ACL and local IDB not atomic. Added 30s idempotent authorization with explicit server linearization and localPersistence NOT_ATTESTED, local receipt/recovery and limitations. |
| `/root/independent_qa_review` | REWORK | UNKNOWN proof could be wrapped/imported to bypass no-adopt; missing adopt API and 410 schema. Sign RECONCILED eligibility only after trusted fee evidence; UNKNOWN gets no portable proof; import bypass and expiry/adopt fault cases added. |
| `/root/cost_security_review` | REWORK | Confirmed UNKNOWN import bypass; other currency/nano/cap/freeze/least-privilege semantics sound. Same issuance/eligibility gate revised; no new budget granted. |

Each reviewer reported read-only git SHA/status/diff-scope/whitespace commands exit0 at that exact draft. Backend/Workshop/QA/Cost-Security each checked 11 JSON fences for syntax; QA also independently checked 30 immutable source anchors and canonical request digest. These are documentation checks, never semantic valid-image/proof acceptance. All had a clean worktree on their pinned first-pass reads; no writes, secrets, provider/model calls.

Root first-pass actual command: inline Python parses every fenced JSON, checks 30 git-show source paths/line anchors and all local Markdown targets, checks docs-only diff; exit0, 8 Markdown files, 11 JSON fences, 30 source links at 32c2fb85. `git diff --check`, scoped add, commit and rev-parse all exit0.

## Focused second pass

Revised full commit `fb3cfccae1c9283195bef809eb8ca51f86f59b2d` was actually re-read. Workshop, QA and Cost-Security returned documentation ACK; Backend found one residual SUCCEEDED table sentence still saying content/proof persisted while UNKNOWN has proof null. No Backend ACK was recorded for that revision. A later commit explicitly allows null proof until reconciliation and proof attachment without replacing task/image bytes. First-pass findings remain preserved above.

QA second-pass checker initially failed, exit1, inline line22: `AttributeError: 'NoneType' object has no attribute 'get'`. Its own `b.get('error',{}).get()` incorrectly assumed legitimate error:null was a dict. It corrected the probe with explicit dict/null checking, no repository edit; rerun exit0. This is a known probe defect, not a product failure. QA reported 8 docs-only files, 14 JSON syntax examples, 30 immutable source anchors, local links, signature tuple/eligibility and closed UNKNOWN 410 checks. No actual cryptographic verification/image decoding was performed.

## Final semantic revision — actual ACKs

Contract SHA: **`229ec60af5b6f3c7745b40b9a38c6036bb5ef8a7`**. All four actual reviewers read the new fixed delta and returned the following, independently and read-only:

| Actual session | Actual final verdict | Evidence / bounded conclusion |
|---|---|---|
| `/root/image_backend_review` | **ACK — RFC documentation only** | Original adopt/expiry/session-recovery issues and residual nullable proof wording closed; actual HEAD/status, full delta, allowed8paths, whitespace and14JSON checks exit0. No remaining Backend shared-contract ambiguity. |
| `/root/image_workshop_review` | **ACK — documentation contract only** | Adopt boundary/IDB recovery and eligibility import gate aligned; actual new full diff, SHA/status/path/whitespace checks exit0. |
| `/root/independent_qa_review` | **ACK — final RFC semantics only** | Null proof and late proof attachment consistent; actual HEAD/status, changed paths, full two-file delta and diff-check exit0. Earlier independent14JSON/30anchor checks and failed-probe correction retained above. |
| `/root/cost_security_review` | **ACK — RFC documentation only** | Full delta, whitespace and names checks exit0; no fee/authorization relaxation, UNKNOWN bypass closed. No remaining Cost-Security docs objection. |

These are real newly delegated review roles in this session, not fabricated ACKs or claims that original project members have approved implementation. They grant no paid, secret, budget, merge or deployment authority. No reviewer edited files, ran product scripts or called image providers. RFC ACK != code ACCEPT != REAL acceptance. Final evidence-only publication preserves these ACKs only if the seven other contract/audit document blobs remain identical to this semantic SHA; that equality is separately checked.

## Actual Supervisor verification and publication

- Environment: macOS Darwin25, Git2.50.1 (Apple Git155), Python3.14.7, Node24.22.0. No dependencies installed and no repository executable scripts run.
- Initial fixed draft32c2fb85: `git rev-parse HEAD`, `git status --short` (clean), `git diff --check`, scoped commit, and inline Python docs/source/link audit: exit0; 8Markdown/11JSON/30source anchors.
- Final semantic229ec60: same independent source-link/relative-target/scope audit plus digest/adopt/eligibility/expiry checks: exit0; 8Markdown/14JSON/30source anchors. `git diff --check bebe6f8e9a14e67752c6898b909ada3fd742e352 HEAD` exit0. This checks documentation and illustrative JSON syntax only; invalid placeholder PNG/signature examples are intentionally not accepted as valid artifacts.
- Final full HEAD, final clean status, final diff-check and evidence-only contract-blob equality are reported with the published PR/#92 checkpoint; a document cannot embed its own eventual commit hash. No feature/proposed fault tests were run; they remain NOT_RUN, not mock/REAL test passes.
- Draft [PR100](https://github.com/Nanmuxxx/BlockCraft-AI/pull/100) created and visually verified Draft, targeting #99 head branch, docs-only8files. Published via existing GitHub Desktop identity; no credential/token file read, no direct main push, force update, merge or deployment. Git ls-remote verified original main/#98/#99 unchanged after branch creation.
- On creation PR100 displayed Checks(0). The existing Docker, HTTP Mock and preflight workflow `pull_request.paths` exclude this docs-only directory; inherited baseline successes are linked in source-audit, not attributed to RFC HEAD. No new CI success is invented; final live PR check state is recorded in #92 after publication.

Repeatable audit command (the same checks were actually executed inline; run from RFC worktree):

```sh
python3 - <<'PY_CHECK'
from pathlib import Path
import re,json,subprocess,hashlib
p=Path('docs/acceptance/image-real-contract-rfc'); count=links=examples=0
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
for f in sorted(p.glob('*.md')):
 t=f.read_text();count+=1
 for block in re.findall(r'```json\n(.*?)\n```',t,re.S):
  json.loads(block);examples+=1
 for _,url in re.findall(r'\[([^\]]+)\]\(([^)]+)\)',t):
  if '/blob/' in url:
   m=re.fullmatch(r'https://github.com/Nanmuxxx/BlockCraft-AI/blob/([a-f0-9]{40})/(.+)#L([0-9]+)',url);assert m,url
   txt=subprocess.check_output(['git','show',m[1]+':'+m[2]],text=True);assert 1<=int(m[3])<=len(txt.splitlines());links+=1
  elif not url.startswith(('https://','http://')):assert (f.parent/url.split('#')[0]).exists(),url
paths=subprocess.check_output(['git','diff','--name-only','bebe6f8e9a14e67752c6898b909ada3fd742e352',sha],text=True).splitlines()
assert len(paths)==8 and all(x.startswith(str(p)+'/') for x in paths)
w=(p/'real-wire-contract.md').read_text();pr=(p/'portable-provenance.md').read_text()
assert hashlib.sha256(b'["image-generation.real/2","project_demo","A blue square"]').hexdigest() in w
assert 'attestation:null' in w and 'adoptionEligibility' in pr and '"RECONCILED"]' in pr
assert 'POST {prefix}/jobs/{jobId}/adoptions' in w and 'localPersistence' in w and 'summary' in w
print(sha,count,examples,links,'PASS OFFLINE; feature tests NOT_RUN')
PY_CHECK
git diff --check bebe6f8e9a14e67752c6898b909ada3fd742e352 HEAD
git status --short
```

Final status: **BLOCKED for REAL infrastructure/activation**, docs ready for project review. B1/B2 deployment+project ACL and image accounting infrastructure absent/NOT_VERIFIED; B3 price/model/upper-bound/explicit spend and secret approvals missing; B4 trust/signing/migration implementation NOT_IMPLEMENTED; B5 no implementation at an independently accepted SHA. Single next owner/action: **Image-Backend documents the real server project registry/ACL and deployment authority facts in #92**, coordinating the deployment owner. This does not authorize building/activating a provider. Rollback is leave Draft unmerged or reviewed docs-only revert; no data conversion occurred. `approval_needed=NONE` for delivered RFC.
