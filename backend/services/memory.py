"""
What the agent remembers about a student between conversations.

Stored at users/{uid}/agent_memory/main → {items: [{id, text, createdAt}]}.
Small on purpose (MAX_ITEMS × MAX_CHARS) so it is cheap to inject into every
prompt; the student can see and delete every item from their profile.
"""

from __future__ import annotations

import datetime as dt
import re
import secrets

MAX_ITEMS = 20
MAX_CHARS = 200

# Categories the agent must never store (PDPL "sensitive data").
_SENSITIVE = re.compile(
    r"(مرض|مريض|اكتئاب|قلق نفسي|علاج نفسي|دواء|أدوية|تشخيص|إعاقة|حمل\b|دين|مذهب|طائف|سياس|راتب|دخل|ديون|قرض|رقم الهوية|رقم الحساب|آيبان|iban|كلمة المرور|password)",
    re.IGNORECASE,
)


def _ref(db, uid: str):
    return db.collection("users").document(uid).collection("agent_memory").document("main")


def load_items(db, uid: str) -> list[dict]:
    snap = _ref(db, uid).get()
    items = (snap.to_dict() or {}).get("items") if snap.exists else None
    return items if isinstance(items, list) else []


def _save(db, uid: str, items: list[dict]) -> None:
    _ref(db, uid).set({"items": items, "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat()})


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def remember(db, uid: str, text: str) -> dict:
    text = _norm(text)[:MAX_CHARS]
    if len(text) < 3:
        return {"success": False, "message": "النص قصير جداً."}
    if _SENSITIVE.search(text):
        return {"success": False, "message": "لا أحفظ معلومات حساسة (صحية، دينية، مالية، أرقام هوية أو حسابات). أخبر الطالب بذلك بلطف."}
    items = load_items(db, uid)
    if any(_norm(i.get("text", "")) == text for i in items):
        return {"success": True, "message": "محفوظة مسبقاً.", "items": len(items)}
    item = {"id": secrets.token_hex(4), "text": text, "createdAt": dt.datetime.now(dt.timezone.utc).isoformat()}
    items = (items + [item])[-MAX_ITEMS:]  # keep the newest
    _save(db, uid, items)
    return {"success": True, "saved": item, "items": len(items), "note": "أخبر الطالب أنك حفظت هذه المعلومة ويمكنه حذفها من ملفه الشخصي."}


def forget(db, uid: str, item_id: str | None = None, text: str | None = None) -> dict:
    items = load_items(db, uid)
    if item_id:
        keep = [i for i in items if i.get("id") != item_id]
    elif text:
        q = _norm(text)
        keep = [i for i in items if q not in _norm(i.get("text", ""))]
    else:
        keep = []  # forget everything
    removed = len(items) - len(keep)
    _save(db, uid, keep)
    return {"success": True, "removed": removed, "items": len(keep)}


def prompt_block(items: list[dict]) -> str:
    if not items:
        return ""
    lines = "\n".join(f"- {i.get('text', '')}" for i in items[-MAX_ITEMS:])
    return (
        "\n═══ ما تعرفه عن الطالب من محادثات سابقة (ذاكرة يتحكم فيها الطالب) ═══\n"
        f"{lines}\n"
        "استخدمها لتخصيص النصيحة فقط عندما تكون ذات صلة، ولا تسردها للطالب بدون سبب.\n"
    )
