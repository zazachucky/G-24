"""Deployment boundaries: cold starts, atomic updates, HTTPS and static output."""
from concurrent.futures import ThreadPoolExecutor
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from api.action import handler as ActionHandler
from api.bootstrap import handler as BootstrapHandler
from api.state import handler as StateHandler
from app.shared_state import SharedState, configured_state
from app.state import APIError
from scripts.build_vercel import build, ROOT


class AtomicStore:
    """Controlled compare-and-swap boundary, with a shared server clock."""
    def __init__(self):
        self.raw = ""
        self.now = 1000.0
        self.lock = threading.Lock()
        self.conflict = None

    def read(self):
        with self.lock:
            return self.raw, self.now

    def commit(self, expected, value):
        if self.conflict:
            callback, self.conflict = self.conflict, None
            callback()
        with self.lock:
            if expected != self.raw:
                return False
            self.raw = value
            return True


class SharedStateTests(unittest.TestCase):
    def setUp(self):
        self.store = AtomicStore()
        self.run_id = SharedState(self.store).state()["run_id"]

    def action(self, name, **payload):
        return SharedState(self.store).action({"action": name, "run_id": self.run_id, **payload})

    def test_cold_starts_preserve_full_demo_and_private_messages(self):
        started = self.action("demo_start")
        self.run_id = started["run_id"]
        self.action("demo_spike")
        self.action("approve_app", approval_id="approval-1")
        result = self.action("show_result")
        self.assertEqual(result["campaign"]["state"], "RESULT")
        self.action("ask", customer_id="customer-A", request_id="q1", text="사이즈 비밀질문")
        customer = SharedState(self.store).state("customer-A")
        director = SharedState(self.store).state()
        self.assertEqual(customer["run_id"], self.run_id)
        self.assertIn("사이즈 비밀질문", json.dumps(customer, ensure_ascii=False))
        self.assertNotIn("사이즈 비밀질문", json.dumps(director, ensure_ascii=False))

    def test_conflict_reloads_state_without_losing_either_action(self):
        self.store.conflict = lambda: self.action("event", customer_id="customer-B",
            event_type="BENEFIT_VIEW", event_id="other")
        self.action("event", customer_id="customer-A", event_type="SIZE_TAB_OPEN", event_id="first")
        counts = SharedState(self.store).state()["integration"]["event_counts"]
        self.assertEqual(counts["BENEFIT_VIEW"], 1)
        self.assertEqual(counts["SIZE_TAB_OPEN"], 1)

    def test_concurrent_cold_instances_keep_all_events(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda n: self.action("event", customer_id="customer-A",
                event_type="SIZE_RESULT_VIEW", event_id=f"event-{n}"), range(12)))
        self.assertEqual(SharedState(self.store).state()["integration"]["totals"]["events"], 12)

    def test_presence_expires_using_shared_time_after_cold_start(self):
        self.action("presence", customer_id="customer-A", session_id="tab-a", status="active")
        self.assertIn('"tab-a"', self.store.raw)
        self.store.now += 16
        snapshot = SharedState(self.store).state()
        self.assertEqual(snapshot["integration"]["presence"]["online_customers"], 0)

    def test_clock_regression_does_not_move_virtual_time_backwards(self):
        self.store.now += 10
        before = SharedState(self.store).state()["now"]
        self.store.now -= 5
        self.assertEqual(SharedState(self.store).state()["now"], before)

    def test_pending_reply_settles_after_instance_change(self):
        self.action("ask", customer_id="customer-A", request_id="slow", text="사이즈", fault="delay")
        self.store.now += 5.1
        result = SharedState(self.store).state("customer-A")
        self.assertEqual(result["integration"]["response"]["pending"], 0)
        self.assertEqual(result["integration"]["response"]["fallback"], 1)

    def test_corrupt_state_is_not_overwritten(self):
        self.store.raw = '{"version": 999}'
        with self.assertRaises(APIError) as raised:
            SharedState(self.store).state()
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(self.store.raw, '{"version": 999}')

    def test_configuration_never_silently_uses_instance_memory(self):
        with patch.dict("os.environ", {}, clear=True), self.assertRaises(APIError) as raised:
            configured_state()
        self.assertEqual(raised.exception.status, 503)

    def test_preview_and_production_state_keys_are_isolated(self):
        env = {"UPSTASH_REDIS_REST_URL": "https://example.upstash.io", "UPSTASH_REDIS_REST_TOKEN": "test"}
        with patch.dict("os.environ", {**env, "VERCEL_ENV": "production"}, clear=True):
            production = configured_state().store.key
        with patch.dict("os.environ", {**env, "VERCEL_ENV": "preview", "VERCEL_URL": "preview.vercel.app"}, clear=True):
            preview = configured_state().store.key
        self.assertNotEqual(production, preview)


class FunctionHTTPTests(unittest.TestCase):
    def request(self, handler, method, path, body=None, headers=None):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.handle_request)
        thread.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()
            thread.join(timeout=5)
            server.server_close()

    def test_bootstrap_works_without_database_and_head_has_no_body(self):
        with patch.dict("os.environ", {}, clear=True):
            status, headers, body = self.request(BootstrapHandler, "GET", "/api/bootstrap.py")
            self.assertEqual(status, 200)
            self.assertIn("video_catalog", json.loads(body))
            self.assertEqual(headers["Cache-Control"], "no-store")
            status, _, body = self.request(BootstrapHandler, "HEAD", "/api/bootstrap")
            self.assertEqual((status, body), (200, b""))

    def test_https_action_and_separate_function_state_share_one_run(self):
        shared = SharedState(AtomicStore())
        with patch("app.vercel_handler.configured_state", return_value=shared):
            _, _, raw = self.request(StateHandler, "GET", "/api/state?customer_id=customer-A")
            state = json.loads(raw)
            self.assertIn("customer", state)
            payload = json.dumps({"action":"ui_state", "run_id":state["run_id"],
                "customer_id":"customer-A", "patch":{"size":"77"}})
            headers = {"Content-Type":"application/json", "Host":"demo.vercel.app", "Origin":"https://demo.vercel.app"}
            status, _, _ = self.request(ActionHandler, "POST", "/api/action", payload, headers)
            self.assertEqual(status, 200)
            _, _, raw = self.request(StateHandler, "GET", "/api/state.py?customer_id=customer-A")
            self.assertEqual(json.loads(raw)["customer"]["ui"]["size"], "77")
            for origin in ("https://evil.example", "null", "https://demo.vercel.app/extra"):
                status, _, _ = self.request(ActionHandler, "POST", "/api/action", payload, {**headers,"Origin":origin})
                self.assertEqual(status, 403)

    def test_missing_storage_returns_actionable_503_json(self):
        with patch.dict("os.environ", {}, clear=True):
            status, _, raw = self.request(StateHandler, "GET", "/api/state")
            self.assertEqual(status, 503)
            self.assertIn("공유 저장소", json.loads(raw)["error"])


class StaticBuildTests(unittest.TestCase):
    def test_output_contains_runtime_assets_and_no_server_source(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "public"
            build(ROOT, output)
            for path in ("app/customer.html", "app/director.html", "app/customer.js",
                         "assets/products/main/gallery-01.jpg", "assets/video/reference/core-authentic-cardigan.mp4"):
                self.assertTrue((output / path).is_file(), path)
            self.assertFalse(list(output.rglob("*.py")))
            self.assertFalse((output / "tools-local").exists())
            self.assertFalse((output / ".env.example").exists())


if __name__ == "__main__":
    unittest.main()
