"""Deterministic prototype rules. All times are server/virtual-clock seconds.

This is a reference model, not a production service or a UI. Client timestamps
never enter its calculations. Call evaluate_spike on the 60-second analysis tick.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite


@dataclass(frozen=True)
class Event:
    event_id: str
    customer_id: str
    broadcast_id: str
    product_id: str
    event_type: str
    intent: str | None = None
    need: str | None = None


@dataclass(frozen=True)
class Approval:
    approval_id: str
    created_at: float
    expires_at: float
    targets: tuple[str, ...]


@dataclass
class Campaign:
    state: str = "NORMAL"
    evidence: dict | None = None
    approval: Approval | None = None
    host_delivered: bool = False
    result: dict | None = None
    disabled_customers: set[str] = field(default_factory=set)


class NeedDirector:
    """One in-memory demo run; a new instance resets all demo state."""

    def __init__(self):
        self.now = float("-inf")
        self.events: dict[str, Event] = {}
        self.signals: dict[tuple, list[tuple[float, str]]] = {}
        self.detected: dict[tuple, float] = {}
        self.suggestions: dict[tuple, str] = {}
        self.dismissed: set[tuple] = set()
        self.current_products: dict[tuple, str] = {}
        self.campaigns: dict[tuple, Campaign] = {}
        self.approval_requests: dict[str, tuple] = {}

    def _advance(self, now):
        if not isinstance(now, (int, float)) or not isfinite(now):
            raise ValueError("Server time must be a finite number")
        if now < self.now:
            raise ValueError("Server/virtual time must be monotonic")
        self.now = now

    def _campaign(self, broadcast_id, product_id):
        return self.campaigns.setdefault((broadcast_id, product_id), Campaign())

    @staticmethod
    def _signal(event):
        if event.event_type == "SIZE_TAB_OPEN":
            return "size_tab"
        if event.event_type == "REVIEW_SIZE_VIEW":
            return "size_review"
        if event.event_type == "ASK_LIVE_SUBMIT" and event.intent == "SIZE_GUIDANCE":
            return "size_question"
        return None

    def ingest(self, event: Event, now: float):
        """now is trusted receive time, assigned by the server/demo runner."""
        if not all(isinstance(value, str) and value for value in (
            event.event_id, event.customer_id, event.broadcast_id,
            event.product_id, event.event_type,
        )):
            raise ValueError("Event identifiers and type must be nonempty strings")
        if event.event_id in self.events and self.events[event.event_id] != event:
            raise ValueError("An event_id cannot be reused for different content")
        self._advance(now)
        if event.event_id in self.events:
            return "DUPLICATE"
        self.events[event.event_id] = event
        key = (event.broadcast_id, event.product_id, event.customer_id)
        dismiss_key = (event.broadcast_id, event.customer_id, "SIZE")
        if event.event_type == "AI_SUGGESTION_DISMISS" and event.need == "SIZE":
            self.dismissed.add(dismiss_key)
            for (broadcast_id, _), campaign in self.campaigns.items():
                if broadcast_id == event.broadcast_id:
                    campaign.disabled_customers.add(event.customer_id)
            return "DISMISSED"
        if event.event_type == "AI_SUGGESTION_ACCEPT" and event.need == "SIZE":
            if self.suggestions.get(key) != "OFFERED" or dismiss_key in self.dismissed:
                return "IGNORED"
            self.suggestions[key] = "ACCEPTED"
            return "SIZE_RESULT"
        signal = self._signal(event)
        if signal is None:
            return "IGNORED"
        if key in self.detected:
            return "ALREADY_DETECTED"
        recent = [(at, kind) for at, kind in self.signals.get(key, [])
                  if at >= now - 30]
        recent.append((now, signal))
        self.signals[key] = recent
        if len({kind for _, kind in recent}) < 2:
            return "SIGNAL_RECORDED"
        self.detected[key] = now
        if dismiss_key not in self.dismissed:
            self.suggestions[key] = "OFFERED"
        return "NEED_DETECTED"

    def suggestion_visible(self, broadcast_id, product_id, customer_id):
        key = (broadcast_id, product_id, customer_id)
        return (self.suggestions.get(key) == "OFFERED"
                and (broadcast_id, customer_id, "SIZE") not in self.dismissed)

    def evaluate_spike(self, broadcast_id, product_id, now):
        """Run at a scheduled tick, not on every click. Windows are (start, end]."""
        self._advance(now)
        times = [at for (live, product, _), at in self.detected.items()
                 if (live, product) == (broadcast_id, product_id)]
        previous = sum(now - 120 < at <= now - 60 for at in times)
        current = sum(now - 60 < at <= now for at in times)
        spike = current >= 10 and (previous == 0 or current >= previous * 2)
        evidence = {
            "previous_customers": previous,
            "current_customers": current,
            "change_percent": None if previous == 0 else round((current / previous - 1) * 100),
            "window_seconds": 60,
            "as_of": now,
            "spike": spike,
            "source": "Prototype Simulation",
        }
        campaign = self._campaign(broadcast_id, product_id)
        if campaign.state == "NORMAL" and spike:
            campaign.state = "ALERT"
            campaign.evidence = evidence.copy()
        return evidence

    def approve_app(self, broadcast_id, product_id, approval_id, now):
        """Snapshot once. Repeated approval never extends TTL or adds customers."""
        if not isinstance(approval_id, str) or not approval_id:
            raise ValueError("approval_id is required")
        scope = (broadcast_id, product_id)
        if approval_id in self.approval_requests and self.approval_requests[approval_id] != scope:
            raise ValueError("approval_id cannot be reused in another campaign")
        self._advance(now)
        campaign = self._campaign(*scope)
        if campaign.approval is not None:
            self.approval_requests[approval_id] = scope
            return campaign.approval
        if campaign.state not in ("ALERT", "ACTION"):
            raise ValueError("An alert is required before approval")
        targets = tuple(sorted(customer for (live, product, customer), at in self.detected.items()
            if (live, product) == scope
            and now - 120 < at <= now
            and (live, customer, "SIZE") not in self.dismissed
            and self.current_products.get((customer, live), product) == product))
        campaign.approval = Approval(approval_id, now, now + 300, targets)
        campaign.state = "ACTION"
        self.approval_requests[approval_id] = scope
        return campaign.approval

    def switch_product(self, customer_id, broadcast_id, product_id, now):
        self._advance(now)
        self.current_products[(customer_id, broadcast_id)] = product_id
        for (live, product), campaign in self.campaigns.items():
            if live == broadcast_id and product != product_id:
                campaign.disabled_customers.add(customer_id)

    def personalization_visible(self, customer_id, broadcast_id, product_id, now):
        self._advance(now)
        campaign = self.campaigns.get((broadcast_id, product_id))
        if campaign is None or campaign.approval is None:
            return False
        approval = campaign.approval
        return (customer_id in approval.targets
                and approval.created_at <= now < approval.expires_at
                and customer_id not in campaign.disabled_customers
                and (broadcast_id, customer_id, "SIZE") not in self.dismissed
                and self.current_products.get((customer_id, broadcast_id), product_id) == product_id)

    @staticmethod
    def manual_size_available():
        return True

    def deliver_to_host(self, broadcast_id, product_id, now):
        """Local completion flag only; no real message or external system."""
        self._advance(now)
        campaign = self._campaign(broadcast_id, product_id)
        if campaign.state == "NORMAL":
            raise ValueError("An alert is required")
        campaign.host_delivered = True
        if campaign.state == "ALERT":
            campaign.state = "ACTION"
        return "쇼호스트에게 전달했습니다 (시뮬레이션)"

    def finish_result(self, broadcast_id, product_id, metrics, now):
        self._advance(now)
        campaign = self._campaign(broadcast_id, product_id)
        if campaign.approval is None or now < campaign.approval.created_at + 30:
            raise ValueError("APP approval and 30 seconds of demo time are required")
        if campaign.result is not None:
            return campaign.result
        if metrics.get("source") != "Prototype Simulation":
            raise ValueError("Prepared result metrics must be labeled Prototype Simulation")
        campaign.result = {"source": metrics["source"], "metrics": [
            {**metric, "change_percent": None if metric["before"] == 0 else
             round((metric["after"] / metric["before"] - 1) * 100)}
            for metric in metrics["metrics"]
        ]}
        campaign.state = "RESULT"
        return campaign.result


def replay_fixture(fixture):
    """Replay the prepared synthetic population and evaluate its final tick."""
    engine = NeedDirector()
    for entry in fixture["events"]:
        engine.ingest(Event(**entry["event"]), entry["at"])
    scope = fixture["scope"]
    evidence = engine.evaluate_spike(scope["broadcast_id"], scope["product_id"], fixture["analysis_at"])
    return engine, evidence


if __name__ == "__main__":
    import json
    from pathlib import Path

    fixture = json.loads((Path(__file__).resolve().parents[1] / "fixtures/director-scenario.json").read_text())
    engine, evidence = replay_fixture(fixture)
    live, product = fixture["scope"]["broadcast_id"], fixture["scope"]["product_id"]
    approval = engine.approve_app(live, product, "demo-approval-001", fixture["approve_at"])
    visible = {role: engine.personalization_visible(customer, live, product, fixture["approve_at"])
               for role, customer in fixture["customers"].items()}
    result = engine.finish_result(live, product, fixture["result_metrics"], fixture["result_at"])
    print(json.dumps({
        "source": "Prototype Simulation",
        "evidence": evidence,
        "approved_customer_count": len(approval.targets),
        "personalization_visible": visible,
        "final_state": engine.campaigns[(live, product)].state,
        "result": result,
    }, ensure_ascii=False, indent=2))
