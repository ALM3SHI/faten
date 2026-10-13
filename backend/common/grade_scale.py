"""Official UQU 4.00 grade-point scale — the backend's single copy.

Mirrors frontend/src/lib/grade-scale.ts; tests/test_grade_scale.py pins
both to the regulation table. UQU has no minus grades and no 5.0 scale.

    A+ = 4.00   B+ = 3.50   C+ = 2.50   D+ = 1.50   F  = 0.00
    A  = 3.75   B  = 3.00   C  = 2.00   D  = 1.00   DN = 0.00 (محروم)
"""

#: Letter → points for the nine regular letter grades.
GRADE_POINTS: dict[str, float] = {
    "A+": 4.00, "A": 3.75,
    "B+": 3.50, "B": 3.00,
    "C+": 2.50, "C": 2.00,
    "D+": 1.50, "D": 1.00,
    "F": 0.00,
}

#: Points → letter (inverse of GRADE_POINTS).
POINTS_TO_GRADE: dict[float, str] = {v: k for k, v in GRADE_POINTS.items()}

#: Grades that never count toward the GPA.
NON_GPA_GRADES: frozenset[str] = frozenset({"W", "IP", "NP", "IC"})
