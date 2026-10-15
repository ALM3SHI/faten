"""Arabic explanations of an advisory run.

`summarize_run` is deterministic and always available: it answers the six
questions a student asks (what, why, what if not, GPA/graduation effect,
what is uncertain, what next) straight from the computed result.

`ask` is the optional LLM layer for follow-up questions. The model gets
only the run's facts; its JSON answer is rejected (and the deterministic
answer used instead) if it mentions a course code or a number that is not
in those facts, or promises outcomes.
"""

from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger(__name__)

_CODE_TOKEN = re.compile(r"\b[A-Z]{2,5}\d{3,5}[A-Z]?\b")
_NUM_TOKEN = re.compile(r"\d+\.\d+")
_FORBIDDEN = ("مضمون", "أضمن", "نضمن", "يضمن لك", "بالتأكيد ستنجح", "guarantee")

STRATEGY_AR = {"fastest": "الأسرع تخرجاً", "balanced": "المتوازن", "recovery": "التعافي"}


def summarize_run(run: dict) -> dict:
    rs = run.get("record_status") or {}
    if rs.get("status") in ("graduated", "likely_graduated"):
        return {"what": run.get("withheld_reason") or "", "why": list(rs.get("reasons") or []), "alternatives": [], "effect": [],
                "uncertain": (["الحكم بالتخرج استنتاج من السجل (مشروع التخرج والتدريب والساعات)، وليس إفادة تخرج رسمية."]
                              if rs.get("status") == "likely_graduated" else []),
                "next_steps": ["تأكد من حالة تخرجك في نظام التسجيل أو مع القسم."],
                "confidence": (run.get("confidence") or {}).get("level")}
    if run.get("plan_applicable") is False:
        reason = run.get("withheld_reason") or ""
        return {"what": reason, "why": [], "alternatives": [], "effect": [],
                "uncertain": list((run.get("confidence") or {}).get("reasons") or []),
                "next_steps": ["أكّد إصدار خطتك مع القسم أو من نظام التسجيل.",
                               "إن كانت خطتك هي المنشورة حالياً فصحّح سجلك (مقررات معادلة مثلاً) ثم أعد التحليل."],
                "confidence": (run.get("confidence") or {}).get("level")}
    nt = run.get("next_term") or {}
    courses = nt.get("courses") or []
    sc = run.get("scenarios") or {}
    chosen = run.get("recommended_strategy")
    picked = sc.get(chosen) or {}
    what = (f"سجّل في {nt.get('label')} هذه المقررات ({nt.get('credits')} ساعة): "
            + "، ".join(f"{c['code']} {c['name']}" for c in courses)) if courses else "لا يوجد مقرر يمكن اقتراحه الآن — راجع النواقص أدناه."
    why = [run.get("strategy_reason", "")]
    for c in courses[:4]:
        if c.get("reasons"):
            why.append(f"{c['code']}: {c['reasons'][0]}")
    alts = []
    for key in ("fastest", "balanced", "recovery"):
        s = sc.get(key)
        if not s or key == chosen:
            continue
        if s.get("complete"):
            alts.append(f"مسار {STRATEGY_AR[key]}: {s['terms_needed']} فصول، تخرج محسوب {s['graduation_label']} (حد العبء {s['load_cap']}).")
        else:
            alts.append(f"مسار {STRATEGY_AR[key]}: لم يكتمل ضمن الأفق الزمني.")
    effect = []
    if picked.get("graduation_label"):
        effect.append(f"موعد التخرج المحسوب في المسار المقترح: {picked['graduation_label']} ({picked['terms_needed']} فصول) — "
                      "ممكن رياضياً وفق الخطة المنشورة، وغير مؤكد للتسجيل.")
    wi = run.get("gpa_what_if") or {}
    if wi.get("available"):
        rows = {r["term_average"]: r["resulting_gpa"] for r in wi["rows"]}
        effect.append(f"معدلك الآن {wi['current_gpa']:.2f}: لو كان متوسطك القادم B يصبح {rows['B']:.2f}، ولو C يصبح {rows['C']:.2f}.")
    tgt = (picked.get("target") or {})
    if tgt:
        effect.append(tgt.get("message", ""))
    uncertain = list((run.get("confidence") or {}).get("reasons") or [])
    for u in run.get("uncertainties") or []:
        uncertain.append(f"{u['message']} الأثر: {u['effect']}")
    warn = ((run.get("standing") or {}).get("warning") or {})
    if warn.get("status") == "unknown" and warn.get("message"):
        uncertain.append(warn["message"])
    for g in run.get("data_gaps") or []:
        uncertain.append(f"{g['message']} {g['impact']}")
    nxt = []
    fit = run.get("curriculum_fit") or {}
    if fit.get("verdict") in ("other_edition", "mismatch"):
        nxt.append("أكّد إصدار خطتك مع القسم قبل الاعتماد على هذه النتائج.")
    if any(r["severity"] == "high" for r in run.get("risks") or []):
        nxt.append("راجع مرشدك الأكاديمي بخصوص المخاطر المرتفعة قبل التسجيل.")
    if run.get("data_gaps"):
        nxt.append("أكمل البيانات الناقصة لتحسين دقة الخطة.")
    nxt.append("تحقق من طرح المقررات في نظام التسجيل، ثم استخدم «فحص جدول» قبل اعتماد التسجيل.")
    return {
        "what": what, "why": [w for w in why if w], "alternatives": alts, "effect": [e for e in effect if e],
        "uncertain": uncertain, "next_steps": nxt,
        "confidence": (run.get("confidence") or {}).get("level"),
    }


