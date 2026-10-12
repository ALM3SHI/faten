"""Study pack (summary + key terms + quiz) from an uploaded lecture PDF."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from auth.dependencies import get_current_user
from services.quota import COST_STUDY_PDF, require_ai_credits
from services.study import MAX_PDF_BYTES, StudyError, study_from_pdf

router = APIRouter(prefix="/api/study", tags=["Study"])

_MESSAGES = {
    "not a pdf": "يجب رفع ملف PDF صالح.",
    "too large": f"حجم الملف أكبر من {MAX_PDF_BYTES // (1024 * 1024)} ميجابايت.",
    "unreadable": "ما قدرت أقرأ محتوى دراسي من هذا الملف. تأكد أنه ملف محاضرة وليس صوراً فارغة.",
    "empty": "ما طلع محتوى كافٍ من الملف. جرّب ملفاً آخر.",
    "bad response": "حدث خطأ في معالجة الملف، حاول مرة أخرى.",
}


@router.post("/pdf")
async def study_pdf(
    file: UploadFile = File(...),
    questions: int = Form(10),
    language: str = Form("ar"),
    user_id: str = Depends(get_current_user),
):
    data = await file.read(MAX_PDF_BYTES + 1)
    # Cheap checks first, so a wrong file doesn't cost the student credits.
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail=_MESSAGES["not a pdf"])
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail=_MESSAGES["too large"])
    require_ai_credits(user_id, COST_STUDY_PDF)
    try:
        return await study_from_pdf(data, questions, language)
    except StudyError as exc:
        raise HTTPException(status_code=400, detail=_MESSAGES.get(str(exc), _MESSAGES["bad response"])) from exc
