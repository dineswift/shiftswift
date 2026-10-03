"""Rota week and shift CRUD with validation and optimistic locking."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")


def uk_date_range_utc(*, date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """Inclusive UK calendar dates → UTC bounds for querying timestamptz punches."""
    start = datetime.combine(date_from, time.min, tzinfo=UK_TZ).astimezone(timezone.utc)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UK_TZ).astimezone(timezone.utc)
    return start, end

MIN_SHIFT_MINUTES = 15
MAX_SHIFT_HOURS = 16
BILLABLE_EMPLOYEE_STATUSES = frozenset({"active", "onboarding", "suspended"})
WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
DEFAULT_WEEK_START_DAY = 0


class RotaValidationError(ValueError):
    """Raised when shift data fails validation."""

    def __init__(self, message: str, *, field: str | None = None, index: int | None = None) -> None:
        super().__init__(message)
        self.field = field
        self.index = index


class RotaConflictError(ValueError):
    """Raised when optimistic lock version does not match."""

    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(f"Rota was updated elsewhere (expected version {expected}, now {actual}). Reload and try again.")
        self.expected = expected
        self.actual = actual


def normalize_week_start_day(week_start_day: int | None) -> int:
    if week_start_day is None:
        return DEFAULT_WEEK_START_DAY
    try:
        day = int(week_start_day)
    except (TypeError, ValueError):
        return DEFAULT_WEEK_START_DAY
    if day < 0 or day > 6:
        return DEFAULT_WEEK_START_DAY
    return day


def get_tenant_rota_week_start_day(*, tenant_id: int, conn: Any) -> int:
    from core.schema import table_columns

    if "rota_week_start_day" not in table_columns(conn, "tenants"):
        return DEFAULT_WEEK_START_DAY
    with conn.cursor() as cur:
        cur.execute("SELECT rota_week_start_day FROM tenants WHERE id = %s", (tenant_id,))
        row = cur.fetchone()
        if not row:
            raise LookupError("tenant not found")
        return normalize_week_start_day(row[0])


def parse_week_start(value: str | date, *, week_start_day: int = DEFAULT_WEEK_START_DAY) -> date:
    week_start_day = normalize_week_start_day(week_start_day)
    if isinstance(value, date):
        week_start = value
    else:
        week_start = date.fromisoformat(str(value).strip()[:10])
    if week_start.weekday() != week_start_day:
        expected = WEEKDAY_NAMES[week_start_day]
        raise RotaValidationError(
            f"week_start must be a {expected} (your rota week start day)",
            field="week_start",
        )
    return week_start


def week_start_on_or_before(day: date, week_start_day: int = DEFAULT_WEEK_START_DAY) -> date:
    week_start_day = normalize_week_start_day(week_start_day)
    delta = (day.weekday() - week_start_day) % 7
    return day - timedelta(days=delta)


def monday_on_or_before(day: date) -> date:
    return week_start_on_or_before(day, DEFAULT_WEEK_START_DAY)


def week_dates(week_start: date) -> list[date]:
    return [week_start + timedelta(days=offset) for offset in range(7)]


def week_end_date(week_start: date) -> date:
    return week_start + timedelta(days=6)


def is_week_fully_past(week_start: date, *, today: date | None = None) -> bool:
    ref = today or date.today()
    return week_end_date(week_start) < ref


def rota_week_policy(week_start: date, week: dict[str, Any] | None) -> dict[str, Any]:
    fully_past = is_week_fully_past(week_start)
    published = bool(week and week.get("status") == "published")
    readonly = fully_past and published
    copy_blocked = fully_past
    policy: dict[str, Any] = {
        "is_past_week": fully_past,
        "readonly": readonly,
        "copy_blocked": copy_blocked,
    }
    if readonly:
        policy["readonly_reason"] = (
            "This published rota is locked because the week has ended. "
            "It stays available for attendance and payroll records."
        )
    if copy_blocked:
        policy["copy_blocked_reason"] = "Copying shifts into past weeks is disabled for compliance."
    return policy


def assert_week_save_allowed(*, week_start: date, status: str | None) -> None:
    if is_week_fully_past(week_start) and status == "published":
        raise RotaValidationError(
            "This published rota is locked. Past published weeks cannot be changed.",
            field="week_start",
        )


def assert_week_copy_allowed(*, week_start: date) -> None:
    if is_week_fully_past(week_start):
        raise RotaValidationError(
            "Cannot copy shifts into a past week. Select the current week or a future week.",
            field="week_start",
        )


def assert_week_publish_allowed(*, week_start: date) -> None:
    if is_week_fully_past(week_start):
        raise RotaValidationError(
            "Cannot publish a rota for a week that has already ended.",
            field="week_start",
        )


def shift_window(*, shift_date: date, start_time: time, end_time: time) -> tuple[datetime, datetime]:
    """Shift times are UK local (Europe/London); returned bounds are UTC for punch comparison."""
    start = datetime.combine(shift_date, start_time, tzinfo=UK_TZ).astimezone(timezone.utc)
    if end_time <= start_time:
        end = datetime.combine(shift_date + timedelta(days=1), end_time, tzinfo=UK_TZ).astimezone(timezone.utc)
    else:
        end = datetime.combine(shift_date, end_time, tzinfo=UK_TZ).astimezone(timezone.utc)
    return start, end


def shifts_overlap(
    a_date: date,
    a_start: time,
    a_end: time,
    b_date: date,
    b_start: time,
    b_end: time,
) -> bool:
    a0, a1 = shift_window(shift_date=a_date, start_time=a_start, end_time=a_end)
    b0, b1 = shift_window(shift_date=b_date, start_time=b_start, end_time=b_end)
    return a0 < b1 and b0 < a1


def _shift_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "employee_id": row[1],
        "shift_date": row[2].isoformat(),
        "start_time": row[3].strftime("%H:%M"),
        "end_time": row[4].strftime("%H:%M"),
        "role_label": row[5] or "",
        "notes": row[6] or "",
        "employee_name": row[7],
        "employee_status": row[8],
    }


def _week_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "week_start": row[1].isoformat(),
        "status": row[2],
        "version": row[3],
        "published_at": row[4].isoformat() if row[4] else None,
        "updated_at": row[5].isoformat() if row[5] else None,
    }


def _load_active_employee_ids(*, tenant_id: int, conn: Any) -> set[int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM employees
            WHERE tenant_id = %s AND status IN ('active', 'onboarding', 'suspended')
            """,
            (tenant_id,),
        )
        return {int(row[0]) for row in cur.fetchall()}


