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


MAX_REPEAT_OCCURRENCES = 52


def _add_months(day: date, months: int) -> date | None:
    month_index = day.month - 1 + months
    year = day.year + month_index // 12
    month = month_index % 12 + 1
    if month == 12:
        month_end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        month_end = date(year, month + 1, 1) - timedelta(days=1)
    if day.day > month_end.day:
        return None
    return date(year, month, day.day)


def plan_repeat_pairs(
    *,
    match_date: date,
    new_date: date,
    until: date,
    frequency: str,
    current_week_start: date,
) -> list[tuple[date, date]]:
    """Future (match day, new day) pairs after the current week, up to `until`."""
    week_end = week_end_date(current_week_start)
    delta = new_date - match_date
    pairs: list[tuple[date, date]] = []
    if frequency == "month":
        step = 1
        while len(pairs) < MAX_REPEAT_OCCURRENCES and step <= 36:
            match_day = _add_months(match_date, step)
            step += 1
            if match_day is None:
                continue
            target = match_day + delta
            if match_day > until and target > until:
                break
            if target > until or target <= week_end:
                continue
            pairs.append((match_day, target))
        return pairs

    match_day = match_date + timedelta(days=7)
    while len(pairs) < MAX_REPEAT_OCCURRENCES:
        target = match_day + delta
        if match_day > until and target > until:
            break
        if target <= until and target > week_end:
            pairs.append((match_day, target))
        match_day += timedelta(days=7)
    return pairs


def _parse_hhmm(value: str) -> time:
    return time.fromisoformat(str(value).strip()[:5])


def _clock_equal(left: time, right: time) -> bool:
    return left.hour == right.hour and left.minute == right.minute


