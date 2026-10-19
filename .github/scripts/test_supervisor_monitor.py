"""Offline regressions for request intake and snapshot deduplication. No network/token."""
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

with patch.dict(os.environ, {"GITHUB_REPOSITORY": "test/repo", "GITHUB_TOKEN": "synthetic-only"}):
    spec = importlib.util.spec_from_file_location("monitor", Path(__file__).with_name("supervisor_monitor.py"))
    monitor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(monitor)

def comment(identifier, body):
    return {"id": identifier, "body": body, "updated_at": "2026-10-19T15:00:00Z",
            "html_url": f"https://github.com/test/repo/issues/57#issuecomment-{identifier}"}

class ReviewIntake(unittest.TestCase):
    def test_request_without_report_or_pr_change_is_visible_and_deduped(self):
        comments = []
        posted = []
        def api(path, payload=None):
            self.assertEqual(path, "/repos/test/repo/issues/57/comments")
            self.assertIsNotNone(payload)
            posted.append(payload["body"])
            comments.append(comment(100 + len(posted), payload["body"]))
        def pages(path):
            return comments if "/issues/" in path else []
        with patch.object(monitor, "api", api), patch.object(monitor, "pages", pages):
            monitor.main()
            comments.append(comment(200, "[REVIEW REQUEST][PR #55]\nHEAD: synthetic"))
            monitor.main()
            self.assertIn("PENDING_ACK", posted[-1])
            monitor.main()
            self.assertEqual(len(posted), 2)
            comments.append(comment(201, "[ACK][PR #55]\nrequest_id: 200\nstatus: DISPATCH_PENDING"))
            monitor.main()
            self.assertIn("ACK_RECORDED", posted[-1])
            self.assertIn("不能证明 Tech Lead 已接单", posted[-1])
            monitor.main()
            self.assertEqual(len(posted), 3)

    def test_exact_request_reference_and_standalone_ack_required(self):
        request = comment(20, "[REVIEW REQUEST][PR #55][Gallery]")
        invalid = [comment(19, "[ACK][PR #55]\nrequest_id: 20"),
                   comment(21, "[REPORT]\nACK [PR #55]\nrequest_id: 20"),
                   comment(22, "[ACK][PR #56]\nrequest_id: 20"),
                   comment(23, "[ACK][PR #55]\nrequest_id: 200"),
                   comment(24, "[ACK][PR #55]\nrequest_id: 999")]
        self.assertEqual(monitor.review_requests([request, *invalid])[0]["status"], "PENDING_ACK")
        ack = comment(25, "[ACK][PR #55]\nrequest: " + request["html_url"])
        self.assertEqual(monitor.review_requests([request, *invalid, ack])[0]["ack_ids"], [25])

    def test_new_request_same_pr_needs_own_ack(self):
        first = comment(10, "[REVIEW REQUEST][PR #55]")
        second = comment(30, "[REVIEW REQUEST][PR #55]")
        ack = comment(20, "[ACK][PR #55]\nrequest_id: 10")
        self.assertEqual([r["status"] for r in monitor.review_requests([second, ack, first])],
                         ["ACK_RECORDED", "PENDING_ACK"])

    def test_pagination_never_silently_truncates(self):
        with patch.object(monitor, "api", return_value=[{}] * 100):
            with self.assertRaises(ValueError):
                monitor.pages("/unused", limit=2)

if __name__ == "__main__":
    unittest.main()
