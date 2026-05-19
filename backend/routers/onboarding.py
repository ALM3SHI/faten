import json
import logging
import io
from datetime import datetime, timezone
import pdfplumber
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from openai import AsyncOpenAI
from pydantic import ValidationError

from config import get_settings
from auth.dependencies import get_current_user_optional, get_current_user
from schemas.onboarding import (
    OnboardingTranscriptResponse,
    TimetableResponse,
    SaveProfileRequest,
    SaveProfileResponse,
)
from db.firestore import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])

def get_openai_client() -> AsyncOpenAI:
    settings = get_settings()
    return AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
    )

def extract_text_from_pdf(file_bytes: bytes) -> str:
    text = ""
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                text += page.extract_text() + "\n"
    except Exception as e:
        logger.error(f"Failed to read PDF: {e}")
        raise HTTPException(status_code=400, detail="الملف المرفق غير صالح كملف PDF.")
    return text

@router.post("/analyze-transcript", response_model=OnboardingTranscriptResponse)
async def analyze_transcript(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_optional)
):
    """
    Strict PDF-only endpoint to parse official academic transcripts.
    """
    if not file.filename.lower().endswith('.pdf') or file.content_type != 'application/pdf':
        raise HTTPException(status_code=400, detail="الرجاء رفع السجل الأكاديمي بصيغة PDF فقط.")

    file_bytes = await file.read()
    text = extract_text_from_pdf(file_bytes)

    if not text or len(text.strip()) < 100:
        raise HTTPException(status_code=400, detail="عذراً، محتوى الملف فارغ أو قصير جداً. يرجى رفع السجل الرسمي.")

    keywords = ["سجل", "أكاديمي", "transcript", "gpa", "ساعات", "معدل", "university", "جامعة"]
    if not any(k in text.lower() for k in keywords):
        raise HTTPException(status_code=400, detail="هذا التقرير لا يبدو كسجل أكاديمي رسمي. يرجى التأكد من الملف المرفق.")

    settings = get_settings()
    client = get_openai_client()

    system_prompt = """
    You are an expert Academic Advisor for Arab universities (e.g., Umm Al-Qura University).
    Your task is to parse a raw text academic transcript and return ONLY a valid JSON object matching the requested schema.
    
    You must extract:
    1. current_gpa (cumulative GPA) — always normalize to the UQU 4.00 scale.
       If the transcript shows a 5-point cumulative number, convert it to the
       equivalent 4-point value using the per-letter mapping below before
       returning. Never return a value above 4.00.
    2. gpa_scale — always 4.0 for UQU. Do not output 5.0.
    3. earned_hours (cumulative passed hours)
    4. plan_hours (total required for degree if found, else null)
    5. university (name of the university)
    6. courses: current/active semester courses (name, code, credits, grade, term)
    7. historical_semesters: array of past semesters (name, sgpa, gpa, hours)
    8. suggested_learning_style: Calculate subject affinity (e.g., if grades are low, suggest slow speed & high stress buffer). Includes best_time, study_hours, method, focus_length, study_speed, stress_level, concept_style.
    9. affinity_reasoning: Short explanation in Arabic.
    
    Do NOT output markdown. Just raw JSON.
    """

    try:
        completion = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Transcript text:\n\n{text}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )

        response_text = completion.choices[0].message.content
        data = json.loads(response_text)
        validated_data = OnboardingTranscriptResponse(**data)
        
        return validated_data

    except ValidationError as ve:
        logger.error(f"Pydantic Validation Error during transcript parsing: {ve}")
        raise HTTPException(status_code=422, detail="فشل في استخراج البيانات بالشكل الصحيح. تأكد أن الملف يحتوي على جداول السجل الأكاديمي واضحة.")
    except Exception as e:
        logger.error(f"Failed to analyze transcript: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="حدث خطأ في النظام الذكي أثناء معالجة السجل.")

@router.post("/analyze-timetable", response_model=TimetableResponse)
async def analyze_timetable(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_optional)
):
    """
    Parses a semester timetable PDF into exact days and times.
    """
    if not file.filename.lower().endswith('.pdf') or file.content_type != 'application/pdf':
        raise HTTPException(status_code=400, detail="الرجاء رفع الجدول الدراسي بصيغة PDF فقط.")

    file_bytes = await file.read()
    text = extract_text_from_pdf(file_bytes)

    if not text or len(text.strip()) < 50:
         raise HTTPException(status_code=400, detail="عذراً، لم نتمكن من قراءة محتوى الجدول.")

    settings = get_settings()
    client = get_openai_client()

    system_prompt = """
    You are an expert AI extraction tool. Your job is to parse a university timetable (class schedule).
    Extract course names, exact days (e.g., Sunday, Tuesday), start time, end time, and location/hall.
    Return ONLY a valid JSON object matching this schema:
    {
      "success": true,
      "schedule": [
         { "course_name": str, "days": [str, str], "start_time": str, "end_time": str, "location": str }
      ]
    }
    """

    try:
        completion = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Timetable text:\n\n{text}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )

        response_text = completion.choices[0].message.content
        data = json.loads(response_text)
        validated_data = TimetableResponse(**data)
        return validated_data
    except Exception as e:
        logger.error(f"Timetable Parse Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="تعذر استخراج أوقات المحاضرات من الجدول.")


# ──────────────────────────────────────────────────────────────
# 3. SAVE PROFILE (replaces direct Firestore batch write in JS)
# ──────────────────────────────────────────────────────────────

@router.post("/save-profile", response_model=SaveProfileResponse)
async def save_onboarding_profile(
    payload: SaveProfileRequest,
    user_id: str = Depends(get_current_user),
):
    """
    Server-side replacement for the direct Firestore batch write
    that was previously in onboarding.js (lines 276-303).

    Performs the EXACT same Firestore writes:
    1. users/{uid}.set({ profile, study_preferences, timetable, updatedAt }, merge=true)
    2. users/{uid}/semesters/term_{i}.set(semester_data) for each historical semester
    """
    try:
        db = get_db()
        user_ref = db.collection("users").document(user_id)
        now_iso = datetime.now(timezone.utc).isoformat()

        # ── Build the profile document (exact same shape as JS) ──
        profile_doc = {
            "profile": {
                "currentGpa":  payload.goals.currentGpa,
                "earnedHours": payload.goals.earnedHours,
                "targetGpa":   payload.goals.targetGpa,
                "planHours":   payload.goals.planHours,
                "courses":     payload.courses,
                "university":  payload.university,
            },
            "study_preferences": payload.preferences.model_dump(),
            "timetable": payload.timetable,
            "updatedAt": now_iso,
        }

        # ── Batch write (mirrors the JS batch.commit()) ──
        batch = db.batch()
        batch.set(user_ref, profile_doc, merge=True)

        # Write historical semesters as sub-documents
        if payload.historical_semesters:
            for i, sem in enumerate(payload.historical_semesters):
                sem_ref = user_ref.collection("semesters").document(f"term_{i}")
                batch.set(sem_ref, sem)

        batch.commit()

        logger.info(f"[Onboarding] Profile saved for user {user_id}")
        return SaveProfileResponse(success=True, message="تم حفظ البيانات بنجاح")

    except Exception as e:
        logger.error(f"[Onboarding] Save profile failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="فشل حفظ البيانات. يرجى المحاولة مرة أخرى."
        )

