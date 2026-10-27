#!/usr/bin/env python3
"""Offline unit tests for the Supervisor snapshot; no network or GitHub token required."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".github" / "scripts" / "supervisor_monitor.py"
MAIN_SHA = "bcb6c1a7402ad4b4514feb4865c38d769d7244d1"

os.environ.setdefault("GITHUB_REPOSITORY", "Nanmuxxx/BlockCraft-AI")
os.environ.setdefault("GITHUB_TOKEN", "offline-test-token")
os.environ["COORDINATION_ISSUE"] = "92"

spec = importlib.util.spec_from_file_location("supervisor_monitor", SCRIPT)
monitor = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(monitor)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class SupervisorMonitorTests(unittest.TestCase):
    def setUp(self):
        self.comments = [{
            "id": 77,
            "body": "[REPORT] role: QA\nbase_sha: " + MAIN_SHA,
            "updated_at": "2026-10-27T13:00:00Z",
            "html_url": "https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-77",
        }]
        self.posts = []
        self.prs = [{
            "number": 93,
            "updated_at": "2026-10-27T14:00:00Z",
            "draft": True,
            "head": {"sha": "2c8c7d093ef662e9d3ddccfb56beeaf78eb17b65"},
            "base": {"ref": "main", "sha": MAIN_SHA},
        }]

        def fake_urlopen(request, timeout=20):
            url = request.full_url
            if request.get_method() == "POST":
                payload = json.loads(request.data.decode("utf-8"))
                self.posts.append(payload)
                return FakeResponse({"id": 123})
            if "/issues/92/comments?" in url:
                return FakeResponse(self.comments)
            if "/pulls?state=open" in url:
                return FakeResponse(self.prs)
            if "/commits/main" in url:
                return FakeResponse({"sha": MAIN_SHA})
            raise AssertionError(f"Unexpected API request: {request.get_method()} {url}")

        self.urlopen_patch = mock.patch("urllib.request.urlopen", side_effect=fake_urlopen)
        self.urlopen_patch.start()
        self.addCleanup(self.urlopen_patch.stop)

    def run_monitor(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            monitor.main()
        return output.getvalue()

    def test_posts_current_main_and_dynamic_pr_snapshot_to_issue_92(self):
        output = self.run_monitor()
        self.assertEqual(len(self.posts), 1)
        body = self.posts[0]["body"]
        self.assertIn("Current main SHA: `" + MAIN_SHA + "`", body)
        self.assertIn("Active coordination: [Issue #92]", body)
        self.assertIn("Image-generation milestone: [Issue #91]", body)
        self.assertIn("[#93]", body)
        self.assertIn("[报告]", body)
        self.assertIn("规则监控，非 AI 审查", body)
        self.assertIn("Posted snapshot", output)

    def test_identical_snapshot_is_deduplicated(self):
        self.run_monitor()
        self.assertEqual(len(self.posts), 1)
        self.comments.append({
            "id": 123,
            "body": self.posts[0]["body"],
            "updated_at": "2026-10-27T14:01:00Z",
            "html_url": "https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-123",
        })
        output = self.run_monitor()
        self.assertEqual(len(self.posts), 1)
        self.assertIn("No change since prior report", output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
