"""Actual Director telemetry: privacy, windows, rates and exposure evidence."""

from copy import deepcopy
import json
import unittest

from app.experience_metrics import build_monitor, classify_topics


class ExperienceMetricsTests(unittest.TestCase):
    def monitor(self, **fields):
        values = {"activity": [], "requests": [], "presence": {}, "now": 0,
                  "approval": None, "logs": [], "comments": []}
        values.update(fields)
        return build_monitor(**values)

    def request(self, at, *topics):
        return {"received_at": at, "topics": list(topics)}

    def event(self, kind, customer="customer-A", **metadata):
        return {"received_at": 0, "event_type": kind, "customer_id": customer, "metadata": metadata}

    def test_topic_classification_returns_fixed_ids_never_private_text(self):
        self.assertEqual(classify_topics("김고객 010-0000-0000 평소 66 사이즈", ["SIZE_GUIDANCE"]), ["size"])
        self.assertEqual(classify_topics("55 사이즈 있어요?", ["SIZE_GUIDANCE"]), ["availability"])
        self.assertEqual(classify_topics("재고와 배송 문의", ["DELIVERY"]), ["availability", "delivery"])
        self.assertEqual(classify_topics("비공개 사용자 문장", ["UNSUPPORTED_VIDEO"]), ["other"])
        self.assertEqual(classify_topics("", ["PRODUCT_COLOR", "PRODUCT_COLOR", "PRODUCT_REVIEW"]), ["color", "review"])

    def test_empty_metrics_have_no_fabricated_audience_or_conversion(self):
        data = self.monitor()
        self.assertEqual(data["viewers"], {"online_customers": 0, "sessions": 0, "unique_visitors": 0})
        self.assertIsNone(data["conversion"]["rate_percent"])
        self.assertEqual(data["top_questions"], [])
        self.assertEqual(data["insight"]["status"], "empty")
        self.assertFalse(data["actions"]["app"]["approved"])

    def test_completion_rate_uses_unique_visitors_and_completed_visitors(self):
        rows = [self.event("LIVE_ENTER"), self.event("LIVE_ENTER"), self.event("LIVE_ENTER", "customer-B"),
                self.event("PURCHASE_DEMO_COMPLETE"), self.event("PURCHASE_DEMO_COMPLETE"),
                self.event("PURCHASE_DEMO_COMPLETE", "customer-C")]
        data = self.monitor(activity=rows, presence={"online_customers": 1, "sessions": 2})
        self.assertEqual(data["viewers"], {"online_customers": 1, "sessions": 2, "unique_visitors": 2})
        self.assertEqual(data["conversion"], {"completed_customers": 1, "visitor_customers": 2, "rate_percent": 50.0})

    def test_same_category_compound_question_counts_once_per_bucket(self):
        data = self.monitor(now=70, requests=[self.request(65, "thickness", "color", "thickness"),
                                             self.request(66, "size", "benefit")])
        last = data["trend"]["buckets"][-1]["counts"]
        self.assertEqual(last, {"size": 1, "benefit": 1, "delivery": 0, "product": 1, "other": 0})
        self.assertEqual({row["topic_id"]: row["count"] for row in data["top_questions"]},
                         {"thickness": 1, "color": 1, "size": 1, "benefit": 1})

    def test_five_minute_windows_do_not_double_count_boundaries(self):
        rows = [self.request(0, "size"), self.request(1, "size"), self.request(300, "size"),
                self.request(301, "size"), self.request(400, "size"), self.request(600, "size")]
        insight = self.monitor(now=600, requests=rows)["insight"]
        self.assertEqual((insight["previous_count"], insight["current_count"]), (2, 3))
        self.assertEqual(insight["change_percent"], 50.0)
        self.assertEqual(insight["status"], "increase")

    def test_initial_time_zero_and_new_interest_use_no_infinite_percentage(self):
        insight = self.monitor(requests=[self.request(0, "delivery")])["insight"]
        self.assertEqual(insight["current_count"], 1)
        self.assertIsNone(insight["change_percent"])
        self.assertEqual(insight["status"], "new")
        self.assertIn("직전 5분에는 없어", insight["text"])

    def test_thirty_minute_chart_and_top_questions_share_exact_cutoff(self):
        rows = [self.request(10, "size"), self.request(11, "size"), self.request(1810, "size"),
                self.request(1811, "size"), self.request(-1, "size"), {"topics": ["size"]}]
        data = self.monitor(now=1810, requests=rows)
        self.assertEqual(sum(bucket["counts"]["size"] for bucket in data["trend"]["buckets"]), 2)
        self.assertEqual(data["top_questions"], [{"topic_id": "size", "label": "사이즈는 어떻게 선택하나요?", "count": 2}])

    def test_top_five_is_stable_and_output_has_no_private_request_or_comment_text(self):
        rows = [dict(self.request(0, topic), text="PRIVATE-ASK-SECRET")
                for topic in ("size", "benefit", "delivery", "thickness", "color", "review", "styling")]
        rows.extend([self.request(0, "size")] * 3)
        values = {"requests": rows, "comments": [{"text": "PUBLIC-COMMENT-NOT-A-TOPIC"}]}
        original = deepcopy(values)
        data = self.monitor(**values)
        self.assertEqual(data["comments"]["total"], 1)
        self.assertEqual(len(data["top_questions"]), 5)
        self.assertEqual(data["top_questions"][0]["topic_id"], "size")
        self.assertEqual(data["top_questions"][0]["count"], 4)
        self.assertNotIn("PRIVATE-ASK-SECRET", json.dumps(data))
        self.assertNotIn("PUBLIC-COMMENT-NOT-A-TOPIC", json.dumps(data))
        self.assertEqual(values, original)

    def test_exposure_is_unique_current_approval_target_and_distinct_from_target_count(self):
        approval = {"approval_id": "a1", "created_at": 121, "expires_at": 421, "virtual_now": 121,
                    "ended": False, "targets": ["customer-A", "fixture-B"], "highlighted_customers": ["customer-A"]}
        rows = [self.event("PERSONALIZATION_SHOWN", approval_id="a1"),
                self.event("PERSONALIZATION_SHOWN", approval_id="a1"),
                self.event("PERSONALIZATION_SHOWN", "customer-B", approval_id="a1"),
                self.event("PERSONALIZATION_SHOWN", "fixture-B", approval_id="old"),
                self.event("AI_SUGGESTION_SHOWN", "fixture-B")]
        data = self.monitor(activity=rows, now=900, approval=approval,
                            logs=[{"action": "HOST_DELIVERED", "at": 122}])
        app = data["actions"]["app"]
        self.assertEqual((app["target_count"], app["exposed_customers"], app["highlighted_customers"]), (2, 1, 1))
        self.assertTrue(app["active"])
        self.assertEqual(data["actions"]["host"], {"delivered": True, "delivered_at": 122})
        self.assertFalse(self.monitor(approval={**approval, "virtual_now": 421})["actions"]["app"]["active"])
        self.assertFalse(self.monitor(approval={**approval, "ended": True})["actions"]["app"]["active"])

    def test_actual_outcomes_count_size_questions_detail_views_and_unique_phase_participants(self):
        rows = [dict(self.event("ASK_LIVE_SUBMIT"), intent="SIZE_GUIDANCE"),
                dict(self.event("ASK_LIVE_SUBMIT"), intent="PRODUCT_COLOR"),
                self.event("PRODUCT_DETAIL_OPEN", "customer-B"), self.event("PURCHASE_DEMO_COMPLETE"),
                self.event("PRODUCT_DETAIL_OPEN"), self.event("PURCHASE_DEMO_COMPLETE"),
                self.event("PURCHASE_DEMO_COMPLETE")]
        outcomes = self.monitor(activity=rows, approval={"activity_index": 4, "created_at": 121})["outcomes"]
        self.assertEqual(outcomes["before"], {"size_questions": 1, "detail_views": 1,
                                             "active_customers": 2, "completed_customers": 1,
                                             "completion_rate_percent": 50.0})
        self.assertEqual(outcomes["after"], {"size_questions": 0, "detail_views": 1,
                                            "active_customers": 1, "completed_customers": 1,
                                            "completion_rate_percent": 100.0})
        self.assertTrue(outcomes["approved"])

    def test_outcomes_without_approval_or_phase_population_have_no_invented_rate(self):
        before = self.monitor(activity=[self.event("PRODUCT_DETAIL_OPEN")])["outcomes"]
        self.assertFalse(before["approved"])
        self.assertEqual(before["before"]["completion_rate_percent"], 0)
        self.assertIsNone(before["after"]["completion_rate_percent"])
        approved = self.monitor(approval={"activity_index": 0, "created_at": 121})["outcomes"]
        self.assertIsNone(approved["before"]["completion_rate_percent"])
        self.assertIsNone(approved["after"]["completion_rate_percent"])


if __name__ == "__main__":
    unittest.main()