def facts_for_llm(run: dict) -> dict:
    """The only material the model may use."""
    nt = run.get("next_term") or {}
    return {
        "program": run.get("program", {}).get("name"),
        "curriculum_status": run.get("curriculum", {}).get("verification"),
        "gpa": run.get("profile", {}).get("gpa"),
        "earned_hours": run.get("profile", {}).get("earned_hours"),
        "failed_not_passed": run.get("profile", {}).get("failed_unresolved"),
        "recommended_strategy": run.get("recommended_strategy"),
        "strategy_reason": run.get("strategy_reason"),
        "load": run.get("load"),
        "plan_applicable": run.get("plan_applicable", True),
        "withheld_reason": run.get("withheld_reason"),
        "next_term": {"label": nt.get("label"), "credits": nt.get("credits"),
                      "courses": [{k: c.get(k) for k in ("code", "name", "credits", "reasons", "unlocks", "delay_cost_terms")}
                                  for c in nt.get("courses") or []],
                      "alternatives": [a.get("code") for a in nt.get("alternatives") or []]},
        "scenarios": {k: {"terms": v.get("terms_needed"), "graduation": v.get("graduation_label"), "load_cap": v.get("load_cap"),
                          "target": (v.get("target") or {}).get("message")}
                      for k, v in (run.get("scenarios") or {}).items()},
        "risks": [{"severity": r["severity"], "basis": r["basis"], "message": r["message"]} for r in run.get("risks") or []],
        "gpa_what_if": run.get("gpa_what_if"),
        "data_gaps": [g["message"] for g in run.get("data_gaps") or []],
        "academic_standing": {k: (v or {}).get("message") for k, v in (run.get("standing") or {}).items()},
        "uncertainties": [{"what": u["message"], "effect": u["effect"]} for u in run.get("uncertainties") or []],
        "confidence": run.get("confidence"),
    }


SYSTEM = """أنت مرشد أكاديمي في جامعة أم القرى تشرح نتائج محرك تخطيط حسابي.
القواعد:
- استخدم فقط الحقائق في JSON المرفق. لا تضف مقررات أو أرقاماً أو لوائح أو أسماء محاضرين من عندك.
- إذا لم تكفِ الحقائق للإجابة فقل ذلك بوضوح واقترح ما يلزم معرفته.
- فرّق بين الحقيقة (من السجل) والتقدير. لا تَعِد بنتيجة ولا تضمن نجاحاً أو وظيفة.
- عربية واضحة بسيطة، دون مصطلحات تقنية.
أعد JSON فقط بهذا الشكل:
{"answer": "فقرة قصيرة", "points": ["نقطة", "..."], "next_step": "خطوة عملية واحدة"}"""


def _allowed_tokens(facts: dict) -> tuple[set[str], set[str]]:
    blob = json.dumps(facts, ensure_ascii=False)
    codes = set(_CODE_TOKEN.findall(blob))
    nums = set(_NUM_TOKEN.findall(blob))
    # Also allow 1- and 2-decimal renderings of the same numbers.
    for n in list(nums):
        try:
            f = float(n)
            nums |= {f"{f:.1f}", f"{f:.2f}"}
        except ValueError:
            pass
    return codes, nums


def validate_answer(answer: dict, facts: dict) -> list[str]:
    problems = []
    if not isinstance(answer, dict) or not isinstance(answer.get("answer"), str):
        return ["شكل الإجابة غير صالح"]
    text = json.dumps(answer, ensure_ascii=False)
    codes, nums = _allowed_tokens(facts)
    extra_codes = set(_CODE_TOKEN.findall(text)) - codes
    if extra_codes:
        problems.append(f"رموز مقررات غير موجودة في الحقائق: {sorted(extra_codes)}")
    extra_nums = set(_NUM_TOKEN.findall(text)) - nums
    if extra_nums:
        problems.append(f"أرقام غير موجودة في الحقائق: {sorted(extra_nums)}")
    if any(w in text for w in _FORBIDDEN):
        problems.append("وعد أو ضمان غير مسموح")
    return problems


def _parse_json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


async def ask(run: dict, question: str, client, model: str, history: list[dict] | None = None) -> dict:
    facts = facts_for_llm(run)
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": "الحقائق:\n" + json.dumps(facts, ensure_ascii=False)}]
    for turn in (history or [])[-6:]:
        if turn.get("role") in ("user", "assistant") and isinstance(turn.get("content"), str):
            messages.append({"role": turn["role"], "content": turn["content"][:1500]})
    messages.append({"role": "user", "content": question[:800]})
    fallback = summarize_run(run)
    try:
        completion = await client.chat.completions.create(model=model, messages=messages, temperature=0.2, max_tokens=900)
        parsed = _parse_json(completion.choices[0].message.content or "")
    except Exception as exc:  # network / provider errors → deterministic answer
        logger.warning("advisor explain failed: %s", exc)
        return {"source": "deterministic", "reason": "تعذّر الوصول لمحرك الصياغة", "summary": fallback}
    problems = validate_answer(parsed or {}, facts) if parsed else ["لم يُرجع JSON"]
    if problems:
        logger.info("advisor explain rejected: %s", problems)
        return {"source": "deterministic", "reason": "رُفضت صياغة الذكاء الاصطناعي لأنها خرجت عن الحقائق", "problems": problems,
                "summary": fallback}
    return {"source": "llm_validated", "answer": parsed["answer"], "points": [p for p in parsed.get("points", []) if isinstance(p, str)][:8],
            "next_step": parsed.get("next_step") if isinstance(parsed.get("next_step"), str) else None}
