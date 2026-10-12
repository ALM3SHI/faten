"""
================================================================
UQU Academic Assistant — Community course reviews
================================================================
Students rate courses they have actually taken (verified against
their own academic record) and leave a short tip for future students.

Firestore (server-only — firestore.rules deny all client access):
  course_reviews/{CODE}                  aggregate {code, name, count, sums…}
  course_reviews/{CODE}/reviews/{rid}    one review per student
                                         rid = sha256(uid:CODE)[:20] so the
                                         reviewer's uid is never exposed.
================================================================
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from google.cloud import firestore

from db.firestore import get_db

RATING_FIELDS = ("difficulty", "workload", "usefulness")
REPORTS_TO_HIDE = 3
MAX_TIP_CHARS = 600

_CODE_RE = re.compile(r"^[A-Z]{2,5}\d{3,5}[A-Z]?$")
_LINK_RE = re.compile(r"(https?://\S+|www\.\S+|\S+\.(com|net|org|sa|io)\b)", re.IGNORECASE)
_PHONE_RE = re.compile(r"(\+?966|05)\d[\d\s-]{6,}")
# Minimal profanity guard; extend as moderation needs grow.
_BLOCKED = ("كلب", "حمار", "غبي", "حقير", "تافه", "زق")


def normalize_code(code: str) -> str:
    c = re.sub(r"[\s\-_]", "", (code or "").upper())
    if not _CODE_RE.match(c):
        raise HTTPException(status_code=400, detail="رمز المادة غير صالح (مثال: CS4510)")
    return c


def review_id(uid: str, code: str) -> str:
    return hashlib.sha256(f"{uid}:{code}".encode()).hexdigest()[:20]


def clean_tip(text: str) -> str:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if len(text) > MAX_TIP_CHARS:
        raise HTTPException(status_code=400, detail=f"النصيحة أطول من {MAX_TIP_CHARS} حرف")
    if _LINK_RE.search(text) or _PHONE_RE.search(text):
        raise HTTPException(status_code=400, detail="لا يُسمح بالروابط أو أرقام التواصل في التقييم")
    if any(w in text for w in _BLOCKED):
        raise HTTPException(status_code=400, detail="الرجاء الالتزام بأسلوب محترم في التقييم")
    return text


def _taken_course(uid: str, code: str) -> dict[str, Any] | None:
    """Return the course from the student's own record, with its status."""
    snap = get_db().collection("users").document(uid).collection("academic_record").document("main").get()
    data = snap.to_dict() or {}
    for status, key in (("completed", "completedCourses"), ("current", "currentCourses"), ("current", "registeredCourses")):
        for c in data.get(key) or []:
            if isinstance(c, dict) and re.sub(r"[\s\-_]", "", str(c.get("code", "")).upper()) == code:
                return {"status": status, "name": c.get("nameAr") or c.get("name") or c.get("nameEn") or code}
    return None


def _public_summary(agg: dict[str, Any]) -> dict[str, Any]:
    count = int(agg.get("count", 0))
    avg = {f: round(agg.get(f"sum_{f}", 0) / count, 1) if count else None for f in RATING_FIELDS}
    return {"code": agg.get("code"), "name": agg.get("name"), "count": count, "averages": avg,
            "recommend_pct": round(100 * agg.get("recommend_yes", 0) / count) if count else None}


def list_courses(query: str = "", limit: int = 30) -> list[dict[str, Any]]:
    col = get_db().collection("course_reviews")
    docs = col.order_by("count", direction=firestore.Query.DESCENDING).limit(200).stream()
    q = (query or "").strip().upper()
    out = []
    for d in docs:
        agg = d.to_dict() or {}
        if agg.get("count", 0) <= 0:
            continue
        if q and q not in str(agg.get("code", "")).upper() and query.strip() not in str(agg.get("name", "")):
            continue
        out.append(_public_summary(agg))
        if len(out) >= limit:
            break
    return out


def get_course(uid: str, code: str) -> dict[str, Any]:
    code = normalize_code(code)
    ref = get_db().collection("course_reviews").document(code)
    agg = ref.get().to_dict() or {"code": code, "name": None, "count": 0}
    mine_id = review_id(uid, code)
    reviews, mine = [], None
    for d in ref.collection("reviews").order_by("updatedAt", direction=firestore.Query.DESCENDING).limit(100).stream():
        r = d.to_dict() or {}
        item = {
            "id": d.id,
            "ratings": {f: r.get(f) for f in RATING_FIELDS},
            "recommend": r.get("recommend"),
            "tip": r.get("tip", ""),
            "semester": r.get("semester", ""),
            "status": r.get("status"),
            "updatedAt": r.get("updatedAt"),
            "mine": d.id == mine_id,
        }
        if d.id == mine_id:
            mine = item
        if r.get("hidden") and d.id != mine_id:
            continue
        reviews.append(item)
    taken = _taken_course(uid, code)
    return {**_public_summary(agg), "reviews": reviews, "my_review": mine,
            "can_review": taken is not None, "my_course_name": taken["name"] if taken else None}


