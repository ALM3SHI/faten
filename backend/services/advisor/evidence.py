"""Cross-check official documents against the published study plans.

Input: knowledge/catalog/<uni>/documents.json (course specifications,
program handbooks, degree-catalog pages, regulations — each with URL,
SHA-256, version/date and the exact facts copied from it).

For every document this module decides *applicability* first, then:
  • agreement   → the plan entry gains the document id as evidence;
  • new detail  → added beside the plan data with its source
                  (a co-requisite, «Department Approval», an elective option);
  • conflict    → an Issue; the plan snapshot is left untouched.
A course-specification revision date is recorded as the document's date,
never as the curriculum's version.
"""

from __future__ import annotations

import json
from pathlib import Path

from services.advisor.catalog import (
    Catalog,
    Curriculum,
    Document,
    ElectiveOption,
    Issue,
    PrepYear,
    normalize_code,
)

SPECIAL_CONDITION_TEXT = {
    "department_approval": "يتطلب موافقة القسم (مذكورة ضمن متطلبات المقرر في توصيفه الرسمي)",
}


def load_documents(path: Path) -> list[Document]:
    data = json.loads(path.read_text(encoding="utf-8"))
    default_date = data.get("retrieved_at", "")
    return [Document.model_validate({"retrieved_at": default_date, **d}) for d in data.get("documents", [])]


def _current(cat: Catalog, program_id: str) -> Curriculum | None:
    return cat.curriculum_for(program_id)


def _note(cur: Curriculum, severity: str, code: str, message: str, subject: str | None = None) -> None:
    cur.issues.append(Issue(severity=severity, code=code, message=message, subject=subject))  # type: ignore[arg-type]


def apply_course_spec(cat: Catalog, doc: Document) -> None:
    f = doc.facts
    code = normalize_code(f.get("code"))
    for pid in doc.applies_to.get("program_ids", []):
        cur = _current(cat, pid)
        if cur is None:
            cat.issues.append(Issue(severity="warning", code="doc_unknown_program", subject=code,
                                    message=f"{doc.id} يخص برنامجاً غير موجود في الكتالوج: {pid}"))
            continue
        if doc.applicability == "not_applicable":
            continue
        cur.documents.append(doc.id)
        pc = cur.course(code)
        src = f"{doc.title} (الإصدار {doc.doc_version or '؟'}، {doc.doc_date_label or 'بدون تاريخ'})"
        if pc is None:
            if f.get("requirement") == "elective":
                cur.elective_options.append(ElectiveOption(
                    code=code, title=f.get("title", ""), credits=int(f.get("credits") or 0), level=f.get("level"),
                    prerequisites=[normalize_code(p) for p in f.get("prerequisites", []) if normalize_code(p)],
                    corequisites=[normalize_code(p) for p in f.get("corequisites", []) if normalize_code(p)],
                    source=doc.id, source_url=doc.url,
                ))
                missing = [p for p in f.get("prerequisites", []) + f.get("corequisites", []) if not cur.course(normalize_code(p))]
                _note(cur, "info", "elective_option_documented", subject=code,
                      message=f"{code} مقرر اختياري موثّق في {src}" + (f"؛ متطلبات خارج الخطة المنشورة: {missing}" if missing else "."))
            else:
                _note(cur, "warning", "spec_course_not_in_plan", subject=code,
                      message=f"توصيف {code} يصفه مقرراً إجبارياً في البرنامج لكنه غير موجود في الخطة المنشورة.")
            continue

        conflicts = []
        if f.get("credits") is not None and int(f["credits"]) != pc.credits:
            conflicts.append(f"الساعات: الخطة {pc.credits} والتوصيف {f['credits']}")
        if f.get("level") is not None and int(f["level"]) != pc.level:
            conflicts.append(f"المستوى: الخطة {pc.level} والتوصيف {f['level']}")
        spec_pre = sorted(normalize_code(p) for p in f.get("prerequisites", []) if normalize_code(p))
        if spec_pre != sorted(pc.prerequisites):
            if pc.prereq_source == "college_list":
                conflicts.append(f"المتطلبات: المعتمدة من قائمة الكلية {sorted(pc.prerequisites)} والتوصيف {spec_pre}"
                                 + (" (يطابق صفحة الخطة)" if spec_pre == sorted(pc.plan_page_prerequisites or []) else ""))
            else:
                conflicts.append(f"المتطلبات: الخطة {sorted(pc.prerequisites)} والتوصيف {spec_pre}")
        if f.get("requirement") == "elective":
            conflicts.append("الخطة تعرضه ضمن مقرراتها والتوصيف يصفه اختيارياً")
        if conflicts:
            pc.verification = "conflicting"
            _note(cur, "warning", "spec_conflict", subject=code,
                  message=f"{code}: تعارض بين بيانات الخطة المعتمدة و{src} — " + "؛ ".join(conflicts) + ". أُبقيت البيانات المعتمدة كما هي.")
        else:
            pc.evidence.append(doc.id)
            pc.prereq_list_corroborated = True
            _note(cur, "info", "spec_agrees", subject=code,
                  message=f"{code}: المستوى والساعات وقائمة المتطلبات تطابق {src}.")
        for co in f.get("corequisites", []):
            c = normalize_code(co)
            if c and c not in pc.corequisites:
                pc.corequisites.append(c)
                _note(cur, "info", "corequisite_from_spec", subject=code,
                      message=f"{code}: متطلب متزامن {c} مذكور في {src} ولا تعرضه صفحة الخطة.")
        for cond in f.get("special_conditions", []):
            pc.special_conditions.append({"kind": cond, "text": SPECIAL_CONDITION_TEXT.get(cond, cond), "source": doc.id,
                                          "source_url": doc.url})
            _note(cur, "info", "special_condition", subject=code,
                  message=f"{code}: {SPECIAL_CONDITION_TEXT.get(cond, cond)} — {src}.")


