"""
Dynamic study mode — «المذاكرة الذكية الديناميكية».

  POST   /api/tutor/lectures                 upload a lecture PDF (or reuse it)
  GET    /api/tutor/lectures                 the student's lectures + progress
  GET    /api/tutor/lectures/{id}            full session: lecture, state, messages, timer
  POST   /api/tutor/lectures/{id}/step       one tutor step {action, payload, version}
  PUT    /api/tutor/lectures/{id}/focus      save the study timer
  POST   /api/tutor/lectures/{id}/reset      start the lecture over (keeps the analysis)
  DELETE /api/tutor/lectures/{id}

The normal chat (/api/chat) is untouched and shares no state with this mode.
"""

from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from auth.dependencies import get_current_user
import db.firestore as dbmod
from schemas.tutor import FocusState, StepRequest
from services.quota import COST_TUTOR_INGEST, CreditLedger
from services.tutor import analytics, engine, mastery, store
from services.tutor.ingest import ESTIMATE_VERSION, IngestError, build_lecture, file_hash, lecture_id_for, refresh_estimates

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tutor", tags=["Tutor"])

MAX_PDF_BYTES = 10 * 1024 * 1024

_INGEST_MESSAGES = {
    "broken": "الملف تالف أو محمي بكلمة مرور، فما قدرت أفتحه. جرّب نسخة أخرى من المحاضرة.",
    "too many pages": "المحاضرة أطول من 120 صفحة. قسّمها إلى ملفين وارفع كل جزء لوحده.",
    "empty": "الملف لا يحتوي صفحات.",
    "unreadable": "ما لقيت في الملف محتوى دراسياً أقدر أقرأه (ولا حتى بتحليل الصور). تأكد أنه ملف المحاضرة.",
}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _id_ok(lid: str) -> str:
    if not (lid.startswith("L") and 8 <= len(lid) <= 40 and lid[1:].isalnum()):
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة.")
    return lid


def _load(db, uid: str, lid: str) -> dict:
    lecture = store.get_lecture(db, uid, _id_ok(lid))
    if not lecture:
        raise HTTPException(status_code=404, detail="المحاضرة غير موجودة. ربما حُذفت من جهاز آخر.")
    return lecture


def _fresh_estimates(db, uid: str, lecture: dict) -> dict:
    """Lectures analysed before the code-based time estimate get it once (no model call)."""
    if lecture.get("estVersion") == ESTIMATE_VERSION:
        return lecture
    try:
        pages = store.load_pages(db, lecture["fileHash"], int(lecture.get("pageCount") or 0))
        if refresh_estimates(lecture, pages):
            store.touch_lecture(db, uid, lecture["id"], {"topics": lecture["topics"], "estMinutes": lecture["estMinutes"], "estVersion": ESTIMATE_VERSION})
            store.cache_ref(db, lecture["fileHash"]).set({"topics": lecture["topics"], "estMinutes": lecture["estMinutes"], "estVersion": ESTIMATE_VERSION}, merge=True)
    except Exception as exc:  # an estimate must never block opening a lecture
        logger.warning("[tutor] estimate refresh skipped for %s: %s", lecture.get("id"), exc)
    return lecture


def _ctx(db, uid: str, lecture: dict, progress: dict, ledger: CreditLedger | None = None) -> engine.Ctx:
    ledger = ledger or CreditLedger(uid)
    return engine.Ctx(db=db, uid=uid, lecture=lecture, progress=progress, now=_now(), charge=ledger.charge)


def _focus_view(focus: dict | None) -> dict:
    return {**(focus or {"mode": "idle"}), "serverNow": _now().isoformat()}


def _session(db, uid: str, lecture: dict, progress: dict) -> dict:
    ctx = _ctx(db, uid, lecture, progress)
    msgs = store.load_messages(db, uid, lecture["id"])
    out = engine.snapshot(ctx, msgs)
    out["focus"] = _focus_view(store.load_focus(db, uid, lecture["id"]))
    return out


async def _apply(db, uid: str, lecture: dict, progress: dict, action: str, payload: dict, expected: int) -> tuple[engine.Ctx, list[dict]]:
    """Run one tutor step and save it. If anything fails before the save
    succeeds, the student gets nothing — so every credit charged during this
    request is refunded (once), and the saved progress is untouched."""
    ledger = CreditLedger(uid)
    ctx = _ctx(db, uid, lecture, progress, ledger)
    try:
        try:
            await engine.run_action(ctx, action, payload)
        except engine.TutorError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
        ctx.flush()
        try:
            store.commit(db, uid, lecture["id"], ctx.progress, expected, ctx.messages)
        except store.Conflict as exc:
            raise HTTPException(status_code=409, detail="تقدّمت الجلسة من نافذة أو جهاز آخر — حدّثنا الصفحة لتكمل من آخر نقطة.") from exc
    except BaseException:
        if ledger.total:
            back = ledger.refund_all()
            logger.info("[tutor] step '%s' failed for user=%s — refunded %d credit(s)", action, uid, back)
        raise
    store.touch_lecture(db, uid, lecture["id"], {"updatedAt": ctx.iso})
    analytics.apply_events(db, lecture.get("fileHash", ""), lecture.get("title", ""), ctx.events)
    return ctx, ctx.messages


