"""Apply the Faten team's compiled college course lists to the captured plans.

Input: knowledge/catalog/<uni>/college-of-computing/manifest.json plus one
JSON file per program ({"major": {"levels": [{"level", "courses": [{code,
credits, prerequisites}]}]}}), compiled by the team from the university site.

Decision (manifest «decision»): where a list and the plan page disagree on a
course's prerequisites, the list is adopted. Nothing is lost: the plan page's
list stays on the course (`plan_page_prerequisites`) and every difference is
an Issue the advisor shows. Levels and credits are never changed here — a
difference there is only reported.

A file whose SHA-256 differs from the manifest is not applied, so an edited
list must be re-recorded on purpose rather than slipping in silently.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from services.advisor.catalog import Catalog, Curriculum, Issue, normalize_code

SURFACED_CODES = ("college_list_applied",)


def _note(cur: Curriculum, severity: str, code: str, message: str, subject: str | None = None) -> None:
    cur.issues.append(Issue(severity=severity, code=code, message=message, subject=subject))  # type: ignore[arg-type]


def _cycle(graph: dict[str, list[str]]) -> list[str] | None:
    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(u: str) -> list[str] | None:
        state[u] = 1
        stack.append(u)
        for v in graph.get(u, []):
            if state.get(v) == 1:
                return stack[stack.index(v):] + [v]
            if v in graph and not state.get(v):
                found = visit(v)
                if found:
                    return found
        stack.pop()
        state[u] = 2
        return None

    for node in sorted(graph):
        if not state.get(node):
            found = visit(node)
            if found:
                return found
    return None


def apply_college_lists(cat: Catalog, folder: Path) -> Catalog:
    manifest_path = folder / "manifest.json"
    if not manifest_path.is_file():
        return cat
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    aliases = {normalize_code(k): normalize_code(v["code"]) for k, v in manifest.get("code_aliases", {}).items()}

    def code_of(raw: str) -> str:
        c = normalize_code(raw)
        return aliases.get(c, c)

    for rej in manifest.get("rejected", []):
        cat.issues.append(Issue(severity="info", code="college_list_rejected", subject=rej.get("program_id"),
                                message=f"قائمة «{rej.get('original_name')}» لم تُعتمد: {rej.get('reason')}"))

    for entry in manifest.get("files", []):
        path = folder / entry["file"]
        pid = entry["program_id"]
        if not path.is_file():
            cat.issues.append(Issue(severity="error", code="college_list_missing", subject=pid,
                                    message=f"{entry['file']} مذكور في البيان وغير موجود."))
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry.get("sha256"):
            cat.issues.append(Issue(severity="error", code="college_list_hash_mismatch", subject=pid,
                                    message=f"{entry['file']} تغيّر بعد تسجيله (SHA-256 لا يطابق البيان)؛ لم يُطبَّق."))
            continue
        cur = cat.curriculum_for(pid)
        if cur is None:
            cat.issues.append(Issue(severity="warning", code="college_list_unknown_program", subject=pid,
                                    message=f"{entry['file']} يخص برنامجاً غير موجود في الكتالوج: {pid}"))
            continue

        major = json.loads(path.read_text(encoding="utf-8"))["major"]
        listed: dict[str, tuple[int, int, list[str]]] = {}
        for lv in major.get("levels", []):
            for c in lv.get("courses", []):
                code = code_of(c.get("code"))
                if not code:
                    _note(cur, "warning", "college_list_bad_code", f"رمز غير صالح في قائمة الكلية: {c.get('code')!r}")
                    continue
                pre = sorted({p for p in (code_of(x) for x in c.get("prerequisites", [])) if p})
                listed[code] = (int(lv.get("level")), int(c.get("credits") or 0), pre)

        changed: list[str] = []
        for code, (level, credits, pre) in sorted(listed.items()):
            pc = cur.course(code)
            if pc is None:
                _note(cur, "warning", "college_list_course_not_in_plan", subject=code,
                      message=f"{code} في قائمة الكلية وغير موجود في صفحة الخطة؛ لم يُضف.")
                continue
            if level != pc.level or credits != pc.credits:
                _note(cur, "warning", "college_list_level_or_hours_differ", subject=code,
                      message=(f"{code}: قائمة الكلية (المستوى {level}، {credits} ساعات) وصفحة الخطة "
                               f"(المستوى {pc.level}، {pc.credits} ساعات)؛ أُبقيت بيانات الصفحة."))
            if pre != sorted(pc.prerequisites):
                pc.plan_page_prerequisites = list(pc.prerequisites)
                pc.prerequisites = pre
                pc.prereq_source = "college_list"
                changed.append(code)
                _note(cur, "info", "prereq_from_college_list", subject=code,
                      message=(f"{code}: المتطلبات المعتمدة {pre or 'لا شيء'} من قائمة الكلية؛ "
                               f"صفحة الخطة تذكر {pc.plan_page_prerequisites or 'لا شيء'}."))
            for p in pre:
                if not cur.course(p):
                    _note(cur, "warning", "prereq_outside_plan", subject=code,
                          message=f"{code} يتطلب {p} (حسب قائمة الكلية) وهو غير موجود في هذه الخطة.")

        for pc in cur.courses:
            if pc.code not in listed:
                _note(cur, "warning", "college_list_missing_course", subject=pc.code,
                      message=f"{pc.code} في صفحة الخطة وغير موجود في قائمة الكلية؛ بقيت متطلبات الصفحة.")

        # Ingest-time notes about the page's prerequisites no longer describe the adopted ones.
        cur.issues = [i for i in cur.issues
                      if not (i.code in ("prereq_outside_plan", "prereq_level_order", "prereq_count_mismatch")
                              and i.subject in changed and "قائمة الكلية" not in i.message)]
        cycle = _cycle({c.code: c.prerequisites for c in cur.courses})
        if cycle:
            _note(cur, "error", "prereq_cycle", " ← ".join(cycle) + " (بعد اعتماد قائمة الكلية)")
            cur.verification = "conflicting"

        cur.college_list = {"id": manifest.get("id"), "title": manifest.get("title"), "file": entry["file"],
                            "original_name": entry.get("original_name"), "sha256": digest,
                            "compiled_at": manifest.get("compiled_at"), "compiled_by": manifest.get("compiled_by")}
        _note(cur, "warning" if changed else "info", "college_list_applied",
              message=(f"المتطلبات السابقة لـ {len(changed)} مقرر مأخوذة من قائمة الكلية التي جمعها فريق فطن "
                       f"({manifest.get('compiled_at')}) لأنها تختلف عن صفحة الخطة في موقع الجامعة. "
                       "عند الشك راجع مرشدك أو نظام التسجيل.") if changed else
                      "قائمة الكلية التي جمعها فريق فطن تطابق متطلبات صفحة الخطة.")
    return cat
