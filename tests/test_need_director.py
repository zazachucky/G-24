import json
from pathlib import Path
import unittest

from prototype.need_director import Event, NeedDirector, replay_fixture


FIXTURE = json.loads((Path(__file__).resolve().parents[1] / "fixtures/director-scenario.json").read_text())
LIVE = FIXTURE["scope"]["broadcast_id"]
PRODUCT = FIXTURE["scope"]["product_id"]


def event(customer, kind, event_id, product=PRODUCT, live=LIVE, **kwargs):
    return Event(event_id, customer, live, product, kind, **kwargs)


def detect(engine, customer, at, product=PRODUCT, live=LIVE):
    engine.ingest(event(customer, "SIZE_TAB_OPEN", f"{live}-{product}-{customer}-tab", product, live), at)
    return engine.ingest(event(customer, "REVIEW_SIZE_VIEW", f"{live}-{product}-{customer}-review", product, live), at)


class NeedDirectorTests(unittest.TestCase):
    def test_full_fixture_a_included_b_c_excluded_and_simulation_result(self):
        engine, evidence = replay_fixture(FIXTURE)
        self.assertEqual((evidence["previous_customers"], evidence["current_customers"], evidence["change_percent"]), (8, 26, 225))
        self.assertEqual(engine.campaigns[(LIVE, PRODUCT)].state, "ALERT")
        self.assertFalse(engine.personalization_visible("customer-A", LIVE, PRODUCT, 120))
        approval = engine.approve_app(LIVE, PRODUCT, "approval-1", 121)
        self.assertEqual(len(approval.targets), 33)
        self.assertIn("customer-A", approval.targets)
        self.assertNotIn("customer-B", approval.targets)
        self.assertNotIn("customer-C", approval.targets)
        self.assertTrue(engine.personalization_visible("customer-A", LIVE, PRODUCT, 121))
        self.assertFalse(engine.personalization_visible("customer-B", LIVE, PRODUCT, 121))
        self.assertFalse(engine.personalization_visible("customer-C", LIVE, PRODUCT, 121))
        self.assertEqual(engine.campaigns[(LIVE, PRODUCT)].state, "ACTION")
        result = engine.finish_result(LIVE, PRODUCT, FIXTURE["result_metrics"], 151)
        self.assertEqual(engine.campaigns[(LIVE, PRODUCT)].state, "RESULT")
        self.assertEqual(result["source"], "Prototype Simulation")
        self.assertEqual([m["change_percent"] for m in result["metrics"]], [-58, 207, 16])

    def test_same_signal_and_one_customer_cannot_create_spike(self):
        engine = NeedDirector()
        for i in range(100):
            engine.ingest(event("one", "SIZE_TAB_OPEN", f"tab-{i}"), 70 + i / 100)
        self.assertFalse(engine.suggestion_visible(LIVE, PRODUCT, "one"))
        self.assertEqual(engine.ingest(event("one", "REVIEW_SIZE_VIEW", "review"), 72), "NEED_DETECTED")
        for i in range(100):
            engine.ingest(event("one", "REVIEW_SIZE_VIEW", f"review-{i}"), 73 + i / 100)
        evidence = engine.evaluate_spike(LIVE, PRODUCT, 120)
        self.assertEqual(evidence["current_customers"], 1)
        self.assertFalse(evidence["spike"])

    def test_signals_must_share_customer_broadcast_and_product(self):
        engine = NeedDirector()
        engine.ingest(event("A", "SIZE_TAB_OPEN", "a"), 10)
        engine.ingest(event("B", "REVIEW_SIZE_VIEW", "b"), 11)
        engine.ingest(event("A", "REVIEW_SIZE_VIEW", "c", product="other"), 12)
        engine.ingest(event("A", "REVIEW_SIZE_VIEW", "d", live="other"), 13)
        self.assertEqual(engine.detected, {})

    def test_thirty_second_boundary_is_inclusive(self):
        for second_at, expected in [(40, "NEED_DETECTED"), (40.001, "SIGNAL_RECORDED")]:
            engine = NeedDirector()
            engine.ingest(event("A", "SIZE_TAB_OPEN", "a"), 10)
            self.assertEqual(engine.ingest(event("A", "REVIEW_SIZE_VIEW", "b"), second_at), expected)

    def test_size_question_signal_requires_explicit_size_intent(self):
        engine = NeedDirector()
        engine.ingest(event("A", "SIZE_TAB_OPEN", "a"), 10)
        self.assertEqual(engine.ingest(event("A", "ASK_LIVE_SUBMIT", "b", intent="COLOR"), 11), "IGNORED")
        self.assertEqual(engine.ingest(event("A", "ASK_LIVE_SUBMIT", "c", intent="SIZE_GUIDANCE"), 12), "NEED_DETECTED")

    def test_event_dedup_and_id_collision(self):
        engine = NeedDirector()
        first = event("A", "SIZE_TAB_OPEN", "id")
        engine.ingest(first, 10)
        self.assertEqual(engine.ingest(first, 11), "DUPLICATE")
        self.assertFalse(engine.suggestion_visible(LIVE, PRODUCT, "A"))
        with self.assertRaises(ValueError):
            engine.ingest(event("A", "REVIEW_SIZE_VIEW", "id"), 12)

    def test_minimum_population_ratio_and_zero_baseline(self):
        for previous, current, spike in [(0, 9, False), (0, 10, True), (6, 11, False), (6, 12, True)]:
            engine = NeedDirector()
            for i in range(previous):
                detect(engine, f"previous-{i}", 10)
            for i in range(current):
                detect(engine, f"current-{i}", 70)
            result = engine.evaluate_spike(LIVE, PRODUCT, 120)
            self.assertEqual(result["spike"], spike)
            if previous == 0:
                self.assertIsNone(result["change_percent"])

    def test_adjacent_windows_do_not_double_count_boundary(self):
        engine = NeedDirector()
        detect(engine, "expired", 0)
        detect(engine, "previous", 60)
        detect(engine, "current", 60.001)
        result = engine.evaluate_spike(LIVE, PRODUCT, 120)
        self.assertEqual((result["previous_customers"], result["current_customers"]), (1, 1))

    def test_approval_is_snapshot_and_idempotent_without_ttl_extension(self):
        engine, _ = replay_fixture(FIXTURE)
        approval = engine.approve_app(LIVE, PRODUCT, "approve", 121)
        self.assertEqual(detect(engine, "late", 122), "NEED_DETECTED")
        repeated = engine.approve_app(LIVE, PRODUCT, "approve", 123)
        second_request = engine.approve_app(LIVE, PRODUCT, "another-click", 124)
        self.assertEqual(approval, repeated)
        self.assertEqual(approval, second_request)
        self.assertNotIn("late", approval.targets)
        self.assertEqual(approval.expires_at, 421)
        self.assertTrue(engine.personalization_visible("customer-A", LIVE, PRODUCT, 420.999))
        self.assertFalse(engine.personalization_visible("customer-A", LIVE, PRODUCT, 421))

    def test_dismissal_after_approval_wins_and_survives_product_change(self):
        engine, _ = replay_fixture(FIXTURE)
        engine.approve_app(LIVE, PRODUCT, "approve", 121)
        engine.ingest(event("customer-A", "AI_SUGGESTION_DISMISS", "dismiss-A", need="SIZE"), 122)
        self.assertFalse(engine.personalization_visible("customer-A", LIVE, PRODUCT, 122))
        self.assertFalse(engine.suggestion_visible(LIVE, PRODUCT, "customer-A"))
        detect(engine, "customer-A", 123, product="other")
        self.assertFalse(engine.suggestion_visible(LIVE, "other", "customer-A"))
        self.assertTrue(engine.manual_size_available())
        detect(engine, "customer-A", 124, live="new-live")
        self.assertTrue(engine.suggestion_visible("new-live", PRODUCT, "customer-A"))

    def test_product_switch_cancels_personalization_without_reactivation(self):
        engine, _ = replay_fixture(FIXTURE)
        engine.approve_app(LIVE, PRODUCT, "approve", 121)
        engine.switch_product("customer-A", LIVE, "other", 122)
        engine.switch_product("customer-A", LIVE, PRODUCT, 123)
        self.assertFalse(engine.personalization_visible("customer-A", LIVE, PRODUCT, 123))
        self.assertTrue(engine.manual_size_available())

    def test_host_action_does_not_approve_customer_personalization(self):
        engine, _ = replay_fixture(FIXTURE)
        engine.deliver_to_host(LIVE, PRODUCT, 121)
        self.assertTrue(engine.campaigns[(LIVE, PRODUCT)].host_delivered)
        self.assertFalse(engine.personalization_visible("customer-A", LIVE, PRODUCT, 121))
        with self.assertRaises(ValueError):
            engine.finish_result(LIVE, PRODUCT, FIXTURE["result_metrics"], 151)

    def test_result_requires_elapsed_time_and_simulation_label(self):
        engine, _ = replay_fixture(FIXTURE)
        engine.approve_app(LIVE, PRODUCT, "approve", 121)
        with self.assertRaises(ValueError):
            engine.finish_result(LIVE, PRODUCT, FIXTURE["result_metrics"], 150)
        with self.assertRaises(ValueError):
            engine.finish_result(LIVE, PRODUCT, {"source": "actual"}, 151)

    def test_server_clock_rejects_backwards_and_nonfinite_values(self):
        engine = NeedDirector()
        engine.ingest(event("A", "SIZE_TAB_OPEN", "a"), 20)
        for value in (19, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                engine.ingest(event("A", "REVIEW_SIZE_VIEW", "b"), value)

    def test_accept_routes_size_result_and_hides_small_suggestion(self):
        engine = NeedDirector()
        detect(engine, "A", 10)
        self.assertTrue(engine.suggestion_visible(LIVE, PRODUCT, "A"))
        self.assertEqual(engine.ingest(event("A", "AI_SUGGESTION_ACCEPT", "accept", need="SIZE"), 11), "SIZE_RESULT")
        self.assertFalse(engine.suggestion_visible(LIVE, PRODUCT, "A"))


if __name__ == "__main__":
    unittest.main()