def apply_repeat_rules(
    *,
    tenant_id: int,
    current_week_start: date,
    rules: list[dict[str, Any]],
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    """Write the same shift into upcoming weeks without unlocking past published rotas."""
    if not rules:
        raise RotaValidationError("Choose at least one shift to repeat", field="rules")
    week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    active_ids = _load_active_employee_ids(tenant_id=tenant_id, conn=conn)
    written = 0
    skipped = 0
    created_weeks: set[int] = set()
    touched_weeks: set[int] = set()

    try:
        with conn.cursor() as cur:
            for rule in rules:
                employee_id = int(rule["employee_id"])
                if employee_id not in active_ids:
                    raise RotaValidationError("Employee not found or not active for rota", field="employee_id")
                new_date = date.fromisoformat(str(rule["shift_date"])[:10])
                match_date = date.fromisoformat(str(rule.get("match_shift_date") or rule["shift_date"])[:10])
                until = date.fromisoformat(str(rule["until"])[:10])
                if until < new_date:
                    raise RotaValidationError("Auto schedule end date must be on or after the shift", field="until")
                frequency = "month" if rule.get("frequency") == "month" else "week"
                new_start = _parse_hhmm(rule["start_time"])
                new_end = _parse_hhmm(rule["end_time"])
                match_employee = int(rule.get("match_employee_id") or employee_id)
                match_start = _parse_hhmm(rule["match_start_time"]) if rule.get("match_start_time") else new_start
                match_end = _parse_hhmm(rule["match_end_time"]) if rule.get("match_end_time") else new_end
                role_label = str(rule.get("role_label") or "").strip()[:80]
                notes = str(rule.get("notes") or "").strip()[:500]
                pairs = plan_repeat_pairs(
                    match_date=match_date,
                    new_date=new_date,
                    until=until,
                    frequency=frequency,
                    current_week_start=current_week_start,
                )
                for match_day, target_day in pairs:
                    target_week = week_start_on_or_before(target_day, week_start_day)
                    if target_week <= current_week_start or is_week_fully_past(target_week):
                        skipped += 1
                        continue
                    cur.execute(
                        """
                        SELECT id, status, version
                        FROM rota_weeks
                        WHERE tenant_id = %s AND week_start = %s
                        FOR UPDATE
                        """,
                        (tenant_id, target_week),
                    )
                    week_row = cur.fetchone()
                    if week_row:
                        week_id, status, _version = int(week_row[0]), week_row[1], int(week_row[2])
                        if status == "published" and is_week_fully_past(target_week):
                            skipped += 1
                            continue
                    else:
                        cur.execute(
                            """
                            INSERT INTO rota_weeks (tenant_id, week_start, created_by, updated_by)
                            VALUES (%s, %s, %s, %s)
                            RETURNING id, status, version
                            """,
                            (tenant_id, target_week, actor_username, actor_username),
                        )
                        created = cur.fetchone()
                        week_id, status = int(created[0]), created[1]
                        created_weeks.add(week_id)

                    week_end = week_end_date(target_week)
                    payload = validate_shift_payload(
                        shift={
                            "employee_id": employee_id,
                            "shift_date": target_day.isoformat(),
                            "start_time": new_start.strftime("%H:%M"),
                            "end_time": new_end.strftime("%H:%M"),
                            "role_label": role_label,
                            "notes": notes,
                        },
                        week_start=target_week,
                        week_end=week_end,
                        active_employee_ids=active_ids,
                        index=0,
                    )
                    cur.execute(
                        """
                        SELECT id, employee_id, shift_date, start_time, end_time
                        FROM rota_shifts
                        WHERE tenant_id = %s AND rota_week_id = %s
                        """,
                        (tenant_id, week_id),
                    )
                    existing = cur.fetchall()
                    match_id = None
                    already = False
                    for row in existing:
                        row_id, row_employee, row_date, row_start, row_end = row
                        if (
                            int(row_employee) == employee_id
                            and row_date == target_day
                            and _clock_equal(row_start, new_start)
                            and _clock_equal(row_end, new_end)
                        ):
                            already = True
                            break
                        if (
                            int(row_employee) == match_employee
                            and row_date == match_day
                            and _clock_equal(row_start, match_start)
                            and _clock_equal(row_end, match_end)
                        ):
                            match_id = int(row_id)
                    if already:
                        continue
                    others = []
                    for row in existing:
                        if match_id is not None and int(row[0]) == match_id:
                            continue
                        others.append(
                            {
                                "employee_id": int(row[1]),
                                "shift_date": row[2],
                                "start_time": row[3],
                                "end_time": row[4],
                            }
                        )
                    clash = any(
                        item["employee_id"] == employee_id
                        and shifts_overlap(
                            target_day,
                            new_start,
                            new_end,
                            item["shift_date"],
                            item["start_time"],
                            item["end_time"],
                        )
                        for item in others
                    )
                    if clash:
                        skipped += 1
                        continue
                    if match_id is not None:
                        cur.execute(
                            """
                            UPDATE rota_shifts
                            SET employee_id = %s, shift_date = %s, start_time = %s, end_time = %s,
                                role_label = %s, notes = %s, updated_at = NOW()
                            WHERE id = %s AND tenant_id = %s
                            """,
                            (
                                payload["employee_id"],
                                payload["shift_date"],
                                payload["start_time"],
                                payload["end_time"],
                                payload["role_label"],
                                payload["notes"],
                                match_id,
                                tenant_id,
                            ),
                        )
                    else:
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
                                payload["employee_id"],
                                payload["shift_date"],
                                payload["start_time"],
                                payload["end_time"],
                                payload["role_label"],
                                payload["notes"],
                            ),
                        )
                    written += 1
                    touched_weeks.add(week_id)

            for week_id in touched_weeks - created_weeks:
                cur.execute(
                    """
                    UPDATE rota_weeks
                    SET version = version + 1, updated_by = %s, updated_at = NOW()
                    WHERE id = %s AND tenant_id = %s
                    """,
                    (actor_username, week_id, tenant_id),
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    week_count = len(touched_weeks)
    if written:
        message = (
            f"Auto schedule saved {written} shift{'' if written == 1 else 's'} "
            f"across {week_count} upcoming week{'' if week_count == 1 else 's'}"
        )
        if skipped:
            message += f" ({skipped} skipped)"
    elif skipped:
        message = f"No upcoming shifts saved — {skipped} skipped because they would overlap or the week is locked."
    else:
        message = "Nothing to repeat before the end date. Choose a later until date."
    return {"written": written, "skipped": skipped, "weeks": week_count, "message": message}
