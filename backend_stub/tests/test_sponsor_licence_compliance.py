"""Tests for UK Sponsor Licence mandatory safeguards."""

from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "sponsor_licence_compliance.py"
spec = importlib.util.spec_from_file_location("sponsor_licence_compliance", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules["sponsor_licence_compliance"] = module
assert spec.loader is not None
spec.loader.exec_module(module)


def test_sms_reportable_fields_are_fixed() -> None:
    assert module.SMS_REPORTABLE_FIELDS == {"job_title", "salary", "work_location"}


def test_absence_alert_day_defaults_to_nine() -> None:
    assert module.SPONSOR_ABSENCE_ALERT_DAY == 9


def test_rtw_checklist_url_is_gov_uk() -> None:
    assert module.UK_RTW_CHECKLIST_URL.startswith("https://www.gov.uk/")


def test_sha256_helper_is_stable() -> None:
    digest = module._sha256_bytes(b"%PDF-1.4 test")
    assert len(digest) == 64


def test_rtw_check_status_buckets() -> None:
    today = date(2026, 6, 11)
    assert module.rtw_check_status(outcome="pass", expiry_date=None, as_of=today) == "verified"
    assert (
        module.rtw_check_status(outcome="time_limited", expiry_date=today.replace(day=30), as_of=today)
        == "expiring_soon"
    )
    assert (
        module.rtw_check_status(outcome="pass", expiry_date=today.replace(day=1), as_of=today) == "needs_review"
    )
    assert module.rtw_check_status(outcome="fail", expiry_date=None, as_of=today) == "needs_review"


def test_rtw_document_number_is_masked() -> None:
    masked = module.rtw_document_number_masked("abc1234567890deadbeef")
    assert masked.startswith("••••••••")
    assert masked.endswith("beef")


class _FakeCursor:
    def __init__(self) -> None:
        self.commands: list[tuple] = []

    def execute(self, sql, params=None):
        self.commands.append((sql.strip(), params))
        self.rowcount = 1
        return self

    def fetchone(self):
        return (101,)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeConn:
    def __init__(self) -> None:
        self.cursor_obj = _FakeCursor()

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        return None


def test_log_sms_reportable_change_inserts_when_value_changes() -> None:
    conn = _FakeConn()
    result = module.log_sms_reportable_change(
        tenant_id=1,
        employee_id=42,
        field_name="job_title",
        old_value="Team Member",
        new_value="Supervisor",
        changed_by="hr-user",
        conn=conn,
    )
    assert result is not None
    assert result["field_name"] == "job_title"
    assert result["alert_status"] == "open"
    deadline = date.fromisoformat(result["sms_reporting_deadline"])
    assert deadline >= date.today()


def test_log_sms_reportable_change_ignores_non_reportable_field() -> None:
    conn = _FakeConn()
    assert module.log_sms_reportable_change(
        tenant_id=1,
        employee_id=42,
        field_name="phone",
        old_value="1",
        new_value="2",
        changed_by="hr-user",
        conn=conn,
    ) is None


def test_recruitment_reference_links_include_find_a_job() -> None:
    links = module.recruitment_reference_links()
    urls = [item["url"] for item in links]
    assert any("find-a-job" in url for url in urls)


def test_create_advertisement_record_requires_http_url() -> None:
    conn = _FakeConn()
    try:
        module.create_advertisement_record(
            tenant_id=1,
            job_title="Chef",
            platform="Indeed",
            advert_url="not-a-url",
            posted_date=date.today(),
            conn=conn,
        )
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_resolve_absence_fields_paid_annual_leave_is_excused() -> None:
    is_excused, excuse_type = module.resolve_absence_fields(excuse_type="paid_annual_leave")
    assert is_excused is True
    assert excuse_type == "paid_annual_leave"


def test_resolve_absence_fields_unauthorized_is_unexcused() -> None:
    is_excused, excuse_type = module.resolve_absence_fields(excuse_type="unauthorized")
    assert is_excused is False
    assert excuse_type == "unauthorized"


def test_resolve_absence_fields_rejects_unknown_type() -> None:
    try:
        module.resolve_absence_fields(excuse_type="random_leave")
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_absence_type_catalog_includes_paid_and_unpaid() -> None:
    catalog = {item["value"]: item for item in module.absence_type_catalog()}
    assert catalog["paid_annual_leave"]["paid"] is True
    assert catalog["unpaid_authorized"]["paid"] is False
    assert catalog["unauthorized"]["is_excused"] is False


def test_absence_risk_level_thresholds() -> None:
    assert module._absence_risk_level(0) == "clear"
    assert module._absence_risk_level(7) == "warning"
    assert module._absence_risk_level(9) == "alert"


def test_england_wales_2026_includes_boxing_day_substitute() -> None:
    days = {item["calendar_date"]: item["name"] for item in module.england_wales_bank_holidays(years=[2026])}
    assert len(days) == 8
    assert days["2026-01-01"] == "New Year's Day"
    assert days["2026-12-28"] == "Boxing Day (substitute)"
    assert "2026-12-26" not in days


def test_england_wales_2027_christmas_substitute() -> None:
    days = {item["calendar_date"]: item["name"] for item in module.england_wales_bank_holidays(years=[2027])}
    assert days["2027-12-27"] == "Christmas Day (substitute)"
    assert days["2027-12-28"] == "Boxing Day (substitute)"


def test_working_calendar_label_uses_holiday_name() -> None:
    assert module.working_calendar_label(calendar_date=date(2026, 12, 25), is_working_day=False) == "Christmas Day"
    assert (
        module.working_calendar_label(calendar_date=date(2026, 9, 15), is_working_day=False)
        == "Non-working / site closed"
    )


def test_apply_england_wales_bank_holidays_skips_unknown_year() -> None:
    conn = _FakeConn()
    try:
        module.apply_england_wales_bank_holidays(tenant_id=1, conn=conn, years=[1999])
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_apply_england_wales_bank_holidays_inserts_dates() -> None:
    conn = _FakeConn()
    result = module.apply_england_wales_bank_holidays(tenant_id=1, conn=conn, years=[2026])
    assert result["applied"] == 8
    assert result["skipped"] == 0
    assert result["years"] == [2026]
    holiday_inserts = [
        params for sql, params in conn.cursor_obj.commands if "INSERT INTO sponsor_working_calendar" in sql
    ]
    assert len(holiday_inserts) == 8
    assert holiday_inserts[0][1] == date(2026, 1, 1)
