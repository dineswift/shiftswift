"""Unit tests for geofenced time punch."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.time_punch.service import (
    _detect_rapid_re_punch,
    _punch_row,
    haversine_meters,
    preview_geofence,
    record_punch,
    record_punch_via_site_token,
    review_punch,
    scan_site_token,
)


def test_haversine_same_point_is_zero() -> None:
    assert haversine_meters(53.48, -2.24, 53.48, -2.24) == 0.0


def test_haversine_known_distance_roughly() -> None:
    # ~1 km north-south at Manchester latitude
    distance = haversine_meters(53.48, -2.24, 53.489, -2.24)
    assert 900 < distance < 1100


def test_record_punch_rejects_when_outside_geofence() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor

    cursor.fetchone.side_effect = [
        (1, "Demo", "Employee", "employee@shiftswifthr.co.uk", "active"),
        (10, "in", "2026-06-08T09:00:00+00:00", "Main site", 1),
    ]
    cursor.fetchall.side_effect = [
        [],
        [(1, 1, "Main site", "1 Spinningfields", 53.4794, -2.2451, 150, True, True)],
    ]

    try:
        record_punch(
            tenant_id=1,
            employee_id=1,
            username="employee@shiftswifthr.co.uk",
            punch_type="out",
            latitude=51.5074,
            longitude=-0.1278,
            accuracy_meters=10.0,
            ip_address="127.0.0.1",
            user_agent="test",
            conn=conn,
        )
        assert False, "expected PermissionError"
    except PermissionError as exc:
        assert "150m" in str(exc)


def test_preview_geofence_outside() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [
        (1, 1, "Himalayan Inn", "1 High St", 53.4794, -2.2451, 100, True, True),
    ]

    result = preview_geofence(
        tenant_id=1,
        employee_id=1,
        latitude=51.5074,
        longitude=-0.1278,
        accuracy_meters=34.0,
        conn=conn,
    )
    assert result["within_geofence"] is False
    assert result["accuracy_meters"] == 34.0
    assert "Himalayan Inn" in result["message"]
    assert result["radius_meters"] == 100


def test_preview_geofence_inside() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [
        (1, 1, "Himalayan Inn", "1 High St", 53.4794, -2.2451, 100, True, True),
    ]

    result = preview_geofence(
        tenant_id=1,
        employee_id=1,
        latitude=53.4794,
        longitude=-2.2451,
        accuracy_meters=12.0,
        conn=conn,
    )
    assert result["within_geofence"] is True
    assert result["distance_meters"] == 0.0


def test_scan_site_token_rejects_other_tenant() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (
        1,
        99,
        "Main site",
        "1 High St",
        53.4794,
        -2.2451,
        150,
        True,
        True,
        None,
        "all",
    )

    try:
        scan_site_token(
            tenant_id=1,
            employee_id=1,
            clock_token="valid-token",
            conn=conn,
        )
        assert False, "expected PermissionError"
    except PermissionError as exc:
        assert "another business" in str(exc)


def test_record_punch_via_site_token_inserts_qr_punch() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor

    cursor.fetchone.side_effect = [
        (1, "Demo", "Employee", "employee@shiftswifthr.co.uk", "active"),
        None,
        (
            1,
            1,
            "Main site",
            "1 High St",
            53.4794,
            -2.2451,
            150,
            True,
            True,
            None,
            "all",
        ),
        None,
        (42, "2026-06-08T09:00:00+00:00"),
    ]
    cursor.fetchall.side_effect = [
        [(1, 1, "Main site", "1 High St", 53.4794, -2.2451, 150, True, True)],
    ]

    result = record_punch_via_site_token(
        tenant_id=1,
        employee_id=1,
        username="employee@shiftswifthr.co.uk",
        punch_type="in",
        clock_token="valid-token",
        ip_address="127.0.0.1",
        user_agent="test",
        conn=conn,
    )

    assert result["punch_method"] == "site_qr"
    assert result["site_name"] == "Main site"
    assert result["clocked_in"] is True
    insert_params = cursor.execute.call_args_list[-1][0][1]
    assert insert_params[11] == "site_qr"


def test_punch_row_includes_hr_review_fields() -> None:
    now = datetime.now(timezone.utc)
    row = (
        1,
        "in",
        now,
        20.0,
        5,
        "Karun",
        "Acharya",
        "k@example.com",
        "Main site",
        False,
        None,
        1,
        100,
        True,
        9.0,
        "gps",
        now,
        "hr.admin",
        False,
    )
    item = _punch_row(row)
    assert item["employee_id"] == 5
    assert item["hr_reviewed_by"] == "hr.admin"
    assert item["hr_review_pending"] is False
    assert item["rapid_re_punch"] is False


def test_detect_rapid_re_punch_within_window() -> None:
    from datetime import datetime, timedelta, timezone

    last_at = datetime.now(timezone.utc) - timedelta(minutes=3)
    assert (
        _detect_rapid_re_punch(
            last={"punch_type": "out", "punched_at": last_at.isoformat()},
            punch_type="in",
        )
        is True
    )


def test_detect_rapid_re_punch_after_window() -> None:
    from datetime import datetime, timedelta, timezone

    last_at = datetime.now(timezone.utc) - timedelta(minutes=20)
    assert (
        _detect_rapid_re_punch(
            last={"punch_type": "out", "punched_at": last_at.isoformat()},
            punch_type="in",
        )
        is False
    )


def test_review_punch_marks_record() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (42,)

    result = review_punch(tenant_id=1, punch_id=42, reviewed_by="hr.admin", conn=conn)

    assert result == {"id": 42, "reviewed": True}
    conn.commit.assert_called_once()
