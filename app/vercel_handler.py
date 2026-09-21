"""Vercel adapter; the local HTTP server keeps its original execution model."""
from urllib.parse import urlsplit

from app.server import LiveHandler
from app.shared_state import configured_state
from app.state import AppState


class VercelHandler(LiveHandler):
    endpoint = ""

    @property
    def application_state(self):
        if self.endpoint == "/api/bootstrap":
            return AppState()
        return configured_state()

    def _normalize_path(self):
        # Vercel may pass the .py filesystem path or the clean public route.
        query = urlsplit(self.path).query
        self.path = self.endpoint + ("?" + query if query else "")

    def _get(self, head=False):
        self._normalize_path()
        super()._get(head)

    def do_POST(self):
        self._normalize_path()
        super().do_POST()

    def _static(self, url_path, head):
        self._error(404, "API를 찾을 수 없습니다.", head)
