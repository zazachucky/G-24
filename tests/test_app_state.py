"""Service and real HTTP checks for the integrated local application."""

import http.client
import json
from pathlib import Path
import threading
import unittest

from app.server import create_server
from app.state import APIError, AppState, DEFAULT_UI


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, delta):
        self.now += delta


class AppStateTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.service = AppState(clock=self.clock)

    def action(self, action, **fields):
        return self.service.action({"action": action, "run_id": self.service.run_id, **fields})

    def event(self, kind, customer="customer-A", **fields):
        return self.action("event", customer_id=customer, event_type=kind, **fields)

    def ask(self, text, customer="customer-A", request_id="question-1", **fields):
        return self.action("ask", customer_id=customer, text=text, request_id=request_id, **fields)

    def approved(self):
        self.action("demo_start")
        self.action("demo_spike")
        return self.action("approve_app", approval_id="approval-1")

    def test_fixture_runs_three_times_with_exact_targets_times_and_result(self):
        for _ in range(3):
            start = self.action("demo_start", customer_id="customer-A")
            self.assertEqual(start["now"], 68)
            self.assertEqual(start["campaign"]["state"], "NORMAL")
            self.assertTrue(start["customer"]["suggestion_visible"])
            self.assertFalse(start["customer"]["highlight"])
            spike = self.action("demo_spike")
            self.assertEqual(spike["now"], 120)
            evidence = spike["campaign"]["evidence"]
            self.assertEqual((evidence["previous_customers"], evidence["current_customers"], evidence["change_percent"]), (8, 26, 225))
            repeat = self.action("demo_spike")
            self.assertEqual(repeat["counts"], spike["counts"])
            approved = self.action("approve_app", approval_id="approval-1")
            approval = approved["campaign"]["approval"]
            self.assertEqual((approved["now"], approval["count"], approval["expires_at"]), (121, 33, 421))
            self.assertEqual([row["highlight"] for row in approved["customers"]], [True, False, False])
            self.assertEqual(approved["counts"]["fixture_events"], 70)
            result = self.action("show_result")
            self.assertEqual(result["now"], 151)
            self.assertEqual(result["campaign"]["state"], "RESULT")
            self.assertEqual([m["change_percent"] for m in result["campaign"]["result"]["metrics"]], [-58, 207, 16])
            self.assertEqual(result["campaign"]["result"]["source"], "Prototype Simulation")

    def test_interactive_clock_records_real_receive_time_and_scheduled_ticks(self):
        self.event("SIZE_TAB_OPEN")
        self.clock.advance(30)
        detected = self.event("REVIEW_SIZE_VIEW")
        self.assertTrue(detected["customer"]["detected"])
        self.assertEqual(detected["now"], 30)
        self.clock.advance(29.9)
        self.assertEqual(self.service.state()["campaign"]["evidence"]["as_of"], 0)
        self.clock.advance(.1)
        state = self.service.state()
        self.assertEqual(state["campaign"]["evidence"]["as_of"], 60)
        self.assertEqual(state["campaign"]["evidence"]["current_customers"], 1)
        self.assertEqual(state["counts"]["ui_events"], 2)

    def test_demo_clock_is_frozen_while_fallback_uses_wall_time(self):
        self.action("demo_start")
        self.clock.advance(900)
        self.assertEqual(self.service.state()["now"], 68)

    def test_exact_thirty_seconds_boundary_and_customer_scope(self):
        self.event("SIZE_TAB_OPEN")
        self.clock.advance(30.001)
        result = self.event("REVIEW_SIZE_VIEW")
        self.assertFalse(result["customer"]["detected"])
        self.event("SIZE_TAB_OPEN", customer="customer-B")
        self.assertFalse(self.service.state("customer-B")["customer"]["detected"])
        self.event("SIZE_TAB_OPEN")
        self.assertTrue(self.service.state("customer-A")["customer"]["detected"])

    def test_repeated_signal_and_duplicate_id_do_not_inflate_detection(self):
        self.event("SIZE_TAB_OPEN", event_id="tab")
        duplicate = self.event("SIZE_TAB_OPEN", event_id="tab")
        self.assertEqual(duplicate["event_outcome"], "DUPLICATE")
        self.assertEqual(self.service.state()["counts"]["detected"], 0)
        second = self.event("SIZE_TAB_OPEN", event_id="tab-2")
        self.assertEqual(second["event_outcome"], "NEED_DETECTED")
        self.assertEqual(self.service.state()["counts"]["detected"], 1)
        with self.assertRaises(APIError):
            self.event("REVIEW_SIZE_VIEW", event_id="tab")
        self.event("REVIEW_SIZE_VIEW", event_id="review")
        self.event("REVIEW_SIZE_VIEW", event_id="review-2")
        self.assertEqual(self.service.state()["counts"]["detected"], 1)

    def test_ask_size_is_signal_but_video_question_takes_priority(self):
        self.event("SIZE_TAB_OPEN")
        answer = self.ask("모델은 몇 사이즈 입었어?")
        self.assertEqual(answer["intents"], ["UNSUPPORTED_VIDEO"])
        self.assertFalse(answer["customer"]["detected"])
        self.assertIsNone(answer["route"])
        size = self.ask("평소 66인데 그대로 주문해도 돼?", request_id="size-2")
        self.assertEqual(size["route"], "size")
        self.assertTrue(size["customer"]["detected"])
        self.assertEqual(size["customer"]["ui"]["active_result"], "size")

    def test_ask_all_prepared_examples_route_to_exact_intent(self):
        fixture = self.service.fixtures["ask"]
        for group in fixture["responses"] + fixture["direct_result_routes"]:
            for example in group["examples"]:
                with self.subTest(example=example):
                    result = self.ask(example, request_id=example)
                    self.assertIn(group["intent"], result["intents"])
                    message = result["customer"]["messages"][-1]
                    self.assertTrue(message["provenance"])
                    self.assertTrue(message["source_refs"])

    def test_messages_are_private_with_shared_operator_and_public_log(self):
        secret = "내 주소는 비밀주소123인데 배송 언제 와?"
        a = self.ask(secret)
        self.assertEqual(a["customer"]["messages"][0]["visibility"], "broadcast")
        self.assertIsNone(a["customer"]["messages"][0]["customer_id"])
        self.assertIn(secret, json.dumps(a, ensure_ascii=False))
        for public in (self.service.state(), self.service.state("customer-B")):
            serialized = json.dumps(public, ensure_ascii=False)
            self.assertNotIn(secret, serialized)
            self.assertNotIn("김지수", serialized)
            self.assertNotIn("서울 영등포구", serialized)
        self.assertNotIn("messages", self.service.state())
        self.assertEqual(len(self.service.state("customer-B")["customer"]["messages"]), 1)

    def test_followups_scope_multiple_intents_and_unknown_sections(self):
        first = self.ask("그건 어때?")
        self.assertEqual(first["intents"], ["AMBIGUOUS_FOLLOWUP"])
        self.ask("두께감 어때?", request_id="thick")
        again = self.ask("자세히 알려줘", request_id="follow")
        self.assertEqual(again["intents"], ["PRODUCT_THICKNESS"])
        other = self.ask("자세히 알려줘", customer="customer-B")
        self.assertEqual(other["intents"], ["AMBIGUOUS_FOLLOWUP"])
        mixed = self.ask("후기랑 두께랑 배송 알려줘", request_id="mixed")
        self.assertEqual(len(mixed["intents"]), 2)
        self.assertEqual(mixed["customer"]["messages"][-1]["intent"], "CLARIFICATION")
        unsupported = self.ask("후기와 세탁법 알려줘", request_id="mixed-unsupported")
        self.assertEqual(unsupported["customer"]["messages"][-1]["intent"], "UNSUPPORTED")

    def test_ask_request_id_is_idempotent_and_conflicting_reuse_rejected(self):
        first = self.ask("후기 어때?")
        repeat = self.ask("후기 어때?")
        self.assertEqual(first["customer"]["messages"], repeat["customer"]["messages"])
        self.assertEqual(first["counts"], repeat["counts"])
        with self.assertRaises(APIError):
            self.ask("배송 언제 돼?")

    def test_five_second_fallback_once_and_delayed_adapter_never_appends(self):
        pending = self.ask("배송 언제 돼?", fault="delay")
        self.assertEqual(pending["customer"]["messages"][-1]["status"], "pending")
        self.clock.advance(4.999)
        self.assertEqual(self.service.state("customer-A")["customer"]["messages"][-1]["status"], "pending")
        self.clock.advance(.001)
        complete = self.service.state("customer-A")["customer"]["messages"]
        self.assertEqual(len(complete), 3)
        self.assertTrue(complete[-1]["fallback"])
        self.assertEqual(complete[-1]["intent"], "DELIVERY")
        self.assertIn("2~3영업일", complete[-1]["text"])
        self.clock.advance(10)
        self.assertEqual(self.service.state("customer-A")["customer"]["messages"], complete)

    def test_error_fallback_matches_intent_and_never_fabricates_unknown_answer(self):
        answer = self.ask("두께감 어때?", fault="error")["customer"]["messages"][-1]
        self.assertTrue(answer["fallback"])
        self.assertIn("63%", answer["text"])
        answer = self.ask("내일 날씨는?", request_id="unknown", fault="error")["customer"]["messages"][-1]
        self.assertEqual(answer["intent"], "UNSUPPORTED")

    def test_reset_clears_all_state_and_rejects_previous_run_mutation(self):
        self.approved()
        self.ask("배송 언제 돼?", fault="delay")
        self.action("ui_state", customer_id="customer-A", patch={"orientation": "landscape", "image_index": 2})
        old_run = self.service.run_id
        result = self.action("reset", customer_id="customer-A")
        self.assertNotEqual(old_run, result["run_id"])
        self.assertEqual(result["now"], 0)
        self.assertEqual(result["counts"]["events"], 0)
        self.assertEqual(result["customer"]["ui"], DEFAULT_UI)
        self.assertIsNone(result["campaign"]["approval"])
        self.assertEqual(self.service.pending, {})
        self.clock.advance(10)
        self.assertEqual(len(self.service.state("customer-A")["customer"]["messages"]), 1)
        with self.assertRaises(APIError) as rejected:
            self.service.action({"action": "event", "run_id": old_run, "customer_id": "customer-A", "event_type": "SIZE_TAB_OPEN"})
        self.assertEqual(rejected.exception.status, 409)

    def test_product_switch_cancels_pending_and_context_does_not_leak(self):
        self.ask("배송 언제 돼?", fault="delay")
        self.action("switch_product", customer_id="customer-A", product_id="other-product")
        self.clock.advance(8)
        self.assertEqual(len(self.service.state("customer-A")["customer"]["messages"]), 1)
        self.action("switch_product", customer_id="customer-A", product_id=self.service.scope["product_id"])
        messages = self.service.state("customer-A")["customer"]["messages"]
        self.assertEqual(len(messages), 3)
        self.assertIn("취소", messages[-1]["text"])
        self.assertFalse(messages[-1].get("fallback", False))

    def test_approval_is_frozen_ttl_exact_and_no_result_until_control(self):
        approved = self.approved()
        approval = approved["campaign"]["approval"]
        self.event("SIZE_TAB_OPEN", customer="customer-B")
        self.event("REVIEW_SIZE_VIEW", customer="customer-B")
        self.action("advance", seconds=30)
        repeat = self.action("approve_app", approval_id="another-click")
        self.assertEqual(repeat["campaign"]["approval"], approval)
        self.assertNotIn("customer-B", repeat["campaign"]["approval"]["targets"])
        self.assertIsNone(repeat["campaign"]["result"])
        self.action("advance", seconds=269.999)
        self.assertTrue(self.service.state("customer-A")["customer"]["highlight"])
        expired = self.action("advance", seconds=.001, customer_id="customer-A")
        self.assertEqual(expired["now"], 421)
        self.assertFalse(expired["customer"]["highlight"])

    def test_decline_product_switch_end_override_approval_and_manual_size_remains(self):
        self.approved()
        dismissed = self.event("AI_SUGGESTION_DISMISS", need="SIZE")
        self.assertFalse(dismissed["customer"]["highlight"])
        self.assertFalse(dismissed["customer"]["suggestion_visible"])
        manual = self.action("ui_state", customer_id="customer-A", patch={"active_result": "size"})
        self.assertEqual(manual["customer"]["ui"]["active_result"], "size")
        self.approved()
        self.action("switch_product", customer_id="customer-A", product_id="other")
        back = self.action("switch_product", customer_id="customer-A", product_id=self.service.scope["product_id"])
        self.assertFalse(back["customer"]["highlight"])
        self.approved()
        end = self.action("end", customer_id="customer-A")
        self.assertFalse(end["customer"]["highlight"])
        self.assertFalse(end["customer"]["suggestion_visible"])

    def test_accept_routes_only_when_offered_and_is_idempotent(self):
        ignored = self.event("AI_SUGGESTION_ACCEPT", need="SIZE")
        self.assertNotIn("route", ignored)
        self.action("demo_start")
        accepted = self.event("AI_SUGGESTION_ACCEPT", need="SIZE", event_id="accepted")
        self.assertEqual(accepted["route"], "size")
        self.assertFalse(accepted["customer"]["suggestion_visible"])
        repeated = self.event("AI_SUGGESTION_ACCEPT", need="SIZE", event_id="accepted")
        self.assertEqual(repeated["event_outcome"], "DUPLICATE")

    def test_ui_transitions_emit_once_without_affecting_video_clock(self):
        self.action("demo_start")
        before = self.service.state("customer-A")
        patch = {"orientation": "landscape", "color": "블랙", "size": "77", "look": "LOOK_03", "active_result": "styling", "image_index": 2, "video_time": 40, "video_paused": False}
        after = self.action("ui_state", customer_id="customer-A", patch=patch)
        self.assertEqual(after["counts"]["ui_events"], before["counts"]["ui_events"] + 5)
        self.assertEqual(after["counts"]["fixture_events"], before["counts"]["fixture_events"])
        self.assertEqual(after["now"], before["now"])
        for key, value in patch.items():
            self.assertEqual(after["customer"]["ui"][key], value)
        repeated = self.action("ui_state", customer_id="customer-A", patch=patch)
        self.assertEqual(repeated["counts"], after["counts"])
        time_only = self.action("ui_state", customer_id="customer-A", patch={"video_time": 41, "video_volume": .5})
        self.assertEqual(time_only["counts"], after["counts"])
        self.assertEqual(time_only["now"], before["now"])

    def test_host_and_app_approval_are_independent(self):
        with self.assertRaises(APIError):
            self.action("approve_app", approval_id="early")
        self.action("demo_start")
        self.action("demo_spike")
        hosted = self.action("host_deliver", text="검토 후 수정된 사이즈 안내 문구")
        self.assertTrue(hosted["campaign"]["host_delivered"])
        self.assertIsNone(hosted["campaign"]["approval"])
        self.assertFalse(any(row["highlight"] for row in hosted["customers"]))
        self.assertEqual(hosted["campaign"]["host_text"], "검토 후 수정된 사이즈 안내 문구")

    def test_invalid_payloads_and_client_time_are_rejected(self):
        cases = [
            {"action": "advance", "seconds": -1}, {"action": "advance", "seconds": True},
            {"action": "advance", "seconds": float("nan")}, {"action": "advance", "seconds": []},
            {"action": "event", "customer_id": "customer-A", "event_type": "SIZE_TAB_OPEN", "now": 100},
            {"action": "event", "customer_id": "customer-A", "event_type": "UNKNOWN"},
            {"action": "event", "customer_id": "customer-A", "event_type": "AI_SUGGESTION_DISMISS"},
            {"action": "ui_state", "customer_id": "customer-A", "patch": {"size": [66]}},
            {"action": "ui_state", "customer_id": "customer-A", "patch": {"unknown": True}},
            {"action": "ask", "customer_id": "customer-A", "text": "", "request_id": "q"},
            {"action": "ask", "customer_id": "customer-A", "text": "후기", "request_id": "q", "fault": []},
            {"action": "ask", "customer_id": "wrong", "text": "후기", "request_id": "q"},
        ]
        for payload in cases:
            with self.subTest(payload=payload), self.assertRaises(APIError):
                self.service.action({"run_id": self.service.run_id, **payload})
        self.assertEqual(self.service.state()["counts"]["events"], 0)


class HTTPServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server(port=0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": .02}, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_api_redirect_errors_and_no_source_file_exposure(self):
        status, headers, _ = self.request("GET", "/")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/app/customer.html")
        status, _, body = self.request("GET", "/api/state?customer_id=customer-A")
        self.assertEqual(status, 200)
        self.assertIn("customer", json.loads(body))
        for path in ["/app/server.py", "/.git/config", "/tools-local/", "/app/../prototype/need_director.py", "/api/state?customer_id=unknown"]:
            with self.subTest(path=path):
                status, _, body = self.request("GET", path)
                self.assertGreaterEqual(status, 400)
                self.assertIn("error", json.loads(body))
        status, _, body = self.request("POST", "/api/action", "not-json", {"Content-Type": "application/json"})
        self.assertEqual(status, 400)
        self.assertIn("error", json.loads(body))

    def test_bootstrap_and_http_action_share_one_run(self):
        status, _, body = self.request("GET", "/api/bootstrap")
        self.assertEqual(status, 200)
        self.assertEqual(set(json.loads(body)), {"product", "demo", "ask", "looks", "candidates", "media", "experience", "video_catalog"})
        _, _, body = self.request("GET", "/api/state")
        run_id = json.loads(body)["run_id"]
        payload = json.dumps({"action": "demo_start", "run_id": run_id, "customer_id": "customer-A"})
        status, _, body = self.request("POST", "/api/action", payload, {"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        started = json.loads(body)
        _, _, body = self.request("GET", "/api/state")
        director = json.loads(body)
        self.assertEqual(director["run_id"], started["run_id"])
        self.assertEqual(director["now"], 68)
        self.assertNotIn("customer", director)

    def test_ranges_support_media_seek_suffix_head_and_unsatisfiable(self):
        root = self.server.state.root
        candidates = list((root / "assets/video/reference").glob("*.mp4"))
        if not candidates:
            candidates = list((root / "assets/video/test-live").glob("*.mp4"))
        self.assertTrue(candidates, "A checked-in local MP4 is required")
        file = candidates[0]
        url = "/" + str(file.relative_to(root))
        status, headers, body = self.request("GET", url, headers={"Range": "bytes=0-15"})
        self.assertEqual(status, 206)
        self.assertEqual(len(body), 16)
        self.assertEqual(headers["Content-Range"], f"bytes 0-15/{file.stat().st_size}")
        with file.open("rb") as source:
            self.assertEqual(body, source.read(16))
        status, _, body = self.request("GET", url, headers={"Range": "bytes=-8"})
        self.assertEqual((status, len(body)), (206, 8))
        status, headers, body = self.request("HEAD", url)
        self.assertEqual((status, body), (200, b""))
        self.assertEqual(int(headers["Content-Length"]), file.stat().st_size)
        status, headers, _ = self.request("GET", url, headers={"Range": "bytes=9999999999999-"})
        self.assertEqual(status, 416)
        self.assertEqual(headers["Content-Range"], f"bytes */{file.stat().st_size}")


if __name__ == "__main__":
    unittest.main()
