"""Customer inputs must change sizing only through disclosed garment rules."""

from copy import deepcopy
import json
from pathlib import Path
import unittest

from app.size_profile import default_profile, recommend_size, validate_profile


PRODUCT = json.loads((Path(__file__).resolve().parents[1] / "fixtures/main-product.json").read_text())


class SizeProfileTests(unittest.TestCase):
    def recommend(self, **patch):
        return recommend_size(validate_profile(patch, default_profile()), PRODUCT)

    def test_default_preserves_prepared_66_and_actual_overall_review(self):
        result = self.recommend()
        self.assertEqual(result["recommended_size"], "66")
        self.assertEqual(result["source"], "가상프로필 · 준비 안내")
        self.assertEqual(result["measurements"]["가슴단면"], 45)
        self.assertEqual(result["measurements"]["총길이"], 61)
        self.assertEqual(result["review"], {"matched_count": 1046, "total": 1202,
                                           "percentage": 87,
                                           "label": "상품 전체 사이즈 리뷰 · 유사 체형 만족률 아님"})

    def test_each_usual_size_and_half_size_follow_available_retailer_steps(self):
        for size in ("55", "66", "77", "88"):
            with self.subTest(size=size):
                self.assertEqual(self.recommend(usual_size=size)["recommended_size"], size)
        self.assertEqual(self.recommend(usual_size="55", half_size=True)["recommended_size"], "66")
        self.assertEqual(self.recommend(usual_size="66", half_size=True)["recommended_size"], "77")
        self.assertEqual(self.recommend(usual_size="77", half_size=True)["recommended_size"], "88")
        too_large = self.recommend(usual_size="88", half_size=True)
        self.assertIsNone(too_large["recommended_size"])
        self.assertIn("최대 88", too_large["unavailable_reason"])

    def test_height_cannot_change_size_and_relaxed_without_measurements_cannot_infer_body(self):
        for height in (140, 171.5, 200):
            result = self.recommend(height_cm=height, fit="relaxed")
            self.assertEqual(result["recommended_size"], "66")
            self.assertIn("키로 사이즈", " ".join(result["reasons"]))
            self.assertIn("보유 의류 실측이 없어", " ".join(result["reasons"]))
            self.assertEqual(result["source"], "입력 기준 · 실측 비교 데모")

    def test_owned_garment_uses_actual_table_ceiling_not_body_circumference(self):
        for width, expected in ((30, "55"), (42.5, "55"), (42.6, "66"),
                                (45, "66"), (45.1, "77"), (47.5, "77"), (50, "88")):
            with self.subTest(width=width):
                result = self.recommend(garment_chest_cm=width)
                self.assertEqual(result["recommended_size"], expected)
                self.assertGreaterEqual(result["measurements"]["가슴단면"], width)
                self.assertIn("신체 둘레가 아닌", " ".join(result["reasons"]))

    def test_relaxed_measured_rule_and_half_size_lower_bound_do_not_stack(self):
        result = self.recommend(garment_chest_cm=45, fit="relaxed", half_size=True)
        self.assertEqual(result["recommended_size"], "77")
        self.assertIn("데모 규칙", " ".join(result["reasons"]))
        self.assertIn("main-product.size_guide.half_size_guidance", result["source_refs"])
        self.assertEqual(self.recommend(usual_size="77", half_size=True,
                                        garment_chest_cm=42.5)["recommended_size"], "88")

    def test_measurement_or_relaxed_requirement_above_maximum_returns_manual_check(self):
        for patch in ({"garment_chest_cm": 50.1}, {"garment_chest_cm": 80},
                      {"garment_chest_cm": 50, "fit": "relaxed"}):
            with self.subTest(patch=patch):
                result = self.recommend(**patch)
                self.assertIsNone(result["recommended_size"])
                self.assertEqual(result["measurements"], {})
                self.assertTrue(result["unavailable_reason"])

    def test_validation_supports_partial_update_clearing_and_does_not_mutate(self):
        initial = default_profile()
        updated = validate_profile({"usual_size": "77", "height_cm": 168, "garment_chest_cm": 47.5}, initial)
        cleared = validate_profile({"height_cm": None, "garment_chest_cm": None}, updated)
        self.assertEqual(initial, default_profile())
        self.assertEqual(updated["height_cm"], 168)
        self.assertEqual(cleared["usual_size"], "77")
        self.assertIsNone(cleared["height_cm"])
        initial["usual_size"] = "55"
        self.assertEqual(default_profile()["usual_size"], "66")

    def test_invalid_types_ranges_unknown_fields_and_nonfinite_numbers_rejected(self):
        patches = [None, [], {"height_cm": True}, {"height_cm": "170"}, {"height_cm": 139.9},
                   {"height_cm": 201}, {"height_cm": float("nan")}, {"height_cm": float("inf")},
                   {"garment_chest_cm": False}, {"garment_chest_cm": 29.9}, {"garment_chest_cm": 80.1},
                   {"usual_size": "99"}, {"usual_size": 66}, {"half_size": 1}, {"half_size": "false"},
                   {"fit": "tight"}, {"body_chest_cm": 90}]
        for patch in patches:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_profile(patch, default_profile())
        self.assertIsNone(recommend_size({"usual_size": "99"}, PRODUCT)["recommended_size"])

    def test_missing_or_inconsistent_product_measurements_do_not_fabricate_a_result(self):
        for change in ({"unit": "inch"}, {"rows": []}, {"sizes": ["55", "66"]}):
            product = deepcopy(PRODUCT)
            product["size_guide"].update(change)
            with self.subTest(change=change):
                self.assertIsNone(recommend_size(default_profile(), product)["recommended_size"])

    def test_input_and_product_unchanged_and_purchase_stock_not_used_as_fit_evidence(self):
        profile = validate_profile({"garment_chest_cm": 45}, default_profile())
        product = deepcopy(PRODUCT)
        before = deepcopy((profile, product))
        self.assertEqual(recommend_size(profile, product)["recommended_size"], "66")
        self.assertEqual((profile, product), before)
        product["review_summary"]["aggregate_discrepancy"]["overall_review_count"] = 9999
        self.assertEqual(recommend_size(profile, product)["review"]["total"], 1202)


if __name__ == "__main__":
    unittest.main()