def validate_shift_payload(
    *,
    shift: dict[str, Any],
    week_start: date,
    week_end: date,
    active_employee_ids: set[int],
    index: int,
) -> dict[str, Any]:
    try:
        employee_id = int(shift["employee_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RotaValidationError("employee_id is required", field="employee_id", index=index) from exc

    if employee_id not in active_employee_ids:
        raise RotaValidationError("Employee not found or not active for rota", field="employee_id", index=index)

    try:
        shift_date = date.fromisoformat(str(shift["shift_date"])[:10])
    except (TypeError, ValueError) as exc:
        raise RotaValidationError("shift_date must be YYYY-MM-DD", field="shift_date", index=index) from exc

    if shift_date < week_start or shift_date > week_end:
        raise RotaValidationError("shift_date must fall within the selected week", field="shift_date", index=index)

    try:
        start_time = time.fromisoformat(str(shift["start_time"])[:5])
        end_time = time.fromisoformat(str(shift["end_time"])[:5])
    except (TypeError, ValueError) as exc:
        raise RotaValidationError("start_time and end_time must be HH:MM", field="start_time", index=index) from exc

    if start_time == end_time:
        raise RotaValidationError("Shift start and end cannot be the same", field="end_time", index=index)

    start_dt, end_dt = shift_window(shift_date=shift_date, start_time=start_time, end_time=end_time)
    duration_minutes = (end_dt - start_dt).total_seconds() / 60
    if duration_minutes < MIN_SHIFT_MINUTES:
        raise RotaValidationError(f"Shift must be at least {MIN_SHIFT_MINUTES} minutes", field="end_time", index=index)
    if duration_minutes > MAX_SHIFT_HOURS * 60:
        raise RotaValidationError(f"Shift cannot exceed {MAX_SHIFT_HOURS} hours", field="end_time", index=index)

    role_label = str(shift.get("role_label") or "").strip()[:80]
    notes = str(shift.get("notes") or "").strip()[:500]
    shift_id = shift.get("id")
    parsed_id = int(shift_id) if shift_id not in (None, "") else None

    return {
        "id": parsed_id,
        "employee_id": employee_id,
        "shift_date": shift_date,
        "start_time": start_time,
        "end_time": end_time,
        "role_label": role_label,
        "notes": notes,
    }


def validate_no_overlaps(shifts: list[dict[str, Any]]) -> None:
    for i, left in enumerate(shifts):
        for j in range(i + 1, len(shifts)):
            right = shifts[j]
            if left["employee_id"] != right["employee_id"]:
                continue
            if shifts_overlap(
                left["shift_date"],
                left["start_time"],
                left["end_time"],
                right["shift_date"],
                right["start_time"],
                right["end_time"],
            ):
                raise RotaValidationError(
                    "Overlapping shifts for the same employee",
                    field="start_time",
                    index=j,
                )


def get_or_create_week(
    *,
    tenant_id: int,
    week_start: date,
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, week_start, status, version, published_at, updated_at
            FROM rota_weeks
            WHERE tenant_id = %s AND week_start = %s
            """,
            (tenant_id, week_start),
        )
        row = cur.fetchone()
        if row:
            return _week_row(row)

        cur.execute(
            """
            INSERT INTO rota_weeks (tenant_id, week_start, created_by, updated_by)
            VALUES (%s, %s, %s, %s)
            RETURNING id, week_start, status, version, published_at, updated_at
            """,
            (tenant_id, week_start, actor_username, actor_username),
        )
        return _week_row(cur.fetchone())


def list_shifts_for_week(*, tenant_id: int, week_start: date, conn: Any) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, week_start, status, version, published_at, updated_at
            FROM rota_weeks
            WHERE tenant_id = %s AND week_start = %s
            """,
            (tenant_id, week_start),
        )
        week_row = cur.fetchone()
        if not week_row:
            return None, []

        week = _week_row(week_row)
        cur.execute(
            """
            SELECT s.id, s.employee_id, s.shift_date, s.start_time, s.end_time,
                   s.role_label, s.notes,
                   trim(both ' ' from coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) AS employee_name,
                   e.status
            FROM rota_shifts s
            JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
            WHERE s.tenant_id = %s AND s.rota_week_id = %s
            ORDER BY s.shift_date, s.start_time, employee_name
            """,
            (tenant_id, week["id"]),
        )
        shifts = [_shift_row(row) for row in cur.fetchall()]
        return week, shifts


def get_week_rota(
    *,
    tenant_id: int,
    week_start: date,
    conn: Any,
    week_start_day: int | None = None,
) -> dict[str, Any]:
    week, shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=week_start, conn=conn)
    resolved_day = normalize_week_start_day(
        week_start_day if week_start_day is not None else get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    )
    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end_date(week_start).isoformat(),
        "week_days": [day.isoformat() for day in week_dates(week_start)],
        "week_start_day": resolved_day,
        "week_start_day_name": WEEKDAY_NAMES[resolved_day],
        "week": week,
        "shifts": shifts,
        "policy": rota_week_policy(week_start, week),
    }


