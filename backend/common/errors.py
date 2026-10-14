"""Arabic error responses for everything the API sends back.

Route code raises HTTPException with an Arabic `detail`. This module covers
the cases FastAPI/Starlette answer on their own in English — unknown routes,
wrong methods, request bodies that fail validation — so the student always
reads a clear Arabic reason. Every response keeps the shape {"detail": str}.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# Starlette's default phrases (detail == reason phrase) → Arabic.
_DEFAULT_MESSAGES: dict[int, str] = {
    400: "الطلب غير صحيح.",
    401: "سجّل دخولك أولاً ثم أعد المحاولة.",
    403: "ليس لديك صلاحية لهذا الإجراء.",
    404: "الصفحة أو الخدمة المطلوبة غير موجودة.",
    405: "هذه العملية غير مدعومة على هذا الرابط.",
    408: "انتهت مهلة الطلب. حاول مرة أخرى.",
    413: "حجم البيانات المرسلة أكبر من المسموح.",
    415: "نوع الملف أو البيانات غير مدعوم.",
    422: "البيانات المرسلة غير مكتملة أو غير صحيحة.",
    429: "طلبات كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول مرة أخرى.",
    500: "حدث خطأ غير متوقع في الخادم. حاول مرة أخرى بعد قليل.",
    502: "تعذّر الوصول لخدمة خارجية يعتمد عليها فطن. حاول بعد قليل.",
    503: "الخدمة غير متاحة مؤقتاً. حاول بعد قليل.",
    504: "تأخرت الخدمة في الرد. حاول مرة أخرى.",
}

# Pydantic v2 error types → what is wrong with the field, in Arabic.
_FIELD_PROBLEMS: dict[str, str] = {
    "missing": "مطلوب",
    "string_too_short": "أقصر من المسموح",
    "string_too_long": "أطول من المسموح",
    "too_short": "عدد عناصره أقل من المسموح",
    "too_long": "عدد عناصره أكثر من المسموح",
    "greater_than": "قيمته أصغر من المسموح",
    "greater_than_equal": "قيمته أصغر من المسموح",
    "less_than": "قيمته أكبر من المسموح",
    "less_than_equal": "قيمته أكبر من المسموح",
    "literal_error": "قيمته غير مسموحة",
    "enum": "قيمته غير مسموحة",
    "json_invalid": "ليس بصيغة JSON صحيحة",
    "extra_forbidden": "غير متوقع",
    "string_pattern_mismatch": "صيغته غير صحيحة",
    "date_from_datetime_parsing": "ليس تاريخاً صحيحاً",
    "date_parsing": "ليس تاريخاً صحيحاً",
    "time_parsing": "ليس وقتاً صحيحاً",
}


def _field_name(loc: tuple | list) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path", "header", "form")]
    return ".".join(parts) or "الطلب"


def validation_message(errors: list[dict]) -> str:
    """One Arabic sentence describing the first few validation problems."""
    problems = []
    for err in errors[:3]:
        etype = str(err.get("type", ""))
        problem = _FIELD_PROBLEMS.get(etype)
        if problem is None:
            problem = "نوعه غير صحيح" if etype.endswith(("_type", "_parsing")) else "قيمته غير صحيحة"
        problems.append(f"«{_field_name(err.get('loc', ()))}» {problem}")
    more = f" (و{len(errors) - 3} غيرها)" if len(errors) > 3 else ""
    return "البيانات المرسلة غير صحيحة: " + "، ".join(problems) + more + "."


def arabic_detail(status_code: int, detail: object) -> object:
    """Keep route-provided details; replace Starlette's English defaults."""
    if isinstance(detail, str):
        try:
            from http import HTTPStatus

            default_phrase = HTTPStatus(status_code).phrase
        except ValueError:
            default_phrase = None
        if detail == default_phrase or not detail.strip():
            return _DEFAULT_MESSAGES.get(status_code, _DEFAULT_MESSAGES[500 if status_code >= 500 else 400])
    return detail


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):  # noqa: ARG001
        errors = exc.errors()
        return JSONResponse(
            status_code=422,
            content={
                "detail": validation_message(errors),
                # Machine-readable copy for debugging (field paths + types only).
                "errors": [{"loc": list(e.get("loc", ())), "type": e.get("type")} for e in errors[:10]],
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):  # noqa: ARG001
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": arabic_detail(exc.status_code, exc.detail)},
            headers=getattr(exc, "headers", None),
        )


class UpstreamAIError(HTTPException):
    """The AI provider answered with an error. `upstream_status` keeps its
    HTTP status (429 quota, 5xx outage …) so callers can decide to retry
    while the student sees an Arabic `detail`."""

    def __init__(self, upstream_status: int | None, status_code: int = 502, detail: str | None = None):
        super().__init__(status_code=status_code, detail=detail or upstream_ai_message(upstream_status))
        self.upstream_status = upstream_status


RETRYABLE_UPSTREAM = frozenset({429, 500, 502, 503, 504})


def upstream_ai_message(status_code: int | None) -> str:
    """Arabic reason for a failed call to the AI provider (Gemini / OpenAI-compatible)."""
    if status_code == 429:
        return "خدمة الذكاء الاصطناعي مشغولة الآن (وصلنا للحد المسموح مؤقتاً). حاول بعد دقيقة."
    if status_code in (401, 403):
        return "إعدادات خدمة الذكاء الاصطناعي على الخادم غير صحيحة. أبلغ المسؤول عن فطن."
    if status_code == 404:
        return "نموذج الذكاء الاصطناعي المضبوط على الخادم غير متاح. أبلغ المسؤول عن فطن."
    if status_code is not None and 400 <= status_code < 500:
        return "رفضت خدمة الذكاء الاصطناعي هذا الطلب. جرّب ملفاً أو صياغة أخرى."
    return "خدمة الذكاء الاصطناعي متعطلة مؤقتاً. حاول بعد قليل."


AI_KEY_MISSING_MESSAGE = "خدمة الذكاء الاصطناعي غير مفعّلة على الخادم (المفتاح غير مضبوط). أبلغ المسؤول عن فطن."
AI_TIMEOUT_MESSAGE = "تأخرت خدمة الذكاء الاصطناعي في الرد. حاول مرة أخرى بعد قليل."
AI_EMPTY_REPLY_MESSAGE = "لم يصل رد من خدمة الذكاء الاصطناعي. حاول مرة أخرى."
AI_BAD_REPLY_MESSAGE = "وصل رد غير مفهوم من خدمة الذكاء الاصطناعي. حاول مرة أخرى."
AI_BLOCKED_MESSAGE = "رفضت خدمة الذكاء الاصطناعي هذا المحتوى لأسباب تتعلق بالسلامة. جرّب صياغة أو ملفاً آخر."