def upsert_review(uid: str, code: str, payload: dict[str, Any]) -> dict[str, Any]:
    code = normalize_code(code)
    taken = _taken_course(uid, code)
    if not taken:
        raise HTTPException(status_code=403, detail="تقدر تقيّم المواد الموجودة في سجلك الأكاديمي فقط. ارفع سجلك أولًا من صفحة السجل.")
    ratings = {}
    for f in RATING_FIELDS:
        v = payload.get(f)
        if not isinstance(v, int) or not 1 <= v <= 5:
            raise HTTPException(status_code=400, detail="كل تقييم يجب أن يكون من 1 إلى 5")
        ratings[f] = v
    recommend = bool(payload.get("recommend"))
    tip = clean_tip(payload.get("tip", ""))
    semester = re.sub(r"[^\w\s؀-ۿ/-]", "", str(payload.get("semester", "")))[:40]

    db = get_db()
    agg_ref = db.collection("course_reviews").document(code)
    rev_ref = agg_ref.collection("reviews").document(review_id(uid, code))
    now = datetime.now(timezone.utc).isoformat()

    @firestore.transactional
    def _tx(tx: firestore.Transaction) -> None:
        agg = agg_ref.get(transaction=tx).to_dict() or {"code": code, "count": 0, "recommend_yes": 0,
                                                       **{f"sum_{f}": 0 for f in RATING_FIELDS}}
        old = rev_ref.get(transaction=tx).to_dict()
        if old:  # replace previous contribution
            for f in RATING_FIELDS:
                agg[f"sum_{f}"] -= old.get(f, 0)
            agg["recommend_yes"] -= 1 if old.get("recommend") else 0
        else:
            agg["count"] = agg.get("count", 0) + 1
        for f in RATING_FIELDS:
            agg[f"sum_{f}"] = agg.get(f"sum_{f}", 0) + ratings[f]
        agg["recommend_yes"] = agg.get("recommend_yes", 0) + (1 if recommend else 0)
        agg["name"] = agg.get("name") or taken["name"]
        agg["code"] = code
        agg["updatedAt"] = now
        tx.set(agg_ref, agg)
        tx.set(rev_ref, {
            **ratings, "recommend": recommend, "tip": tip, "semester": semester,
            "status": taken["status"], "uid": uid, "updatedAt": now,
            "createdAt": (old or {}).get("createdAt", now),
            "reports": (old or {}).get("reports", []), "hidden": (old or {}).get("hidden", False),
        })

    _tx(db.transaction())
    return get_course(uid, code)


def delete_review(uid: str, code: str) -> dict[str, Any]:
    code = normalize_code(code)
    db = get_db()
    agg_ref = db.collection("course_reviews").document(code)
    rev_ref = agg_ref.collection("reviews").document(review_id(uid, code))

    @firestore.transactional
    def _tx(tx: firestore.Transaction) -> None:
        old = rev_ref.get(transaction=tx).to_dict()
        if not old:
            return
        agg = agg_ref.get(transaction=tx).to_dict() or {}
        agg["count"] = max(agg.get("count", 1) - 1, 0)
        for f in RATING_FIELDS:
            agg[f"sum_{f}"] = agg.get(f"sum_{f}", 0) - old.get(f, 0)
        agg["recommend_yes"] = agg.get("recommend_yes", 0) - (1 if old.get("recommend") else 0)
        tx.set(agg_ref, agg)
        tx.delete(rev_ref)

    _tx(db.transaction())
    return get_course(uid, code)


def report_review(uid: str, code: str, rid: str) -> dict[str, Any]:
    code = normalize_code(code)
    if not re.fullmatch(r"[0-9a-f]{20}", rid or ""):
        raise HTTPException(status_code=400, detail="معرّف غير صالح")
    rev_ref = get_db().collection("course_reviews").document(code).collection("reviews").document(rid)
    snap = rev_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="التقييم غير موجود")
    reporters = set(snap.to_dict().get("reports", []))
    reporters.add(hashlib.sha256(uid.encode()).hexdigest()[:16])  # one report per student
    rev_ref.update({"reports": sorted(reporters), "hidden": len(reporters) >= REPORTS_TO_HIDE})
    return {"success": True}


def course_reviews_for_agent(code_or_name: str) -> dict[str, Any]:
    """Compact, read-only summary the chat agent can quote."""
    db = get_db()
    code = re.sub(r"[\s\-_]", "", (code_or_name or "").upper())
    agg = None
    if _CODE_RE.match(code):
        agg = db.collection("course_reviews").document(code).get().to_dict()
    if not agg:
        for d in db.collection("course_reviews").limit(300).stream():
            a = d.to_dict() or {}
            if code_or_name and code_or_name.strip() in str(a.get("name", "")):
                agg, code = a, a.get("code", code)
                break
    if not agg or not agg.get("count"):
        return {"success": True, "found": False, "message": "لا توجد تقييمات طلاب لهذه المادة بعد."}
    tips = []
    for d in db.collection("course_reviews").document(code).collection("reviews") \
            .order_by("updatedAt", direction=firestore.Query.DESCENDING).limit(15).stream():
        r = d.to_dict() or {}
        if r.get("tip") and not r.get("hidden"):
            tips.append(r["tip"])
    return {"success": True, "found": True, **_public_summary(agg),
            "scale": "1 = منخفض، 5 = مرتفع", "recent_tips": tips[:8]}
