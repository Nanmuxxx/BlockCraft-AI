#!/usr/bin/env python3
"""Rules-based learning-edition coordination snapshot; the ONLY write is a comment to Issue #92."""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = "https://api.github.com"
REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GITHUB_TOKEN"]
ISSUE = int(os.environ.get("COORDINATION_ISSUE", "92"))
ROLES = ("Supervisor", "Image-Backend", "Image-Workshop", "Cost-Security", "QA", "Team-Agent")
MARK = "<!-- supervisor-monitor:"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

def api(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(API + path, data=data, headers=HEADERS,
                                     method="POST" if payload is not None else "GET")
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)

def pages(path, limit=4):
    out = []
    for page in range(1, limit + 1):
        joiner = "&" if "?" in path else "?"
        batch = api(f"{path}{joiner}per_page=100&page={page}")
        out.extend(batch)
        if len(batch) < 100:
            break
    return out

def main():
    issue_path = f"/repos/{REPO}/issues/{ISSUE}"
    comments = pages(issue_path + "/comments")
    prs = pages(f"/repos/{REPO}/pulls?state=open")
    main_commit = api(f"/repos/{REPO}/commits/main")
    main_sha = main_commit["sha"]

    # Monitor the latest 20 open PRs dynamically rather than a stale hard-coded list.
    selected = sorted(prs, key=lambda p: (p.get("updated_at", ""), p["number"]), reverse=True)[:20]
    last_reports = {}
    for c in comments:
        body = c.get("body") or ""
        if not body.startswith("[REPORT]"):
            continue
        for role in ROLES:
            if f"role: {role}" in body:
                last_reports[role] = c
                break

    snapshot = {
        "main_sha": main_sha,
        "coordination_issue": ISSUE,
        "prs": [{
            "n": p["number"],
            "head_sha": p["head"]["sha"],
            "base_ref": p["base"]["ref"],
            "base_sha": p["base"]["sha"],
            "draft": p["draft"],
            "updated": p["updated_at"],
        } for p in selected],
        "reports": {
            role: {
                "id": c["id"],
                "updated": c["updated_at"],
                "body_sha256": hashlib.sha256((c.get("body") or "").encode()).hexdigest(),
            }
            for role, c in sorted(last_reports.items())
        },
    }
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()[:16]
    if any(MARK + digest + " -->" in (c.get("body") or "") for c in comments):
        print("No change since prior report; no comment posted.")
        return

    lines = [
        MARK + digest + " -->",
        "## 自动协调快照（规则监控，非 AI 审查）",
        f"UTC: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        f"Current main SHA: `{main_sha}`",
        f"Active coordination: [Issue #{ISSUE}](https://github.com/{REPO}/issues/{ISSUE})",
        f"Image-generation milestone: [Issue #91](https://github.com/{REPO}/issues/91)",
        "",
        "| Open PR | Target | State | HEAD SHA | Updated (UTC) |",
        "|---|---|---|---|---|",
    ]
    for p in selected:
        state = "Draft" if p["draft"] else "Open"
        lines.append(
            f"| [#{p['number']}](https://github.com/{REPO}/pull/{p['number']}) "
            f"| {p['base']['ref']} (`{p['base']['sha'][:12]}`) "
            f"| {state} | `{p['head']['sha'][:12]}` | {p['updated_at']} |"
        )
    lines += ["", "**最近的 Agent 报告**"]
    for role in ROLES:
        item = last_reports.get(role)
        lines.append(f"- {role}: " + (f"[报告]({item['html_url']})" if item else "尚无符合格式的报告"))
    lines += [
        "",
        "**自动化边界**：此工作流只读取 GitHub 并发布状态快照；不执行 AI 审查，不会唤醒外部 Codex Agent，不会合并、部署、调用付费模型或修改密钥/预算。",
        "**图片生成状态**：真实供应商、价格、付费测试及生产放量须按 Issue #91 的阶段门槛执行；Mock/离线通过不代表真实模型通过。",
        "**基线纪律**：所有 Agent 报告都必须提供完整 base/head SHA、可复核证据和明确的 OFFLINE/MOCK/REAL 测试类型。静默的 Agent 视为 UNREPORTED。",
    ]
    body = "\n".join(lines)
    api(issue_path + "/comments", {"body": body})
    print(f"Posted snapshot {digest}; reports {len(last_reports)}/{len(ROLES)}; open PRs monitored {len(selected)}")

if __name__ == "__main__":
    try:
        main()
    except (urllib.error.URLError, ValueError, KeyError) as exc:
        print(f"Monitor failed closed: {exc}", file=sys.stderr)
        sys.exit(1)
