"""Build knowledge/instructors/uqu/profiles.json from the team's instructor files.

    python scripts/build_instructor_profiles.py "<folder with the instructor JSON files>"

Input: one JSON file per instructor ({professor_profile, reviews[]}) compiled by
the Faten team from public student reviews. Those raw files are NOT committed:
the decision (2026-10-15) is to never show comments or raw records to students.

Output keeps only:
  • aggregate numbers per instructor and per plan-course family
    (counts, averages on a 1–5 scale, badge shares, mode split);
  • the course-name → plan-code links, each with a confidence level;
  • the qualitative analysis in analysis.json (written after reading every
    review; no quotes).
A truncated file is read up to its last complete review and marked as partial.
"""

from __future__ import annotations

import hashlib
import json
import re
import statistics
import sys
from collections import Counter
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.advisor.catalog import load_catalog  # noqa: E402
from services.advisor.instructors import instructor_key, normalize_instructor  # noqa: E402

OUT_DIR = BACKEND / "knowledge" / "instructors" / "uqu"
CAPTURED = date(2026, 10, 15)  # when the team compiled the files; review ages are relative to it

# ── normalisation ─────────────────────────────────────────────────

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def norm(s: str) -> str:
    s = (s or "").translate(_DIGITS).lower()
    s = re.sub(r"[ً-ْـ]", "", s)  # harakat + tatweel
    s = re.sub(r"[أإآ]", "ا", s).replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s).strip()


def mode_of(label: str | None) -> str:
    n = norm(label or "")
    if "تدريب" in n:
        return "summer_training"
    practical, theory = "عملي" in n, "نظري" in n
    if practical and theory:
        return "both"
    return "practical" if practical else "theory" if theory else "unspecified"


# ── course families: student wording → plan codes ─────────────────
# Each family lists the equivalent course in every program that has it.
# "likely": the wording names the course; "ambiguous": it could be two courses
# (e.g. «برمجة 1» is Java in some plans and Python in others).
# Order matters: specific patterns first.

