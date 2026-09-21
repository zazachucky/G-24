"""Cross-screen contracts: real usage, privacy, wall-time presence and notices."""

import json
import unittest

from app.state import APIError, AppState


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class CrossScreenStateTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.service = AppState(clock=self.clock)

    def action(self, action, **fields):
        return self.service.action({"action": action, "run_id": self.service.run_id, **fields})

    def event(self, kind, customer="customer-A", **fields):
        return self.action("event", customer_id=customer, event_type=kind, **fields)

    def ask(self, text, request="q1", customer="customer-A", **fields):
        return self.action("ask", text=text, request_id=request, customer_id=customer, **fields)

    def ui(self, patch, customer="customer-A"):
        return self.action("ui_state", customer_id=customer, patch=patch)

    def integration(self):
        return self.service.state()["integration"]

    def presence(self, session="tab-a", customer="customer-A", status="active"):
        return self.action("presence", customer_id=customer, session_id=session, status=status)

    def publish(self, notice="notice-1", text="공용 사이즈 안내", route="size"):
        return self.action("notice_publish", notice_id=notice, text=text, route=route)

    def test_fixture_is_excluded_from_all_actual_metrics(self):
        self.action("demo_start")
        self.action("demo_spike")
        fixture = self.service.state()
        self.assertEqual(fixture["counts"]["fixture_events"], 70)
        self.assertTrue(all(value == 0 for value in fixture["integration"]["totals"].values()))
        self.assertEqual(fixture["integration"]["recent"], [])
        self.assertEqual(fixture["integration"]["intents"], [])
        self.event("SIZE_RESULT_VIEW")
        state = self.service.state()
        self.assertEqual(state["counts"]["fixture_events"], 70)
        self.assertEqual(state["integration"]["totals"]["events"], 1)
        self.assertEqual(state["integration"]["totals"]["size_views"], 1)
        self.action("approve_app", approval_id="approval")
        result = self.action("show_result")
        self.assertEqual([metric["change_percent"] for metric in result["campaign"]["result"]["metrics"]], [-58, 207, 16])
        self.assertEqual(result["integration"]["totals"]["purchase_clicks"], 0)

    def test_summary_covers_actual_actions_and_metadata_without_recount_on_get(self):
        actions = ["SIZE_RESULT_VIEW", "BENEFIT_RESULT_VIEW", "STYLING_RESULT_VIEW", "PURCHASE_CLICK", "PURCHASE_DEMO_COMPLETE"]
        for kind in actions:
            self.event(kind)
        self.event("PRODUCT_DETAIL_OPEN", metadata={"tab": "reviews"})
        self.event("MEDIA_ERROR", metadata={"kind": "video"})
        self.event("STYLING_PRODUCT_CLICK", customer="customer-B", metadata={"product_id": "1103554292"})
        metrics = self.integration()
        self.assertEqual(metrics["totals"], {"events": 8, "customers": 2, "asks": 0, "size_views": 1,
                                            "benefit_views": 1, "styling_views": 1, "detail_views": 1,
                                            "purchase_clicks": 1, "purchase_completions": 1, "media_errors": 1})
        self.assertEqual(metrics["linked_products"], [{"product_id": "1103554292", "count": 1}])
        self.assertEqual(metrics["recent"][0]["metadata"], {"product_id": "1103554292"})
        self.assertEqual(metrics["customers"][1]["last_event"], "STYLING_PRODUCT_CLICK")
        self.assertEqual(metrics, self.integration())
        self.assertEqual(metrics, self.integration())

    def test_metadata_duplicate_is_idempotent_but_changed_content_is_conflict(self):
        first = self.event("STYLING_PRODUCT_CLICK", event_id="link", metadata={"product_id": "1103554292"})
        repeated = self.event("STYLING_PRODUCT_CLICK", event_id="link", metadata={"product_id": "1103554292"})
        self.assertEqual(repeated["event_outcome"], "DUPLICATE")
        self.assertEqual(first["integration"], repeated["integration"])
        for payload in ({"product_id": "1092943486"}, {}):
            with self.assertRaises(APIError) as error:
                self.event("STYLING_PRODUCT_CLICK", event_id="link", metadata=payload)
            self.assertEqual(error.exception.status, 409)
        with self.assertRaises(APIError) as error:
            self.event("SIZE_TAB_OPEN", event_id="link")
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.integration()["totals"]["events"], 1)

    def test_invalid_metadata_and_public_ui_strings_cannot_leak_customer_text(self):
        for kind, metadata in [
            ("SIZE_RESULT_VIEW", {"text": "private question"}),
            ("STYLING_PRODUCT_CLICK", {"product_id": "private value"}),
            ("STYLING_PRODUCT_CLICK", {"product_id": []}),
            ("PRODUCT_DETAIL_OPEN", {"tab": "private detail"}),
            ("QUICK_ACTION_CLICK", {"action": "unknown"}),
            ("MEDIA_ERROR", {"kind": "untrusted stack trace"}),
            ("SIZE_TAB_OPEN", []), ("SIZE_TAB_OPEN", None),
        ]:
            with self.subTest(kind=kind, metadata=metadata), self.assertRaises(APIError):
                self.event(kind, metadata=metadata)
        with self.assertRaises(APIError):
            self.event("ASK_LIVE_SUBMIT", intent="private question")
        with self.assertRaises(APIError):
            self.ui({"active_result": "private question"})
        self.assertEqual(self.integration()["totals"]["events"], 0)

    def test_ui_transition_events_count_only_changed_dimensions_and_noop_is_silent(self):
        self.ui({"color": "블랙", "size": "77", "look": "LOOK_02", "orientation": "landscape",
                 "image_index": 2, "media_mode": "video", "video_paused": False})
        self.ui({"color": "블랙", "size": "88", "look": "LOOK_02"})
        self.ui({"video_time": 35, "video_volume": .25, "video_muted": False})
        metrics = self.integration()
        self.assertEqual(metrics["totals"]["events"], 7)
        self.assertEqual(metrics["event_counts"]["OPTION_SELECT"], 2)
        self.assertEqual(metrics["selections"], {
            "colors": [{"value": "블랙", "count": 1}],
            "sizes": [{"value": "77", "count": 1}, {"value": "88", "count": 1}],
            "looks": [{"value": "LOOK_02", "count": 1}]})
        self.assertEqual(metrics["customers"][0]["selection"], {"color": "블랙", "size": "88", "look": "LOOK_02"})
        self.ui({"color": "블랙", "size": "88", "look": "LOOK_02", "orientation": "landscape",
                 "image_index": 2, "media_mode": "video", "video_paused": False})
        self.assertEqual(self.integration(), metrics)
        self.ui({"active_result": "size"})
        self.ui({"active_result": None})
        self.ui({"active_result": None})
        self.assertEqual(self.integration()["event_counts"]["LIVE_RETURN"], 1)

    def test_ui_validation_is_atomic_and_bounds_follow_fixture(self):
        for patch in ({"color": "블랙", "size": "100"}, {"image_index": 99}, {"image_index": True},
                      {"media_mode": "private"}, {"video_paused": "false"}):
            with self.assertRaises(APIError):
                self.ui(patch)
        self.assertEqual(self.service.state("customer-A")["customer"]["ui"]["color"], "그레이")
        self.assertEqual(self.integration()["totals"]["events"], 0)

    def test_intent_aggregation_uses_request_units_and_private_messages_stay_private(self):
        secret = "비밀 고객주소 12345: 사이즈와 혜택 알려줘"
        answer = self.ask(secret)
        self.ask(secret)
        metrics = self.integration()
        self.assertEqual(metrics["totals"]["asks"], 1)
        self.assertEqual(metrics["intents"], [{"intent": "BENEFIT", "count": 1}, {"intent": "SIZE_GUIDANCE", "count": 1}])
        self.assertEqual(metrics["response"], {"pending": 0, "completed": 1, "fallback": 0, "cancelled": 0})
        self.assertIn(secret, json.dumps(answer, ensure_ascii=False))
        for state in (self.service.state(), self.service.state("customer-B"), self.service.state("customer-C")):
            self.assertNotIn(secret, json.dumps(state, ensure_ascii=False))
            self.assertNotIn("김지수", json.dumps(state, ensure_ascii=False))

    def test_response_counts_settle_once_on_wall_clock_and_cancel_on_context_change(self):
        self.action("demo_start")
        self.ask("사이즈 알려줘", fault="delay")
        self.ask("후기 어때?", request="q2", fault="error")
        self.assertEqual(self.integration()["response"], {"pending": 1, "completed": 1, "fallback": 1, "cancelled": 0})
        self.clock.advance(5)
        self.assertEqual(self.integration()["response"], {"pending": 0, "completed": 2, "fallback": 2, "cancelled": 0})
        self.clock.advance(50)
        self.assertEqual(self.integration()["response"]["completed"], 2)
        self.assertEqual(self.service.state()["now"], 68)
        self.ask("사이즈 알려줘", request="q3", fault="delay")
        self.action("switch_product", customer_id="customer-A", product_id="other")
        self.action("switch_product", customer_id="customer-A", product_id=self.service.scope["product_id"])
        duplicate = self.ask("사이즈 알려줘", request="q3", fault="delay")
        self.assertIsNone(duplicate["route"])
        self.assertEqual(self.integration()["response"]["cancelled"], 1)
        self.ask("배송 알려줘", request="q4", fault="delay")
        self.action("end")
        self.clock.advance(10)
        self.assertEqual(self.integration()["response"], {"pending": 0, "completed": 2, "fallback": 2, "cancelled": 2})

    def test_other_product_events_and_questions_do_not_contaminate_main_metrics(self):
        self.action("switch_product", customer_id="customer-A", product_id="other")
        self.ask("배송 알려줘")
        self.event("PURCHASE_CLICK")
        self.ui({"size": "77"})
        metrics = self.integration()
        self.assertEqual(metrics["totals"]["events"], 0)
        self.assertEqual(metrics["intents"], [])
        self.assertEqual(metrics["selections"]["sizes"], [])
        self.assertEqual(metrics["response"]["completed"], 0)

    def test_presence_lease_expires_in_frozen_demo_and_reconnect_does_not_reenter(self):
        self.action("demo_start")
        self.presence()
        self.presence()
        self.presence("second-tab")
        self.presence("tab-b", "customer-B")
        metrics = self.integration()
        self.assertEqual(metrics["presence"], {"online_customers": 2, "sessions": 3, "lease_seconds": 15})
        self.assertEqual(metrics["event_counts"]["LIVE_ENTER"], 2)
        self.assertEqual(metrics["customers"][0]["sessions"], 2)
        self.clock.advance(14.999)
        self.assertEqual(self.integration()["presence"]["sessions"], 3)
        self.clock.advance(.001)
        self.assertEqual(self.integration()["presence"]["sessions"], 0)
        self.assertEqual(self.service.state()["now"], 68)
        self.presence()
        self.assertEqual(self.integration()["event_counts"]["LIVE_ENTER"], 2)

    def test_presence_customer_switch_replaces_mapping_and_stale_leave_cannot_remove_new_customer(self):
        self.presence()
        self.presence(customer="customer-B")
        self.presence(status="leave")
        state = self.integration()
        self.assertEqual(state["presence"]["sessions"], 1)
        self.assertFalse(state["customers"][0]["online"])
        self.assertTrue(state["customers"][1]["online"])
        self.presence(customer="customer-B", status="leave")
        self.assertEqual(self.integration()["presence"]["sessions"], 0)

    def test_presence_after_end_is_allowed_without_recording_customer_actions(self):
        self.action("end")
        self.presence()
        self.ui({"size": "77", "look": "LOOK_02", "orientation": "landscape"})
        self.assertEqual(self.integration()["presence"]["online_customers"], 1)
        self.assertEqual(self.integration()["totals"]["events"], 0)
        self.assertEqual(self.integration()["customers"][0]["selection"]["size"], "77")
        with self.assertRaises(APIError) as error:
            self.event("SIZE_RESULT_VIEW")
        self.assertEqual(error.exception.status, 409)

    def test_operator_notices_are_shared_stable_and_visible_to_late_joiners(self):
        self.publish()
        all_messages = []
        for customer in ("customer-A", "customer-B", "customer-C"):
            notices = [message for message in self.service.state(customer)["customer"]["messages"] if message.get("notice_id")]
            self.assertEqual(len(notices), 1)
            self.assertEqual(notices[0]["visibility"], "broadcast")
            self.assertEqual(notices[0]["actor"], "OPERATOR")
            self.assertEqual(notices[0]["route"], "size")
            self.assertIsNone(notices[0]["customer_id"])
            self.assertIsNone(notices[0]["product_id"])
            all_messages.append(notices[0])
        self.assertEqual(all_messages[0], all_messages[1])
        self.assertEqual(all_messages[1], all_messages[2])
        self.action("switch_product", customer_id="customer-B", product_id="other")
        self.assertEqual(self.service.state("customer-B")["customer"]["messages"][-1], all_messages[0])
        self.assertEqual(self.integration()["totals"]["events"], 0)

    def test_notice_publish_retries_conflicts_seen_retries_and_retraction(self):
        self.publish()
        self.publish()
        with self.assertRaises(APIError) as conflict:
            self.publish(text="수정된 내용")
        self.assertEqual(conflict.exception.status, 409)
        with self.assertRaises(APIError):
            self.publish(route="benefit")
        for customer in ("customer-A", "customer-A", "customer-B"):
            self.action("notice_seen", customer_id=customer, notice_id="notice-1")
        notice = self.integration()["notices"][0]
        self.assertEqual(notice["seen_count"], 2)
        self.assertEqual(notice["seen_by"], ["customer-A", "customer-B"])
        self.action("notice_retract", notice_id="notice-1")
        self.action("notice_retract", notice_id="notice-1")
        self.action("notice_seen", customer_id="customer-C", notice_id="notice-1")
        self.publish()  # A late retry may never republish a retracted message.
        self.assertEqual(len(self.integration()["notices"]), 1)
        self.assertFalse(self.integration()["notices"][0]["active"])
        self.assertEqual(self.integration()["notices"][0]["seen_count"], 2)
        for customer in ("customer-A", "customer-B", "customer-C"):
            self.assertFalse(any(message.get("notice_id") for message in self.service.state(customer)["customer"]["messages"]))

    def test_notice_validation_end_cleanup_and_reset(self):
        for fields in ({"text": ""}, {"text": "x" * 501}, {"route": []}, {"route": "purchase"}, {"notice": "bad:id"}):
            with self.subTest(fields=fields), self.assertRaises(APIError):
                self.publish(**fields)
        with self.assertRaises(APIError) as error:
            self.action("notice_retract", notice_id="missing")
        self.assertEqual(error.exception.status, 404)
        self.publish()
        self.presence()
        self.ask("배송 알려줘", fault="delay")
        self.action("end")
        self.action("notice_seen", customer_id="customer-A", notice_id="notice-1")
        self.action("notice_retract", notice_id="notice-1")
        with self.assertRaises(APIError):
            self.publish(notice="another")
        old_run = self.service.run_id
        self.action("reset")
        metrics = self.integration()
        self.assertEqual(metrics["notices"], [])
        self.assertEqual(metrics["presence"]["sessions"], 0)
        self.assertEqual(metrics["totals"]["events"], 0)
        self.assertEqual(metrics["response"], {"pending": 0, "completed": 0, "fallback": 0, "cancelled": 0})
        with self.assertRaises(APIError) as error:
            self.service.action({"action": "notice_publish", "run_id": old_run, "notice_id": "old", "text": "old"})
        self.assertEqual(error.exception.status, 409)

    def test_measured_before_after_uses_receive_sequence_even_at_same_virtual_time(self):
        self.action("demo_start")
        self.action("demo_spike")
        self.action("advance", seconds=1)
        self.ask("배송 알려줘", request="before")
        self.event("SIZE_RESULT_VIEW")
        self.action("approve_app", approval_id="approval-1")
        self.ask("배송 알려줘", request="after")
        self.event("PURCHASE_CLICK")
        self.event("PURCHASE_DEMO_COMPLETE")
        measured = self.integration()["measured"]
        self.assertEqual(measured, {"approval_at": 121,
                                   "before": {"asks": 1, "size_views": 1, "purchase_clicks": 0, "purchase_completions": 0},
                                   "after": {"asks": 1, "size_views": 0, "purchase_clicks": 1, "purchase_completions": 1}})
        self.assertEqual({row["at"] for row in self.integration()["recent"]}, {121})
        self.action("approve_app", approval_id="approval-2")
        self.assertEqual(self.integration()["measured"], measured)

    def test_recent_activity_is_capped_without_losing_totals(self):
        for _ in range(55):
            self.event("BENEFIT_RESULT_VIEW")
        metrics = self.integration()
        self.assertEqual(len(metrics["recent"]), 50)
        self.assertEqual(metrics["totals"]["benefit_views"], 55)
        self.assertTrue(all("selection_fields" not in item for item in metrics["recent"]))


if __name__ == "__main__":
    unittest.main()