def apply_handbook(cat: Catalog, doc: Document) -> None:
    for pid in doc.applies_to.get("program_ids", []):
        cur = _current(cat, pid)
        if cur is None:
            continue
        cur.documents.append(doc.id)
        total = doc.facts.get("total_hours")
        if doc.applicability == "not_applicable":
            label = f"الخطة {doc.facts['plan_number']}" if doc.facts.get("plan_number") else (doc.doc_version or doc.title)
            cur.other_editions.append({"label": label, "total_hours": total, "document": doc.id, "url": doc.url,
                                       "codes": doc.facts.get("course_codes_extracted", [])})
            _note(cur, "info", "other_edition_documented",
                  message=(f"يوجد إصدار آخر موثّق للبرنامج: {doc.title} ({total} ساعة) يختلف عن الخطة المنشورة "
                           f"({cur.stated_total_hours} ساعة). الطالب الملتحق بذلك الإصدار قد لا تنطبق عليه هذه الخطة."))


def apply_degree_catalog(cat: Catalog, doc: Document) -> None:
    for row in doc.facts.get("programs", []):
        pid = row.get("program_id")
        cur = _current(cat, pid) if pid else None
        if cur is None:
            continue
        cur.documents.append(doc.id)
        if cur.stated_total_hours == row.get("hours"):
            _note(cur, "info", "total_hours_confirmed",
                  message=f"إجمالي ساعات البرنامج ({row['hours']}) يطابق صفحة القسم في دليل البرامج.")
        else:
            _note(cur, "warning", "total_hours_conflict",
                  message=f"إجمالي الساعات: الخطة {cur.stated_total_hours} وصفحة القسم {row.get('hours')}.")
    for prep in doc.facts.get("prep_years", []):
        cur = _current(cat, prep["program_id"])
        if cur is None:
            continue
        cur.documents.append(doc.id)
        levels = sorted(int(k) for k in prep["courses"])
        same = all(sorted(prep["courses"][str(lv)]) == sorted(c.code for c in cur.courses if c.level == lv) for lv in levels)
        hours = sum(c.credits for c in cur.courses if c.level in levels)
        matches = same and hours == prep["hours"]
        cur.prep_year = PrepYear(source_id=prep["source_id"], hours=prep["hours"], levels=levels, matches_plan=matches, source=doc.id)
        if matches:
            _note(cur, "info", "prep_year_matches",
                  message=(f"المستويات {levels} في الخطة هي نفسها برنامج السنة التأهيلية ({prep['source_id']}، {prep['hours']} ساعة) "
                           "مقرراً وساعات."))
        else:
            _note(cur, "warning", "prep_year_mismatch",
                  message=f"مقررات/ساعات السنة التأهيلية ({prep['source_id']}) لا تطابق المستويات {levels} من الخطة ({hours} ساعة).")


def apply_documents(cat: Catalog, path: Path) -> Catalog:
    for doc in load_documents(path):
        cat.documents[doc.id] = doc
        if doc.type == "course_spec":
            apply_course_spec(cat, doc)
        elif doc.type == "program_handbook":
            apply_handbook(cat, doc)
        elif doc.type == "degree_catalog":
            apply_degree_catalog(cat, doc)
    for cur in cat.curricula.values():
        cur.documents = sorted(set(cur.documents))
        if cur.elective_options:
            known = sum(o.credits for o in cur.elective_options)
            _note(cur, "info", "elective_options_partial",
                  message=(f"{len(cur.elective_options)} مقررات اختيارية موثّقة ({known} ساعة متاحة للاختيار) مقابل "
                           f"{cur.unlisted_hours} ساعة اختيارية مطلوبة؛ القائمة جزئية وليست القائمة الرسمية الكاملة."))
    return cat