FAMILIES: list[tuple[str, str, list[str], str]] = [
    (r"تدريب", "التدريب الصيفي", [], "no_plan_course"),
    (r"مقيده", "تحسين البرمجة المقيدة", [], "no_plan_course"),
    (r"بناء نظم برمجيات", "نظم بناء البرمجيات", ["CS3809", "SE3302"], "likely"),
    (r"واجهه (ال)?(عتاد|عناد)", "واجهة العتاد والبرمجيات", [], "no_plan_course"),
    (r"(تنظيم الحاسوب.*منطق|منطق.*تنظيم)", "المنطق الرقمي وتنظيم الحاسوب", ["CEN1012", "CEN1011"], "likely"),
    (r"(تنظيم.*عمار|computer architecture|\bcoa\b)", "تنظيم وعمارة الحاسب", ["CEN2012"], "likely"),
    (r"عمار\w* (ال)?حاسب (ال)?متقدم", "عمارة الحاسب المتقدمة", [], "no_plan_course"),
    (r"عمار", "عمارة الحاسب", ["CEN2012", "CEN2202"], "likely"),
    (r"تنسيق", "تنسيق وتصميم الحاسب", ["CEN1201"], "likely"),
    (r"منطق رقمي|المنطق الرقمي", "المنطق الرقمي وتنظيم الحاسوب", ["CEN1012", "CEN1011"], "likely"),
    (r"تصميم (ال)?رقمي|تصميم منطقي|التصميم الرقمي", "التصميم الرقمي المنطقي", ["CEN2011", "CEN0301"], "likely"),
    (r"شبكات.*(امن|سيبر)", "شبكات الحاسب (الأمن السيبراني)", ["CEN1013"], "likely"),
    (r"هندسه (ال)?شبكات", "هندسة الشبكات", ["CEN3504"], "likely"),
    (r"اساسيات (ال)?شبكات", "أساسيات الشبكات وتطبيقاتها", ["CEN1501"], "likely"),
    (r"شبك|خاسب", "شبكات الحاسب", ["CEN3011", "CEN1013", "CEN1501"], "ambiguous"),
    (r"تشفير|اشفير", "التشفير التطبيقي", ["SEC1202"], "likely"),
    (r"اداره|امن.*قواعد", "إدارة وأمن قواعد البيانات", ["SEC2203"], "likely"),
    (r"قواعد (ال)?بيانات (اثنين|2)", "قواعد البيانات المتقدمة", ["CS4411"], "likely"),
    (r"قواعد|database", "مقدمة في قواعد البيانات", ["DS2201"], "likely"),
    (r"هياكل (ال)?متقطع\w*\s*(2|ii)\b|هياكل 2", "هياكل متقطعة 2", ["CS1303"], "likely"),
    (r"هياكل (ال)?متقطع", "هياكل متقطعة 1", ["CS1302", "DS1901", "SEC1201"], "likely"),
    (r"هياكل حسابي\w*\s*\(?2", "الهياكل الحسابية 2", ["SE3402"], "likely"),
    (r"هياكل حسابي", "الهياكل الحسابية 1", ["MTH1402"], "likely"),
    (r"هياكل (ال)?بيانات (و ?خوارزميات )?جافا", "هياكل البيانات (جافا)", ["CS2105"], "likely"),
    (r"هياكل (ال)?بيانات|data structures|اساسيات هياكل", "هياكل البيانات", ["CS2105", "CS2015", "CS2014", "DS2206"], "ambiguous"),
    (r"خوار|خورز|خوازم", "تصميم وتحليل الخوارزميات", ["CS2107", "CS3019"], "likely"),
    (r"c\+\+|\+\+c", "البرمجة الشيئية C++", ["CS1013"], "likely"),
    (r"(شيئي|كائني|oop|برمج\D*2|برمجه الحاسب (الالي )?2|برمجه حاسب 2|جافا ?2|java ?2)", "البرمجة الشيئية",
     ["CS1704", "CS1012", "CS1013", "SE1101"], "ambiguous"),
    (r"متقدمه للمهندسين|برمجه متقدمه", "برمجة متقدمة للمهندسين", [], "no_plan_course"),
    (r"بايثون|python", "برمجة الحاسب بلغة بايثون", ["CS1011"], "likely"),
    (r"(برمج.*جافا|java)", "برمجة الحاسب بلغة جافا", ["CS1701"], "likely"),
    (r"برمج", "برمجة الحاسب 1", ["CS1701", "CS1011"], "ambiguous"),
    (r"نظم (ال)?تشغيل|^os\b|نظك تشغيل|اسس نظم", "نظم التشغيل", ["CS3608", "CS2016", "CEN1014"], "likely"),
    (r"تطوير (ال)?ويب|تطوير ويب", "تطوير الويب", ["CS3810", "SEC3205"], "likely"),
    (r"جمع و? ?تهيئه", "جمع ومعالجة البيانات", ["DS2301"], "likely"),
    (r"مبادئ و ?تقنيات", "مبادئ وتقنيات الذكاء الاصطناعي", ["AI3101"], "likely"),
    (r"مبادئ الذكاء", "مبادئ الذكاء الاصطناعي", ["AI4101"], "likely"),
    (r"مقدمه في الذكاء", "مقدمة في الذكاء الاصطناعي", ["AI2001"], "likely"),
    (r"اخلاقيات (ال)?ذكاء", "أخلاقيات الذكاء الاصطناعي", ["AI3103"], "likely"),
    (r"ذكاء (اص|ص)طناعي|الذكاء الاصطناعي|ذكاء صناعي", "الذكاء الاصطناعي", ["AI3101", "AI4101"], "ambiguous"),
    (r"تعلم الاله 2", "تعلم الآلة 2", [], "no_plan_course"),
    (r"تعلم الاله|machine learning", "تعلم الآلة", ["AI4202", "AI3201", "DS2401"], "likely"),
    (r"رسومات|graphics", "الرسومات بالحاسب", ["CS2206"], "likely"),
    (r"مترجمات", "تركيب المترجمات", ["CS4714"], "likely"),
    (r"طرق النمذجه", "طرق النمذجة", ["HCI3301"], "likely"),
]


def family_of(label: str | None):
    if not label:
        return None
    n = norm(label)
    for pattern, title, codes, conf in FAMILIES:
        if re.search(pattern, n):
            return {"id": title, "title": title, "codes": codes, "confidence": conf}
    return None


# ── review age ────────────────────────────────────────────────────

def months_ago(text: str | None) -> float | None:
    t = norm(text or "")
    if not t:
        return None
    m = re.search(r"(\d+)\s*(يوم|ايام)", t)
    if m:
        return int(m.group(1)) / 30
    if "يوم" in t:
        return 0.5
    m = re.search(r"(\d+)\s*(شهر|اشهر)", t)
    if m:
        return float(m.group(1))
    if "شهرين" in t:
        return 2
    if "شهر" in t:
        return 1
    more = 6 if "اكثر من" in t else 0
    m = re.search(r"(\d+)\s*سنو", t)
    if m:
        return int(m.group(1)) * 12 + more
    if "سنتين" in t:
        return 24 + more
    if "سنه" in t:
        return 12 + more
    return None


# ── loading (truncated files keep complete reviews only) ──────────

def load(path: Path) -> tuple[dict, bool]:
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text), True
    except json.JSONDecodeError:
        pass
    dec = json.JSONDecoder()
    i = text.index("{", text.index('"professor_profile"'))
    profile, end = dec.raw_decode(text, i)
    j = text.index("[", text.index('"reviews"', end)) + 1
    reviews = []
    while True:
        j = re.compile(r"\s*,?\s*").match(text, j).end()
        if j >= len(text) or text[j] != "{":
            break
        try:
            obj, j = dec.raw_decode(text, j)
        except json.JSONDecodeError:
            break
        reviews.append(obj)
    return {"professor_profile": profile, "reviews": reviews}, False


def score(r: dict) -> float | None:
    rt = r.get("ratings") or {}
    vals = [rt.get(k) for k in ("explanation", "treatment", "helpfulness") if isinstance(rt.get(k), (int, float))]
    return round(statistics.fmean(vals) / 20, 2) if vals else None  # 0–100 → 0–5


