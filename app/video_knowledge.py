"""Bounded video answers grounded in reviewed frames or explicitly authored scripts.

This runtime never calls ASR, uploads media, or uses an unreviewed transcript as fact.
"""
from copy import deepcopy
from functools import lru_cache
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_ASSET = "reference-core-authentic-cardigan-01"
SAMPLE_ASSET = "main-product-sample-120s"


@lru_cache(maxsize=1)
def _knowledge():
    return json.loads((ROOT / "fixtures/video-knowledge.json").read_text(encoding="utf-8"))


def video_catalog():
    """Return independent catalog/chapters data suitable for bootstrap JSON."""
    return deepcopy(_knowledge()["videos"])


def _unsupported(message):
    return {"intent": "UNSUPPORTED_VIDEO", "text": message,
            "provenance": "prepared_fallback", "label": "영상 근거 확인 필요",
            "source_refs": []}


def _time(seconds):
    return "%02d:%02d" % divmod(int(seconds), 60)


def lookup_video(text, asset_id, at=0):
    """Answer a question for one explicit asset; never borrow another video's facts.

    Returns VIDEO_CONTENT with a validated ``video`` seek target, or a bounded
    UNSUPPORTED_VIDEO reply without a target. ``at`` is the actual media clock.
    """
    asset = next((v for v in _knowledge()["videos"] if v["asset_id"] == asset_id), None)
    if not asset:
        return _unsupported("영상이 선택되지 않았거나 확인한 영상 자료가 없어요. 방송 화면에서 영상을 선택한 뒤 물어봐주세요.")
    if not isinstance(text, str) or not text.strip():
        return _unsupported("영상에서 궁금한 내용이나 찾으려는 장면을 알려주세요.")
    if isinstance(at, bool) or not isinstance(at, (int, float)) or not math.isfinite(at) or at < 0 or at > asset["duration_s"]:
        return _unsupported("현재 영상의 재생 위치를 확인할 수 없어요. 영상을 다시 선택한 뒤 물어봐주세요.")
    compact = re.sub(r"\s+", "", text).lower()
    reference = not asset["product_match"]
    if reference and re.search(r"sj와니|에스제이와니|1084192893|풀오버|현재상품|판매중인상품", compact):
        return _unsupported("이 참고 영상은 코어어센틱 가디건이며 현재 SJ와니 풀오버와 다른 상품이에요. 영상 내용을 현재 상품의 소재·사이즈·가격·혜택 근거로 연결할 수 없어요.")
    # These claims have no reviewed source in the supplied reference video.
    if reference and re.search(r"가격|얼마|판매가|사이즈|치수|키가|몸무게|체중|세탁|배송|환불|반품|원산지|혼용|함량|몇퍼센트|현재.*(혜택|행사)|지금.*(혜택|행사|적용)", compact):
        return _unsupported("그 정보는 이 참고 영상의 검수한 화면 근거로 확인할 수 없어요. 착용 사이즈·가격·소재 함량·현재 적용 혜택을 추측하지 않을게요. 목선·단추, 재킷 코디, 블랙 구성 등 확인한 장면은 안내할 수 있어요.")
    if re.search(r"모델.*(키|몸무게|체중|사이즈|몇)|쇼호스트.*(키|몸무게|체중|사이즈|몇)|착용사이즈|몇사이즈입", compact):
        return _unsupported("이 영상 자료에는 모델이나 쇼호스트의 착용 사이즈·신체 치수를 확인할 근거가 없어요. 상품의 의류 실측이나 가상 고객 추천과 구분해야 해요.")

    chapters = asset["chapters"]
    summary = bool(re.search(r"요약|전체내용|방송내용|영상내용|무슨내용", compact)) and not compact.startswith(("아까", "방금", "지금", "현재"))
    selected = []
    if summary:
        selected = [c for c in chapters if c["id"] in asset["summary_ids"]]
    else:
        scored = [(sum(len(k) for k in c["keywords"] if k.lower() in compact), c) for c in chapters]
        best = max(score for score, _ in scored)
        if best:
            selected = [c for score, c in scored if score == best][:1]
        else:
            timestamp = re.search(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)", text)
            second = re.search(r"(?<!\d)(\d+(?:\.\d+)?)\s*초", text)
            point = at
            if timestamp:
                point = int(timestamp.group(1)) * 60 + int(timestamp.group(2))
            elif second:
                point = float(second.group(1))
            current_query = bool(re.fullmatch(r"(아까|방금|지금|현재)(뭐라고|뭐|어떤|무슨)?(말|설명|내용|장면|했|해|이야기|알려|줘|요|야|이|어|있|보여|주|은|는|한|거|번|다시|었|고|랬|지|까|해줘|알려줘|나요|주세요|을|를|다|보|가|나|오|하|라|고|요약|\?|!|\.)*", compact))
            time_query = (timestamp or second) and bool(re.search(r"장면|내용|말|설명|보여|이동|찾", compact))
            if not (current_query or time_query) or point < 0 or point >= asset["duration_s"]:
                return _unsupported("이 질문에 맞는 검수된 영상 근거를 찾지 못했어요. 영상 요약, 목선·단추, 재킷 코디, 색상 구성처럼 확인 가능한 장면을 물어봐주세요." if reference else "제작 대본에서 이 질문의 근거를 찾지 못했어요. 소재·두께·66 실측·재고·코디·가격·배송 장면을 물어봐주세요.")
            # Return only the chapter covering the actual point; no invented gap content.
            selected = [c for c in chapters if c["start"] <= point < c["end"]][:1]
            if not selected:
                return _unsupported(_time(point) + " 시점은 상세 검수한 장면 구간에 포함되지 않아요. 영상 요약을 요청하거나 장면 목록에서 확인한 구간을 선택해주세요.")

    first = selected[0]
    evidence = list(dict.fromkeys(ref for chapter in selected for ref in chapter["source_refs"]))
    prefix = "참고 영상의 확인한 화면 자막·장면을 안내해요. " if reference else "상품 설명 샘플의 제작 대본을 기준으로 안내해요. "
    body = "\n".join(_time(c["start"]) + " · " + c["text"] for c in selected)
    suffix = "\n현재 상품과 다른 녹화 참고 영상의 내용이에요." if reference else "\n실제 방송의 자동 전사 결과가 아니며, 대본에 표시한 데모·스냅샷 조건을 유지해요."
    return {"intent": "VIDEO_CONTENT", "text": prefix + body + suffix,
            "provenance": asset["provenance"],
            "label": "참고 영상 · 확인한 화면 근거" if reference else "상품 샘플 · 제작 대본 기반",
            "source_refs": evidence,
            "video": {"asset_id": asset_id, "chapter_id": first["id"], "start": first["start"], "end": first["end"],
                      "label": first["label"]}}
