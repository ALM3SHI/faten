"""Program comparison for students choosing or reconsidering a major.

Evidence used, all shown to the student:
  • overlap — which of the program's published courses they already passed;
  • remaining time — the deterministic fastest plan under the same settings;
  • related performance — their grades in the course prefixes that make up
    most of the program (e.g. CS, MTH, AI), weighted by credit;
  • stated interests — plain keyword matches against official course names.
No employment or salary claims: labour-market data is a separate,
time-sensitive source that this engine does not have.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import Counter

from services.advisor import rules
from services.advisor.catalog import Catalog
from services.advisor.planner import PlanSettings, plan
from services.advisor.profile import StudentProfile, effective_gpa

TRANSFER_RULES = [
    {"text": ("التحويل لبرنامج آخر يتطلب تحقيق النسبة الموزونة للقبول في البرنامج المحوَّل إليه وفق معايير المستجدين، "
              "ويجوز تخفيضها ثلاث نسب كحد أقصى بشرط ألا يقل المعدل التراكمي عن «جيد جداً»."),
     "source": rules.STUDY_RULES_DOC},
    {"text": "المفاضلة بين المتقدمين للتحويل: 50% المعدل التراكمي و50% النسبة الموزونة.", "source": rules.STUDY_RULES_DOC},
    {"text": "التحويل بين تخصصات الكلية المشاركة في السنة التأهيلية يكون بعد اجتيازها وبحسب المعدل التراكمي.",
     "source": rules.STUDY_RULES_DOC},
]


def _prefix(code: str) -> str:
    m = re.match(r"[A-Z]+", code)
    return m.group(0) if m else code


def compare_programs(
    profile: StudentProfile,
    catalog: Catalog,
    program_ids: list[str] | None = None,
    interests: list[str] | None = None,
    max_load: int = rules.DEFAULT_MAX_REGULAR_LOAD,
    start_term: str | None = None,
    today: dt.date | None = None,
) -> dict:
    ids = program_ids or sorted(catalog.programs)
    interests = [w.strip().lower() for w in (interests or []) if w and w.strip()]
    passed = set(profile.passed)
    rows = []
    for pid in ids:
        cur = catalog.curriculum_for(pid)
        if cur is None:
            continue
        codes = {c.code for c in cur.courses}
        overlap = sorted(codes & passed)
        overlap_h = sum(cur.course(c).credits for c in overlap)
        weights = Counter()
        for c in cur.courses:
            weights[_prefix(c.code)] += c.credits
        top = [p for p, _ in weights.most_common(4)]
        perf_pts, perf_h, used = 0.0, 0, []
        for p in top:
            cp = profile.category_performance.get(p)
            if cp:
                perf_pts += cp["avg_points"] * cp["hours"]
                perf_h += cp["hours"]
                used.append(f"{p}: {cp['avg_points']:.2f} في {cp['hours']} ساعة")
        related = round(perf_pts / perf_h, 2) if perf_h else None
        interest_hits = []
        if interests:
            for c in cur.courses:
                course = catalog.courses.get(c.code)
                text = f"{course.name_ar} {course.name_en}".lower() if course else ""
                if any(w in text for w in interests):
                    interest_hits.append(c.code)
        fast = plan(profile, catalog, cur, PlanSettings(max_regular_load=max_load, start_term=start_term), "fastest", max_load, today)
        evidence, missing = [], []
        if overlap:
            evidence.append(f"اجتزت {len(overlap)} من مقرراته ({overlap_h} ساعة).")
        if related is not None:
            evidence.append(f"متوسط نقاطك في مجالاته الرئيسية {related:.2f} من 4 ({'، '.join(used)}).")
        else:
            missing.append("لا توجد درجات في مجالاته الرئيسية لتقدير ملاءمتها لك.")
        if interests:
            evidence.append(f"{len(interest_hits)} من مقرراته تطابق اهتماماتك المكتوبة." if interest_hits
                            else "لا تطابق مباشر بين أسماء مقرراته واهتماماتك المكتوبة.")
        else:
            missing.append("لم تذكر اهتماماتك؛ أضفها لتحسين المقارنة.")
        rows.append({
            "program_id": pid, "name": catalog.programs[pid].name_ar, "department": catalog.programs[pid].department_ar,
            "stated_total_hours": cur.stated_total_hours, "overlap_courses": overlap, "overlap_hours": overlap_h,
            "remaining_listed_hours": cur.listed_hours - overlap_h, "unlisted_hours": cur.unlisted_hours,
            "main_areas": top, "related_performance": related, "interest_matches": interest_hits,
            "fastest_terms": fast.terms_needed if fast.complete else None,
            "fastest_graduation": fast.graduation_label, "evidence": evidence, "missing": missing,
            "curriculum_verification": cur.verification, "source_url": cur.provenance.source_url,
        })
    rows.sort(key=lambda r: (-(r["related_performance"] or 0), -r["overlap_hours"], r["program_id"]))
    gpa = effective_gpa(profile)
    return {
        "programs": rows,
        "transfer_rules": TRANSFER_RULES,
        "gpa": gpa,
        "disclaimer": ("المقارنة مبنية على سجلك والخطط المنشورة فقط. لا يضمن أي تخصص وظيفة أو نجاحاً؛ "
                       "بيانات سوق العمل مصدر منفصل يتغير مع الوقت ولم تُدمج هنا. القبول والتحويل يحددهما القسم."),
        "coverage_note": f"الخطط المتاحة حالياً: {len(catalog.programs)} برامج من كلية الحاسبات. بقية برامج الجامعة لم تُضف بعد.",
    }
