#!/usr/bin/env python3
"""Read-only GitHub coordination monitor; the ONLY write is a comment to the coordination Issue."""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = "https://api.github.com"
REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GITHUB_TOKEN"]
ISSUE = int(os.environ.get("COORDINATION_ISSUE", "57"))
WATCH = (44, 54, 55, 56, 59, 60, 61, 62, 63, 64)
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
            return out
    raise ValueError("Pagination bound reached; refusing incomplete coordination snapshot")

def review_requests(comments):
    """Track explicit review requests; recorded ACK is not proof of delivery or approval."""
    requests = []
    for comment in sorted(comments, key=lambda c: c["id"]):
        body = comment.get("body") or ""
        match = re.match(r"^\[REVIEW REQUEST\]\s*\[PR #(\d+)\]", body)
        if not match:
            continue
        request_id = comment["id"]
        pr = int(match[1])
        url = comment["html_url"]
        acknowledgements = []
        for reply in comments:
            if reply["id"] <= request_id:
                continue
            text = reply.get("body") or ""
            if not re.match(rf"^\[ACK\]\s*\[PR #{pr}\](?=\s|$)", text):
                continue
            # Exact reference prevents an old/sibling PR request being silently consumed.
            references = re.findall(r"https://github\.com/[\w.-]+/[\w.-]+/issues/\d+#issuecomment-\d+", text)
            ids = re.findall(r"(?m)^request_id:\s*(\d+)\s*$", text)
            if url in references or str(request_id) in ids:
                acknowledgements.append(reply["id"])
        requests.append({"request_id": request_id, "pr": pr, "url": url,
                         "updated": comment.get("updated_at"),
                         "status": "ACK_RECORDED" if acknowledgements else "PENDING_ACK",
                         "ack_ids": sorted(acknowledgements)})
    return requests

def main():
    issue_path = f"/repos/{REPO}/issues/{ISSUE}"
    comments = pages(issue_path + "/comments")
    requests = review_requests(comments)
    prs = pages(f"/repos/{REPO}/pulls?state=open")
    tracked = set(WATCH) | {r["pr"] for r in requests}
    selected = sorted((p for p in prs if p["number"] in tracked), key=lambda p: p["number"])
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
        "review_requests": requests,
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
    lines += ["", "**审核请求追踪（评论记录，不证明接收/执行/批准）**"]
    for request in requests:
        lines.append(f"- PR #{request['pr']}: [{request['request_id']}]({request['url']}) "
                     f"{request['status']}; ACK comment IDs: {request['ack_ids']}")
    if not requests:
        lines.append("- 未发现标准格式 [REVIEW REQUEST][PR #N]；非标准报告仍须 Supervisor 人工/AI 读取。")
    lines += ["", "PENDING_ACK 必须由已获授权的 Supervisor 接单并通过实际聊天工具派发；本脚本不自动 ACK。",
              "ACK_RECORDED 仅表示引用该请求的 standalone ACK 已记录，不能证明 Tech Lead 已接单。",
              "**自动化权限**：仅监测并发布摘要；不合并、不部署、不调用付费 AI、不批准高风险操作。",
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
