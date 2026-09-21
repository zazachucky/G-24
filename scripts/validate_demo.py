"""Offline integration checks for the prepared prototype package (not UI tests)."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prototype.need_director import Event, NeedDirector, replay_fixture


def read(name):
    return json.loads((ROOT / "fixtures" / f"{name}.json").read_text())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def asset(path, expected_hash=None):
    p = ROOT / path
    require(p.is_file(), f"Missing asset: {path}")
    raw = p.read_bytes()
    require(len(raw) > 1000, f"Unexpectedly small image: {path}")
    require(raw.startswith(b"\xff\xd8\xff") or raw.startswith(b"\x89PNG\r\n\x1a\n"),
            f"Asset is not JPEG/PNG: {path}")
    if expected_hash:
        require(sha256(raw).hexdigest() == expected_hash, f"Asset hash differs: {path}")
    return p


def main(write_report=False):
    product, config, ask = read("main-product"), read("demo-config"), read("ask-live")
    candidates, looks, scenario = read("styling-candidates"), read("styling-looks"), read("director-scenario")
    require({product["product_id"], config["product_id"], ask["product_id"], scenario["scope"]["product_id"]}
            == {"1084192893"}, "Product IDs are inconsistent")
    require(config["broadcast_id"] == ask["broadcast_id"] == scenario["scope"]["broadcast_id"],
            "Broadcast IDs are inconsistent")
    require(product["rating"]["review_count"] == config["data_policy"]["review_count"] == 1200,
            "Review snapshot mismatch")
    require(product["price"]["sale_price_krw"] == config["benefit_result"]["base_price_krw"] == 49900,
            "Base price mismatch")
    benefit = config["benefit_result"]
    discount = sum(row["amount_krw"] for row in benefit["discounts"])
    require(discount == benefit["total_discount_krw"] == 4385, "Discount sum mismatch")
    require(benefit["base_price_krw"] - discount + benefit["shipping_fee_krw"]
            == benefit["final_price_krw"] == 45515, "Benefit result mismatch")

    expected = {
        "design": {"좋아요": 68, "보통이에요": 31, "별로예요": 1},
        "size": {"잘 맞아요": 87, "작아요": 7, "커요": 6},
        "color": {"동일해요": 91, "생각보다 어두워요": 6, "생각보다 밝아요": 2},
        "thickness": {"얇아요": 63, "적당해요": 35, "두꺼워요": 2},
        "fit": {"보통이에요": 68, "슬림핏이에요": 30, "오버핏이에요": 1},
    }
    groups = {row["group_id"]: row for row in product["review_summary"]["groups"]}
    require(product["review_summary"]["provenance"] == "actual_snapshot", "Review source not verified")
    for key, percentages in expected.items():
        actual = {row["label"]: row["percentage"] for row in groups[key]["responses"]}
        require(actual == percentages, f"Review data changed: {key}")
        require(sum(actual.values()) == groups[key]["percentage_sum"], f"Review total mismatch: {key}")
    require(config["size_result"]["review_source_group_id"] in groups, "Size source group missing")
    for response in ask["responses"]:
        for group_id in response.get("review_group_ids", []):
            require(group_id in groups, f"Answer references missing group {group_id}")
        for ref in response.get("source_refs", []):
            filename, *segments = ref.split(".")
            obj = read(filename)
            for segment in segments:
                require(isinstance(obj, dict) and segment in obj, f"Broken answer source: {ref}")
                obj = obj[segment]
        if response.get("answer_ref"):
            filename, *segments = response["answer_ref"].split(".")
            obj = read(filename)
            for segment in segments:
                require(segment in obj, f"Broken prepared answer: {response['answer_ref']}")
                obj = obj[segment]
    require(config["media"]["mode"] == "product_image_slideshow" and not config["media"]["video_ai_enabled"],
            "User's image-based demo decision is not reflected")
    for image in product["images"] + product["detail_images"]:
        asset(image["local_path"], image["sha256"])
    for path in config["media"]["image_paths"]:
        asset(path)
    test_video = config["media"].get("test_video")
    home_shopping_video = config["media"].get("home_shopping_video")
    for video, label in ((test_video, "video test"), (home_shopping_video, "home shopping video")):
        if not video:
            continue
        for field in ("path", "player_path", "subtitles_path", "chapters_path", "reference_transcript_path"):
            path = ROOT / video[field]
            require(path.is_file() and path.stat().st_size > 0, f"Missing {label} file: {path}")
    require(product["size_guide"]["unit"] == "cm" and len(product["size_guide"]["rows"]) == 8,
            "Size guide missing")
    require(all(len(row["values"]) == len(product["size_guide"]["sizes"])
                for row in product["size_guide"]["rows"]), "Incomplete size table")

    products = {p["product_id"]: p for p in candidates["products"]}
    require(len(products) == len(candidates["products"]), "Duplicate candidate IDs")
    require(sum(p["category"] == "BOTTOM" for p in products.values()) == 8, "Expected eight bottoms")
    require(sum(p["category"] == "SHOES" for p in products.values()) == 6, "Expected six shoes")
    for p in products.values():
        asset(p["image"], p["image_sha256"])
        require(p["sale_status_at_snapshot"] == "Y" and p["runtime_eligible"], "Inactive candidate")
        require(f"prdid={p['product_id']}" in p["product_url"], "Product URL mismatch")
        require(p["listed_sale_price"] - p["public_coupon_discount"] == p["price"], "Candidate price mismatch")
    require(len(looks["looks"]) == 3, "Expected three complete looks")
    for look in looks["looks"]:
        require(look["top_product_id"] == product["product_id"], "Look top mismatch")
        require(products[look["bottom_product_id"]]["category"] == "BOTTOM", "Look bottom mismatch")
        require(products[look["shoes_product_id"]]["category"] == "SHOES", "Look shoes mismatch")
        for path in look["product_images"]:
            asset(path)
        p = asset(look["static_lookbook_image"])
        require(look["asset_status"] == "GENERATED_AND_VISUALLY_REVIEWED", "Lookbook not ready")
        width, height = struct.unpack(">II", p.read_bytes()[16:24])
        require(width >= 1024 and height >= 1024, "Lookbook resolution unexpectedly small")
        require(look["required_label"] == "AI 코디 예시" and look["selected_size"] is None,
                "Look labels or shoe size policy incorrect")

    engine, evidence = replay_fixture(scenario)
    live, prd = scenario["scope"]["broadcast_id"], scenario["scope"]["product_id"]
    require(evidence["previous_customers"] == 8 and evidence["current_customers"] == 26
            and evidence["change_percent"] == 225, "Scenario spike mismatch")
    approval = engine.approve_app(live, prd, "integration-approval", scenario["approve_at"])
    visible = {role: engine.personalization_visible(customer, live, prd, scenario["approve_at"])
               for role, customer in scenario["customers"].items()}
    require(len(approval.targets) == 33 and visible == {"target": True, "non_target": False, "dismissed": False},
            "Approval targeting mismatch")
    result = engine.finish_result(live, prd, scenario["result_metrics"], scenario["result_at"])
    actual_metrics = {m["metric"]: m for m in result["metrics"]}
    for metric in config["director_result"]["metrics"]:
        actual = actual_metrics[metric["key"]]
        require((actual["before"], actual["after"], actual["change_percent"])
                == (metric["before"], metric["after"], metric["change_percent_rounded"]),
                "Director result configurations disagree")
    # Verify the review walkthrough can pause and resume without replaying old events.
    resumed = NeedDirector()
    for entry in scenario["events"]:
        if entry["at"] <= 68:
            resumed.ingest(Event(**entry["event"]), entry["at"])
    require(resumed.suggestion_visible(live, prd, "customer-A"), "A suggestion missing at pause")
    require(not resumed.suggestion_visible(live, prd, "customer-C"), "C dismissal lost at pause")
    for entry in scenario["events"]:
        if entry["at"] > 68:
            resumed.ingest(Event(**entry["event"]), entry["at"])
    require(resumed.evaluate_spike(live, prd, 120)["current_customers"] == 26, "Resumed scenario diverges")

    knowledge = read("video-knowledge")
    for video in knowledge["videos"]:
        require((ROOT / video["path"]).is_file(), "Missing indexed video: " + video["asset_id"])
        require(not video["allow_current_product_grounding"] or video["product_match"], "Reference video cannot ground current product")
        for chapter in video["chapters"]:
            require(0 <= chapter["start"] < chapter["end"] <= video["duration_s"], "Invalid scene range: " + chapter["id"])
            require(chapter["source_refs"], "Missing scene evidence: " + chapter["id"])
            for ref in chapter["source_refs"]:
                require((ROOT / ref.split("#")[0]).is_file(), "Missing video evidence: " + ref)
    review = json.loads((ROOT / "assets/video/reference/transcript-review.json").read_text())
    for frame in review["frames"]:
        asset(frame["path"], frame["sha256"])
    require(sha256((ROOT / "assets/video/reference/core-authentic-cardigan.mp4").read_bytes()).hexdigest()
            == review["source_sha256"], "Reviewed MP4 source changed")

    report = {
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "status": "PASS",
        "scope": "Offline fixture, image integrity, cross-file references, deterministic logic; not app UI testing",
        "main_product_images": len(product["images"]) + len(product["detail_images"]),
        "verified_review_groups": len(groups),
        "size_measurement_rows": len(product["size_guide"]["rows"]),
        "styling_bottoms": 8,
        "styling_shoes": 6,
        "generated_lookbooks": 3,
        "spike": {"previous": 8, "current": 26, "change_percent": 225},
        "approval_targets": len(approval.targets),
        "customer_personalization": visible,
        "paused_resume_scenario": "PASS",
        "app_ui_tests": "SEPARATE_BROWSER_VERIFICATION_REQUIRED",
        "app_ui_report": "docs/evidence/browser-verification.json",
        "legacy_media_fixture_status": config["media"]["video_ai_status"],
        "video_knowledge": {"scope": "Bounded reviewed frames and authored sample script; not unrestricted video AI",
                            "assets": len(knowledge["videos"]),
                            "indexed_chapters": sum(len(video["chapters"]) for video in knowledge["videos"]),
                            "verified_reference_frames": len(review["frames"]),
                            "asr_status": "EXECUTED_DRAFT_NOT_AUDIO_VERIFIED",
                            "browser_report": "docs/evidence/video-experience-verification.json"},
        "test_video_asset": "AVAILABLE" if test_video else "NOT_PROVIDED",
        "home_shopping_video_asset": "AVAILABLE" if home_shopping_video else "NOT_CONFIGURED"
    }
    if write_report:
        (ROOT / "docs" / "verification-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-report", action="store_true")
    main(parser.parse_args().write_report)
