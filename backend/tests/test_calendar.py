import datetime as dt

from data import uqu_calendar as cal


def test_events_are_well_formed():
    events = [e for t in cal.UQU_CALENDAR for e in t["events"]]
    assert len(events) >= 20
    for e in events:
        start = dt.date.fromisoformat(e["start"])
        if e["end"]:
            assert dt.date.fromisoformat(e["end"]) >= start, e["title"]
        assert e["type"] in {"academic", "exam", "holiday", "system"}
        assert e["hijri"]


def test_term_boundaries_are_ordered():
    assert cal.TERM1_START < cal.TERM1_END < cal.TERM2_START < cal.TERM2_END


def test_finals_fall_inside_their_term():
    t1, t2 = cal.UQU_CALENDAR
    finals1 = next(e for e in t1["events"] if e["title"] == "الاختبارات النهائية")
    finals2 = next(e for e in t2["events"] if e["title"] == "الاختبارات النهائية")
    assert cal.TERM1_START <= dt.date.fromisoformat(finals1["start"]) <= cal.TERM1_END
    assert cal.TERM2_START <= dt.date.fromisoformat(finals2["start"]) <= cal.TERM2_END
