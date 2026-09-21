"""Shared, local-only application state; domain decisions use NeedDirector.

Only this service supplies timestamps to the engine. Interactive sessions use a
monotonic receive clock; the explicit demo controls freeze/advance virtual time.
No customer question or profile is written to the public Director audit log.
"""

from __future__ import annotations

from copy import deepcopy
from collections import Counter
from dataclasses import asdict
import json
import math
from pathlib import Path
import re
from threading import RLock
import time
import uuid

from prototype.need_director import Event, NeedDirector
from app.experience_metrics import build_monitor, classify_topics
from app.video_knowledge import REFERENCE_ASSET, lookup_video, video_catalog
from app.size_profile import default_profile, recommend_size, validate_profile


ROOT = Path(__file__).resolve().parents[1]
CUSTOMERS = {"customer-A": "고객 A", "customer-B": "고객 B", "customer-C": "고객 C"}
DEFAULT_UI = {
    "color": "그레이", "size": "66", "look": "LOOK_01",
    "orientation": "portrait", "active_result": None, "image_index": 0,
    "media_mode": "image", "video_time": 0, "video_paused": True,
    "video_muted": True, "video_volume": 1,
    "purchase_quantity": 1,
    "video_asset_id": REFERENCE_ASSET,
}
EVENT_TYPES = {
    "SIZE_TAB_OPEN", "REVIEW_SIZE_VIEW", "ASK_LIVE_SUBMIT",
    "AI_SUGGESTION_ACCEPT", "AI_SUGGESTION_DISMISS", "QUICK_ACTION_CLICK",
    "PURCHASE_CLICK", "PRODUCT_DETAIL_VIEW", "PRODUCT_DETAIL_OPEN",
    "REVIEW_VIEW", "LOOK_SELECT", "OPTION_SELECT", "BENEFIT_VIEW",
    "STYLING_VIEW", "SIZE_RESULT_VIEW", "PRODUCT_INQUIRY_CLICK",
    "LIVE_ENTER", "BENEFIT_DETAIL_OPEN", "STYLING_OPEN", "STYLING_LOOK_CHANGE",
    "STYLING_PRODUCT_CLICK", "AI_SUGGESTION_SHOWN", "BENEFIT_RESULT_VIEW", "LIVE_RETURN",
    "STYLING_RESULT_VIEW", "PURCHASE_DEMO_COMPLETE",
    "PRODUCT_IMAGE_VIEW", "ORIENTATION_CHANGE", "MEDIA_MODE_CHANGE",
    "MEDIA_PLAY", "MEDIA_PAUSE", "MEDIA_ERROR",
    "SHARE_COPY", "CART_OPEN", "STYLING_ALL_OPEN", "PERSONALIZATION_SHOWN",
    "VIDEO_SCENE_SEEK",
}
PRESENCE_LEASE_SECONDS = 15
RESULT_ROUTES = {"size", "benefit", "styling", "detail", "purchase", "guide", "complete", "cart", "styling_all"}
HOST_TEXT = "평소 착용하시는 사이즈와 반사이즈 선택 기준을 안내해주세요. 상세 실측표와 선호하는 핏을 함께 확인하도록 안내해주세요."
NEED_AGGREGATE_SOURCE = "서버 Need 집계 · UI/시연 공통 규칙"


