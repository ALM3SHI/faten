"""Synthetic student records for the advisor tests (no real student data)."""

from __future__ import annotations

import datetime as dt

TODAY = dt.date(2026, 10, 14)  # first term 1448 in progress → next term is 1448-2
T1 = "الفصل الأول 1446/1447"
T2 = "الفصل الثاني 1446/1447"
T3 = "الفصل الأول 1447/1448"
T4 = "الفصل الثاني 1447/1448"


def course(code: str, credits: int, grade: str | None, semester: str, status: str = "completed") -> dict:
    return {"code": code, "creditHours": credits, "grade": grade, "semester": semester, "semesterStatus": status}


def record(completed: list[dict], current: list[dict] | None = None, gpa: float | None = None,
           earned: int | None = None, major: str | None = "علوم الحاسب الآلي") -> dict:
    return {"completedCourses": completed, "currentCourses": current or [], "gpa": gpa, "earnedHours": earned, "major": major}


# CS (uqu-478) levels 1–2, all strong grades.
CS_L1 = [("QR1101", 2), ("IND1101", 2), ("MTH1141", 3), ("ELIE1201", 4), ("CS1701", 3), ("CS1302", 3)]
CS_L2 = [("QR2102", 2), ("CUR1101", 0), ("CS1704", 3), ("MTH1602", 3), ("PHYS1113", 3), ("ELIE1202", 4), ("CS1303", 3)]
CS_L3 = [("QR2103", 2), ("AI2001", 2), ("SEC1101", 3), ("CS2105", 3), ("MTH1441", 3), ("BIO3101", 3), ("CEN2011", 3)]
CS_L4 = [("QR3104", 2), ("ICC1201", 2), ("SE1201", 3), ("DS2201", 3), ("CS2206", 3), ("CS2107", 3), ("CEN2012", 3)]


def high_performer() -> dict:
    rows = [course(c, h, "A+", T1) for c, h in CS_L1] + [course(c, h, "A", T2) for c, h in CS_L2]
    rows += [course(c, h, "A+", T3) for c, h in CS_L3]
    return record(rows, gpa=3.91, earned=sum(h for _, h in CS_L1 + CS_L2 + CS_L3))


def failed_prerequisites() -> dict:
    rows = [course("QR1101", 2, "B", T1), course("IND1101", 2, "B", T1), course("ELIE1201", 4, "C", T1),
            course("CS1701", 3, "F", T1), course("CS1302", 3, "F", T1), course("MTH1141", 3, "D", T1),
            course("CS1701", 3, "F", T2), course("ELIE1202", 4, "C+", T2), course("QR2102", 2, "B", T2)]
    return record(rows, gpa=1.62, earned=17)


def low_gpa_recovery() -> dict:
    good = [course(c, h, "C", T1) for c, h in CS_L1]
    bad = [course("CS1704", 3, "F", T2), course("MTH1602", 3, "D", T2), course("PHYS1113", 3, "F", T2),
           course("ELIE1202", 4, "D+", T2), course("CS1303", 3, "D", T2)]
    return record(good + bad, gpa=1.55, earned=27)


def near_graduation() -> dict:
    from services.advisor.catalog import load_catalog

    cur = load_catalog().curriculum_for("uqu-478")
    keep_out = {"CS4902", "CS4714"}
    rows = [course(c.code, c.credits, "B+", T3) for c in cur.courses if c.code not in keep_out]
    return record(rows, gpa=3.2, earned=sum(c.credits for c in cur.courses if c.code not in keep_out))


def python_track_student() -> dict:
    """Took the AI/CE-style Python & math courses — useful for comparing majors."""
    rows = [course("CS1011", 3, "A+", T1), course("MTH1141", 3, "A", T1), course("MTH1441", 3, "A", T1),
            course("MTH1602", 3, "A+", T1), course("ELIE1201", 4, "B", T1), course("IND1101", 2, "B+", T1),
            course("CS1012", 3, "A", T2), course("CS1302", 3, "B", T2), course("CEN2011", 3, "C", T2)]
    return record(rows, gpa=3.5, earned=27, major=None)
