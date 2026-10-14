"""Shared helpers for the tutor tests."""

from tutor_fakes import FakeTutorAI


def fake_ai(monkeypatch, **kw) -> FakeTutorAI:
    fake = FakeTutorAI(**kw)
    monkeypatch.setattr("services.tutor.ai.ask_json", fake)
    return fake
