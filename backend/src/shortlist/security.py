"""Keeps other websites out of the local API.

The backend only listens on 127.0.0.1, but the browser that shows the dashboard also visits
other sites. Without these checks such a site could (a) point a domain name at 127.0.0.1 and
read the API as if it were its own ("DNS rebinding"), or (b) send requests here from its own
pages. Both are refused before any route runs.
"""

from urllib.parse import urlsplit

from starlette.types import ASGIApp, Receive, Scope, Send

# Names under which the dashboard is opened. The port is not checked.
LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "[::1]"})


def host_of(value: str) -> str:
    """Host name of a Host header ("127.0.0.1:8000") or an Origin ("http://localhost:5173")."""
    netloc = urlsplit(value).netloc if "://" in value else value
    if netloc.startswith("["):  # IPv6 literal, with or without port
        return netloc.split("]")[0] + "]"
    return netloc.rsplit(":", 1)[0].lower() if ":" in netloc else netloc.lower()


def refusal(headers: dict[str, str], path: str) -> str | None:
    """Why a request must not be served, or None if it is fine."""
    if host_of(headers.get("host", "")) not in LOCAL_HOSTS:
        return "This server only answers to 127.0.0.1 and localhost."
    if not (path == "/api" or path.startswith("/api/")):
        return None  # pages and assets may be opened from a link anywhere
    origin = headers.get("origin")
    if origin is not None and host_of(origin) not in LOCAL_HOSTS:
        return "The API cannot be used from another website."
    if headers.get("sec-fetch-site") == "cross-site":
        return "The API cannot be used from another website."
    return None


class LocalOnlyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {
            key.decode("latin-1"): value.decode("latin-1") for key, value in scope["headers"]
        }
        reason = refusal(headers, scope["path"])
        if reason is None:
            await self.app(scope, receive, send)
            return
        body = reason.encode()
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"text/plain; charset=utf-8"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
