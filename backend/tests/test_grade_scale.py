"""The backend and frontend grade scales must match the UQU regulation table."""

import re
from pathlib import Path

from common.grade_scale import GRADE_POINTS, NON_GPA_GRADES, POINTS_TO_GRADE

# ملحق لائحة الدراسة والاختبارات للمرحلة الجامعية — جامعة أم القرى
OFFICIAL = {
    "A+": 4.0, "A": 3.75, "B+": 3.5, "B": 3.0, "C+": 2.5,
    "C": 2.0, "D+": 1.5, "D": 1.0, "F": 0.0,
}

FRONTEND_SCALE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "grade-scale.ts"


def test_backend_scale_matches_regulation():
    assert GRADE_POINTS == OFFICIAL
    assert POINTS_TO_GRADE[3.75] == "A" and POINTS_TO_GRADE[0.0] == "F"
    assert NON_GPA_GRADES == {"W", "IP", "NP", "IC"}


def test_frontend_scale_matches_backend():
    if not FRONTEND_SCALE.exists():  # backend deployed on its own
        return
    src = FRONTEND_SCALE.read_text(encoding="utf-8")
    block = src[src.index("GRADE_POINTS"): src.index("};", src.index("GRADE_POINTS"))]
    pairs = dict(re.findall(r'"?([A-Z]{1,2}\+?)"?:\s*(null|[\d.]+)', block))
    front = {k: float(v) for k, v in pairs.items() if v != "null"}
    assert {k: v for k, v in front.items() if k != "DN"} == OFFICIAL
    assert front["DN"] == 0.0
    assert {k for k, v in pairs.items() if v == "null"} == NON_GPA_GRADES
