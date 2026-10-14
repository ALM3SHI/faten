"""
Production plumbing: request ids, access logs, a safe 500 handler, gzip and
optional Sentry. Kept separate from main.py so it can be tested on its own.
"""

from __future__ import annotations

import logging
import os
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

logger = logging.getLogger("faten.http")

REQUEST_ID_HEADER = "X-Request-ID"
INTERNAL_ERROR_MESSAGE = "حدث خطأ غير متوقع في الخادم. حاول مرة أخرى بعد قليل."


def _clean_request_id(raw: str | None) -> str:
    """Accept a caller-supplied id only if it is short and safe to log."""
    if raw and len(raw) <= 64 and all(c.isalnum() or c in "-_" for c in raw):
        return raw
    return uuid.uuid4().hex[:16]


def install_observability(app: FastAPI) -> None:
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = _clean_request_id(request.headers.get(REQUEST_ID_HEADER))
        request.state.request_id = rid
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers[REQUEST_ID_HEADER] = rid
            return response
        finally:
            ms = (time.perf_counter() - start) * 1000
            # Path only — never log query strings, bodies or tokens.
            if request.url.path != "/health":
                logger.info("%s %s %s %.0fms rid=%s", request.method, request.url.path, status, ms, rid)

    @app.exception_handler(Exception)
    async def unhandled_exception(request: Request, exc: Exception):
        rid = getattr(request.state, "request_id", None) or _clean_request_id(None)
        logger.exception("Unhandled error on %s %s rid=%s", request.method, request.url.path, rid)
        return JSONResponse(
            status_code=500,
            content={"detail": INTERNAL_ERROR_MESSAGE, "request_id": rid},
            headers={REQUEST_ID_HEADER: rid},
        )

    _init_sentry()


def _init_sentry() -> None:
    """Enable Sentry only when SENTRY_DSN is set and sentry-sdk is installed."""
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        return
    try:
        import sentry_sdk  # type: ignore[import-not-found]
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed — skipping")
        return
    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.05")),
        send_default_pii=False,
        # Never ship request bodies: they hold students' messages and lecture
        # files. The stack trace and the URL are enough to find a bug.
        max_request_body_size="never",
        environment=os.getenv("APP_ENV", "production"),
    )
    logger.info("Sentry enabled")
