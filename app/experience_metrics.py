"""Pure public aggregates for the Director experience; never return ASK prose."""

from collections import Counter
import math
import re


CATEGORIES = [
    {"id": "size", "label": "사이즈"},
    {"id": "benefit", "label": "가격·혜택"},
    {"id": "delivery", "label": "배송"},
    {"id": "product", "label": "상품 정보"},
    {"id": "other", "label": "기타"},
]
TOPICS = {
    "size": ("사이즈는 어떻게 선택하나요?", "size"),
    "availability": ("원하는 옵션의 재고가 있나요?", "size"),
    "thickness": ("두께감은 어떤가요?", "product"),
    "color": ("색상은 어떤가요?", "product"),
    "review": ("구매 후기는 어떤가요?", "product"),
    "benefit": ("어떤 가격·혜택을 받을 수 있나요?", "benefit"),
    "delivery": ("배송은 언제 되나요?", "delivery"),
    "styling": ("어떻게 코디하면 좋을까요?", "other"),
    "other": ("그 밖의 상품 안내가 궁금해요", "other"),
}
INTENT_TOPICS = {"SIZE_GUIDANCE": "size", "BENEFIT": "benefit", "DELIVERY": "delivery",
                 "PRODUCT_THICKNESS": "thickness", "PRODUCT_COLOR": "color",
                 "PRODUCT_REVIEW": "review", "STYLING": "styling"}


def classify_topics(text, intents):
    """Return enum IDs only; this descriptive taxonomy does not change Need rules."""
    topics = {INTENT_TOPICS[intent] for intent in intents if intent in INTENT_TOPICS}
    compact = re.sub(r"\s+", "", text or "")
    if re.search(r"재고|품절|(?:55|66|77|88|사이즈).*(?:있나|있어|있을|남아)", compact):
        topics.discard("size")
        topics.add("availability")
    return [topic for topic in TOPICS if topic in topics] or ["other"]


def _received(row):
    value = row.get("received_at")
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def _outcomes(rows):
    participants = {row["customer_id"] for row in rows}
    completed = {row["customer_id"] for row in rows if row["event_type"] == "PURCHASE_DEMO_COMPLETE"}
    return {
        "size_questions": sum(row["event_type"] == "ASK_LIVE_SUBMIT"
                              and row.get("intent") == "SIZE_GUIDANCE" for row in rows),
        "detail_views": sum(row["event_type"] == "PRODUCT_DETAIL_OPEN" for row in rows),
        "active_customers": len(participants), "completed_customers": len(completed),
        "completion_rate_percent": round(len(completed) / len(participants) * 100, 1) if participants else None,
    }


