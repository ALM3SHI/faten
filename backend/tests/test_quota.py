import pytest
from fastapi import HTTPException

from services import quota


def test_spending_and_blocking(fake_db, settings):
    settings.DAILY_AI_CREDITS = 10
    assert quota.consume_ai_credits("u1", 1) == 9
    assert quota.consume_ai_credits("u1", 5) == 4
    with pytest.raises(quota.QuotaExceeded):
        quota.consume_ai_credits("u1", 5)
    # a blocked request does not consume anything
    assert fake_db.store[("ai_usage", "u1")]["used"] == 6
    assert quota.consume_ai_credits("u1", 4) == 0


def test_require_credits_returns_429_in_arabic(fake_db, settings):
    settings.DAILY_AI_CREDITS = 1
    quota.require_ai_credits("u1", 1)
    with pytest.raises(HTTPException) as e:
        quota.require_ai_credits("u1", 1)
    assert e.value.status_code == 429 and "للحد اليومي" in e.value.detail


def test_users_are_isolated_and_days_reset(fake_db, settings):
    settings.DAILY_AI_CREDITS = 2
    quota.consume_ai_credits("u1", 2)
    assert quota.consume_ai_credits("u2", 1) == 1
    fake_db.store[("ai_usage", "u1")]["date"] = "2000-01-01"  # yesterday's counter
    assert quota.consume_ai_credits("u1", 1) == 1


def test_zero_limit_disables_quota(fake_db, settings):
    settings.DAILY_AI_CREDITS = 0
    assert quota.consume_ai_credits("u1", 999) == -1
