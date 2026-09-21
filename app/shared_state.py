"""Atomic Redis-backed demo state shared by independent Vercel functions.

Snapshots use an explicit JSON type allowlist, never pickle. Redis supplies the
receive clock so process-local monotonic clocks cannot leak between instances.
"""
from dataclasses import fields, is_dataclass
import json
import os
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from app.state import APIError, AppState, ROOT
from prototype.need_director import Approval, Campaign, Event, NeedDirector


TYPES = {cls.__name__: cls for cls in (Approval, Campaign, Event, NeedDirector)}
LOCAL_FIELDS = {"root", "clock", "lock", "fixtures", "scope", "responses"}
READ = """
local value = redis.call('GET', KEYS[1])
local now = redis.call('TIME')
return {value or '', now[1], now[2]}
"""
COMMIT = """
local current = redis.call('GET', KEYS[1]) or ''
if current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
"""


def encode(value):
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, list):
        return [encode(item) for item in value]
    if isinstance(value, dict):
        return {"type": "dict", "items": [[encode(k), encode(v)] for k, v in value.items()]}
    if isinstance(value, (tuple, set)):
        return {"type": type(value).__name__, "items": [encode(item) for item in value]}
    if type(value).__name__ in TYPES and type(value) is TYPES[type(value).__name__]:
        return {"type": type(value).__name__, "items": encode(vars(value))}
    raise ValueError(f"Unsupported snapshot type: {type(value).__name__}")


def decode(value):
    if isinstance(value, list):
        return [decode(item) for item in value]
    if not isinstance(value, dict):
        return value
    kind, items = value["type"], value["items"]
    if kind == "dict":
        return {decode(k): decode(v) for k, v in items}
    if kind in {"tuple", "set"}:
        return (tuple if kind == "tuple" else set)(decode(item) for item in items)
    cls = TYPES[kind]
    attributes = decode(items)
    if is_dataclass(cls):
        if set(attributes) != {field.name for field in fields(cls)}:
            raise ValueError("Invalid dataclass snapshot")
        return cls(**attributes)
    instance = cls()
    if set(attributes) != set(vars(instance)):
        raise ValueError("Invalid engine snapshot")
    vars(instance).update(attributes)
    return instance


class RedisStore:
    def __init__(self, url, token, key):
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment):
            raise APIError("공유 저장소 주소 설정을 확인해주세요.", 503)
        self.url, self.token, self.key = url.rstrip("/"), token, key

    def command(self, *command):
        request = Request(self.url, data=json.dumps(command).encode(), headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json",
        }, method="POST")
        try:
            with urlopen(request, timeout=4) as response:
                result = json.load(response)
            if "error" in result or "result" not in result:
                raise ValueError("Redis command failed")
            return result["result"]
        except (URLError, TimeoutError, OSError, ValueError) as exc:
            # Never reflect credentials, upstream bodies or user data in errors.
            raise APIError("공유 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.", 503) from exc

    def read(self):
        raw, seconds, micros = self.command("EVAL", READ, 1, self.key)
        return raw, int(seconds) + int(micros) / 1_000_000

    def commit(self, expected, value):
        return self.command("EVAL", COMMIT, 1, self.key, expected, value, 86400) == 1


class SharedState:
    def __init__(self, store, root=ROOT):
        self.store, self.root = store, root

    def bootstrap(self):
        return AppState(root=self.root).bootstrap()

    def state(self, customer_id=None):
        return self._run("state", customer_id)

    def action(self, data):
        return self._run("action", data)

    def _run(self, operation, argument):
        deadline = time.monotonic() + 20
        for attempt in range(8):
            raw, now = self.store.read()
            try:
                saved = json.loads(raw) if raw else None
                if saved:
                    if saved["version"] != 1:
                        raise ValueError("Unsupported snapshot version")
                    now = max(now, saved["received_at"])
                state = AppState(root=self.root, clock=lambda: now)
                if saved:
                    attributes = decode(saved["state"])
                    if set(attributes) != set(vars(state)) - LOCAL_FIELDS:
                        raise ValueError("Invalid state snapshot")
                    vars(state).update(attributes)
            except (ValueError, KeyError, TypeError, RecursionError) as exc:
                raise APIError("저장된 상태를 읽지 못했습니다. 저장소 설정을 확인해주세요.", 503) from exc
            result = getattr(state, operation)(argument)
            snapshot = json.dumps({"version": 1, "received_at": now,
                "state": encode({k: v for k, v in vars(state).items() if k not in LOCAL_FIELDS})},
                ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            if len(snapshot.encode()) > 5_000_000:
                raise APIError("데모 저장 용량에 도달했습니다. Director에서 Reset해주세요.", 503)
            if self.store.commit(raw, snapshot):
                return result
            if time.monotonic() >= deadline:
                break
            time.sleep(min(.01 * (attempt + 1), .08))
        raise APIError("다른 요청을 처리 중입니다. 잠시 후 다시 시도해주세요.", 503)


def configured_state():
    url = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN")
    if not url or not token:
        raise APIError("공유 저장소가 연결되지 않았습니다. Vercel Storage 설정을 확인해주세요.", 503)
    environment = os.environ.get("VERCEL_ENV", "development")
    if environment == "preview":
        environment += ":" + os.environ.get("VERCEL_URL", "local")
    key = os.environ.get("GS_STATE_KEY") or f"gs-ai-live:g-24:{environment}:v1"
    return SharedState(RedisStore(url, token, key))
