#!/usr/bin/env python3
"""Read-only GitHub coordination monitor; the ONLY write is a comment to the coordination Issue."""
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
ISSUE = int(os.environ.get("COORDINATION_ISSUE", "57"))
WATCH = (44, 54, 55, 56)
ROLES = ("AI-Core", "Gateway", "QA", "Docker", "Workshop", "BP", "Video")
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
    selected = sorted((p for p in prs if p["number"] in WATCH), key=lambda p: p["number"])
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
        "prs": [{"n":p["number"],"sha":p["head"]["sha"],"draft":p["draft"],
                  "state":p["state"],"updated":p["updated_at"]} for p in selected],
        "reports": {role: {"id":c["id"], "updated":c["updated_at"]}
                    for role,c in sorted(last_reports.items())},
    }
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()[:16]
    if any(MARK + digest + " -->" in (c.get("body") or "") for c in comments):
        print("No change since prior report; no comment posted.")
        return
    lines = [MARK + digest + " -->",
             "## 自动协调快照（规则监控，非 AI 审查）",
             f"UTC: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
             "",
             "| PR | 状态 | HEAD |",
             "|---|---|---|"]
    lines.extend(f"| #{p['number']} | {'Draft' if p['draft'] else 'Open'} | `{p['head']['sha'][:12]}` |" for p in selected)
    lines += ["", "**最近的 Agent 报告**"]
    for role in ROLES:
        item = last_reports.get(role)
        lines.append(f"- {role}: " + (f"[报告]({item['html_url']})" if item else "尚无符合格式的报告"))
    lines += ["", "**自动化权限**：仅监测并发布摘要；不合并、不部署、不调用付费 AI、不批准高风险操作。",
              "**真实 AI 生产状态**：NO-GO，直到可信身份、预算持久化、启动接线及独立 E2E 验收。", 
              "本机器人未实际唤醒任何外部 Codex Agent。每个 Agent 仍需配置自己的汇报/轮询机制。"]
    body = "\n".join(lines)
    api(issue_path + "/comments", {"body":body})
    print(f"Posted snapshot {digest}; reports {len(last_reports)}/{len(ROLES)}")

if __name__ == "__main__":
    try:
        main()
    except (urllib.error.URLError, ValueError, KeyError) as exc:
        print(f"Monitor failed closed: {exc}", file=sys.stderr)
        sys.exit(1)
