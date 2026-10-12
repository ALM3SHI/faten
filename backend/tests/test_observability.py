"""Request ids, safe 500s and gzip from observability.py."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
from observability import INTERNAL_ERROR_MESSAGE, REQUEST_ID_HEADER, install_observability


def _app():
    app = FastAPI()
    install_observability(app)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("secret internal detail")

    @app.get("/big")
    async def big():
        return {"data": "x" * 5000}

    return app


def test_every_response_has_a_request_id():
    r = TestClient(main.app).get("/health")
    assert len(r.headers[REQUEST_ID_HEADER]) >= 8


def test_caller_request_id_is_kept_when_safe():
    r = TestClient(main.app).get("/health", headers={REQUEST_ID_HEADER: "abc-123"})
    assert r.headers[REQUEST_ID_HEADER] == "abc-123"


def test_unsafe_request_id_is_replaced():
    r = TestClient(main.app).get("/health", headers={REQUEST_ID_HEADER: "bad id\nwith newline"[:20]})
    assert r.headers[REQUEST_ID_HEADER] != "bad id\nwith newline"[:20]


def test_unhandled_error_returns_arabic_json_without_leaking():
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/boom")
    assert r.status_code == 500
    body = r.json()
    assert body["detail"] == INTERNAL_ERROR_MESSAGE
    assert "secret" not in r.text
    assert body["request_id"] == r.headers[REQUEST_ID_HEADER]


def test_large_responses_are_gzipped():
    r = TestClient(_app()).get("/big", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"

