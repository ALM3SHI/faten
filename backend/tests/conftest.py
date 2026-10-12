"""
Shared test setup.

Tests run without network access, API keys or a real Firebase project:
  • settings come from the environment variables set below;
  • Firestore is replaced by the in-memory FakeFirestore;
  • Firestore transactions run inline (the fake has no server to retry).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("AI_PROVIDER", "gemini")
os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("CRON_SECRET", "")
os.environ.setdefault("ENABLE_INTERNAL_SCHEDULER", "false")


# ── In-memory Firestore ──────────────────────────────────────────
class _Snap:
    def __init__(self, path, data):
        self.id = path[-1]
        self._data = None if data is None else dict(data)
        self.exists = data is not None

    def to_dict(self):
        return None if self._data is None else dict(self._data)


class _Doc:
    def __init__(self, store, path):
        self._store, self.path, self.id = store, path, path[-1]

    def get(self, transaction=None):
        return _Snap(self.path, self._store.get(self.path))

    def set(self, data, merge=False):
        if merge and self.path in self._store:
            self._store[self.path].update(data)
        else:
            self._store[self.path] = dict(data)

    def update(self, data):
        self._store[self.path].update(data)

    def delete(self):
        self._store.pop(self.path, None)

    def collection(self, name):
        return _Col(self._store, self.path + (name,))


class _Col:
    def __init__(self, store, path, order=None, desc=False, limit=None):
        self._store, self.path = store, path
        self._order, self._desc, self._limit = order, desc, limit

    def document(self, doc_id):
        return _Doc(self._store, self.path + (doc_id,))

    def order_by(self, field, direction=None):
        return _Col(self._store, self.path, field, str(direction).upper().startswith("DESC"), self._limit)

    def limit(self, n):
        return _Col(self._store, self.path, self._order, self._desc, n)

    def stream(self):
        snaps = [
            _Snap(p, d) for p, d in self._store.items()
            if len(p) == len(self.path) + 1 and p[:-1] == self.path
        ]
        if self._order:
            snaps.sort(key=lambda s: (s._data or {}).get(self._order) or 0, reverse=self._desc)
        return snaps[: self._limit] if self._limit else snaps

    get = stream

    def add(self, data):
        doc = _Doc(self._store, self.path + (f"auto{len(self._store)}",))
        doc.set(data)
        return None, doc


class _Tx:
    def set(self, ref, data):
        ref.set(data)

    def update(self, ref, data):
        ref.update(data)

    def delete(self, ref):
        ref.delete()


class FakeFirestore:
    def __init__(self):
        self.store: dict[tuple, dict] = {}

    def collection(self, name):
        return _Col(self.store, (name,))

    def transaction(self):
        return _Tx()


@pytest.fixture
def fake_db(monkeypatch):
    """Patch every module that reaches Firestore through get_db()."""
    from google.cloud import firestore

    db = FakeFirestore()
    monkeypatch.setattr(firestore, "transactional", lambda fn: fn)
    import db.firestore as dbmod
    monkeypatch.setattr(dbmod, "get_db", lambda: db)
    for mod in ("services.quota", "services.community"):
        module = __import__(mod, fromlist=["get_db"])
        monkeypatch.setattr(module, "get_db", lambda: db)
    return db


@pytest.fixture
def settings(monkeypatch):
    """Mutable view over the cached Settings for one test."""
    from config import get_settings

    get_settings.cache_clear()
    s = get_settings()
    yield s
    get_settings.cache_clear()


def give_courses(db: FakeFirestore, uid: str, codes: list[str]) -> None:
    """Seed a student's academic record with completed courses."""
    db.store[("users", uid, "academic_record", "main")] = {
        "completedCourses": [{"code": c, "nameAr": f"مادة {c}"} for c in codes]
    }


@pytest.fixture
def seed():
    return SimpleNamespace(courses=give_courses)
