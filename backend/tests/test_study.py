"""Study-from-PDF: model fallback, output normalisation, credits and validation."""

import asyncio

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from auth.dependencies import get_current_user
from services import study

PDF = b"%PDF-1.4 fake lecture"
GOOD = {
    "title": "الخوارزميات الجشعة",
    "summary": ["تعريف الخوارزمية الجشعة", "  ", "مثال: مسألة الفكة"],
    "key_terms": [{"term": "Greedy", "definition": "اختيار الأفضل محلياً"}, {"term": "", "definition": "x"}],
    "quiz": [
        {"question": "ما الخوارزمية الجشعة؟", "options": ["أ", "ب", "ج", "د"], "answer_index": 1, "explanation": "لأن…"},
        {"question": "سؤال مكسور", "options": ["أ", "ب"], "answer_index": 5},
        {"question": "", "options": ["أ", "ب"], "answer_index": 0},
        {"question": "سؤال صح/خطأ", "options": ["صح", "خطأ"], "answer_index": "0"},
    ],
}


def test_normalize_drops_invalid_items():
    out = study.normalize(GOOD, 10)
    assert out["summary"] == ["تعريف الخوارزمية الجشعة", "مثال: مسألة الفكة"]
    assert [t["term"] for t in out["key_terms"]] == ["Greedy"]
    assert [q["question"] for q in out["quiz"]] == ["ما الخوارزمية الجشعة؟", "سؤال صح/خطأ"]
    assert out["quiz"][1]["answer_index"] == 0
    assert len(study.normalize({**GOOD, "quiz": GOOD["quiz"][:1] * 9}, 5)["quiz"]) == 5
    with pytest.raises(study.StudyError):
        study.normalize({"error": "unreadable"}, 5)


def test_falls_back_to_fast_model_on_quota(monkeypatch, settings):
    calls = []

    async def fake_call(**kw):
        calls.append(kw["model"])
        if kw["model"] == settings.GEMINI_MODEL:
            raise HTTPException(status_code=502, detail="Gemini RESOURCE_EXHAUSTED: quota")
        return GOOD

    monkeypatch.setattr(study, "call_gemini", fake_call)
    out = asyncio.run(study.study_from_pdf(PDF, 5))
    assert calls == [settings.GEMINI_MODEL, settings.GEMINI_FAST_MODEL]
    assert out["title"] == "الخوارزميات الجشعة"


def test_non_retryable_errors_surface(monkeypatch):
    async def bad(**kw):
        raise HTTPException(status_code=502, detail="Gemini INVALID_ARGUMENT: bad pdf")

    monkeypatch.setattr(study, "call_gemini", bad)
    with pytest.raises(HTTPException):
        asyncio.run(study.study_from_pdf(PDF))


@pytest.fixture
def client(fake_db, monkeypatch):
    main.app.dependency_overrides[get_current_user] = lambda: "stu-study"
    try:
        yield TestClient(main.app), fake_db
    finally:
        main.app.dependency_overrides.clear()


def test_endpoint_charges_credits_only_for_valid_pdfs(client, monkeypatch):
    http, db = client

    async def fake_study(data, questions, language):
        assert questions == 5 and language == "en"
        return study.normalize(GOOD, questions)

    monkeypatch.setattr("routers.study.study_from_pdf", fake_study)
    bad = http.post("/api/study/pdf", files={"file": ("x.pdf", b"not a pdf", "application/pdf")})
    assert bad.status_code == 400 and ("ai_usage", "stu-study") not in db.store
    ok = http.post("/api/study/pdf", files={"file": ("l.pdf", PDF, "application/pdf")}, data={"questions": "5", "language": "en"})
    assert ok.status_code == 200 and ok.json()["quiz"]
    assert db.store[("ai_usage", "stu-study")]["used"] == 5