def save_week_shifts(
    *,
    tenant_id: int,
    week_start: date,
    shifts_payload: list[dict[str, Any]],
    expected_version: int | None,
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    week_end = week_start + timedelta(days=6)
    active_ids = _load_active_employee_ids(tenant_id=tenant_id, conn=conn)
    parsed = [
        validate_shift_payload(
            shift=item,
            week_start=week_start,
            week_end=week_end,
            active_employee_ids=active_ids,
            index=index,
        )
        for index, item in enumerate(shifts_payload)
    ]
    validate_no_overlaps(parsed)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, status, version
            FROM rota_weeks
            WHERE tenant_id = %s AND week_start = %s
            FOR UPDATE
            """,
            (tenant_id, week_start),
        )
        row = cur.fetchone()
        if row:
            week_id, status, version = row[0], row[1], int(row[2])
            assert_week_save_allowed(week_start=week_start, status=status)
            if expected_version is not None and expected_version != version:
                raise RotaConflictError(expected_version, version)
        else:
            cur.execute(
                """
                INSERT INTO rota_weeks (tenant_id, week_start, created_by, updated_by)
                VALUES (%s, %s, %s, %s)
                RETURNING id, status, version
                """,
                (tenant_id, week_start, actor_username, actor_username),
            )
            week_id, status, version = cur.fetchone()

        cur.execute("DELETE FROM rota_shifts WHERE tenant_id = %s AND rota_week_id = %s", (tenant_id, week_id))

        for shift in parsed:
            cur.execute(
                """
                INSERT INTO rota_shifts (
                  tenant_id, rota_week_id, employee_id, shift_date,
                  start_time, end_time, role_label, notes
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    tenant_id,
                    week_id,
                    shift["employee_id"],
                    shift["shift_date"],
                    shift["start_time"],
                    shift["end_time"],
                    shift["role_label"],
                    shift["notes"],
                ),
            )

        cur.execute(
            """
            UPDATE rota_weeks
            SET version = version + 1,
                status = 'draft',
                published_at = NULL,
                updated_by = %s,
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, week_start, status, version, published_at, updated_at
            """,
            (actor_username, week_id),
        )
        week = _week_row(cur.fetchone())

    conn.commit()
    _, shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=week_start, conn=conn)
    return {
        "week": week,
        "shifts": shifts,
        "message": "Rota saved",
    }


