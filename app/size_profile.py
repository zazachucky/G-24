"""Explicit, non-predictive sizing rules using the product's garment measures.

This module does not estimate a person's dimensions or learn a body-fit model.
Product stock and the currently selected purchase option are deliberately not
part of a sizing recommendation.
"""

import math


SIZES = ("55", "66", "77", "88")
REVIEW_LABEL = "상품 전체 사이즈 리뷰 · 유사 체형 만족률 아님"


def default_profile():
    """Return an independent prepared profile, preserving the existing 66 demo."""
    return {"height_cm": None, "usual_size": "66", "half_size": False,
            "fit": "regular", "garment_chest_cm": None}


def validate_profile(patch, current):
    """Merge a partial update without mutation; reject invalid values atomically."""
    if not isinstance(patch, dict) or not isinstance(current, dict):
        raise ValueError("프로필은 항목별 입력 객체여야 합니다.")
    profile = default_profile()
    if (set(patch) | set(current)) - set(profile):
        raise ValueError("지원하지 않는 프로필 항목입니다.")
    profile.update(current)
    profile.update(patch)
    for field, minimum, maximum, label in (
            ("height_cm", 140, 200, "키"),
            ("garment_chest_cm", 30, 80, "보유 의류 가슴단면")):
        value = profile[field]
        if value is not None and (type(value) not in (int, float)
                                  or not math.isfinite(value)
                                  or not minimum <= value <= maximum):
            raise ValueError("{}는 {}~{}cm의 숫자 또는 빈 값이어야 합니다.".format(label, minimum, maximum))
    if profile["usual_size"] not in SIZES:
        raise ValueError("평소 사이즈는 55·66·77·88 중에서 선택해 주세요.")
    if type(profile["half_size"]) is not bool:
        raise ValueError("반사이즈 여부는 참 또는 거짓이어야 합니다.")
    if profile["fit"] not in ("regular", "relaxed"):
        raise ValueError("선호 핏은 기본 또는 여유 있게 중에서 선택해 주세요.")
    return profile


def _size_review(product):
    """Keep the provider's size-group denominator and percentage unchanged."""
    group = next((row for row in product.get("review_summary", {}).get("groups", [])
                  if row.get("group_id") == "size"), {})
    matched = next((row for row in group.get("responses", [])
                    if row.get("label") == "잘 맞아요"), {})
    return {"matched_count": matched.get("response_count"),
            "total": group.get("response_count_sum"),
            "percentage": matched.get("percentage"), "label": REVIEW_LABEL}


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def recommend_size(profile, product):
    """Return a transparent garment comparison, or request manual checking.

    A supplied garment width replaces the usual-size baseline. Relaxed fit adds
    one option to that measured baseline only. Retailer half-size guidance sets
    a lower bound one option above the usual size; those two rules do not stack
    an unexplained extra increase. Height never changes the recommended size.

    API callers should use ``validate_profile`` first. Invalid direct-call input
    yields an unavailable result rather than a fabricated recommendation.
    """
    result = {
        "recommended_size": None, "label": "실측표를 보고 직접 확인해 주세요",
        "reasons": [], "measurements": {}, "review": _size_review(product),
        "source_refs": ["main-product.size_guide", "main-product.review_summary.groups.size"],
        "source": "가상프로필 · 준비 안내" if profile == default_profile()
                  else "입력 기준 · 실측 비교 데모",
    }

    def unavailable(reason):
        result["unavailable_reason"] = reason
        result["reasons"].append(reason)
        return result

    try:
        values = validate_profile(profile, default_profile())
    except ValueError as error:
        return unavailable(str(error))

    guide = product.get("size_guide", {})
    sizes = guide.get("sizes", [])
    rows = guide.get("rows", [])
    chest = next((row.get("values", []) for row in rows
                  if row.get("measurement") == "가슴단면"), [])
    if (guide.get("unit") != "cm" or list(sizes) != list(SIZES)
            or len(chest) != len(SIZES) or not all(_number(value) for value in chest)
            or any(left >= right for left, right in zip(chest, chest[1:]))):
        return unavailable("비교할 상품 가슴단면 실측표를 확인할 수 없어 사이즈를 제안하지 않습니다.")

    usual_index = SIZES.index(values["usual_size"])
    selected_index = usual_index
    result["reasons"].append("평소 입는 사이즈 {}를 기본 기준으로 삼았습니다.".format(values["usual_size"]))
    garment = values["garment_chest_cm"]
    if garment is not None:
        candidates = [index for index, width in enumerate(chest) if width >= garment]
        if not candidates:
            return unavailable("보유 의류 가슴단면 {:g}cm가 최대 88의 {:g}cm보다 큽니다. 실측표를 보고 직접 확인해 주세요."
                               .format(garment, chest[-1]))
        selected_index = candidates[0]
        result["reasons"].append(
            "잘 맞는 보유 의류 가슴단면 {:g}cm와 비교해, 같거나 큰 최소 옵션 {}({:g}cm)를 기준으로 삼았습니다."
            .format(garment, SIZES[selected_index], chest[selected_index]))
        if values["fit"] == "relaxed":
            selected_index += 1
            result["reasons"].append("여유 있는 핏은 실측 비교 기준보다 한 단계 큰 옵션을 고르는 데모 규칙을 적용했습니다.")
    elif values["fit"] == "relaxed":
        result["reasons"].append("보유 의류 실측이 없어 선호 핏만으로 사이즈를 키우지 않았습니다. 여유 비교에는 보유 의류 가슴단면이 필요합니다.")

    if values["half_size"]:
        selected_index = max(selected_index, usual_index + 1)
        result["source_refs"].append("main-product.size_guide.half_size_guidance")
        result["reasons"].append("상품의 반사이즈 크게 주문 안내에 따라, 평소 {}보다 한 단계 큰 옵션을 최소 기준으로 적용했습니다."
                                 .format(values["usual_size"]))
    if selected_index >= len(SIZES):
        return unavailable("입력한 조건은 최대 88보다 큰 옵션이 필요합니다. 더 큰 사이즈를 추정하지 않고 직접 확인을 안내합니다.")

    recommended = SIZES[selected_index]
    if recommended not in product.get("sizes", []):
        return unavailable("비교 결과에 해당하는 상품 사이즈를 확인할 수 없습니다. 상품 옵션을 직접 확인해 주세요.")
    measurements = {row["measurement"]: row["values"][selected_index]
                    for row in rows if isinstance(row.get("measurement"), str)
                    and len(row.get("values", [])) > selected_index
                    and _number(row["values"][selected_index])}
    result.update(recommended_size=recommended, label="{} 사이즈 참고 제안".format(recommended),
                  measurements=measurements)
    if values["height_cm"] is not None:
        length = measurements.get("총길이")
        result["reasons"].append("입력한 키 {:g}cm는 총길이{}를 살펴보는 참고 정보입니다. 키로 사이즈나 착용 위치를 추정하지 않습니다."
                                 .format(values["height_cm"], " {:g}cm".format(length) if length else ""))
    result["reasons"].append("가슴단면은 신체 둘레가 아닌 의류를 평평하게 놓고 잰 폭입니다. 소재·착용 취향에 따라 달라 실제 맞음새를 보장하지 않습니다.")
    return result
