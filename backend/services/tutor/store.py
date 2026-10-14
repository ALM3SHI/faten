"""
Firestore layout of the dynamic study mode. Everything is written by the
server only — firestore.rules forbid client writes, so mastery cannot be
edited from the browser.

Shared, content-addressed cache (no personal data — course material only;
reachable only by uploading the exact same file bytes):

  tutor_cache/{fileHash}                 lecture structure (topics, page map)
      content/{k}                        extracted pages (text, tables, vision notes)
      lessons/{topicId}                  explanation + question bank (generic,
                                         generated once for everyone with that file)

Per student:

  users/{uid}/tutor_lectures/{lectureId} the student's copy of the structure
      progress/main                      learning state: phase, step, evidence, version
      messages/{seq}                     the tutor conversation (restore the session)
      extras/{topicId}                   questions made for this student's remediation

`lectureId` derives from the file's SHA-256, so the same file is never processed twice.
"""

from __future__ import annotations

import logging
from typing import Any

from google.cloud import firestore

from services.tutor.extract import PageContent

logger = logging.getLogger(__name__)

PAGES_PER_DOC = 20  # keeps each content doc well under Firestore's 1 MiB limit
MAX_LECTURES = 20
MESSAGES_RESTORE = 150


class Conflict(Exception):
    """The progress changed since it was read (another tab/device, double click)."""


# ── shared cache ──────────────────────────────────────────────────


def cache_ref(db, file_hash: str):
    return db.collection("tutor_cache").document(file_hash)


def get_cached_lecture(db, file_hash: str) -> dict | None:
    snap = cache_ref(db, file_hash).get()
    d = snap.to_dict() if snap.exists else None
    return d if d and d.get("topics") else None


def save_cache(db, lecture: dict, pages: list[PageContent]) -> None:
    ref = cache_ref(db, lecture["fileHash"])
    for k in range(0, len(pages), PAGES_PER_DOC):
        ref.collection("content").document(str(k // PAGES_PER_DOC)).set(
            {"pages": [p.to_dict() for p in pages[k : k + PAGES_PER_DOC]]}
        )
    shared = {k: v for k, v in lecture.items() if k not in ("fileName", "createdAt", "updatedAt")}
    ref.set(shared)  # last, so a half-written cache is never treated as complete


def load_pages(db, file_hash: str, page_count: int) -> list[PageContent]:
    ref = cache_ref(db, file_hash)
    pages: list[PageContent] = []
    for k in range((page_count + PAGES_PER_DOC - 1) // PAGES_PER_DOC):
        snap = ref.collection("content").document(str(k)).get()
        for d in (snap.to_dict() or {}).get("pages") or []:
            pages.append(PageContent.from_dict(d))
    return pages


def get_lesson(db, file_hash: str, tid: str) -> dict | None:
    snap = cache_ref(db, file_hash).collection("lessons").document(tid).get()
    return snap.to_dict() if snap.exists else None


def save_lesson(db, file_hash: str, tid: str, lesson: dict) -> None:
    cache_ref(db, file_hash).collection("lessons").document(tid).set(lesson)


# ── per student ───────────────────────────────────────────────────


def _lectures(db, uid: str):
    return db.collection("users").document(uid).collection("tutor_lectures")


def lecture_ref(db, uid: str, lid: str):
    return _lectures(db, uid).document(lid)


def get_lecture(db, uid: str, lid: str) -> dict | None:
    snap = lecture_ref(db, uid, lid).get()
    return snap.to_dict() if snap.exists else None


def list_lectures(db, uid: str) -> list[dict]:
    out = [s.to_dict() or {} for s in _lectures(db, uid).stream()]
    out = [d for d in out if d.get("id")]
    out.sort(key=lambda d: str(d.get("updatedAt") or d.get("createdAt") or ""), reverse=True)
    return out


def save_lecture(db, uid: str, lecture: dict) -> None:
    lecture_ref(db, uid, lecture["id"]).set(lecture)


def touch_lecture(db, uid: str, lid: str, fields: dict) -> None:
    lecture_ref(db, uid, lid).set(fields, merge=True)


def get_extras(db, uid: str, lid: str, tid: str) -> list[dict]:
    snap = lecture_ref(db, uid, lid).collection("extras").document(tid).get()
    return list((snap.to_dict() or {}).get("questions") or []) if snap.exists else []


def save_extras(db, uid: str, lid: str, tid: str, questions: list[dict]) -> None:
    lecture_ref(db, uid, lid).collection("extras").document(tid).set({"questions": questions[-60:]})


def _progress_ref(db, uid: str, lid: str):
    return lecture_ref(db, uid, lid).collection("progress").document("main")


def load_progress(db, uid: str, lid: str) -> dict | None:
    snap = _progress_ref(db, uid, lid).get()
    return snap.to_dict() if snap.exists else None


def _focus_ref(db, uid: str, lid: str):
    return lecture_ref(db, uid, lid).collection("progress").document("focus")


def load_focus(db, uid: str, lid: str) -> dict | None:
    snap = _focus_ref(db, uid, lid).get()
    return snap.to_dict() if snap.exists else None


def save_focus(db, uid: str, lid: str, focus: dict) -> None:
    _focus_ref(db, uid, lid).set(focus)


def _msg_id(seq: int) -> str:
    return f"{seq:06d}"


def commit(db, uid: str, lid: str, progress: dict, expected_version: int, messages: list[dict]) -> dict:
    """Save progress + new messages atomically, only if nobody saved in between."""
    pref = _progress_ref(db, uid, lid)
    mcol = lecture_ref(db, uid, lid).collection("messages")

    @firestore.transactional
    def _run(transaction) -> dict:
        snap = pref.get(transaction=transaction)
        current = int((snap.to_dict() or {}).get("version", 0)) if snap.exists else 0
        if current != expected_version:
            raise Conflict()
        progress["version"] = expected_version + 1
        transaction.set(pref, progress)
        for m in messages:
            transaction.set(mcol.document(_msg_id(m["seq"])), m)
        return progress

    return _run(db.transaction())


def load_messages(db, uid: str, lid: str, limit: int = MESSAGES_RESTORE) -> list[dict]:
    col = lecture_ref(db, uid, lid).collection("messages")
    snaps = col.order_by("seq", direction=firestore.Query.DESCENDING).limit(limit).stream()
    rows = [s.to_dict() or {} for s in snaps]
    rows.sort(key=lambda m: int(m.get("seq") or 0))
    return rows


def _delete_children(ref, names: tuple[str, ...]) -> None:
    for name in names:
        for s in ref.collection(name).stream():
            s.reference.delete()


def delete_lecture(db, uid: str, lid: str) -> None:
    ref = lecture_ref(db, uid, lid)
    recursive = getattr(db, "recursive_delete", None)
    if recursive is not None:
        recursive(ref)
        return
    _delete_children(ref, ("progress", "messages", "extras"))
    ref.delete()


def reset_progress(db, uid: str, lid: str) -> None:
    _delete_children(lecture_ref(db, uid, lid), ("progress", "messages", "extras"))


def public_lecture(lecture: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "title", "fileName", "fileHash", "overview", "pageCount", "topics", "extraction", "estMinutes", "createdAt", "updatedAt")
    return {k: lecture.get(k) for k in keys}
