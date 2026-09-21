#!/usr/bin/env python3
"""Read public GS SHOP product data into a temporary evidence directory.

This is a preparation tool, never a runtime dependency of the demo. It does not
overwrite fixtures or assign option availability. It stores aggregate reviews
only, excluding individual reviewers and customer identifiers.
"""

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


PRODUCT_ID = "1084192893"
PRODUCT_URL = f"https://m.gsshop.com/prd/prd.gs?prdid={PRODUCT_ID}"
BUYING_URL = f"https://m.gsshop.com/prd/prdBuyingInfo.gs?prdid={PRODUCT_ID}&format=json"
REVIEW_URL = (
    f"https://m.gsshop.com/product/api/revw/v0/reviewMain/{PRODUCT_ID}"
    "?mseq=397078&prsnInclYn=Y&prsnFilterYn=N"
)


def read_url(url):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*"})
    with urlopen(request, timeout=30) as response:
        return response.read()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def aggregate_reviews(response):
    if response.get("resultCode") != "S0000":
        raise ValueError("Public review API did not return success")
    reviews = response["revwMain"]
    return {
        "product_id": str(reviews["prdCd"]),
        "rating": reviews["prdRevwGrade"],
        "review_count": reviews["allRevwTotCnt"],
        "groups": [
            {
                "label": group["evalItmNm"],
                "responses": [
                    {
                        "label": item["evalItmVal"],
                        "percentage": item["evalRatio"],
                        "response_count": item["evalCount"],
                    }
                    for item in group["evalTotal"]
                ],
            }
            for group in reviews["prdrevwEvalTotal"]
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("/tmp/gs-ai-live-main-source"))
    parser.add_argument("--download-images", action="store_true")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    html = read_url(PRODUCT_URL).decode("utf-8")
    match = re.search(r"\b(?:var|let|const)\s+renderJson\s*=\s*", html)
    if match is None:
        raise ValueError("Product page no longer exposes renderJson; inspect the page before updating fixtures")
    render, _ = json.JSONDecoder().raw_decode(html[match.end():])
    if str(render["prd"]["prdCd"]) != PRODUCT_ID:
        raise ValueError("Unexpected product returned")

    buying_response = json.loads(read_url(BUYING_URL))
    buying = buying_response["_CONTENT_KEY"]["prd"]
    reviews = aggregate_reviews(json.loads(read_url(REVIEW_URL)))
    product = render["prd"]
    # Whitelist fields: never copy the complete session/customer response.
    summary = {
        "product_id": PRODUCT_ID,
        "product_name": product["nameInfo"]["productNm"],
        "price": render["pmo"]["prc"]["salePrc"],
        "rating": product["nameInfo"]["revwAvgScore"],
        "review_count": render["prdrevw"]["prdrevwTotCnt"],
        "options_raw": product["attrTypList"],
        "images": product["mediaInfo"]["images"],
        "detail_image_urls": list(dict.fromkeys(re.findall(r'(?:data-)?src="([^"]+)"', product["prdImgDescd"]))),
        "shipping": product["dlvInfo"],
    }
    write_json(args.output_dir / "product-summary.json", summary)
    write_json(args.output_dir / "buying-info.json", {
        "product_information": buying["govPublsPrdInfo"],
        "size_guides": buying["clothsSizeGuideInfoList"],
        "manufacturer_guidance": buying["clothsFlexGuide"],
    })
    write_json(args.output_dir / "review-aggregate.json", reviews)
    write_json(args.output_dir / "sources.json", {
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "source_urls": [PRODUCT_URL, BUYING_URL, REVIEW_URL],
        "reviewer_records_included": False,
        "fixture_update": "Review differences and image mappings before manually updating frozen demo fixtures.",
    })
    if args.download_images:
        for number, url in enumerate(summary["images"], 1):
            (args.output_dir / f"gallery-{number:02}.jpg").write_bytes(read_url(url))
    print(f"Saved public aggregate evidence to {args.output_dir}")


if __name__ == "__main__":
    main()
