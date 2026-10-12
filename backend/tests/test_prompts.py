"""System-prompt building must survive incomplete transcripts (regression)."""

import pytest

from agent.prompts import build_system_prompt

TRANSCRIPT = {
    "semesters": [
        {"name": "الأول 1446", "gpa": 3.1},
        {"name": "الثاني 1446", "gpa": 3.4},
        {"name": "الأول 1448", "gpa": None},  # semester in progress
    ],
    "courses": [
        {"code": "CS1301", "nameAr": "برمجة 1", "grade": "A", "gradePoints": 3.75},
        {"code": "CS4510", "nameAr": "تعلم الآلة", "grade": None, "gradePoints": None},  # in progress
        {"code": None, "nameAr": "مقرر بلا رمز", "grade": "B", "gradePoints": 3.0},
    ],
}
RECORD = {"completedCourses": TRANSCRIPT["courses"], "currentCourses": [], "gpa": 3.2}


@pytest.mark.parametrize("intent", ["FULL_ACADEMIC_ANALYSIS", "GPA_QUERY", "SEMESTER_QUERY", "GPA_IMPROVEMENT", "UNKNOWN"])
def test_prompt_handles_missing_grades_and_gpas(intent):
    p = build_system_prompt(
        None, TRANSCRIPT, [], None,
        academic_record=RECORD,
        required_blocks=["all"],
        intent=intent,
    )
    assert isinstance(p, str) and len(p) > 100
    assert "None" not in p