def five(v):
    return round(v / 20, 2) if isinstance(v, (int, float)) else None


def summarize(rows: list[dict]) -> dict:
    scores = [s for s in (score(r) for r in rows) if s is not None]
    ages = [a for a in (months_ago(r.get("date")) for r in rows) if a is not None]
    return {
        "reviews": len(rows),
        "average": round(statistics.fmean(scores), 2) if scores else None,
        "positive_share": round(sum(s >= 4 for s in scores) / len(scores), 2) if scores else None,
        "recent_reviews": sum(a <= 24 for a in ages),
    }


def build(src: Path) -> dict:
    catalog = load_catalog("uqu")
    in_program = {code: sorted(pid for pid, p in catalog.programs.items()
                               if catalog.curriculum_for(pid).course(code)) for code in catalog.courses}
    analysis = json.loads((OUT_DIR / "analysis.json").read_text(encoding="utf-8"))
    files = sorted(src.glob("*.json"))
    out = []
    unmatched_labels: Counter = Counter()
    for path in files:
        data, complete = load(path)
        prof = data["professor_profile"]
        reviews = data.get("reviews") or []
        name = normalize_instructor(prof.get("name", ""))
        notes = analysis["instructors"].get(path.stem)
        if notes is None:
            raise SystemExit(f"no analysis for {path.stem}")

        families: dict[str, dict] = {}
        modes: dict[str, list] = {}
        unspecified = 0
        for r in reviews:
            fam = family_of(r.get("course"))
            modes.setdefault(mode_of(r.get("course")), []).append(r)
            if fam is None:
                if r.get("course"):
                    unmatched_labels[norm(r["course"])] += 1
                else:
                    unspecified += 1
                fam = {"id": "_other", "title": "مقررات أخرى أو غير محددة", "codes": [], "confidence": "none"}
            f = families.setdefault(fam["id"], {**fam, "rows": []})
            f["rows"].append(r)

        courses = []
        for f in families.values():
            if f["id"] == "_other":
                continue
            links = [{"code": c, "name": catalog.course_name(c), "programs": in_program.get(c, [])}
                     for c in f["codes"] if c in catalog.courses]
            courses.append({"family": f["title"], "confidence": f["confidence"] if links else "no_plan_course",
                            "links": links, **summarize(f["rows"])})
        courses.sort(key=lambda c: -c["reviews"])
        other = families.get("_other", {}).get("rows", [])

        badges = Counter(b for r in reviews for b in r.get("badges") or [])
        n = len(reviews)
        out.append({
            "id": instructor_key(name),
            "name": name,
            "department": prof.get("department"),
            "data": {
                "reviews_stated": prof.get("total_reviews"), "reviews_analyzed": n, "complete": complete,
                "file_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            },
            "stats": {
                **summarize(reviews),
                "site_metrics": {k: five(v) for k, v in (prof.get("metrics") or {}).items()},
                "site_overall": five(prof.get("overall_rating")),
                "badges": [{"label": b, "share": round(c / n, 2)} for b, c in badges.most_common(8)] if n else [],
                "modes": {m: summarize(rows) for m, rows in modes.items()},
                "unmatched_reviews": len(other) - unspecified, "unspecified_course_reviews": unspecified,
            },
            "courses": courses,
            "analysis": notes,
        })
    out.sort(key=lambda p: p["name"])
    return {
        "schema_version": 1,
        "university": "uqu",
        "built_at": CAPTURED.isoformat(),
        "source": {
            "kind": "team_compiled_student_reviews",
            "description": "تقييمات طلاب عامة جمعها فريق فطن (2026-10-15). لا تُعرض نصوصها؛ المعروض أرقام مجمّعة وتحليل كتبه فطن.",
            "files": len(files),
        },
        "verdict_labels": analysis["verdicts"],
        "method": {
            "scale": "متوسط الشرح والتعامل والمساعدة محولاً إلى 1–5",
            "recent_window_months": 24,
            "course_links": "اسم المقرر كما كتبه الطالب مطابقاً لعائلة مقرر في الخطط؛ likely = الاسم يدل على المقرر، ambiguous = يحتمل مقررين",
        },
        "caveats": [
            "تقييمات اختيارية يكتبها من أراد؛ لا تمثل كل من درس عند المحاضر.",
            "الدرجة الواحدة لا تتنبأ بدرجتك، وتجربة المحاضر قد تتغير من فصل لآخر.",
            "ربط اسم المقرر برمز الخطة استنتاج من صياغة الطالب، وقد يكون المقرر من خطة أقدم.",
        ],
        "unmatched_course_labels": sum(unmatched_labels.values()),
        "instructors": out,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    result = build(Path(argv[1]))
    path = OUT_DIR / "profiles.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for p in result["instructors"]:
        print(f"{p['name']}: {p['data']['reviews_analyzed']}/{p['data']['reviews_stated']} reviews, "
              f"{len(p['courses'])} course families, other={p['stats']['unmatched_reviews']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
