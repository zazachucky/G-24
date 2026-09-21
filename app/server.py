#!/usr/bin/env python3
"""Run the local GS AI LIVE demo: python3 app/server.py."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.state import APIError, AppState


class LiveServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, state=None):
        self.state = state or AppState()
        super().__init__(address, LiveHandler)

    def service_actions(self):
        # This also settles the five-second fallback without an active browser.
        with self.state.lock:
            self.state._sync()


class LiveHandler(BaseHTTPRequestHandler):
    server_version = "GS-AI-LIVE/1.0"

    def _headers(self, status, content_type, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in (extra or {}).items():
            self.send_header(name, str(value))
        self.end_headers()

    def _json(self, status, body, head=False):
        payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(payload))
        if not head:
            self.wfile.write(payload)

    def _error(self, status, message, head=False):
        self._json(status, {"error": message}, head)

    def do_HEAD(self):
        self._get(head=True)

    def do_GET(self):
        self._get()

    def _get(self, head=False):
        try:
            parsed = urlsplit(self.path)
            if parsed.path == "/":
                self._headers(302, "text/plain; charset=utf-8", 0, {"Location": "/app/customer.html"})
            elif parsed.path == "/api/bootstrap":
                self._json(200, self.server.state.bootstrap(), head)
            elif parsed.path == "/api/state":
                query = parse_qs(parsed.query, keep_blank_values=True)
                if set(query) - {"customer_id"} or any(len(values) != 1 for values in query.values()):
                    raise APIError("지원하지 않는 쿼리입니다.")
                customer = query.get("customer_id", [None])[0]
                self._json(200, self.server.state.state(customer), head)
            elif parsed.path.startswith("/api/"):
                self._error(404, "API를 찾을 수 없습니다.", head)
            else:
                self._static(parsed.path, head)
        except APIError as exc:
            self._error(exc.status, str(exc), head)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        try:
            if self.path != "/api/action":
                self._error(404, "API를 찾을 수 없습니다.")
                return
            # The demo has no external integration; browser mutations are same-origin.
            origin = self.headers.get("Origin")
            if origin:
                parsed_origin = urlsplit(origin)
                if parsed_origin.scheme != "http" or parsed_origin.netloc != self.headers.get("Host"):
                    self._error(403, "같은 로컬 앱에서 요청해주세요.")
                    return
            if self.headers.get_content_type() != "application/json":
                self._error(415, "application/json 요청이 필요합니다.")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise APIError("Content-Length가 올바르지 않습니다.")
            if length <= 0 or length > 65536:
                self._error(413, "요청 본문은 1~65536바이트여야 합니다.")
                return
            try:
                data = json.loads(self.rfile.read(length).decode("utf-8"),
                                  parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
            except (UnicodeDecodeError, ValueError, RecursionError):
                raise APIError("올바른 JSON 요청이 필요합니다.")
            self._json(200, self.server.state.action(data))
        except APIError as exc:
            self._error(exc.status, str(exc))
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _static(self, url_path, head):
        decoded = unquote(url_path)
        relative = Path(decoded.lstrip("/"))
        allowed_extensions = {".html", ".css", ".js", ".json", ".md", ".jpg", ".jpeg", ".png",
                              ".webp", ".gif", ".svg", ".ico", ".mp4", ".webm", ".vtt",
                              ".woff", ".woff2", ".mp3", ".wav"}
        if (not relative.parts or relative.parts[0] not in {"app", "assets", "fixtures", "docs"}
                or any(part.startswith(".") for part in relative.parts)
                or relative.suffix.lower() not in allowed_extensions or "\x00" in decoded):
            self._error(404, "파일을 찾을 수 없습니다.", head)
            return
        root = self.server.state.root.resolve()
        path = (root / relative).resolve()
        if not path.is_relative_to(root / relative.parts[0]) or not path.is_file():
            self._error(404, "파일을 찾을 수 없습니다.", head)
            return
        size = path.stat().st_size
        start, end, status = 0, size - 1, HTTPStatus.OK
        extra = {"Accept-Ranges": "bytes"}
        requested_range = self.headers.get("Range")
        if requested_range:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested_range.strip())
            if match and size and any(match.groups()):
                first, last = match.groups()
                if first:
                    start = int(first)
                    end = min(int(last), size - 1) if last else size - 1
                else:
                    suffix = int(last)
                    start, end = max(0, size - suffix), size - 1
                valid = 0 <= start <= end < size
            else:
                valid = False
            if not valid:
                self._headers(416, "application/octet-stream", 0, {"Content-Range": f"bytes */{size}"})
                return
            status = HTTPStatus.PARTIAL_CONTENT
            extra["Content-Range"] = f"bytes {start}-{end}/{size}"
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix in {".html", ".css", ".js", ".json", ".md", ".vtt"}:
            content_type += "; charset=utf-8"
        length = max(0, end - start + 1)
        self._headers(status, content_type, length, extra)
        if not head:
            with path.open("rb") as source:
                source.seek(start)
                remaining = length
                while remaining:
                    chunk = source.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

    def log_message(self, format, *args):
        # Do not log URLs containing question text or request bodies.
        if args and len(args) > 1 and str(args[1]).startswith(("4", "5")):
            sys.stderr.write(f"HTTP {args[1]}\n")


def create_server(host="127.0.0.1", port=8765, state=None):
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("This demo binds only to localhost")
    return LiveServer((host, port), state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = create_server(port=args.port)
    print(f"GS AI LIVE: http://127.0.0.1:{server.server_port}/app/customer.html", flush=True)
    print(f"Director: http://127.0.0.1:{server.server_port}/app/director.html", flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