def build_monitor(*, activity, requests, presence, now, approval, logs, comments):
    """Compute from this run's scoped UI input and server receive elapsed seconds.

    The caller supplies already scoped, deduplicated UI records. Approval times
    remain virtual domain times; ``virtual_now`` is supplied separately in that
    mapping, so demo clock changes cannot change the telemetry time windows.
    """
    now = max(0, float(now))
    visitors = {row["customer_id"] for row in activity if row["event_type"] == "LIVE_ENTER"}
    completed = visitors & {row["customer_id"] for row in activity
                            if row["event_type"] == "PURCHASE_DEMO_COMPLETE"}
    current_start = int(now // 60) * 60
    first_start = int(max(0, now - 1800) // 60) * 60
    buckets = [{"start": start, "end": start + 60,
                "counts": {category["id"]: 0 for category in CATEGORIES}}
               for start in range(first_start, current_start + 1, 60)]
    previous, current, ranking = Counter(), Counter(), Counter()
    for request in requests:
        received = _received(request)
        if received is None or received > now:
            continue
        topics = set(request.get("topics") or [INTENT_TOPICS.get(intent, "other")
                                               for intent in request.get("intents", [])])
        topics = topics & TOPICS.keys() or {"other"}
        categories = {TOPICS[topic][1] for topic in topics}
        if first_start <= received and (now - 1800 < received or now < 1800):
            bucket = buckets[int(received // 60) - first_start // 60]
            bucket["counts"].update({category: bucket["counts"][category] + 1
                                     for category in categories})
        if now - 1800 < received or now < 1800:
            ranking.update(topics)
        if now - 300 < received or now < 300:
            current.update(categories)
        elif now - 600 < received:
            previous.update(categories)
    category = max((item["id"] for item in CATEGORIES), key=lambda key: current[key])
    before, after = previous[category], current[category]
    change = round((after / before - 1) * 100, 1) if before else None
    label = next(item["label"] for item in CATEGORIES if item["id"] == category)
    if not after:
        status, insight_text = "empty", "최근 5분에 접수된 질문이 없습니다. 고객의 다음 질문을 기다리고 있어요."
        category = None
    elif not before:
        status = "new"
        insight_text = f"최근 5분 {label} 질문이 {after}건 접수됐어요. 직전 5분에는 없어 새 관심으로 표시합니다."
    else:
        status = "increase" if after > before else "decrease" if after < before else "steady"
        direction = "증가" if change > 0 else "감소" if change < 0 else "동일"
        comparison = f"{abs(change):g}% {direction}" if change else "동일"
        insight_text = f"최근 5분 {label} 질문은 {after}건으로, 직전 5분 {before}건 대비 {comparison}해요."
    host_log = next((row for row in reversed(logs) if row.get("action") == "HOST_DELIVERED"), None)
    targets = set(approval.get("targets", [])) if approval else set()
    exposed = {row["customer_id"] for row in activity
               if approval and row["event_type"] == "PERSONALIZATION_SHOWN"
               and row.get("metadata", {}).get("approval_id") == approval.get("approval_id")
               and row["customer_id"] in targets}
    highlighted = set(approval.get("highlighted_customers", [])) & targets if approval else set()
    approval_active = bool(approval and not approval.get("ended") and
                           approval.get("created_at", 0) <= approval.get("virtual_now", 0)
                           < approval.get("expires_at", 0))
    boundary = approval.get("activity_index", len(activity)) if approval else len(activity)
    boundary = max(0, min(len(activity), boundary))
    return {
        "source": "실제 고객 UI 수신", "as_of": now,
        "time_basis": "server_receive_elapsed_seconds",
        "viewers": {"online_customers": presence.get("online_customers", 0),
                    "sessions": presence.get("sessions", 0), "unique_visitors": len(visitors)},
        "comments": {"total": len(comments)},
        "conversion": {"completed_customers": len(completed), "visitor_customers": len(visitors),
                       "rate_percent": round(len(completed) / len(visitors) * 100, 1) if visitors else None},
        "trend": {"bucket_seconds": 60, "window_seconds": 1800,
                  "categories": [dict(item) for item in CATEGORIES], "buckets": buckets},
        "top_questions": [{"topic_id": topic, "label": TOPICS[topic][0], "count": count}
                          for topic, count in sorted(ranking.items(), key=lambda item: (-item[1], item[0]))[:5]],
        "insight": {"window_seconds": 300, "category": category,
                    "previous_count": before, "current_count": after, "change_percent": change,
                    "status": status, "text": insight_text,
                    "counts": {"previous": {item["id"]: previous[item["id"]] for item in CATEGORIES},
                               "current": {item["id"]: current[item["id"]] for item in CATEGORIES}}},
        "outcomes": {"approved": bool(approval), "approval_at": approval.get("created_at") if approval else None,
                     "source": "실제 UI 누적", "before": _outcomes(activity[:boundary]),
                     "after": _outcomes(activity[boundary:])},
        "actions": {
            "host": {"delivered": bool(host_log), "delivered_at": host_log["at"] if host_log else None},
            "app": {"approved": bool(approval), "approved_at": approval.get("created_at") if approval else None,
                    "target_count": len(targets), "expires_at": approval.get("expires_at") if approval else None,
                    "active": approval_active, "highlighted_customers": len(highlighted),
                    "exposed_customers": len(exposed)},
        },
    }
