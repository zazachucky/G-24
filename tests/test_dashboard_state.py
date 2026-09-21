"""Dashboard scope, audit correlation and public provenance regressions."""

import json
import unittest

from app.state import APIError, AppState, NEED_AGGREGATE_SOURCE
from prototype.need_director import Event


class DashboardStateTests(unittest.TestCase):
    def setUp(self):
        self.service = AppState(clock=lambda: 0)

    def action(self, action, **fields):
        return self.service.action({"action": action, "run_id": self.service.run_id, **fields})

    def event(self, kind, **fields):
        return self.action("event", customer_id="customer-A", event_type=kind, **fields)

    def test_other_product_detection_does_not_inflate_main_dashboard(self):
        self.action("switch_product", customer_id="customer-A", product_id="OTHER-PRODUCT")
        self.event("SIZE_TAB_OPEN", event_id="other-tab")
        state = self.event("REVIEW_SIZE_VIEW", event_id="other-review")
        self.assertEqual(state["counts"], {"events": 0, "detected": 0,
                                           "ui_events": 0, "fixture_events": 0})
        self.assertEqual(state["integration"]["totals"]["events"], 0)
        self.assertFalse(state["customers"][0]["detected"])
        self.assertEqual(len(self.service.engine.events), 2)
        self.assertEqual(len(self.service.engine.detected), 1)
        self.assertEqual(state["logs"][-1]["detail"]["product_id"], "OTHER-PRODUCT")

    def test_counts_filter_broadcast_and_product_but_keep_ui_fixture_origins(self):
        live, product = self.service.scope["broadcast_id"], self.service.scope["product_id"]
        for index, (event_live, event_product, origin) in enumerate([
            (live, "OTHER-PRODUCT", "ui"), ("OTHER-LIVE", product, "fixture"),
        ]):
            for kind in ("SIZE_TAB_OPEN", "REVIEW_SIZE_VIEW"):
                self.service._ingest(Event(f"other-{index}-{kind}", "customer-A",
                                           event_live, event_product, kind), origin)
        self.event("SIZE_TAB_OPEN", event_id="main-tab")
        self.event("REVIEW_SIZE_VIEW", event_id="main-review")
        self.service._ingest(Event("main-fixture", "customer-B", live, product,
                                   "ASK_LIVE_SUBMIT", "PRODUCT_COLOR"), "fixture")
        state = self.service.state()
        self.assertEqual(state["counts"], {"events": 3, "detected": 1,
                                           "ui_events": 2, "fixture_events": 1})
        self.assertEqual(state["integration"]["totals"]["events"], 2)
        self.assertEqual(len(self.service.engine.events), 7)
        self.assertEqual(len(self.service.engine.detected), 3)

    def test_audit_sequence_orders_same_time_events_and_resets_with_run(self):
        self.event("SIZE_TAB_OPEN", event_id="one")
        first = self.service.state()["logs"]
        self.event("SIZE_TAB_OPEN", event_id="one")
        self.assertEqual(self.service.state()["logs"], first)
        for index in range(302):
            self.event("PRODUCT_DETAIL_VIEW", event_id=f"event-{index}")
        logs = self.service.state()["logs"]
        self.assertEqual(len(logs), 300)
        self.assertEqual([row["sequence"] for row in logs], list(range(5, 305)))
        self.assertEqual({row["at"] for row in logs}, {0})
        old_run = self.service.run_id
        reset = self.action("reset")
        self.assertNotEqual(reset["run_id"], old_run)
        self.assertEqual([row["sequence"] for row in reset["logs"]], [1])

    def test_safe_event_details_are_correlated_without_private_ask_text(self):
        secret = "개인확인문구-SENSITIVE-9137 사이즈 추천해줘"
        self.action("ask", customer_id="customer-A", text=secret,
                    request_id="private-request-token")
        self.action("ui_state", customer_id="customer-A", patch={"color": "블랙"})
        state = self.service.state()
        public = json.dumps(state, ensure_ascii=False)
        self.assertNotIn(secret, public)
        self.assertNotIn("private-request-token", public)
        ask = next(row for row in state["logs"] if row["action"] == "ASK_LIVE_SUBMIT")
        self.assertEqual(ask["detail"]["customer_id"], "customer-A")
        self.assertEqual(ask["detail"]["event_type"], "ASK_LIVE_SUBMIT")
        self.assertEqual(ask["detail"]["intent"], "SIZE_GUIDANCE")
        self.assertEqual(state["logs"][-1]["detail"]["metadata"], {"color": "블랙", "size": "66"})
        with self.assertRaises(APIError):
            self.event("QUICK_ACTION_CLICK", metadata={"action": secret})
        self.assertNotIn(secret, json.dumps(self.service.state()["logs"], ensure_ascii=False))

    def test_notice_and_product_switch_logs_have_safe_correlation_fields(self):
        self.action("notice_publish", notice_id="notice-audit", text="공용 안내 문구", route="size")
        self.action("notice_retract", notice_id="notice-audit")
        self.action("switch_product", customer_id="customer-A", product_id="OTHER-PRODUCT")
        logs = {row["action"]: row for row in self.service.state()["logs"]}
        self.assertEqual(logs["NOTICE_PUBLISHED"]["detail"], {"notice_id": "notice-audit", "route": "size"})
        self.assertEqual(logs["NOTICE_RETRACTED"]["detail"], {"notice_id": "notice-audit"})
        self.assertEqual(logs["PRODUCT_SWITCH"]["detail"], {
            "customer_id": "customer-A", "from_product": self.service.scope["product_id"],
            "to_product": "OTHER-PRODUCT"})
        self.assertNotIn("공용 안내 문구", json.dumps(logs, ensure_ascii=False))

    def test_public_need_provenance_is_distinct_from_fixed_result(self):
        self.assertEqual(self.service.state()["campaign"]["evidence"]["source"], NEED_AGGREGATE_SOURCE)
        self.action("demo_start")
        spike = self.action("demo_spike")
        self.assertEqual(spike["campaign"]["evidence"]["source"], NEED_AGGREGATE_SOURCE)
        self.assertEqual(spike["campaign"]["evidence"]["current_customers"], 26)
        self.assertEqual(self.service._campaign().evidence["source"], "Prototype Simulation")
        self.action("approve_app", approval_id="audit-approval")
        result = self.action("show_result")
        self.assertEqual(result["campaign"]["evidence"]["source"], NEED_AGGREGATE_SOURCE)
        self.assertEqual(result["campaign"]["result"]["source"], "Prototype Simulation")
        self.assertEqual([metric["change_percent"] for metric in result["campaign"]["result"]["metrics"]],
                         [-58, 207, 16])


if __name__ == "__main__":
    unittest.main()
