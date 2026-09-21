"""New screenshot interactions: private cart, explicit public comments and exposure."""
import json
import unittest

from app.state import APIError, AppState


class CustomerExperienceTests(unittest.TestCase):
    def setUp(self):
        self.elapsed = 1000
        self.app = AppState(clock=lambda: self.elapsed)

    def action(self, action, customer="customer-A", **fields):
        return self.app.action({"action": action, "run_id": self.app.run_id,
                                "customer_id": customer, **fields})

    def add(self, request="add-1", **fields):
        return self.action("cart_add", request_id=request, color="블랙", size="77",
                           quantity=fields.pop("quantity", 1), **fields)

    def test_cart_mutations_are_private_idempotent_and_survive_reads(self):
        first = self.add(quantity=2)
        item = first["customer"]["cart"][0]
        self.assertEqual((item["quantity"], item["unit_price_krw"]), (2, 49900))
        repeat = self.add(quantity=2)
        self.assertEqual(repeat["customer"]["cart"], first["customer"]["cart"])
        self.assertEqual(repeat["counts"], first["counts"])
        self.assertEqual(self.app.state("customer-B")["customer"]["cart"], [])
        self.assertNotIn("cart", self.app.state())
        with self.assertRaises(APIError):
            self.add(quantity=1)
        updated = self.action("cart_update", request_id="update", item_id=item["item_id"], quantity=3)
        self.assertEqual(updated["customer"]["cart"][0]["quantity"], 3)
        self.action("cart_update", request_id="remove", item_id=item["item_id"], quantity=0)
        retry = self.action("cart_update", request_id="remove", item_id=item["item_id"], quantity=0)
        self.assertEqual(retry["customer"]["cart"], [])

    def test_cart_rejects_unavailable_options_and_invalid_quantities_atomically(self):
        for color, size, quantity in [("그레이", "66", 1), ("라벤더", "77", 1),
                                       ("블랙", "44", 1), ("블랙", "77", 0),
                                       ("블랙", "77", True), ("블랙", "77", 11)]:
            with self.subTest(color=color, size=size, quantity=quantity), self.assertRaises(APIError):
                self.action("cart_add", request_id="invalid", color=color, size=size, quantity=quantity)
        self.assertEqual(self.app.state("customer-A")["customer"]["cart"], [])
        self.assertEqual(self.app.state()["counts"]["events"], 0)
        self.add(quantity=10)
        with self.assertRaises(APIError):
            self.add(request="overflow")
        self.assertEqual(self.app.state("customer-A")["customer"]["cart"][0]["quantity"], 10)

    def test_cart_checkout_transfers_options_quantity_and_consumes_only_selected_item(self):
        item = self.add(quantity=3)["customer"]["cart"][0]
        self.action("cart_add", request_id="another", color="블랙", size="55", quantity=1)
        with self.assertRaises(APIError):
            self.action("cart_checkout", customer="customer-B", item_id=item["item_id"])
        checkout = self.action("cart_checkout", item_id=item["item_id"])
        ui = checkout["customer"]["ui"]
        self.assertEqual((ui["color"], ui["size"], ui["purchase_quantity"], ui["active_result"]),
                         ("블랙", "77", 3, "purchase"))
        completed = self.action("event", event_type="PURCHASE_DEMO_COMPLETE", event_id="complete")
        self.assertEqual([item["size"] for item in completed["customer"]["cart"]], ["55"])
        self.assertEqual(completed["integration"]["totals"]["purchase_clicks"], 1)
        self.assertEqual(completed["integration"]["totals"]["purchase_completions"], 1)

    def test_product_switch_hides_cart_and_reset_clears_it(self):
        original = self.add()["customer"]["cart"]
        other = self.action("switch_product", product_id="other")
        self.assertEqual(other["customer"]["cart"], [])
        with self.assertRaises(APIError):
            self.add(request="other")
        back = self.action("switch_product", product_id=self.app.scope["product_id"])
        self.assertEqual(back["customer"]["cart"], original)
        reset = self.action("reset")
        self.assertEqual(reset["customer"]["cart"], [])

    def test_checkout_does_not_remove_quantity_added_from_another_tab(self):
        item = self.add(quantity=2)["customer"]["cart"][0]
        self.action("cart_checkout", item_id=item["item_id"])
        self.action("cart_update", request_id="other-tab", item_id=item["item_id"], quantity=3)
        done = self.action("event", event_type="PURCHASE_DEMO_COMPLETE", event_id="checkout-done")
        self.assertEqual(done["customer"]["cart"][0]["quantity"], 1)
        again = self.action("event", event_type="PURCHASE_DEMO_COMPLETE", event_id="checkout-done")
        self.assertEqual(again["customer"]["cart"][0]["quantity"], 1)

    def test_only_explicit_public_comment_is_shared_and_retry_does_not_duplicate(self):
        private = "나만의비밀질문887 두께감 알려줘"
        public = "공개 댓글입니다 <script>alert(1)</script>"
        self.action("ask", text=private, request_id="private")
        posted = self.action("comment_publish", comment_id="comment-1", text=public)
        self.action("comment_publish", comment_id="comment-1", text=public)
        b = self.app.state("customer-B")
        self.assertEqual(b["integration"]["comments"][0]["text"], public)
        self.assertNotIn(private, json.dumps(b, ensure_ascii=False))
        self.assertNotIn(public, json.dumps(b["logs"], ensure_ascii=False))
        self.assertEqual(b["integration"]["monitor"]["comments"]["total"], 1)
        self.assertEqual(posted["integration"]["totals"]["asks"], 1)
        with self.assertRaises(APIError):
            self.action("comment_publish", customer="customer-B", comment_id="comment-1", text=public)
        with self.assertRaises(APIError):
            self.action("comment_publish", comment_id="comment-1", text="different")

    def test_comment_validation_end_and_reset(self):
        for text in ["", "x" * 301, None, []]:
            with self.subTest(text=text), self.assertRaises(APIError):
                self.action("comment_publish", comment_id="invalid", text=text)
        self.action("comment_publish", comment_id="ok", text="좋아요")
        self.action("end")
        with self.assertRaises(APIError):
            self.action("comment_publish", comment_id="after", text="종료 후")
        self.assertEqual(self.action("reset")["integration"]["comments"], [])

    def test_frozen_demo_uses_receive_clock_for_new_question_trends(self):
        self.action("advance", seconds=60)
        self.action("ask", text="두께감 어때?", request_id="before")
        self.elapsed += 301
        later = self.action("ask", text="배송 언제 와?", request_id="after")
        self.assertEqual(later["now"], 60)
        self.assertEqual([request["received_at"] for request in self.app.requests.values()], [0, 301])
        self.assertEqual(later["integration"]["monitor"]["as_of"], 301)
        self.assertNotIn("배송 언제 와?", json.dumps(later["logs"], ensure_ascii=False))

    def test_reviews_retain_structured_evidence_and_unadjusted_percentages(self):
        message = self.action("ask", text="두께감 어때?", request_id="thickness")["customer"]["messages"][-1]
        self.assertIn("thickness", message["review_group_ids"])
        self.assertIn("main-product", str(message["source_refs"]))

    def test_personalization_exposure_requires_current_target_and_deduplicates_ids(self):
        self.action("demo_start")
        self.action("demo_spike")
        self.action("approve_app", approval_id="approved")
        fields = {"event_type": "PERSONALIZATION_SHOWN", "metadata": {"approval_id": "approved"}}
        with self.assertRaises(APIError):
            self.action("event", customer="customer-B", event_id="b", **fields)
        shown = self.action("event", event_id="a-1", **fields)
        duplicate = self.action("event", event_id="a-2", **fields)
        self.assertEqual(duplicate["event_outcome"], "DUPLICATE")
        self.assertEqual(shown["counts"], duplicate["counts"])
        self.assertEqual(duplicate["integration"]["event_counts"]["PERSONALIZATION_SHOWN"], 1)

    def test_video_answers_use_selected_asset_and_do_not_create_size_need(self):
        self.action("event", event_type="SIZE_TAB_OPEN", event_id="size")
        answer = self.action("ask", text="영상에서 재킷 코디한 부분 찾아줘", request_id="video")
        message = answer["customer"]["messages"][-1]
        self.assertEqual(message["intent"], "VIDEO_CONTENT")
        self.assertEqual(message["video"]["start"], 34)
        self.assertIn("현재 상품과 다른", message["text"])
        self.assertFalse(answer["customer"]["detected"])
        public = json.dumps(self.app.state(), ensure_ascii=False)
        self.assertNotIn("영상에서 재킷 코디한 부분 찾아줘", public)
        self.action("ui_state", patch={"video_asset_id": "main-product-sample-120s", "video_time": 40})
        sample = self.action("ask", text="영상에서 66 실측 설명 찾아줘", request_id="sample")["customer"]["messages"][-1]
        self.assertEqual(sample["video"]["asset_id"], "main-product-sample-120s")
        self.assertIn("제작 대본", sample["text"])

    def test_media_clock_and_seek_provenance_are_separate_from_live_clock(self):
        self.action("advance", seconds=60)
        self.action("ui_state", patch={"video_time": 47})
        answer = self.action("ask", text="방금 무슨 내용이야?", request_id="position")
        self.assertEqual(answer["now"], 60)
        self.assertEqual(answer["customer"]["messages"][-1]["video"]["start"], 46)
        with self.assertRaises(APIError):
            self.action("ui_state", patch={"video_asset_id": "unknown"})
        with self.assertRaises(APIError):
            self.action("event", event_type="VIDEO_SCENE_SEEK", metadata={"asset_id": "main-product-sample-120s", "chapter_id": "nonexistent"})

    def test_size_profile_is_private_and_saving_does_not_select_purchase_option(self):
        updated = self.action("profile_update", patch={"height_cm": 179, "usual_size": "66", "half_size": True})
        self.assertEqual(updated["customer"]["profile"]["height_cm"], 179)
        self.assertEqual(updated["customer"]["size_recommendation"]["recommended_size"], "77")
        self.assertEqual(updated["customer"]["ui"]["size"], "66")
        self.assertFalse(updated["customer"]["detected"])
        b = self.app.state("customer-B")["customer"]
        self.assertIsNone(b["profile"]["height_cm"])
        self.assertEqual(b["size_recommendation"]["recommended_size"], "66")
        public = json.dumps(self.app.state(), ensure_ascii=False)
        self.assertNotIn('"height_cm"', public)
        self.assertNotIn('"garment_chest_cm"', public)
        repeat = self.action("profile_update", patch={"height_cm": 179, "usual_size": "66", "half_size": True})
        self.assertEqual(updated["counts"], repeat["counts"])
        self.assertEqual(self.action("reset")["customer"]["size_recommendation"]["recommended_size"], "66")

    def test_size_profile_validation_rejects_unknown_or_impossible_values_without_mutation(self):
        original = self.app.state("customer-A")["customer"]["profile"]
        for patch in [{"height_cm": True}, {"height_cm": 210}, {"usual_size": "99"},
                      {"half_size": "yes"}, {"garment_chest_cm": float("nan")}, {"body_private_note": "text"}]:
            with self.subTest(patch=patch), self.assertRaises(APIError):
                self.action("profile_update", patch=patch)
        self.assertEqual(self.app.state("customer-A")["customer"]["profile"], original)


if __name__ == "__main__":
    unittest.main()
