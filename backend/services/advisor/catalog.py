"""Catalog model + loader.

The catalog is plain JSON under knowledge/catalog/<university>/catalog.json,
produced by `python -m services.advisor.ingest_uqu` from captured raw pages.
Shared course definitions live once in `courses`; everything that can
differ between programs (level, credits as listed, prerequisites) lives on
the curriculum entry, because the official site shows the same course with
different prerequisites in different programs (e.g. DS2201).
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, PrivateAttr

CATALOG_ROOT = Path(__file__).resolve().parents[2] / "knowledge" / "catalog"

#: How much we trust a piece of data.
#:   verified     — read from an official page, passed every check
#:   inferred     — derived by us (e.g. AND-relation between listed prerequisites)
#:   incomplete   — official, but known to be missing parts (e.g. unlisted electives)
#:   conflicting  — official sources disagree; needs human review
#:   unavailable  — no official source found
Verification = Literal["verified", "inferred", "incomplete", "conflicting", "unavailable"]

_CODE_RE = re.compile(r"^[A-Z]{2,5}\d{3,5}[A-Z]?$")


def normalize_code(code: str | None) -> str:
    """'cs 1701' / 'CS-1701' → 'CS1701'. Returns '' for anything unusable."""
    c = re.sub(r"[\s\-_]", "", str(code or "").upper())
    return c if _CODE_RE.match(c) else ""


class Provenance(BaseModel):
    source_url: str
    retrieved_at: str
    method: str = "browser capture of public page"
    raw_file: str | None = None
    raw_sha256: str | None = None


class Issue(BaseModel):
    severity: Literal["info", "warning", "error"]
    code: str  # machine-readable kind, e.g. "prereq_card_hours_mismatch"
    message: str
    subject: str | None = None  # course code / program id it concerns


class Course(BaseModel):
    """University-wide course definition (shared across programs)."""

    code: str
    name_ar: str = ""
    name_en: str = ""
    credits: int | None = None  # None when programs list different credits
    seen_in: list[str] = Field(default_factory=list)


class PlanCourse(BaseModel):
    """A course as it appears in one curriculum."""

    code: str
    level: int
    credits: int
    prerequisites: list[str] = Field(default_factory=list)
    prereq_relation: Literal["all_of"] = "all_of"
    prereq_relation_status: Verification = "inferred"
    corequisites: list[str] = Field(default_factory=list)
    kind: Literal["required", "coop"] = "required"
    source_url: str = ""
    verification: Verification = "verified"
    # Evidence from official documents other than the plan page (course specifications).
    # The plan page stays the base; a document can corroborate it, add a condition the
    # page does not show, or disagree with it — never silently replace it.
    evidence: list[str] = Field(default_factory=list)  # document ids that agree with this entry
    special_conditions: list[dict] = Field(default_factory=list)  # [{kind, text, source}]
    prereq_list_corroborated: bool = False  # the same prerequisite list appears in a course specification
    # Where `prerequisites` came from. "college_list" = the Faten team's compiled
    # college list was adopted over the plan page (a recorded decision); the plan
    # page's own list is then kept in `plan_page_prerequisites` and shown as a note.
    prereq_source: Literal["plan_page", "college_list"] = "plan_page"
    plan_page_prerequisites: list[str] | None = None


class ElectiveOption(BaseModel):
    """A course an official document names as an elective of this program.

    Known options are a partial list unless a document says otherwise; the
    unnamed elective hours stay unnamed requirements."""

    code: str
    title: str
    credits: int
    level: int | None
    prerequisites: list[str] = Field(default_factory=list)
    corequisites: list[str] = Field(default_factory=list)
    source: str  # document id
    source_url: str


class PrepYear(BaseModel):
    source_id: str
    hours: int
    levels: list[int]
    matches_plan: bool
    source: str


class Document(BaseModel):
    id: str
    type: Literal["regulation", "degree_catalog", "course_spec", "program_handbook"]
    title: str
    url: str
    sha256: str | None = None
    bytes: int | None = None
    doc_version: str | None = None
    doc_date: str | None = None
    doc_date_label: str | None = None
    approval: str | None = None
    retrieved_at: str
    applicability: Literal["applicable", "not_applicable", "partial"]
    applicability_reason: str | None = None
    applies_to: dict = Field(default_factory=dict)
    facts: dict = Field(default_factory=dict)


class Curriculum(BaseModel):
    id: str
    program_id: str
    version_label: str
    provenance: Provenance
    stated_total_hours: int | None
    listed_hours: int
    unlisted_hours: int  # stated − listed: electives whose list is not published
    levels: int
    courses: list[PlanCourse]
    verification: Verification
    issues: list[Issue] = Field(default_factory=list)
    elective_options: list[ElectiveOption] = Field(default_factory=list)
    elective_options_complete: bool = False
    prep_year: PrepYear | None = None
    other_editions: list[dict] = Field(default_factory=list)  # [{label, total_hours, document}]
    documents: list[str] = Field(default_factory=list)
    # {id, title, file, sha256, compiled_at} of the college list applied to this plan, if any.
    college_list: dict | None = None
    _idx: dict[str, PlanCourse] | None = PrivateAttr(default=None)

    def course(self, code: str) -> PlanCourse | None:
        if self._idx is None:
            self._idx = {c.code: c for c in self.courses}
        return self._idx.get(code)


class Program(BaseModel):
    id: str
    university: str
    source_id: str
    name_ar: str
    degree_type: str
    college_ar: str
    department_ar: str
    curricula: list[str]


class University(BaseModel):
    id: str
    name_ar: str
    name_en: str
    website: str


class Catalog(BaseModel):
    schema_version: int = 2
    generated_at: str
    university: University
    courses: dict[str, Course]
    programs: dict[str, Program]
    curricula: dict[str, Curriculum]
    issues: list[Issue] = Field(default_factory=list)
    documents: dict[str, Document] = Field(default_factory=dict)

    def curriculum_for(self, program_id: str, curriculum_id: str | None = None) -> Curriculum | None:
        prog = self.programs.get(program_id)
        if not prog:
            return None
        cid = curriculum_id or (prog.curricula[-1] if prog.curricula else None)
        if cid not in prog.curricula:
            return None
        return self.curricula.get(cid)

    def course_name(self, code: str) -> str:
        c = self.courses.get(code)
        return (c.name_ar or c.name_en) if c else code


@lru_cache(maxsize=8)
def load_catalog(university: str = "uqu") -> Catalog:
    path = CATALOG_ROOT / university / "catalog.json"
    return Catalog.model_validate(json.loads(path.read_text(encoding="utf-8")))


def available_universities() -> list[str]:
    return sorted(p.name for p in CATALOG_ROOT.iterdir() if (p / "catalog.json").is_file())