@router.post("/lectures")
async def upload_lecture(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
    data = await file.read(MAX_PDF_BYTES + 1)
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="يجب رفع ملف PDF صالح.")
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail=f"حجم الملف أكبر من {MAX_PDF_BYTES // (1024 * 1024)} ميجابايت.")
    db = dbmod.get_db()
    digest = file_hash(data)
    lid = lecture_id_for(digest)
    now = _now().isoformat()
    lecture = store.get_lecture(db, user_id, lid)
    if lecture:
        lecture = _fresh_estimates(db, user_id, lecture)
    reused = "mine" if lecture else None
    if not lecture:
        if len(store.list_lectures(db, user_id)) >= store.MAX_LECTURES:
            raise HTTPException(status_code=400, detail=f"عندك {store.MAX_LECTURES} محاضرة محفوظة. احذف محاضرة قديمة لتضيف جديدة.")
        cached = store.get_cached_lecture(db, digest)
        if cached:
            reused = "shared"
            lecture = {**cached, "id": lid}
        else:
            ledger = CreditLedger(user_id)
            ledger.charge(COST_TUTOR_INGEST)
            try:
                try:
                    lecture, pages = await build_lecture(data, file.filename or "lecture.pdf")
                except IngestError as exc:
                    raise HTTPException(status_code=400, detail=_INGEST_MESSAGES.get(str(exc), _INGEST_MESSAGES["unreadable"])) from exc
                store.save_cache(db, lecture, pages)
            except BaseException:
                ledger.refund_all()  # nothing usable came out of this upload
                raise
        lecture["fileName"] = (file.filename or "lecture.pdf")[:200]
        lecture["createdAt"] = now
        lecture["updatedAt"] = now
        store.save_lecture(db, user_id, lecture)

    progress = store.load_progress(db, user_id, lid)
    if progress is None:
        progress = engine.new_progress(lecture, _now())
        await _apply(db, user_id, lecture, progress, "begin", {}, 0)
        progress = store.load_progress(db, user_id, lid) or progress
    out = _session(db, user_id, lecture, progress)
    out["reused"] = reused
    return out


@router.get("/lectures")
async def my_lectures(user_id: str = Depends(get_current_user)):
    db = dbmod.get_db()
    today = (_now() + dt.timedelta(hours=3)).date().isoformat()
    out = []
    for lec in store.list_lectures(db, user_id):
        prog = store.load_progress(db, user_id, lec["id"]) or {}
        tids = [t["id"] for t in lec.get("topics") or []]
        summary = mastery.lecture_summary(tids, prog.get("topics") or {}, today)
        out.append({
            "id": lec["id"],
            "title": lec.get("title"),
            "fileName": lec.get("fileName"),
            "fileHash": lec.get("fileHash"),
            "pageCount": lec.get("pageCount"),
            "topics": len(tids),
            "estMinutes": lec.get("estMinutes"),
            "phase": prog.get("phase") or "overview",
            "counts": summary["counts"],
            "reviewDue": len(mastery.due_reviews(prog.get("topics") or {}, today)),
            "dueTopics": [
                {"id": t["id"], "title": t["title"]}
                for t in lec.get("topics") or []
                if t["id"] in set(mastery.due_reviews(prog.get("topics") or {}, today))
            ],
            "finalScore": ((prog.get("final") or {}).get("result") or {}).get("score"),
            "updatedAt": lec.get("updatedAt"),
        })
    return {"lectures": out}


@router.get("/lectures/{lid}")
async def get_session(lid: str, user_id: str = Depends(get_current_user)):
    db = dbmod.get_db()
    lecture = _fresh_estimates(db, user_id, _load(db, user_id, lid))
    progress = store.load_progress(db, user_id, lecture["id"])
    if progress is None:
        progress = engine.new_progress(lecture, _now())
        await _apply(db, user_id, lecture, progress, "begin", {}, 0)
        progress = store.load_progress(db, user_id, lecture["id"]) or progress
    return _session(db, user_id, lecture, progress)


@router.post("/lectures/{lid}/step")
async def step(lid: str, body: StepRequest, user_id: str = Depends(get_current_user)):
    db = dbmod.get_db()
    lecture = _load(db, user_id, lid)
    progress = store.load_progress(db, user_id, lecture["id"]) or engine.new_progress(lecture, _now())
    current = int(progress.get("version") or 0)
    if body.version != current:
        raise HTTPException(status_code=409, detail="تقدّمت الجلسة من نافذة أو جهاز آخر — حدّثنا الصفحة لتكمل من آخر نقطة.")
    ctx, messages = await _apply(db, user_id, lecture, progress, body.action, body.payload, current)
    return {"state": engine.public_state(ctx), "messages": messages}


@router.put("/lectures/{lid}/focus")
async def save_focus(lid: str, body: FocusState, user_id: str = Depends(get_current_user)):
    db = dbmod.get_db()
    lecture = _load(db, user_id, lid)
    data = body.model_dump()
    for key in ("startedAt", "pausedAt"):
        if data[key]:
            try:
                dt.datetime.fromisoformat(data[key].replace("Z", "+00:00"))
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="وقت المؤقت غير صحيح.") from exc
    data["updatedAt"] = _now().isoformat()
    store.save_focus(db, user_id, lecture["id"], data)
    return {"focus": _focus_view(data)}


@router.post("/lectures/{lid}/reset")
async def reset(lid: str, user_id: str = Depends(get_current_user)):
    db = dbmod.get_db()
    lecture = _load(db, user_id, lid)
    store.reset_progress(db, user_id, lecture["id"])
    progress = engine.new_progress(lecture, _now())
    await _apply(db, user_id, lecture, progress, "begin", {}, 0)
    return _session(db, user_id, lecture, store.load_progress(db, user_id, lecture["id"]) or progress)


@router.delete("/lectures/{lid}")
async def delete(lid: str, user_id: str = Depends(get_current_user)):
    db = dbmod.get_db()
    lecture = _load(db, user_id, lid)
    store.delete_lecture(db, user_id, lecture["id"])
    return {"success": True}