class APIError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class AppState:
    def __init__(self, root=ROOT, clock=time.monotonic):
        self.root = Path(root)
        self.clock = clock
        self.lock = RLock()
        self.fixtures = {
            key: json.loads((self.root / "fixtures" / filename).read_text())
            for key, filename in {
                "product": "main-product.json", "demo": "demo-config.json",
                "ask": "ask-live.json", "looks": "styling-looks.json",
                "candidates": "styling-candidates.json", "scenario": "director-scenario.json",
            }.items()
        }
        self.scope = self.fixtures["scenario"]["scope"]
        self.responses = {item["intent"]: item for item in self.fixtures["ask"]["responses"]}
        self._reset("interactive")

    def _reset(self, mode):
        self.engine = NeedDirector()
        self.engine._advance(0)
        self.run_id = uuid.uuid4().hex
        self.now = 0.0
        self.mode = mode
        self.ended = False
        self.wall_anchor = self.clock()
        self.time_anchor = 0.0
        self.next_tick = 60.0
        self.fixture_index = 0
        self.fixture_started = False
        self.logs = []
        self.origins = {}
        self.messages = {}
        self.last_intents = {}
        self.requests = {}
        self.pending = {}
        self.activity = []
        self.event_metadata = {}
        self.presence = {}
        self.entered_customers = set()
        self.notices = {}
        self.comments = {}
        self.carts = {customer: {} for customer in CUSTOMERS}
        self.cart_requests = {}
        self.cart_checkout_items = {}
        self.profiles = {customer: default_profile() for customer in CUSTOMERS}
        self.approval_sequence = None
        self.ui = {customer: deepcopy(DEFAULT_UI) for customer in CUSTOMERS}
        self.context_versions = {customer: 0 for customer in CUSTOMERS}
        self.host_text = HOST_TEXT
        self.latest_evidence = self._empty_evidence()
        self._log("RESET", "control", "새 실행을 초기화했습니다.")

    def _empty_evidence(self):
        return {"previous_customers": 0, "current_customers": 0, "change_percent": None,
                "window_seconds": 60, "as_of": 0, "spike": False,
                "source": "Prototype Simulation"}

    def _log(self, action, origin, detail):
        self.logs.append({"sequence": len(self.logs) + 1, "at": self.now,
                          "action": action, "origin": origin, "detail": detail})

    def _received_at(self):
        return max(0, self.clock() - self.wall_anchor)

    def _advance_to(self, target, include_target=True):
        if target < self.now:
            raise APIError("시간은 되돌릴 수 없습니다.")
        while self.next_tick < target or (include_target and self.next_tick == target):
            tick = self.next_tick
            self.now = tick
            self.latest_evidence = self.engine.evaluate_spike(**self.scope, now=tick)
            self.next_tick += 60
            self._log("ANALYSIS", "server", {
                "previous_customers": self.latest_evidence["previous_customers"],
                "current_customers": self.latest_evidence["current_customers"],
                "spike": self.latest_evidence["spike"],
            })
        self.now = float(target)
        self.engine._advance(self.now)

    def _sync(self):
        if self.mode == "interactive" and not self.ended:
            self._advance_to(self.time_anchor + max(0, self.clock() - self.wall_anchor))
        self._settle_pending()

    def bootstrap(self):
        with self.lock:
            data = {key: deepcopy(value) for key, value in self.fixtures.items() if key != "scenario"}
            manifest = self.root / "assets/video/reference/manifest.json"
            data["media"] = json.loads(manifest.read_text()) if manifest.is_file() else None
            experience = self.root / "fixtures/experience-customer.json"
            data["experience"] = json.loads(experience.read_text()) if experience.is_file() else {}
            data["video_catalog"] = video_catalog()
            return data

    def state(self, customer_id=None):
        with self.lock:
            self._customer(customer_id, optional=True)
            self._sync()
            return self._snapshot(customer_id)

    def _customer(self, customer_id, optional=False):
        if customer_id is None and optional:
            return
        if not isinstance(customer_id, str) or customer_id not in CUSTOMERS:
            raise APIError("customer_id는 customer-A, customer-B, customer-C 중 하나여야 합니다.")

    @staticmethod
    def _string(value, name, limit=200, required=True):
        if value is None and not required:
            return value
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise APIError(f"{name} 값이 올바르지 않습니다.")
        return value.strip()

    def _product(self, customer):
        return self.engine.current_products.get((customer, self.scope["broadcast_id"]), self.scope["product_id"])

    def _key(self, customer):
        return (customer, self.scope["broadcast_id"], self._product(customer))

    def _campaign(self):
        return self.engine._campaign(**self.scope)

    def _reason(self, customer, approval_time=None):
        live, product = self.scope["broadcast_id"], self.scope["product_id"]
        at = self.engine.detected.get((live, product, customer))
        if self.ended:
            return "방송 종료"
        if (live, customer, "SIZE") in self.engine.dismissed:
            return "같은 방송에서 SIZE 제안 거절"
        if self._product(customer) != product:
            return "다른 상품을 보고 있음"
        if at is None:
            return "SIZE Need 미감지"
        if not (approval_time if approval_time is not None else self.now) - 120 < at:
            return "최근 120초 감지 범위 밖"
        return None

    def _row(self, customer):
        live, product = self.scope["broadcast_id"], self.scope["product_id"]
        detected = (live, product, customer) in self.engine.detected
        dismissed = (live, customer, "SIZE") in self.engine.dismissed
        campaign = self._campaign()
        reason = self._reason(customer)
        if campaign.approval:
            if customer not in campaign.approval.targets:
                reason = reason or "승인 당시 대상에 포함되지 않음"
            elif self.now >= campaign.approval.expires_at:
                reason = "승인 강조 300초 만료"
            elif customer in campaign.disabled_customers:
                reason = reason or "상품 전환으로 기존 강조 종료"
            elif not dismissed and not self.ended and self._product(customer) == product:
                reason = None
        return {
            "id": customer, "label": CUSTOMERS.get(customer, "시뮬레이션 고객"),
            "detected": detected, "dismissed": dismissed,
            "highlight": not self.ended and self.engine.personalization_visible(customer, live, product, self.now),
            "suggestion_visible": not self.ended and self._product(customer) == product
                and self.engine.suggestion_visible(live, product, customer),
            "eligible": reason is None, "exclusion_reason": reason,
            "current_product": self._product(customer),
        }

    def _preview(self):
        campaign = self._campaign()
        scope_key = (self.scope["broadcast_id"], self.scope["product_id"])
        population = set(CUSTOMERS) | {key[2] for key in self.engine.detected if key[:2] == scope_key}
        targets = list(campaign.approval.targets) if campaign.approval else sorted(
            customer for customer in population if self._reason(customer) is None)
        return {"targets": targets, "count": len(targets), "excluded": [
            {"id": customer, "reason": self._reason(customer) or "승인 당시 대상에 포함되지 않음"}
            for customer in sorted(population) if customer not in targets
        ]}

    def _snapshot(self, customer=None):
        campaign = self._campaign()
        scope_key = (self.scope["broadcast_id"], self.scope["product_id"])
        scoped_events = {event_id: event for event_id, event in self.engine.events.items()
                         if (event.broadcast_id, event.product_id) == scope_key}
        scoped_origins = Counter(self.origins.get(event_id) for event_id in scoped_events)
        approval = asdict(campaign.approval) if campaign.approval else None
        if approval:
            approval["targets"] = list(approval["targets"])
            approval["count"] = len(approval["targets"])
        result = {
            "run_id": self.run_id, "now": self.now, "mode": self.mode, "ended": self.ended,
            "next_analysis_at": self.next_tick,
            "scope": self.scope.copy(),
            "campaign": {"state": campaign.state,
                         "evidence": {**(campaign.evidence or self.latest_evidence),
                                      "source": NEED_AGGREGATE_SOURCE},
                         "approval": approval, "host_delivered": campaign.host_delivered,
                         "host_text": self.host_text, "result": campaign.result},
            "counts": {"events": len(scoped_events),
                       "detected": sum(key[:2] == scope_key for key in self.engine.detected),
                       "ui_events": scoped_origins["ui"], "fixture_events": scoped_origins["fixture"]},
            "customers": [self._row(cid) for cid in CUSTOMERS],
            "approval_preview": self._preview(), "logs": self.logs[-300:],
            "integration": self._integration(),
        }
        if customer:
            row = self._row(customer)
            key = self._key(customer)
            operator = self.fixtures["ask"]["operator_seed_message"]
            seed = self._message(customer, "OPERATOR", operator["text"], None,
                                 operator["provenance"], visibility="broadcast", at=0)
            seed["message_id"] = f"{self.run_id}-operator-seed"
            notices = []
            for notice in self.notices.values():
                if not notice["active"]:
                    continue
                message = self._message(customer, "OPERATOR", notice["text"], None,
                                        "operator_notice", visibility="broadcast", at=notice["created_at"],
                                        notice_id=notice["notice_id"], route=notice["route"], label="운영자 공용 안내")
                message["message_id"] = f"{self.run_id}:notice:{notice['notice_id']}"
                message["product_id"] = None
                notices.append(message)
            messages = self.messages.get(key, []) + notices
            messages = sorted(messages, key=lambda message: message["created_at"])
            result["customer"] = {"id": customer, "messages": [seed] + messages,
                                  "profile": self.profiles[customer],
                                  "size_recommendation": recommend_size(self.profiles[customer], self.fixtures["product"]),
                                  "cart": [item for item in self.carts[customer].values()
                                           if item["product_id"] == self._product(customer)],
                                  "ui": self.ui[customer], **{name: row[name] for name in
                                  ("suggestion_visible", "highlight", "detected", "dismissed")}}
        return deepcopy(result)

    def _ingest(self, event, origin, metadata=None, selection_fields=()):
        metadata = metadata or {}
        if event.event_id in self.engine.events and (
                self.engine.events[event.event_id] != event
                or self.event_metadata.get(event.event_id, {}) != metadata):
            raise APIError("event_id를 다른 내용에 재사용할 수 없습니다.", 409)
        outcome = self.engine.ingest(event, self.now)
        if outcome != "DUPLICATE":
            self.origins[event.event_id] = origin
            self.event_metadata[event.event_id] = deepcopy(metadata)
            detail = {"customer_id": event.customer_id, "event_type": event.event_type,
                      "outcome": outcome, "product_id": event.product_id}
            if event.intent is not None:
                detail["intent"] = event.intent
            if metadata:
                detail["metadata"] = deepcopy(metadata)
            self._log(event.event_type, origin, detail)
            if origin == "ui" and (event.broadcast_id, event.product_id) == (
                    self.scope["broadcast_id"], self.scope["product_id"]):
                self.activity.append({"at": self.now, "received_at": self._received_at(), "event_type": event.event_type,
                                      "customer_id": event.customer_id, "product_id": event.product_id,
                                      "intent": event.intent,
                                      "metadata": deepcopy(metadata), "selection_fields": tuple(selection_fields)})
        return outcome

    def _record_ui(self, customer, kind, metadata=None, selection_fields=()):
        return self._ingest(Event(uuid.uuid4().hex, customer, self.scope["broadcast_id"],
                                  self._product(customer), kind), "ui", metadata, selection_fields)

    def _integration(self):
        """Public summaries have enumerated actions only, never customer prose."""
        wall_now = self.clock()
        self.presence = {sid: value for sid, value in self.presence.items()
                         if value["expires_at"] > wall_now}
        sessions = Counter(value["customer_id"] for value in self.presence.values())
        counts = Counter(row["event_type"] for row in self.activity)
        requests = [value for key, value in self.requests.items()
                    if key[1:3] == (self.scope["broadcast_id"], self.scope["product_id"])]
        intents = Counter(intent for value in requests for intent in value["intents"])
        selections = {"colors": Counter(), "sizes": Counter(), "looks": Counter()}
        linked_products = Counter()
        for row in self.activity:
            for field in row["selection_fields"]:
                selections[{"color": "colors", "size": "sizes", "look": "looks"}[field]][row["metadata"][field]] += 1
            if row["event_type"] == "STYLING_PRODUCT_CLICK" and row["metadata"].get("product_id"):
                linked_products[row["metadata"]["product_id"]] += 1
        def distribution(counter, key="value"):
            return [{key: value, "count": count} for value, count in sorted(counter.items())]
        def measurements(rows):
            counter = Counter(row["event_type"] for row in rows)
            return {"asks": counter["ASK_LIVE_SUBMIT"], "size_views": counter["SIZE_RESULT_VIEW"],
                    "purchase_clicks": counter["PURCHASE_CLICK"], "purchase_completions": counter["PURCHASE_DEMO_COMPLETE"]}
        customers = []
        for customer in CUSTOMERS:
            actions = [row for row in self.activity if row["customer_id"] == customer]
            ui = self.ui[customer]
            customers.append({"id": customer, "online": sessions[customer] > 0, "sessions": sessions[customer],
                              "events": len(actions), "last_event": actions[-1]["event_type"] if actions else None,
                              "last_at": actions[-1]["at"] if actions else None,
                              "selection": {key: ui[key] for key in ("color", "size", "look")},
                              **{key: ui[key] for key in ("active_result", "media_mode", "orientation")}})
        approval = self._campaign().approval
        boundary = self.approval_sequence if self.approval_sequence is not None else len(self.activity)
        presence = {"online_customers": len(sessions), "sessions": sum(sessions.values()),
                    "lease_seconds": PRESENCE_LEASE_SECONDS}
        approval_metrics = None if approval is None else {
            **asdict(approval), "virtual_now": self.now, "ended": self.ended,
            "activity_index": boundary,
            "highlighted_customers": [customer for customer in CUSTOMERS if self._row(customer)["highlight"]]}
        monitor = build_monitor(activity=self.activity, requests=requests, presence=presence,
                                now=self._received_at(), approval=approval_metrics, logs=self.logs,
                                comments=list(self.comments.values()))
        return {
            "source": "실제 UI 이용 집계", "scope": self.scope.copy(),
            "presence": presence, "monitor": monitor,
            "comments": list(self.comments.values())[-100:],
            "totals": {"events": len(self.activity), "customers": len({row["customer_id"] for row in self.activity}),
                       "asks": counts["ASK_LIVE_SUBMIT"], "size_views": counts["SIZE_RESULT_VIEW"],
                       "benefit_views": counts["BENEFIT_RESULT_VIEW"], "styling_views": counts["STYLING_RESULT_VIEW"],
                       "detail_views": counts["PRODUCT_DETAIL_OPEN"], "purchase_clicks": counts["PURCHASE_CLICK"],
                       "purchase_completions": counts["PURCHASE_DEMO_COMPLETE"], "media_errors": counts["MEDIA_ERROR"]},
            "event_counts": dict(counts), "intents": distribution(intents, "intent"),
            "selections": {key: distribution(value) for key, value in selections.items()},
            "linked_products": distribution(linked_products, "product_id"), "customers": customers,
            "recent": [{key: value for key, value in row.items() if key != "selection_fields"}
                       for row in reversed(self.activity[-50:])],
            "response": {"pending": sum(value["status"] == "pending" for value in requests),
                         "completed": sum(value["status"] == "completed" for value in requests),
                         "cancelled": sum(value["status"] == "cancelled" for value in requests),
                         "fallback": sum(value["status"] == "completed" and value["fallback"] for value in requests)},
            "measured": {"approval_at": approval.created_at if approval else None,
                         "before": measurements(self.activity[:boundary]), "after": measurements(self.activity[boundary:])},
            "notices": [{**{key: value for key, value in notice.items() if key != "seen_by"},
                         "seen_count": len(notice["seen_by"]), "seen_by": sorted(notice["seen_by"])}
                        for notice in self.notices.values()],
        }

    def _replay(self, until):
        events = self.fixtures["scenario"]["events"]
        while self.fixture_index < len(events) and events[self.fixture_index]["at"] <= until:
            entry = events[self.fixture_index]
            # All events at a scheduled boundary are ingested before that tick.
            self._advance_to(entry["at"], include_target=False)
            self._ingest(Event(**entry["event"]), "fixture")
            self.fixture_index += 1
        self._advance_to(max(self.now, until))

    def action(self, data):
        with self.lock:
            if not isinstance(data, dict):
                raise APIError("JSON 객체가 필요합니다.")
            action = self._string(data.get("action"), "action")
            allowed = {
                "reset": set(), "demo_start": set(), "demo_spike": set(),
                "approve_app": {"approval_id"}, "host_deliver": {"text"},
                "show_result": set(), "advance": {"seconds"}, "end": set(),
                "switch_product": {"product_id"}, "ui_state": {"patch"},
                "event": {"event_type", "intent", "need", "event_id", "metadata"},
                "ask": {"text", "request_id", "fault"},
                "presence": {"session_id", "status"},
                "notice_publish": {"notice_id", "text", "route"},
                "notice_retract": {"notice_id"}, "notice_seen": {"notice_id"},
                "comment_publish": {"comment_id", "text"},
                "cart_add": {"request_id", "color", "size", "quantity"},
                "cart_update": {"request_id", "item_id", "quantity"},
                "cart_checkout": {"item_id"},
                "profile_update": {"patch"},
            }
            if action not in allowed:
                raise APIError("알 수 없는 action입니다.")
            if set(data) - {"action", "run_id", "customer_id"} - allowed[action]:
                raise APIError("허용되지 않은 필드입니다. 클라이언트 시각은 받지 않습니다.")
            if not isinstance(data.get("run_id"), str) or data["run_id"] != self.run_id:
                raise APIError("이전 실행의 요청입니다. 현재 상태를 다시 불러와주세요.", 409)
            customer = data.get("customer_id")
            self._customer(customer, optional=action not in {"ask", "event", "switch_product", "ui_state", "presence", "notice_seen", "comment_publish", "cart_add", "cart_update", "cart_checkout", "profile_update"})
            self._sync()
            if self.ended and action not in {"reset", "demo_start", "ui_state", "end", "presence", "notice_seen", "notice_retract"}:
                raise APIError("종료된 방송입니다. Reset 후 다시 시작해주세요.", 409)
            extra = {}
            try:
                if action in {"reset", "demo_start"}:
                    self._reset("demo" if action == "demo_start" else "interactive")
                    if action == "demo_start":
                        self.fixture_started = True
                        self._replay(68)
                        self._log("DEMO_START", "control", "Fixture를 68초까지 재생했습니다.")
                elif action == "demo_spike":
                    if not self.fixture_started:
                        raise APIError("Start Need Demo를 먼저 실행해주세요.", 409)
                    if self.fixture_index < len(self.fixtures["scenario"]["events"]):
                        if self.now > self.fixtures["scenario"]["events"][self.fixture_index]["at"]:
                            raise APIError("Fixture 시각을 지났습니다. Start Need Demo로 다시 시작해주세요.", 409)
                        self._replay(120)
                        self._log("DEMO_SPIKE", "control", "남은 Fixture만 120초까지 재생했습니다.")
                elif action == "advance":
                    seconds = data.get("seconds")
                    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or not 0 <= seconds <= 86400:
                        raise APIError("seconds는 0부터 86400 사이 유한한 숫자여야 합니다.")
                    self.mode = "demo"
                    self._advance_to(self.now + seconds)
                    self._log("ADVANCE", "control", {"seconds": seconds})
                elif action == "approve_app":
                    approval_id = self._string(data.get("approval_id"), "approval_id")
                    if self.mode == "demo" and self._campaign().approval is None and self._campaign().state in {"ALERT", "ACTION"}:
                        self._advance_to(max(self.now, self.fixtures["scenario"]["approve_at"]))
                    previous = self._campaign().approval
                    approval = self.engine.approve_app(**self.scope, approval_id=approval_id, now=self.now)
                    if previous is None:
                        self.approval_sequence = len(self.activity)
                        self._log("APP_APPROVED", "director", {"target_count": len(approval.targets), "expires_at": approval.expires_at})
                elif action == "host_deliver":
                    text = self._string(data.get("text", HOST_TEXT), "text", 2000)
                    previous = self._campaign().host_delivered
                    self.engine.deliver_to_host(**self.scope, now=self.now)
                    if not previous:
                        self.host_text = text
                        self._log("HOST_DELIVERED", "director", "쇼호스트 전달을 완료했습니다 (로컬 시뮬레이션).")
                elif action == "show_result":
                    approval = self._campaign().approval
                    if approval is None:
                        raise APIError("APP 승인이 먼저 필요합니다.", 409)
                    self.mode = "demo"
                    self._advance_to(max(self.now, approval.created_at + 30))
                    previous = self._campaign().result
                    self.engine.finish_result(**self.scope, metrics=self.fixtures["scenario"]["result_metrics"], now=self.now)
                    if previous is None:
                        self._log("RESULT", "control", "Prototype Simulation 준비 결과를 표시했습니다.")
                elif action == "end":
                    if not self.ended:
                        self.ended = True
                        for key in self.pending:
                            self.requests[key]["status"] = "cancelled"
                        self.pending.clear()
                        for conversation in self.messages.values():
                            for message in conversation:
                                if message["status"] == "pending":
                                    message.update(status="complete", text="방송이 종료되어 요청을 취소했습니다.")
                        self._log("BROADCAST_END", "control", "방송 종료로 모든 강조를 해제했습니다.")
                elif action == "switch_product":
                    product = self._string(data.get("product_id"), "product_id", 80)
                    if not re.fullmatch(r"[A-Za-z0-9_-]+", product):
                        raise APIError("product_id 형식이 올바르지 않습니다.")
                    previous_product = self._product(customer)
                    if product != previous_product:
                        self.context_versions[customer] += 1
                        self.engine.switch_product(customer, self.scope["broadcast_id"], product, self.now)
                        self.ui[customer]["active_result"] = None
                        self._cancel_pending(customer)
                        self._log("PRODUCT_SWITCH", "ui", {"customer_id": customer,
                                                          "from_product": previous_product,
                                                          "to_product": product})
                elif action == "ui_state":
                    self._patch_ui(customer, data.get("patch"))
                elif action == "presence":
                    self._presence(customer, data)
                elif action in {"notice_publish", "notice_retract", "notice_seen"}:
                    self._notice(action, customer, data)
                elif action == "comment_publish":
                    self._comment(customer, data)
                elif action in {"cart_add", "cart_update", "cart_checkout"}:
                    self._cart(action, customer, data)
                elif action == "profile_update":
                    profile = validate_profile(data.get("patch"), self.profiles[customer])
                    if profile != self.profiles[customer]:
                        self.profiles[customer] = profile
                        self._record_ui(customer, "PROFILE_UPDATE")
                elif action == "event":
                    kind = self._string(data.get("event_type"), "event_type")
                    if kind not in EVENT_TYPES:
                        raise APIError("지원하지 않는 event_type입니다.")
                    intent = self._string(data.get("intent"), "intent", required=False)
                    valid_intents = set(self.responses) | {"SIZE_GUIDANCE", "BENEFIT", "STYLING", "UNSUPPORTED",
                                                          "UNSUPPORTED_VIDEO", "VIDEO_CONTENT", "AMBIGUOUS_FOLLOWUP", "CLARIFICATION"}
                    if intent is not None and intent not in valid_intents:
                        raise APIError("지원하지 않는 intent입니다.")
                    need = self._string(data.get("need"), "need", required=False)
                    if need is not None and need not in {"SIZE", "BENEFIT", "STYLING"}:
                        raise APIError("지원하지 않는 need입니다.")
                    if kind in {"AI_SUGGESTION_ACCEPT", "AI_SUGGESTION_DISMISS"} and need != "SIZE":
                        raise APIError("SIZE 제안의 need=SIZE가 필요합니다.")
                    event_id = self._string(data.get("event_id", uuid.uuid4().hex), "event_id")
                    metadata = self._metadata(kind, data.get("metadata", {}))
                    if kind == "PERSONALIZATION_SHOWN":
                        approval = self._campaign().approval
                        if not approval or metadata.get("approval_id") != approval.approval_id:
                            raise APIError("현재 승인 ID가 필요합니다.", 409)
                        event_id = f"shown:{self.run_id}:{approval.approval_id}:{customer}"
                        if event_id not in self.engine.events and not self._row(customer)["highlight"]:
                            raise APIError("현재 개인화가 적용된 고객만 표시 확인할 수 있습니다.", 409)
                    outcome = self._ingest(Event(event_id, customer, self.scope["broadcast_id"], self._product(customer), kind, intent, need), "ui", metadata)
                    extra["event_outcome"] = outcome
                    if outcome == "SIZE_RESULT":
                        self.ui[customer]["active_result"] = "size"
                        extra["route"] = "size"
                    if kind == "PURCHASE_DEMO_COMPLETE" and outcome != "DUPLICATE":
                        checkout = self.cart_checkout_items.pop(customer, None) or {}
                        cart_id = checkout.get("item_id")
                        item = self.carts[customer].get(cart_id)
                        if item and all(item[key] == self.ui[customer][key] for key in ("color", "size")):
                            remaining = item["quantity"] - checkout["quantity"]
                            if remaining > 0:
                                item["quantity"] = remaining
                            else:
                                del self.carts[customer][cart_id]
                elif action == "ask":
                    extra.update(self._ask(customer, data))
            except APIError:
                raise
            except ValueError as exc:
                raise APIError(str(exc)) from exc
            return {**self._snapshot(customer), **extra}

    def _metadata(self, kind, metadata):
        """Allowlisted fixture values prevent arbitrary customer text in public data."""
        schemas = {
            "STYLING_PRODUCT_CLICK": {"product_id": {p["product_id"] for p in self.fixtures["candidates"]["products"]}},
            "PRODUCT_DETAIL_OPEN": {"tab": {"description", "size", "reviews", "inquiry", "delivery"}},
            "QUICK_ACTION_CLICK": {"action": {"size", "benefit", "styling"}},
            "MEDIA_ERROR": {"kind": {"video", "image"}},
            "PERSONALIZATION_SHOWN": {"approval_id": {self._campaign().approval.approval_id} if self._campaign().approval else set()},
            "VIDEO_SCENE_SEEK": {"asset_id": {asset["asset_id"] for asset in video_catalog()},
                                 "chapter_id": {chapter["id"] for asset in video_catalog() for chapter in asset["chapters"]}},
        }
        schema = schemas.get(kind, {})
        if not isinstance(metadata, dict) or set(metadata) - set(schema):
            raise APIError("허용되지 않은 이벤트 metadata입니다.")
        for key, value in metadata.items():
            if not isinstance(value, str) or value not in schema[key]:
                raise APIError(f"metadata.{key} 값이 올바르지 않습니다.")
        if kind == "VIDEO_SCENE_SEEK":
            asset = next((asset for asset in video_catalog() if asset["asset_id"] == metadata.get("asset_id")), None)
            if not asset or metadata.get("chapter_id") not in {chapter["id"] for chapter in asset["chapters"]}:
                raise APIError("영상과 장면의 출처가 일치하지 않습니다.")
        return metadata.copy()

    def _presence(self, customer, data):
        session_id = self._string(data.get("session_id"), "session_id", 128)
        if not re.fullmatch(r"[A-Za-z0-9_-]+", session_id):
            raise APIError("session_id 형식이 올바르지 않습니다.")
        status = data.get("status")
        if not isinstance(status, str) or status not in {"active", "leave"}:
            raise APIError("presence status는 active 또는 leave여야 합니다.")
        if status == "active":
            self.presence[session_id] = {"customer_id": customer, "expires_at": self.clock() + PRESENCE_LEASE_SECONDS}
            if customer not in self.entered_customers:
                self.entered_customers.add(customer)
                if not self.ended:
                    self._record_ui(customer, "LIVE_ENTER")
        elif self.presence.get(session_id, {}).get("customer_id") == customer:
            del self.presence[session_id]

    def _comment(self, customer, data):
        """Only explicitly submitted public comments enter the shared stream."""
        comment_id = self._string(data.get("comment_id"), "comment_id", 128)
        if not re.fullmatch(r"[A-Za-z0-9_-]+", comment_id):
            raise APIError("comment_id 형식이 올바르지 않습니다.")
        text = self._string(data.get("text"), "text", 300)
        previous = self.comments.get(comment_id)
        if previous:
            if previous["customer_id"] != customer or previous["text"] != text:
                raise APIError("comment_id를 다른 댓글에 재사용할 수 없습니다.", 409)
            return
        if self._product(customer) != self.scope["product_id"]:
            raise APIError("현재 방송 상품으로 돌아온 뒤 댓글을 남겨주세요.", 409)
        self.comments[comment_id] = {"comment_id": comment_id, "customer_id": customer,
                                     "text": text, "created_at": self.now,
                                     "received_at": self._received_at()}
        self._record_ui(customer, "COMMENT_PUBLISH")

    def _cart_option(self, color, size):
        option = next((item for item in self.fixtures["product"]["options"]
                       if item["color"] == color and item["size"] == size), None)
        if not option:
            raise APIError("확인된 상품 옵션을 선택해주세요.")
        if option["page_sold_out"]:
            raise APIError("확인 당시 일시품절인 옵션입니다. 다른 옵션을 선택해주세요.", 409)
        return option

    def _cart(self, action, customer, data):
        product = self._product(customer)
        if product != self.scope["product_id"]:
            raise APIError("현재 방송 상품에서 장바구니를 이용해주세요.", 409)
        cart = self.carts[customer]
        if action == "cart_checkout":
            item_id = self._string(data.get("item_id"), "item_id", 128)
            item = cart.get(item_id)
            if not item or item["product_id"] != product:
                raise APIError("장바구니 상품을 찾을 수 없습니다.", 404)
            self._cart_option(item["color"], item["size"])
            self._patch_ui(customer, {"color": item["color"], "size": item["size"],
                                      "purchase_quantity": item["quantity"], "active_result": "purchase"})
            self.cart_checkout_items[customer] = {"item_id": item_id, "quantity": item["quantity"]}
            self._record_ui(customer, "PURCHASE_CLICK")
            return
        request_id = self._string(data.get("request_id"), "request_id", 128)
        quantity = data.get("quantity")
        if type(quantity) is not int or not (1 if action == "cart_add" else 0) <= quantity <= 10:
            raise APIError("수량은 1~10개 정수여야 합니다. 삭제는 0을 사용해주세요.")
        fingerprint = {key: value for key, value in data.items() if key not in {"run_id", "request_id"}}
        request_key = (customer, request_id)
        if request_key in self.cart_requests:
            if self.cart_requests[request_key] != fingerprint:
                raise APIError("request_id를 다른 장바구니 변경에 재사용할 수 없습니다.", 409)
            return
        if action == "cart_add":
            color = self._string(data.get("color"), "color", 30)
            size = self._string(data.get("size"), "size", 10)
            self._cart_option(color, size)
            item_id = f"{product}:{color}:{size}"
            previous = cart.get(item_id)
            total = quantity + (previous["quantity"] if previous else 0)
            if total > 10:
                raise APIError("같은 옵션은 최대 10개까지 담을 수 있습니다.")
            item = {"item_id": item_id, "product_id": product, "color": color, "size": size,
                    "quantity": total, "unit_price_krw": self.fixtures["product"]["price"]["sale_price_krw"]}
            cart[item_id] = item
            self._record_ui(customer, "CART_ADD", {key: item[key] for key in ("color", "size", "quantity")})
        else:
            item_id = self._string(data.get("item_id"), "item_id", 128)
            item = cart.get(item_id)
            if not item:
                raise APIError("장바구니 상품을 찾을 수 없습니다.", 404)
            if quantity != item["quantity"]:
                metadata = {"color": item["color"], "size": item["size"], "quantity": quantity}
                if quantity:
                    item["quantity"] = quantity
                else:
                    del cart[item_id]
                    if self.cart_checkout_items.get(customer, {}).get("item_id") == item_id:
                        self.cart_checkout_items.pop(customer)
                self._record_ui(customer, "CART_UPDATE" if quantity else "CART_REMOVE", metadata)
        self.cart_requests[request_key] = fingerprint

    def _notice(self, action, customer, data):
        notice_id = self._string(data.get("notice_id"), "notice_id", 128)
        if not re.fullmatch(r"[A-Za-z0-9_-]+", notice_id):
            raise APIError("notice_id 형식이 올바르지 않습니다.")
        if action == "notice_publish":
            text = self._string(data.get("text"), "text", 500)
            route = data.get("route")
            if route is not None and (not isinstance(route, str) or route not in {"size", "benefit", "styling", "detail"}):
                raise APIError("안내 route 값이 올바르지 않습니다.")
            previous = self.notices.get(notice_id)
            if previous:
                if previous["text"] != text or previous["route"] != route:
                    raise APIError("notice_id를 다른 안내에 재사용할 수 없습니다.", 409)
                return
            self.notices[notice_id] = {"notice_id": notice_id, "text": text, "route": route,
                                       "created_at": self.now, "active": True, "seen_by": set()}
            self._log("NOTICE_PUBLISHED", "director", {"notice_id": notice_id, "route": route})
            return
        notice = self.notices.get(notice_id)
        if notice is None:
            raise APIError("안내를 찾을 수 없습니다.", 404)
        if action == "notice_retract" and notice["active"]:
            notice["active"] = False
            self._log("NOTICE_RETRACTED", "director", {"notice_id": notice_id})
        elif action == "notice_seen" and notice["active"]:
            notice["seen_by"].add(customer)

    def _patch_ui(self, customer, patch):
        if not isinstance(patch, dict) or set(patch) - set(DEFAULT_UI):
            raise APIError("지원하지 않는 UI 상태입니다.")
        enums = {"color": {"그레이", "블랙", "크림", "라벤더"},
                 "size": set(self.fixtures["product"]["sizes"]),
                 "look": {look["look_id"] for look in self.fixtures["looks"]["looks"]},
                 "video_asset_id": {asset["asset_id"] for asset in video_catalog()},
                 "orientation": {"portrait", "landscape"}, "media_mode": {"image", "video", "reference"}}
        for key, value in patch.items():
            if key in enums and (not isinstance(value, str) or value not in enums[key]):
                raise APIError(f"{key} 값이 올바르지 않습니다.")
            if key == "active_result" and value is not None and (not isinstance(value, str) or value not in RESULT_ROUTES):
                raise APIError("active_result 값이 올바르지 않습니다.")
            if key == "image_index" and (type(value) is not int or not 0 <= value < len(self.fixtures["product"]["images"])):
                raise APIError("image_index 값이 올바르지 않습니다.")
            if key == "purchase_quantity" and (type(value) is not int or not 1 <= value <= 10):
                raise APIError("수량은 1~10개 정수여야 합니다.")
            if key in {"video_paused", "video_muted"} and type(value) is not bool:
                raise APIError(f"{key} 값이 올바르지 않습니다.")
            if key in {"video_time", "video_volume"} and (type(value) not in {int, float} or not math.isfinite(value) or value < 0 or (key == "video_volume" and value > 1)):
                raise APIError(f"{key} 값이 올바르지 않습니다.")
        changes = {key: value for key, value in patch.items() if value != self.ui[customer][key]}
        self.ui[customer].update(patch)
        if ("active_result" in changes and changes["active_result"] != "purchase") or any(
                key in changes for key in ("color", "size", "purchase_quantity")):
            self.cart_checkout_items.pop(customer, None)
        if self.ended:
            return
        options = [key for key in ("color", "size") if key in changes]
        if options:
            self._record_ui(customer, "OPTION_SELECT", {key: self.ui[customer][key] for key in ("color", "size")}, options)
        for key, kind in (("look", "STYLING_LOOK_CHANGE"), ("image_index", "PRODUCT_IMAGE_VIEW"),
                          ("orientation", "ORIENTATION_CHANGE"), ("media_mode", "MEDIA_MODE_CHANGE")):
            if key in changes:
                self._record_ui(customer, kind, {key: changes[key]}, ("look",) if key == "look" else ())
        if "video_paused" in changes:
            self._record_ui(customer, "MEDIA_PAUSE" if changes["video_paused"] else "MEDIA_PLAY")
        if "active_result" in changes and changes["active_result"] is None:
            self._record_ui(customer, "LIVE_RETURN")

    def _message(self, customer, actor, text, request_id, provenance,
                 source_refs=None, label="", visibility="private", at=None, **extra):
        key = self._key(customer)
        return {"message_id": uuid.uuid4().hex,
                "conversation_id": f"{self.run_id}:{':'.join(key)}" if visibility == "private" else f"{self.run_id}:broadcast",
                "broadcast_id": key[1], "product_id": key[2], "actor": actor,
                "visibility": visibility, "customer_id": customer if visibility == "private" else None,
                "request_id": request_id, "text": text, "source_refs": source_refs or [],
                "created_at": self.now if at is None else at, "provenance": provenance,
                "label": label, "status": "complete", **extra}

    def _classify(self, text, key):
        compact = re.sub(r"\s+", "", text)
        if (re.search(r"영상|장면|아까|쇼호스트|방금|타임코드|북마크|몇분|방송.*(말|내용|입|요약)|지금(뭐라고|무슨내용|어떤설명)", compact)
                or re.search(r"모델.*(입|착용|사이즈|몇)|착용.*모델", compact)):
            return ["UNSUPPORTED_VIDEO"], False
        patterns = {
            "SIZE_GUIDANCE": r"사이즈|치수|반사이즈|평소(55|66|77|88)|크게사|작게사",
            "BENEFIT": r"혜택|할인|쿠폰|적용.*가격|나한테.*가격|최종.*가격",
            "STYLING": r"코디|스타일링|같이입|어울리|함께입",
            "DELIVERY": r"배송|언제와|언제도착|언제받|내일.*받|오늘주문|도착",
            "PRODUCT_THICKNESS": r"두께|얇|두꺼",
            "PRODUCT_COLOR": r"색상|색깔|색은|실제색",
            "PRODUCT_REVIEW": r"후기|리뷰",
        }
        intents = []
        for intent in self.fixtures["ask"]["intent_priority"]:
            if intent in patterns and re.search(patterns[intent], compact):
                intents.append(intent)
        for response in self.fixtures["ask"]["responses"] + self.fixtures["ask"]["direct_result_routes"]:
            if compact in [re.sub(r"\s+", "", example) for example in response["examples"]]:
                if response["intent"] not in intents:
                    intents.append(response["intent"])
        unsupported = bool(re.search(r"세탁|환불|반품|교환|원산지|소재|날씨|주식|재고|최저가|신발.*사이즈", compact))
        if "신발" in compact and "SIZE_GUIDANCE" in intents:
            intents.remove("SIZE_GUIDANCE")
        if not intents and re.fullmatch(r"(그럼|그건|그거|그래서|좀더|조금더|자세히|더)(어때|요|알려줘|설명해줘|말해줘|알려주세요|어때요)?[?!.~]*", compact):
            previous = self.last_intents.get(key)
            return [previous] if previous else ["AMBIGUOUS_FOLLOWUP"], False
        return intents or ["UNSUPPORTED"], unsupported

    def _answer(self, intent):
        if intent in self.responses:
            response = deepcopy(self.responses[intent])
            text = response.get("answer", self.fixtures["demo"]["delivery_result"]["answer"])
            return {"intent": intent, "text": text, "provenance": response["provenance"],
                    "source_refs": response.get("source_refs", ["demo-config.delivery_result"]),
                    "label": response["label"], "action": response.get("action"),
                    "review_group_ids": response.get("review_group_ids", [])}
        direct = {
            "SIZE_GUIDANCE": ("size", "준비된 내 사이즈 안내를 확인해보세요. 추천 사이즈와 실제 구매 가능한 옵션은 별도로 확인해주세요.", "demo_profile", "가상 고객 · 준비된 사이즈 안내", ["demo-config.size_result", "main-product.size_guide"]),
            "BENEFIT": ("benefit", "데모 혜택 예시를 확인해보세요. 49,900 - 2,495 - 1,890 = 45,515원이에요.", "prepared_benefit", "데모 혜택 예시", ["demo-config.benefit_result"]),
            "STYLING": ("styling", "준비된 출근·약속·주말 코디 3가지를 확인해보세요. 이미지는 AI 코디 예시예요.", "generated_lookbook", "AI 코디 예시", ["styling-looks.looks"]),
        }
        if intent in direct:
            route, text, provenance, label, refs = direct[intent]
            return {"intent": intent, "route": route, "text": text, "provenance": provenance, "label": label, "source_refs": refs}
        unsupported = self.fixtures["ask"]["unsupported"]
        text = unsupported["ambiguous_followup" if intent == "AMBIGUOUS_FOLLOWUP" else "generic"]
        if intent == "UNSUPPORTED_VIDEO":
            text = "참고 영상은 현재 상품과 다른 녹화 영상이며, 영상 분석·장면 검색·모델 착용정보는 아직 검증되지 않았어요. 현재 상품의 영상 근거로 답변할 수 없어요."
        return {"intent": intent, "text": text, "provenance": "prepared_fallback", "label": "확인 가능한 자료 안내", "source_refs": [], "action": unsupported["action"]}

    def _ask(self, customer, data):
        text = self._string(data.get("text"), "text", 1500)
        request_id = self._string(data.get("request_id"), "request_id")
        fault = data.get("fault")
        if fault is not None and (not isinstance(fault, str) or fault not in {"delay", "error"}):
            raise APIError("fault는 delay 또는 error만 허용합니다.")
        key = self._key(customer)
        request_key = (*key, request_id)
        if request_key in self.requests:
            previous = self.requests[request_key]
            if previous["text"] != text or previous["fault"] != fault:
                raise APIError("request_id를 다른 질문에 재사용할 수 없습니다.", 409)
            return {"request_id": request_id,
                    "route": previous["route"] if previous["status"] == "completed" else None,
                    "duplicate": True}
        if key[2] != self.scope["product_id"]:
            intents, unsupported = ["UNSUPPORTED"], False
        else:
            intents, unsupported = self._classify(text, key)
        if intents == ["UNSUPPORTED_VIDEO"]:
            answer = lookup_video(text, self.ui[customer]["video_asset_id"], self.ui[customer]["video_time"])
            if answer["intent"] == "UNSUPPORTED_VIDEO":
                answer["action"] = deepcopy(self.fixtures["ask"]["unsupported"]["action"])
            intents = [answer["intent"]]
            answers = [answer]
        else:
            answers = [self._answer(intent) for intent in intents[:2]]
        if unsupported and intents != ["UNSUPPORTED"]:
            answers.append(self._answer("UNSUPPORTED"))
        if len(intents) > 2:
            answers.append({"intent": "CLARIFICATION", "text": "한 번에 두 항목까지 안내해요. 나머지 질문은 하나씩 선택해 다시 물어봐주세요.", "provenance": "prepared_fallback", "source_refs": [], "label": "질문 선택 안내"})
        for intent in intents[:2]:
            if intent in self.responses or intent in {"SIZE_GUIDANCE", "BENEFIT", "STYLING"}:
                self.last_intents[key] = intent
        event_intent = "SIZE_GUIDANCE" if "SIZE_GUIDANCE" in intents[:2] else intents[0]
        self._ingest(Event(f"ask:{customer}:{key[2]}:{request_id}", customer, key[1], key[2], "ASK_LIVE_SUBMIT", event_intent), "ui")
        conversation = self.messages.setdefault(key, [])
        conversation.append(self._message(customer, "CUSTOMER", text, request_id, "customer_input"))
        route = next((answer["route"] for answer in answers if answer.get("route")), None)
        self.requests[request_key] = {"text": text, "fault": fault, "route": route, "intents": intents[:2],
                                      "received_at": self._received_at(), "topics": classify_topics(text, intents[:2]),
                                      "status": "pending" if fault == "delay" else "completed",
                                      "fallback": fault == "error"}
        if fault == "delay":
            status = self.responses.get(intents[0], {}).get("status", "준비된 안내를 확인하고 있어요")
            pending_message = self._message(customer, "ASK_LIVE", status, request_id, "prepared_response", status="pending")
            conversation.append(pending_message)
            self.pending[request_key] = {"run_id": self.run_id, "version": self.context_versions[customer],
                                         "deadline": self.clock() + 5, "adapter_ready": self.clock() + 6,
                                         "answers": answers, "message_id": pending_message["message_id"],
                                         "customer": customer, "route": route}
            route = None
        else:
            self._append_answers(customer, request_id, answers, fallback=fault == "error")
            if route:
                self.ui[customer]["active_result"] = route
        return {"request_id": request_id, "route": route, "intents": intents[:2]}

    def _append_answers(self, customer, request_id, answers, fallback=False, replace_id=None):
        conversation = self.messages.setdefault(self._key(customer), [])
        messages = [self._message(customer, "ASK_LIVE", request_id=request_id, fallback=fallback, **answer) for answer in answers]
        if replace_id:
            index = next((i for i, message in enumerate(conversation) if message["message_id"] == replace_id), None)
            if index is None:
                return
            messages[0]["message_id"] = replace_id
            conversation[index:index + 1] = messages
        else:
            conversation.extend(messages)

    def _cancel_pending(self, customer):
        for key, job in list(self.pending.items()):
            if job["customer"] == customer:
                for message in self.messages.get(key[:3], []):
                    if message["message_id"] == job["message_id"]:
                        message.update(status="complete", text="상품 전환으로 요청을 취소했습니다.")
                self.requests[key]["status"] = "cancelled"
                del self.pending[key]

    def _settle_pending(self):
        for key, job in list(self.pending.items()):
            if job["run_id"] != self.run_id or job["version"] != self.context_versions[job["customer"]]:
                if key in self.requests:
                    self.requests[key]["status"] = "cancelled"
                del self.pending[key]
            elif self.clock() >= job["deadline"]:
                self._append_answers(job["customer"], key[-1], job["answers"], fallback=True, replace_id=job["message_id"])
                if job["route"]:
                    self.ui[job["customer"]]["active_result"] = job["route"]
                self.requests[key].update(status="completed", fallback=True)
                del self.pending[key]


# Descriptive alias for callers embedding the local service.
LiveState = AppState
