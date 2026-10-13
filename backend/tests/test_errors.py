"""Every error the API sends a student is Arabic with a clear reason."""

import ast
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
from auth.dependencies import get_current_user
from common.errors import UpstreamAIError, upstream_ai_message, validation_message

ARABIC = re.compile(r"[؀-ۿ]")
BACKEND = Path(__file__).resolve().parents[1]
client = TestClient(main.app)


@pytest.fixture
def signed_in():
    main.app.dependency_overrides[get_current_user] = lambda: "u1"
    yield
    main.app.dependency_overrides.pop(get_current_user, None)


def test_unknown_route_is_arabic():
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404
    assert ARABIC.search(r.json()["detail"])


def test_wrong_method_is_arabic():
    r = client.put("/health")
    assert r.status_code == 405
    assert ARABIC.search(r.json()["detail"])


def test_validation_errors_name_the_field_in_arabic(signed_in):
    r = client.post("/api/feedback", json={"rating": "up", "comment": "x" * 2000})
    assert r.status_code == 422
    body = r.json()
    assert ARABIC.search(body["detail"])
    assert "«comment»" in body["detail"]
    assert body["errors"][0]["type"] == "string_too_long"


def test_missing_token_is_arabic():
    r = client.get("/api/workspace")
    assert r.status_code == 401
    assert ARABIC.search(r.json()["detail"])


def test_feedback_bad_rating_is_arabic(signed_in, monkeypatch):
    from routers import account

    monkeypatch.setattr(account, "get_db", lambda: object())
    r = client.post("/api/feedback", json={"rating": "meh"})
    assert r.status_code in (400, 422)
    assert ARABIC.search(r.json()["detail"])


def test_validation_message_shapes():
    msg = validation_message([{"type": "missing", "loc": ("body", "messages")}])
    assert msg == "البيانات المرسلة غير صحيحة: «messages» مطلوب."
    many = validation_message([{"type": "int_parsing", "loc": ("query", f"f{i}")} for i in range(5)])
    assert "نوعه غير صحيح" in many and "و2 غيرها" in many


@pytest.mark.parametrize("status", [None, 400, 401, 404, 429, 500, 503])
def test_upstream_messages_are_arabic(status):
    assert ARABIC.search(upstream_ai_message(status))
    err = UpstreamAIError(upstream_status=status)
    assert err.upstream_status == status and ARABIC.search(err.detail)


def _literal_details():
    """(file, line, text) for every HTTPException detail written as a literal."""
    for path in BACKEND.rglob("*.py"):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "scripts/", "evals/", "knowledge/", ".venv")):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", "")) == "HTTPException"):
                continue
            for kw in node.keywords:
                if kw.arg != "detail":
                    continue
                if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                    yield rel, node.lineno, kw.value.value
                elif isinstance(kw.value, ast.JoinedStr):
                    text = "".join(v.value for v in kw.value.values if isinstance(v, ast.Constant))
                    yield rel, node.lineno, text


def test_no_english_error_details_in_code():
    english = [(f, line, t) for f, line, t in _literal_details() if not ARABIC.search(t)]
    assert english == [], english
