"""Behavior and evidence checks for bounded answers about the supplied videos."""
import hashlib
import json
from pathlib import Path
import unittest

from app.video_knowledge import REFERENCE_ASSET, SAMPLE_ASSET, lookup_video, video_catalog

ROOT = Path(__file__).resolve().parents[1]


class VideoKnowledgeTests(unittest.TestCase):
    def test_reference_jacket_answer_has_actual_frame_and_seek(self):
        answer = lookup_video("방송에서 재킷 코디한 장면 찾아줘", REFERENCE_ASSET)
        self.assertEqual(answer["intent"], "VIDEO_CONTENT")
        self.assertEqual(answer["video"]["start"], 34)
        self.assertIn("재킷에도 찰떡", answer["text"])
        self.assertIn("assets/video/reference/transcript-frames/38s.jpg", answer["source_refs"])
        self.assertIn("현재 상품과 다른", answer["text"])

    def test_reference_color_does_not_borrow_main_product_palette(self):
        answer = lookup_video("영상에서 색상 구성 뭐라고 했어?", REFERENCE_ASSET)
        self.assertEqual(answer["video"]["start"], 46)
        self.assertIn("공통 블랙 + 선택 1컬러", answer["text"])
        self.assertNotIn("라벤더", answer["text"])
        self.assertNotIn("크림", answer["text"])

    def test_unverified_reference_numerical_claims_are_rejected(self):
        for question in ["방송에서 가격 얼마야?", "영상 속 66 사이즈 치수 알려줘", "캐시미어 함량 몇 퍼센트야?", "배송 언제라고 했어?"]:
            with self.subTest(question=question):
                answer = lookup_video(question, REFERENCE_ASSET)
                self.assertEqual(answer["intent"], "UNSUPPORTED_VIDEO")
                self.assertNotIn("video", answer)

    def test_reference_cannot_ground_current_sku(self):
        for question in ["이 영상으로 SJ와니 코디 알려줘", "현재 상품의 소재는?", "영상에서 풀오버 설명해줘"]:
            self.assertEqual(lookup_video(question, REFERENCE_ASSET)["intent"], "UNSUPPORTED_VIDEO")

    def test_promotion_is_past_recording_not_current_benefit(self):
        answer = lookup_video("영상 말미 추석 행사 설명해줘", REFERENCE_ASSET)
        self.assertEqual(answer["video"]["start"], 54)
        self.assertIn("현재 구매 혜택으로 적용하면 안", answer["text"])
        self.assertIn("연도·현재 적용 여부는 확인되지", answer["text"])
        self.assertEqual(lookup_video("지금 적용하는 혜택 알려줘", REFERENCE_ASSET)["intent"], "UNSUPPORTED_VIDEO")

    def test_actual_playback_position_selects_covered_scene(self):
        answer = lookup_video("아까 뭐라고 했어?", REFERENCE_ASSET, 14)
        self.assertEqual(answer["video"]["start"], 10)
        answer = lookup_video("방금 무슨 내용이야?", REFERENCE_ASSET, 48)
        self.assertEqual(answer["video"]["start"], 46)

    def test_unreviewed_time_gap_never_invents_content(self):
        answer = lookup_video("아까 뭐라고 했어?", REFERENCE_ASSET, 22)
        self.assertEqual(answer["intent"], "UNSUPPORTED_VIDEO")
        self.assertNotIn("video", answer)

    def test_timestamp_navigation_stays_within_asset(self):
        self.assertEqual(lookup_video("00:38 장면 설명해줘", REFERENCE_ASSET)["video"]["start"], 34)
        self.assertEqual(lookup_video("100초 장면 보여줘", REFERENCE_ASSET)["intent"], "UNSUPPORTED_VIDEO")

    def test_unknown_asset_or_invalid_position_are_bounded(self):
        self.assertEqual(lookup_video("영상 내용", "../../arbitrary")["intent"], "UNSUPPORTED_VIDEO")
        for at in [float("nan"), float("inf"), -1, 1000, True, "5"]:
            self.assertEqual(lookup_video("영상 내용", REFERENCE_ASSET, at)["intent"], "UNSUPPORTED_VIDEO")

    def test_unknown_topic_does_not_receive_unrelated_scene_answer(self):
        self.assertEqual(lookup_video("영상 배경 음악 가수 누구야?", REFERENCE_ASSET)["intent"], "UNSUPPORTED_VIDEO")

    def test_model_size_is_unknown_in_both_assets(self):
        for asset in [REFERENCE_ASSET, SAMPLE_ASSET]:
            self.assertEqual(lookup_video("모델은 몇 사이즈 입었어?", asset)["intent"], "UNSUPPORTED_VIDEO")

    def test_main_sample_size_is_authored_script_not_reference_fact(self):
        answer = lookup_video("방송에서 66 사이즈 실측 설명 찾아줘", SAMPLE_ASSET)
        self.assertEqual(answer["video"]["start"], 40)
        self.assertEqual(answer["provenance"], "script_reference_not_asr")
        self.assertIn("45센티미터", answer["text"])
        self.assertIn("61센티미터", answer["text"])
        self.assertIn("제작 대본", answer["label"])

    def test_main_sample_keeps_demo_benefit_and_delivery_conditions(self):
        benefit = lookup_video("영상에서 가격 혜택 안내한 장면", SAMPLE_ASSET)
        self.assertIn("가상 고객의 데모 혜택", benefit["text"])
        delivery = lookup_video("영상에서 배송 안내 찾아줘", SAMPLE_ASSET)
        self.assertIn("실제 조회가 아닌 배송 시뮬레이션", delivery["text"])

    def test_summary_uses_reviewed_sources_without_asr_draft_errors(self):
        answer = lookup_video("방송 내용 요약해줘", REFERENCE_ASSET)
        self.assertEqual(answer["provenance"], "reviewed_video_frames")
        self.assertGreaterEqual(len(answer["source_refs"]), 4)
        self.assertFalse(any("asr" in ref for ref in answer["source_refs"]))
        self.assertNotIn("예쁜 부인", answer["text"])

    def test_catalog_is_independent_and_all_chapters_fit_real_assets(self):
        videos = video_catalog()
        for asset in videos:
            path = ROOT / asset["path"]
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), asset["source_sha256"])
            for chapter in asset["chapters"]:
                self.assertTrue(0 <= chapter["start"] < chapter["end"] <= asset["duration_s"])
                for source in chapter["source_refs"]:
                    self.assertTrue((ROOT / source.split("#")[0]).is_file(), source)
        videos[0]["chapters"].clear()
        self.assertGreater(len(video_catalog()[0]["chapters"]), 0)

    def test_actual_asr_runs_preserve_unknown_quality_and_zero_prompt(self):
        for model in ["base", "small"]:
            draft = json.loads((ROOT / ("assets/video/reference/transcript-asr-" + model + ".json")).read_text())
            self.assertTrue(draft["segments"])
            self.assertEqual(draft["source_sha256"], video_catalog()[0]["source_sha256"])
            self.assertIsNone(draft["engine"]["initial_prompt"])
            self.assertFalse(draft["engine"]["external_audio_upload"])
            self.assertEqual(draft["validation"], "DRAFT_DO_NOT_GROUND_UNREVIEWED_PRODUCT_FACTS")


if __name__ == "__main__":
    unittest.main()
