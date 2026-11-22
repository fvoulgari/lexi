"""Request-scoped aggregate timings; never retain request or query contents."""

import logging
from contextvars import ContextVar
from time import perf_counter
from uuid import uuid4

timings = ContextVar("request_timings", default=None)


def add(name, started):
    values = timings.get()
    if values is not None:
        values[name] = values.get(name, 0.0) + (perf_counter() - started) * 1000


def operation_for(path, method):
    exact = {
        ("GET", "/api/profiles"): "profiles",
        ("GET", "/api/auth/session"): "auth_session",
        ("POST", "/api/auth/signin"): "password_signin",
        ("POST", "/api/auth/signinup"): "thirdparty_signin",
        ("POST", "/api/sessions"): "practice_start",
        ("GET", "/api/vocabulary"): "vocabulary_list",
    }
    if (method, path) in exact:
        return exact[method, path]
    if path.startswith("/api/sessions/"):
        for required_method, suffix, name in (
            ("POST", "/reveal", "practice_reveal"),
            ("POST", "/reviews", "practice_review"),
            ("GET", "/summary", "practice_summary"),
        ):
            if method == required_method and path.endswith(suffix):
                return name
    return None


class RequestTimingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        operation = (
            operation_for(scope.get("path", ""), scope.get("method"))
            if scope["type"] == "http"
            else None
        )
        if operation is None:
            return await self.app(scope, receive, send)
        values = {}
        token = timings.set(values)
        started = perf_counter()
        status = 0
        timing_id = uuid4().hex

        async def timed_send(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message = dict(message)
                message["headers"] = [
                    *message.get("headers", []),
                    (b"x-lexi-timing-id", timing_id.encode("ascii")),
                ]
            await send(message)
            if message["type"] == "http.response.body" and not message.get(
                "more_body", False
            ):
                logging.getLogger("uvicorn.error").info(
                    "request_timing id=%s operation=%s status=%d total_ms=%.1f "
                    "provider_ms=%.1f session_check_ms=%.1f "
                    "email_check_ms=%.1f db_query_ms=%.1f",
                    timing_id,
                    operation,
                    status,
                    (perf_counter() - started) * 1000,
                    values.get("provider_ms", 0),
                    values.get("session_check_ms", 0),
                    values.get("email_check_ms", 0),
                    values.get("db_query_ms", 0),
                )

        try:
            await self.app(scope, receive, timed_send)
        finally:
            timings.reset(token)