def publish_week(
    *,
    tenant_id: int,
    week_start: date,
    expected_version: int,
    actor_username: str,
    conn: Any,
    notify_staff: bool = False,
) -> dict[str, Any]:
    assert_week_publish_allowed(week_start=week_start)
    previous_snapshot: list[dict[str, Any]] | None = None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, version, published_shift_snapshot
            FROM rota_weeks
            WHERE tenant_id = %s AND week_start = %s
            FOR UPDATE
            """,
            (tenant_id, week_start),
        )
        row = cur.fetchone()
        if not row:
            raise RotaValidationError("No rota for this week — save shifts first", field="week_start")
        week_id, version, snapshot_raw = row[0], int(row[1]), row[2]
        if version != expected_version:
            raise RotaConflictError(expected_version, version)
        if snapshot_raw:
            previous_snapshot = list(snapshot_raw) if isinstance(snapshot_raw, list) else None

        cur.execute(
            "SELECT COUNT(*) FROM rota_shifts WHERE tenant_id = %s AND rota_week_id = %s",
            (tenant_id, week_id),
        )
        if int(cur.fetchone()[0]) == 0:
            raise RotaValidationError(
                "Add at least one shift before publishing — click Save draft first",
                field="shifts",
            )

        cur.execute(
            """
            UPDATE rota_weeks
            SET status = 'published',
                published_at = NOW(),
                version = version + 1,
                updated_by = %s,
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, week_start, status, version, published_at, updated_at
            """,
            (actor_username, week_id),
        )
        week = _week_row(cur.fetchone())

    conn.commit()
    _, shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=week_start, conn=conn)
    result: dict[str, Any] = {"week": week, "shifts": shifts, "message": "Rota published"}
    if notify_staff:
        from modules.rota.notifications import notify_rota_published, save_published_snapshot

        result["notifications"] = notify_rota_published(
            tenant_id=tenant_id,
            week_start=week_start,
            shifts=shifts,
            conn=conn,
            previous_shifts=previous_snapshot,
        )
        save_published_snapshot(conn=conn, week_id=week_id, shifts=shifts)
    else:
        from modules.rota.notifications import save_published_snapshot

        save_published_snapshot(conn=conn, week_id=week_id, shifts=shifts)
    return result


def resend_week_notifications(
    *,
    tenant_id: int,
    week_start: date,
    conn: Any,
    employee_ids: list[int] | None = None,
) -> dict[str, Any]:
    """Resend rota emails and push alerts for an already-published week."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, status
            FROM rota_weeks
            WHERE tenant_id = %s AND week_start = %s
            """,
            (tenant_id, week_start),
        )
        row = cur.fetchone()
        if not row:
            raise RotaValidationError("No rota for this week", field="week_start")
        week_id, status = int(row[0]), str(row[1])
        if status != "published":
            raise RotaValidationError(
                "Publish the rota before resending staff notifications",
                field="status",
            )
        cur.execute(
            "SELECT COUNT(*) FROM rota_shifts WHERE tenant_id = %s AND rota_week_id = %s",
            (tenant_id, week_id),
        )
        if int(cur.fetchone()[0]) == 0:
            raise RotaValidationError("No shifts on this rota week", field="shifts")

    _, shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=week_start, conn=conn)
    if employee_ids is not None:
        allowed = {int(eid) for eid in employee_ids}
        scheduled = {int(s["employee_id"]) for s in shifts}
        missing = allowed - scheduled
        if missing:
            raise RotaValidationError(
                "One or more selected staff are not scheduled on this rota week",
                field="employee_ids",
            )
        if not allowed:
            raise RotaValidationError("Select at least one staff member to resend", field="employee_ids")

    from modules.rota.notifications import notify_rota_published

    notifications = notify_rota_published(
        tenant_id=tenant_id,
        week_start=week_start,
        shifts=shifts,
        conn=conn,
        resend=True,
        employee_ids=employee_ids,
    )
    target_count = len(employee_ids) if employee_ids is not None else notifications.get("employees_notified", 0)
    return {
        "week_start": week_start.isoformat(),
        "notifications": notifications,
        "message": (
            f"Rota notifications resent to {target_count} staff"
            if employee_ids is not None
            else "Rota notifications resent"
        ),
    }


def copy_week_from_previous(
    *,
    tenant_id: int,
    week_start: date,
    expected_version: int | None,
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    assert_week_copy_allowed(week_start=week_start)
    previous_start = week_start - timedelta(days=7)
    _, previous_shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=previous_start, conn=conn)
    if not previous_shifts:
        raise RotaValidationError("Previous week has no shifts to copy", field="week_start")

    _, current_shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=week_start, conn=conn)
    if current_shifts:
        raise RotaValidationError(
            "Current week already has shifts — remove them or save an empty rota before copying",
            field="shifts",
        )

    payload = []
    for shift in previous_shifts:
        old_date = date.fromisoformat(shift["shift_date"])
        payload.append(
            {
                "employee_id": shift["employee_id"],
                "shift_date": (old_date + timedelta(days=7)).isoformat(),
                "start_time": shift["start_time"],
                "end_time": shift["end_time"],
                "role_label": shift.get("role_label") or "",
                "notes": shift.get("notes") or "",
            }
        )
    result = save_week_shifts(
        tenant_id=tenant_id,
        week_start=week_start,
        shifts_payload=payload,
        expected_version=expected_version,
        actor_username=actor_username,
        conn=conn,
    )
    result["message"] = f"Copied {len(payload)} shifts from previous week"
    result["copied_from_week"] = previous_start.isoformat()
    return result
