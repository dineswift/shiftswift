/** Admin — weekly rota: grid, attendance, copy week, shift requests. */
(async function initAdminRota() {
  const { apiFetch, renderTableBody, escapeHtml, parseHashBaseSection, statusPill, downloadAuthenticated, emptyStateHtml, parseApiJson, readApiError, friendlyNativeError, fetchEmployeesList, peekEmployeesListCache } = window.Admin;

  let sectionReady = false;
  let rotaDataLoadPromise = null;
  let rotaWeekStartDay = 0;
  let currentWeekStart = rotaWeekStartIso(new Date());
  let weekMeta = null;
  let rotaPolicy = null;
  let shifts = [];
  let attendanceByShiftId = new Map();
  let attendanceSummary = null;
  let pendingRequestCount = 0;
  let employees = [];
  let dirty = false;
  let activeView = "grid";
  let dragShiftIndex = null;
  let dragCopyMode = false;
  let editingShiftIndex = null;
  let contextMenuEl = null;
  let copyModalEl = null;

  const ATTENDANCE_LABELS = {
    scheduled: "Scheduled",
    awaiting: "Awaiting",
    attended: "Attended",
    late: "Late",
    no_show: "No show",
    missing_clock_out: "No clock-out",
  };

  function formatClockInUkTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    });
  }

  function attendanceStatusPill(attendance) {
    if (!attendance) return "—";
    const status = attendance.attendance_status;
    const label = ATTENDANCE_LABELS[status] || status;
    let cls = "status-ok";
    if (status === "scheduled") cls = "status-neutral";
    else if (status === "awaiting") cls = "status-info";
    else if (status === "late" || status === "missing_clock_out") cls = "status-warning";
    else if (status === "no_show") cls = "status-critical";
    const clockIn =
      (status === "attended" || status === "late") && attendance.clock_in_at
        ? formatClockInUkTime(attendance.clock_in_at)
        : "";
    const tipClass = clockIn ? " status-pill--has-tip" : "";
    const tipAttr = clockIn ? ` data-tip="Clocked in ${escapeHtml(clockIn)}"` : "";
    const ariaAttr = clockIn ? ` aria-label="${escapeHtml(label)}. Clocked in ${escapeHtml(clockIn)}"` : "";
    return `<span class="status-pill ${cls}${tipClass}"${tipAttr}${ariaAttr}${clockIn ? ' tabindex="0"' : ""}>${escapeHtml(label)}</span>`;
  }

  function formatRoleLabel(role) {
    const trimmed = (role || "").trim();
    if (!trimmed) return `<span class="rota-role-unassigned muted">Unassigned</span>`;
    return escapeHtml(trimmed);
  }

  function openPunchRecordsForShift(employeeId, shiftDate) {
    if (!shiftDate) return;
    try {
      sessionStorage.setItem(
        "sshr_punch_day_prefill",
        JSON.stringify({ employee_id: employeeId || null, shift_date: shiftDate })
      );
    } catch {
      /* ignore */
    }
    window.location.hash = "time-punch/records";
    window.dispatchEvent(
      new CustomEvent("admin:open-punch-day", {
        detail: { employee_id: employeeId || null, shift_date: shiftDate },
      })
    );
  }

  function rotaWeekStats() {
    const staffScheduled = new Set(shifts.map((s) => s.employee_id)).size;
    const summary = attendanceSummary || {};
    const noShows = Number(summary.no_show || 0);
    const attended = Number(summary.attended || 0) + Number(summary.late || 0);
    const awaiting = Number(summary.awaiting || 0);
    const flags = noShows + Number(summary.late || 0) + Number(summary.missing_clock_out || 0);
    return {
      shifts: shifts.length,
      staffScheduled,
      noShows,
      attended,
      awaiting,
      flags,
      pendingRequests: pendingRequestCount,
      published: weekMeta?.status === "published",
    };
  }

  function renderRotaStats() {
    const grid = document.getElementById("rota-stats-grid");
    if (!grid) return;
    const stats = rotaWeekStats();
    const hasStaff = hasActiveEmployees();
    grid.hidden = !hasStaff;
    if (!hasStaff) return;

    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set("rota-stat-shifts", String(stats.shifts));
    set("rota-stat-staff", String(stats.staffScheduled));
    set("rota-stat-attended", String(stats.attended));
    set("rota-stat-noshow", String(stats.noShows));
    set("rota-stat-requests", String(stats.pendingRequests));

    const shiftsSub = document.getElementById("rota-stat-shifts-sub");
    if (shiftsSub) {
      shiftsSub.textContent = stats.shifts
        ? stats.published
          ? "Published this week"
          : "Draft — publish when ready"
        : "None scheduled yet";
    }
    const staffSub = document.getElementById("rota-stat-staff-sub");
    if (staffSub) {
      const total = activeEmployees().length;
      staffSub.textContent = total ? `${total} active employees` : "No active staff";
    }
    const attendedSub = document.getElementById("rota-stat-attended-sub");
    if (attendedSub) {
      attendedSub.textContent = stats.published
        ? stats.attended
          ? "Clock-in matched"
          : "No attended shifts yet"
        : "Publish to track";
    }
    const noshowSub = document.getElementById("rota-stat-noshow-sub");
    if (noshowSub) {
      noshowSub.textContent = stats.noShows ? "Needs follow-up" : stats.awaiting ? `${stats.awaiting} awaiting clock-in` : "All clear";
    }
    const requestsSub = document.getElementById("rota-stat-requests-sub");
    if (requestsSub) {
      requestsSub.textContent = stats.pendingRequests ? "Awaiting your review" : "No pending cover or swap";
    }

    document.getElementById("rota-stat-noshow-card")?.classList.toggle("hr-stat-card--warn", stats.noShows > 0);
    document.getElementById("rota-stat-requests-card")?.classList.toggle("hr-stat-card--warn", stats.pendingRequests > 0);
  }

  const DEFAULT_ROLE_SUGGESTIONS = ["Floor", "Bar", "Kitchen", "Front of house", "Management", "Day off"];
  const AVATAR_PALETTES = [
    { bg: "#E1F5EE", color: "#0F6E56" },
    { bg: "#E6F1FB", color: "#185FA5" },
    { bg: "#FAEEDA", color: "#854F0B" },
    { bg: "#FBEAF0", color: "#993556" },
  ];
  let panelOpen = false;
  let rotaTemplates = [];
  let rotaInsights = null;
  let selectedTemplateId = null;
  let advancedUiBound = false;
  let featuresListenerBound = false;
  let mobileSelectedDay = null;

  function shouldUseMobileRotaBuilder() {
    return isMobileViewport() && document.body.dataset.mobileTab === "rota";
  }

  function weekDayIsos() {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  }

  function ensureMobileSelectedDay() {
    const days = weekDayIsos();
    const today = todayIsoLocal();
    if (mobileSelectedDay && days.includes(mobileSelectedDay)) return mobileSelectedDay;
    mobileSelectedDay = days.includes(today) ? today : days[0];
    return mobileSelectedDay;
  }

  function formatMobileDayPill(iso, selected) {
    const date = new Date(`${iso}T12:00:00`);
    const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
    const dayNum = date.getDate();
    const hasShifts = shiftsOnDate(iso) > 0;
    const todayIso = todayIsoLocal();
    const classes = [
      "rota-mobile-day-pill",
      selected ? "is-selected" : "",
      iso === todayIso ? "is-today" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<button type="button" role="tab" aria-selected="${selected ? "true" : "false"}" class="${classes}" data-mobile-day="${iso}">
      <span class="rota-mobile-day-pill__weekday">${escapeHtml(weekday)}</span>
      <span class="rota-mobile-day-pill__date">${dayNum}</span>
      <span class="rota-mobile-day-pill__dot${hasShifts ? " has-shifts" : ""}" aria-hidden="true"></span>
    </button>`;
  }

  function renderMobileDayStatus(selectedDay) {
    const el = document.getElementById("rota-mobile-day-status");
    if (!el) return;
    const dayLabel = new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-GB", {
      weekday: "long",
    });
    const count = shiftsOnDate(selectedDay);
    if (!hasActiveEmployees()) {
      el.innerHTML = '<span class="rota-mobile-day-status__icon" aria-hidden="true">ⓘ</span> Add employees before building a rota.';
      el.className = "rota-mobile-day-status rota-mobile-day-status--info";
      return;
    }
    if (count === 0) {
      el.innerHTML = `<span class="rota-mobile-day-status__icon" aria-hidden="true">ⓘ</span> No shifts scheduled for ${escapeHtml(dayLabel)} yet`;
      el.className = "rota-mobile-day-status rota-mobile-day-status--info";
      return;
    }
    el.innerHTML = `<span class="rota-mobile-day-status__icon" aria-hidden="true">✓</span> ${count} shift${count === 1 ? "" : "s"} on ${escapeHtml(dayLabel)}`;
    el.className = "rota-mobile-day-status rota-mobile-day-status--ok";
  }

  function renderMobileStaffRow(emp, selectedDay, readonly) {
    const palette = avatarPalette(emp.id);
    const dayShifts = shifts
      .map((shift, index) => ({ shift, index }))
      .filter(({ shift }) => Number(shift.employee_id) === Number(emp.id) && shift.shift_date === selectedDay);
    const shiftChips = dayShifts
      .map(({ shift, index }) => {
        const blockClass = shiftBlockClass(shift, emp).replace("rota-shift-block--", "rota-mobile-shift-chip--");
        const body = isDayOffShift(shift)
          ? "Day off"
          : `${escapeHtml(shift.start_time)}–${escapeHtml(shift.end_time)}`;
        const role = escapeHtml(shift.role_label || employeeRoleLabel(emp));
        return `<div class="rota-mobile-shift-chip-wrap">
          <button type="button" class="rota-mobile-shift-chip ${blockClass}" data-mobile-edit-shift="${index}" aria-label="Edit shift for ${escapeHtml(employeeShortName(emp))}">
          <span class="rota-mobile-shift-chip__time">${body}</span>
          <span class="rota-mobile-shift-chip__role">${role}</span>
        </button>
          ${
            readonly
              ? ""
              : `<button type="button" class="rota-mobile-shift-delete" data-mobile-delete-shift="${index}" aria-label="Delete shift for ${escapeHtml(employeeShortName(emp))}">×</button>`
          }
        </div>`;
      })
      .join("");
    const addBtn = readonly
      ? ""
      : `<button type="button" class="rota-mobile-add-btn" data-mobile-add-shift="${emp.id}">+ Add shift</button>`;
    return `<article class="rota-mobile-staff-card">
      <div class="rota-mobile-staff-card__head">
        <span class="rota-staff-avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(employeeInitials(emp))}</span>
        <div class="rota-mobile-staff-card__meta">
          <strong class="rota-mobile-staff-card__name">${escapeHtml(employeeShortName(emp))}</strong>
          <span class="rota-mobile-staff-card__role">${escapeHtml(employeeRoleLabel(emp))}</span>
        </div>
      </div>
      ${shiftChips ? `<div class="rota-mobile-staff-card__shifts">${shiftChips}</div>` : ""}
      ${addBtn}
    </article>`;
  }

  function renderMobileRota() {
    if (!shouldUseMobileRotaBuilder()) return;
    const selectedDay = ensureMobileSelectedDay();
    const weekLabelBtn = document.getElementById("rota-mobile-week-label-btn");
    if (weekLabelBtn) weekLabelBtn.textContent = formatWeekLabel(currentWeekStart);

    const strip = document.getElementById("rota-mobile-day-strip");
    if (strip) {
      strip.innerHTML = weekDayIsos()
        .map((iso) => formatMobileDayPill(iso, iso === selectedDay))
        .join("");
      strip.querySelectorAll("[data-mobile-day]").forEach((btn) => {
        btn.addEventListener("click", () => {
          mobileSelectedDay = btn.getAttribute("data-mobile-day");
          renderMobileRota();
        });
      });
    }

    renderMobileDayStatus(selectedDay);

    const list = document.getElementById("rota-mobile-staff-list");
    if (!list) return;
    const staff = activeEmployees();
    const readonly = isWeekReadOnly();
    if (!staff.length) {
      list.innerHTML =
        '<div class="rota-mobile-empty"><p class="muted">No active employees yet.</p><a class="btn" href="#employees">Add employees</a></div>';
      return;
    }

    list.innerHTML = staff.map((emp) => renderMobileStaffRow(emp, selectedDay, readonly)).join("");

    list.querySelectorAll("[data-mobile-add-shift]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openShiftPanel({
          employeeId: Number(btn.getAttribute("data-mobile-add-shift")),
          shiftDate: selectedDay,
        });
      });
    });
    list.querySelectorAll("[data-mobile-edit-shift]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openShiftPanel({ shiftIndex: Number(btn.getAttribute("data-mobile-edit-shift")) });
      });
    });
    list.querySelectorAll("[data-mobile-delete-shift]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const index = Number(btn.getAttribute("data-mobile-delete-shift"));
        if (!window.confirm("Remove this shift from the draft rota?")) return;
        deleteShift(index);
      });
    });
  }

  function syncMobileNotifyChip() {
    const notify = document.getElementById("rota-notify-staff");
    const chip = document.getElementById("rota-mobile-notify-btn");
    if (!notify || !chip) return;
    const on = Boolean(notify.checked);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
    chip.classList.toggle("is-active", on);
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function isDesktopRotaViewport() {
    return !isMobileViewport();
  }

  function syncViewForViewport() {
    if (isDesktopRotaViewport()) {
      setView("grid");
    }
    renderAll();
  }

  function isMobileRotaUi() {
    return isMobileViewport() && (document.body.dataset.mobileTab === "rota" || activeView === "list");
  }

  function ensureShiftPanelPlacement() {
    const panel = document.getElementById("rota-shift-panel");
    const backdrop = document.getElementById("rota-shift-backdrop");
    const home = document.getElementById("rota-panel-portal-home");
    if (!panel || !backdrop) return;
    const target = isMobileViewport() ? document.body : home;
    if (!target) return;
    if (backdrop.parentElement !== target) {
      target.appendChild(backdrop);
    }
    if (panel.parentElement !== target) {
      target.appendChild(panel);
    }
  }

  function syncPanelOverlay(open) {
    const backdrop = document.getElementById("rota-shift-backdrop");
    if (!backdrop) return;
    if (open && isMobileViewport()) {
      backdrop.removeAttribute("hidden");
      backdrop.setAttribute("aria-hidden", "false");
      document.body.classList.add("rota-shift-panel-open");
      window.ShiftSwiftPortalStability?.lockBodyScroll?.(true);
    } else {
      backdrop.setAttribute("hidden", "");
      backdrop.setAttribute("aria-hidden", "true");
      document.body.classList.remove("rota-shift-panel-open");
      window.ShiftSwiftPortalStability?.lockBodyScroll?.(false);
    }
  }

  const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  function syncRotaWeekStartDay(day) {
    if (day == null || Number.isNaN(Number(day))) return;
    const parsed = Number(day);
    if (parsed >= 0 && parsed <= 6) rotaWeekStartDay = parsed;
  }

  function jsDayFromPythonWeekday(pyDay) {
    return pyDay === 6 ? 0 : pyDay + 1;
  }

  function toLocalIsoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function todayIsoLocal() {
    return toLocalIsoDate(new Date());
  }

  function rotaWeekStartIso(date = new Date(), weekStartDay) {
    const startDay = weekStartDay != null ? weekStartDay : rotaWeekStartDay;
    const d = new Date(date);
    const jsStart = jsDayFromPythonWeekday(startDay);
    const diff = (d.getDay() - jsStart + 7) % 7;
    d.setDate(d.getDate() - diff);
    return toLocalIsoDate(d);
  }

  async function ensureWeekStartAligned() {
    if (window.Admin?.loadTenantFeatures) {
      await window.Admin.loadTenantFeatures();
    }
    syncRotaWeekStartDay(window.Admin?.tenantFeatures?.rota_week_start_day);
    currentWeekStart = rotaWeekStartIso(new Date());
  }

  function parseRotaApiDetail(data, fallback) {
    if (!data || typeof data !== "object") return fallback;
    const detail = data.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
    return fallback;
  }

  function weekRangeShortLabel() {
    const start = WEEKDAY_NAMES[rotaWeekStartDay].slice(0, 3);
    const endDay = (rotaWeekStartDay + 6) % 7;
    const end = WEEKDAY_NAMES[endDay].slice(0, 3);
    return `${start}–${end}`;
  }

  function addDays(isoDate, days) {
    const d = new Date(`${isoDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    return toLocalIsoDate(d);
  }

  function weekEndIso(weekStart) {
    return addDays(weekStart, 6);
  }

  function isWeekFullyPast(weekStart = currentWeekStart) {
    return weekEndIso(weekStart) < todayIsoLocal();
  }

  function isWeekReadOnly() {
    if (rotaPolicy && typeof rotaPolicy.readonly === "boolean") {
      return rotaPolicy.readonly;
    }
    return isWeekFullyPast() && weekMeta?.status === "published";
  }

  function isWeekCopyBlocked() {
    if (rotaPolicy && typeof rotaPolicy.copy_blocked === "boolean") {
      return rotaPolicy.copy_blocked;
    }
    return isWeekFullyPast();
  }

  function readonlyMessage() {
    return (
      rotaPolicy?.readonly_reason ||
      "This published rota is locked because the week has ended. It stays available for attendance and payroll records."
    );
  }

  function copyBlockedMessage() {
    return rotaPolicy?.copy_blocked_reason || "Copying shifts into past weeks is disabled for compliance.";
  }

  function guardWeekEditable(actionLabel = "change this rota") {
    if (!isWeekReadOnly()) return true;
    setMessage(`${readonlyMessage()} Cannot ${actionLabel}.`, "error");
    return false;
  }

  function guardWeekCopy() {
    if (!isWeekCopyBlocked()) return true;
    setMessage(copyBlockedMessage(), "error");
    return false;
  }

  function formatWeekLabel(weekStart) {
    const start = new Date(`${weekStart}T12:00:00`);
    const end = new Date(`${addDays(weekStart, 6)}T12:00:00`);
    const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
    return `${fmt.format(start)} – ${fmt.format(end)} ${start.getFullYear()}`;
  }

  function employeeName(id) {
    const emp = employees.find((e) => Number(e.id) === Number(id));
    if (!emp) return `Employee #${id}`;
    return `${emp.first_name || ""} ${emp.last_name || ""}`.trim() || emp.email || `#${id}`;
  }

  function employeeById(id) {
    return employees.find((e) => Number(e.id) === Number(id));
  }

  function activeEmployees() {
    return employees.filter((e) => ["active", "onboarding", "suspended"].includes(e.status));
  }

  function hasActiveEmployees() {
    return activeEmployees().length > 0;
  }

  function employeeRoleLabel(emp) {
    if (!emp) return "Staff";
    return emp.job_title || emp.department || "Staff";
  }

  function employeeShortName(emp) {
    if (!emp) return "Staff";
    const first = (emp.first_name || "").trim();
    const last = (emp.last_name || "").trim();
    if (first && last) return `${first[0]}. ${last.split(/\s+/)[0]}`;
    return employeeName(emp.id);
  }

  function avatarPalette(employeeId) {
    return AVATAR_PALETTES[Math.abs(Number(employeeId)) % AVATAR_PALETTES.length];
  }

  function employeeInitials(emp) {
    const first = (emp?.first_name || "").trim()[0] || "";
    const last = (emp?.last_name || "").trim()[0] || "";
    return (first + last).toUpperCase() || "?";
  }

  function shiftRoleKey(shift, emp) {
    return (shift.role_label || emp?.job_title || emp?.department || "").toLowerCase();
  }

  function isDayOffShift(shift) {
    const role = (shift.role_label || "").toLowerCase();
    return /day off|off day|annual leave|holiday|unpaid leave/.test(role);
  }

  function shiftBlockClass(shift, emp) {
    if (isDayOffShift(shift)) return "rota-shift-block--off";
    const role = shiftRoleKey(shift, emp);
    if (/kitchen|cook|chef/.test(role)) return "rota-shift-block--kitchen";
    if (/bar|floor|front|wait|server/.test(role)) return "rota-shift-block--floor";
    return "rota-shift-block--default";
  }

  function coverageLevel(count) {
    if (count === 0) return "empty";
    if (count <= 2) return "warn";
    return "ok";
  }

  function gapsOnDate(iso) {
    return (rotaInsights?.coverage_gaps || []).filter((gap) => gap.shift_date === iso).length;
  }

  function coverageLevelForDay(iso, count) {
    if (window.Admin?.tenantFeatures?.rota_advanced_enabled && rotaInsights?.has_template) {
      if (gapsOnDate(iso) > 0) return "warn";
      if (count === 0) return "empty";
      return "ok";
    }
    return coverageLevel(count);
  }

  function templateQuerySuffix() {
    return selectedTemplateId ? `&template_id=${encodeURIComponent(selectedTemplateId)}` : "";
  }

  function parseMinutes(time) {
    const [h, m] = String(time).slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  }

  function shiftsTimeOverlap(a, b) {
    if (Number(a.employee_id) !== Number(b.employee_id) || a.shift_date !== b.shift_date) return false;
    let a0 = parseMinutes(a.start_time);
    let a1 = parseMinutes(a.end_time);
    let b0 = parseMinutes(b.start_time);
    let b1 = parseMinutes(b.end_time);
    if (a1 <= a0) a1 += 24 * 60;
    if (b1 <= b0) b1 += 24 * 60;
    return a0 < b1 && b0 < a1;
  }

  function getFormShiftCandidate() {
    const employeeId = document.getElementById("rota-add-employee")?.value;
    const shiftDate = document.getElementById("rota-add-day")?.value;
    const startTime = document.getElementById("rota-add-start")?.value;
    const endTime = document.getElementById("rota-add-end")?.value;
    const roleLabel = document.getElementById("rota-add-role")?.value?.trim() || "";
    const notes = document.getElementById("rota-add-notes")?.value?.trim() || "";
    if (!employeeId || !shiftDate || !startTime || !endTime) return null;
    return {
      employee_id: Number(employeeId),
      shift_date: shiftDate,
      start_time: startTime.slice(0, 5),
      end_time: endTime.slice(0, 5),
      role_label: roleLabel,
      notes,
    };
  }

  function findFormOverlap() {
    const candidate = getFormShiftCandidate();
    if (!candidate) return null;
    if (candidate.start_time === candidate.end_time) return "Start and end time cannot be the same";
    const empName = employeeName(candidate.employee_id);
    for (let i = 0; i < shifts.length; i += 1) {
      if (i === editingShiftIndex) continue;
      if (Number(shifts[i].employee_id) !== Number(candidate.employee_id)) continue;
      if (!shiftsTimeOverlap(candidate, shifts[i])) continue;
      const dayLabel = new Date(`${shifts[i].shift_date}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      return `${empName} already has a shift on ${dayLabel}, ${shifts[i].start_time}–${shifts[i].end_time}. Change the time or pick another employee.`;
    }
    return null;
  }

  function setOverlapStatus(el, type, message) {
    if (!message) {
      el.textContent = "";
      el.className = "rota-overlap-status";
      return;
    }
    const icon = type === "error" ? "⚠" : "✓";
    el.className = `rota-overlap-status rota-overlap-status--${type}`;
    el.innerHTML = `<span class="rota-overlap-status__icon${
      type === "ok" ? " rota-overlap-status__icon--ok" : ""
    }" aria-hidden="true">${icon}</span><span class="rota-overlap-status__text">${escapeHtml(message)}</span>`;
  }

  function updateOverlapStatus() {
    const el = document.getElementById("rota-overlap-status");
    const addBtn = document.getElementById("rota-add-btn");
    const headSave = document.getElementById("rota-shift-head-save");
    if (!el) return;
    const overlap = findFormOverlap();
    if (!getFormShiftCandidate()) {
      setOverlapStatus(el, "", "");
      if (addBtn) addBtn.disabled = false;
      if (headSave) headSave.disabled = false;
      return;
    }
    if (overlap) {
      setOverlapStatus(el, "error", overlap);
      if (addBtn) addBtn.disabled = true;
      if (headSave) headSave.disabled = true;
    } else {
      setOverlapStatus(el, "ok", "No double-booking for this employee — others can work the same hours");
      if (addBtn) addBtn.disabled = false;
      if (headSave) headSave.disabled = false;
    }
  }

  function timeSelectOptions(selected = "09:00") {
    const parts = [];
    for (let hour = 0; hour < 24; hour += 1) {
      for (const minute of [0, 30]) {
        const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        parts.push(
          `<option value="${value}"${value === selected.slice(0, 5) ? " selected" : ""}>${value}</option>`
        );
      }
    }
    return parts.join("");
  }

  function populateTimeSelects(start = "09:00", end = "17:00") {
    const startEl = document.getElementById("rota-add-start");
    const endEl = document.getElementById("rota-add-end");
    if (startEl) startEl.innerHTML = timeSelectOptions(start);
    if (endEl) endEl.innerHTML = timeSelectOptions(end);
    updateShiftDurationLabel();
  }

  function shiftDurationMinutes(start, end) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    return mins;
  }

  function formatDuration(mins) {
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
    return `${hours}h ${minutes}m`;
  }

  function updateShiftDurationLabel() {
    const el = document.getElementById("rota-shift-duration");
    const start = document.getElementById("rota-add-start")?.value;
    const end = document.getElementById("rota-add-end")?.value;
    if (!el || !start || !end) return;
    el.textContent = formatDuration(shiftDurationMinutes(start, end));
    updateOverlapStatus();
  }

  function roleSuggestions() {
    const values = new Set(DEFAULT_ROLE_SUGGESTIONS);
    employees.forEach((emp) => {
      if (emp.job_title) values.add(emp.job_title);
      if (emp.department) values.add(emp.department);
    });
    return [...values].sort((a, b) => a.localeCompare(b));
  }

  function populateRoleSuggestions() {
    const list = document.getElementById("rota-role-suggestions");
    if (!list) return;
    list.innerHTML = roleSuggestions().map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  }

  function roleFromEmployee(employeeId) {
    const emp = employeeById(employeeId);
    if (!emp) return "";
    return emp.job_title || emp.department || "";
  }

  function applyRoleFromEmployee(employeeId) {
    const roleInput = document.getElementById("rota-add-role");
    if (!roleInput) return;
    roleInput.value = roleFromEmployee(employeeId);
  }

  function prefillRoleFromEmployee(employeeId) {
    const roleInput = document.getElementById("rota-add-role");
    if (!roleInput || roleInput.value.trim()) return;
    roleInput.value = roleFromEmployee(employeeId);
  }

  function setMessage(text, type = "info") {
    const el = document.getElementById("rota-admin-message");
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.className = "rota-admin-message";
      el.dataset.type = "info";
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.dataset.type = type;
    el.className = `rota-admin-message rota-admin-message--${type}`;
  }

  function cloneShift(shift) {
    const copy = { ...shift };
    delete copy.id;
    return copy;
  }

  function shiftWouldOverlap(candidate, excludeIndex = null) {
    for (let i = 0; i < shifts.length; i += 1) {
      if (i === excludeIndex) continue;
      if (shiftsTimeOverlap(candidate, shifts[i])) return shifts[i];
    }
    return null;
  }

  function weekDayIsos() {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  }

  function assignShiftEmployee(shift, employeeId) {
    shift.employee_id = employeeId;
    shift.employee_name = employeeName(employeeId);
    shift.role_label = roleFromEmployee(employeeId);
    return shift;
  }

  function moveShift(index, employeeId, shiftDate) {
    if (!guardWeekEditable("move shifts")) return false;
    const shift = shifts[index];
    if (!shift) return false;
    const next = { ...shift, shift_date: shiftDate };
    assignShiftEmployee(next, employeeId);
    const clash = shiftWouldOverlap(next, index);
    if (clash) {
      setMessage(`Cannot move — ${employeeName(next.employee_id)} already has a shift ${clash.start_time}–${clash.end_time} that day`, "error");
      return false;
    }
    shifts[index] = next;
    markDirty();
    setMessage("Shift moved — click Save draft.", "success");
    renderAll();
    return true;
  }

  function copyShift(index, employeeId, shiftDate) {
    if (!guardWeekEditable("copy shifts")) return false;
    const source = shifts[index];
    if (!source) return false;
    const copy = cloneShift(source);
    copy.shift_date = shiftDate;
    assignShiftEmployee(copy, employeeId);
    const clash = shiftWouldOverlap(copy);
    if (clash) {
      setMessage(`Cannot copy — ${employeeName(copy.employee_id)} already has a shift ${clash.start_time}–${clash.end_time} that day`, "error");
      return false;
    }
    shifts.push(copy);
    shifts.sort((a, b) => `${a.shift_date}${a.start_time}`.localeCompare(`${b.shift_date}${b.start_time}`));
    markDirty();
    setMessage("Shift copied — click Save draft.", "success");
    renderAll();
    return true;
  }

  function deleteShift(index) {
    if (!guardWeekEditable("remove shifts")) return;
    if (!shifts[index]) return;
    shifts.splice(index, 1);
    markDirty();
    setMessage("Shift removed — click Save draft.", "success");
    renderAll();
  }

  function deleteShiftFromPanel() {
    if (editingShiftIndex == null) return;
    if (!guardWeekEditable("remove shifts")) return;
    if (!window.confirm("Remove this shift from the draft rota?")) return;
    deleteShift(editingShiftIndex);
    closeShiftPanel();
  }

  function copyShiftToTargets(index, { dayIsos = [], employeeIds = [] } = {}) {
    if (!guardWeekEditable("copy shifts")) return;
    const source = shifts[index];
    if (!source) return;
    const days = dayIsos.length ? dayIsos : [source.shift_date];
    const employees = employeeIds.length ? employeeIds.map(Number) : [Number(source.employee_id)];
    let added = 0;
    let skipped = 0;
    days.forEach((iso) => {
      employees.forEach((empId) => {
        if (Number(empId) === Number(source.employee_id) && iso === source.shift_date) return;
        const copy = cloneShift(source);
        copy.shift_date = iso;
        assignShiftEmployee(copy, empId);
        if (shiftWouldOverlap(copy)) {
          skipped += 1;
          return;
        }
        shifts.push(copy);
        added += 1;
      });
    });
    if (!added) {
      setMessage(
        skipped > 0
          ? `No shifts copied — ${skipped} slot${skipped === 1 ? "" : "s"} would overlap.`
          : "Select at least one day or employee to copy to.",
        "error",
      );
      return;
    }
    shifts.sort((a, b) => `${a.shift_date}${a.start_time}`.localeCompare(`${b.shift_date}${b.start_time}`));
    markDirty();
    const skippedNote = skipped > 0 ? ` (${skipped} skipped — overlap)` : "";
    setMessage(`${added} shift${added === 1 ? "" : "s"} copied${skippedNote} — click Save draft.`, "success");
    renderAll();
  }

  function copyShiftToDays(index, dayIsos) {
    const source = shifts[index];
    if (!source) return;
    copyShiftToTargets(index, { dayIsos, employeeIds: [source.employee_id] });
  }

  function copyShiftToRestOfWeek(index) {
    const source = shifts[index];
    if (!source) return;
    const targets = weekDayIsos().filter((iso) => iso !== source.shift_date);
    copyShiftToDays(index, targets);
  }

  function quickAddShift(employeeId, shiftDate) {
    if (!guardWeekEditable("add shifts")) return;
    const emp = employeeById(employeeId);
    const roleLabel = emp?.job_title || emp?.department || "";
    const candidate = {
      employee_id: employeeId,
      shift_date: shiftDate,
      start_time: "09:00",
      end_time: "17:00",
      role_label: roleLabel,
      notes: "",
      employee_name: employeeName(employeeId),
    };
    const clash = shiftWouldOverlap(candidate);
    if (clash) {
      setMessage(`Cannot add — ${employeeName(candidate.employee_id)} already has a shift ${clash.start_time}–${clash.end_time} that day`, "error");
      openShiftPanel({ employeeId, shiftDate });
      return;
    }
    shifts.push(candidate);
    shifts.sort((a, b) => `${a.shift_date}${a.start_time}`.localeCompare(`${b.shift_date}${b.start_time}`));
    markDirty();
    setMessage("Shift added — click Save draft.", "success");
    renderAll();
  }

  function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.hidden = true;
  }

  function ensureContextMenu() {
    if (contextMenuEl) return contextMenuEl;
    contextMenuEl = document.createElement("div");
    contextMenuEl.id = "rota-context-menu";
    contextMenuEl.className = "rota-context-menu";
    contextMenuEl.hidden = true;
    document.body.appendChild(contextMenuEl);
    document.addEventListener("click", hideContextMenu);
    const scrollRoot = document.querySelector("main.content") || document.querySelector(".rota-shifts-table-wrap");
    scrollRoot?.addEventListener("scroll", hideContextMenu, { passive: true });
    return contextMenuEl;
  }

  function showContextMenu(event, shiftIndex) {
    if (isWeekReadOnly()) return;
    event.preventDefault();
    const menu = ensureContextMenu();
    menu.innerHTML = `
      <button type="button" data-rota-ctx="copy-days">Copy shift…</button>
      <button type="button" data-rota-ctx="copy-week">Copy to rest of week</button>
      <button type="button" data-rota-ctx="edit">Edit shift</button>
      <button type="button" data-rota-ctx="delete" class="rota-context-menu__danger">Delete shift</button>`;
    menu.hidden = false;
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        hideContextMenu();
        const action = btn.getAttribute("data-rota-ctx");
        if (action === "copy-days") showCopyShiftModal(shiftIndex);
        else if (action === "copy-week") copyShiftToRestOfWeek(shiftIndex);
        else if (action === "edit") openShiftPanel({ shiftIndex });
        else if (action === "delete") deleteShift(shiftIndex);
      });
    });
  }

  function ensureCopyModal() {
    if (copyModalEl) return copyModalEl;
    copyModalEl = document.createElement("div");
    copyModalEl.id = "rota-copy-modal";
    copyModalEl.className = "rota-copy-modal";
    copyModalEl.hidden = true;
    copyModalEl.innerHTML = `
      <div class="rota-copy-modal__backdrop" data-close-copy-modal></div>
      <div class="rota-copy-modal__panel" role="dialog" aria-labelledby="rota-copy-modal-title">
        <h3 id="rota-copy-modal-title">Copy shift</h3>
        <p class="muted rota-copy-modal__lead">Duplicate start time, end time, and role to other days and/or staff.</p>
        <div class="rota-copy-modal__section">
          <p class="rota-copy-modal__section-title">Days</p>
          <div id="rota-copy-modal-days" class="rota-copy-modal__days"></div>
        </div>
        <div class="rota-copy-modal__section">
          <p class="rota-copy-modal__section-title">Employees</p>
          <p class="muted rota-copy-modal__lead">Leave empty to keep the same person. Select others to copy this shift to them too.</p>
          <div id="rota-copy-modal-employees" class="rota-copy-modal__employees"></div>
        </div>
        <div class="rota-copy-modal__foot">
          <button type="button" class="btn ghost" data-close-copy-modal>Cancel</button>
          <button type="button" class="btn primary" id="rota-copy-modal-confirm">Copy shifts</button>
        </div>
      </div>`;
    document.body.appendChild(copyModalEl);
    copyModalEl.querySelectorAll("[data-close-copy-modal]").forEach((el) => {
      el.addEventListener("click", () => {
        copyModalEl.hidden = true;
      });
    });
    return copyModalEl;
  }

  function showCopyShiftModal(shiftIndex) {
    const modal = ensureCopyModal();
    const daysHost = modal.querySelector("#rota-copy-modal-days");
    const employeesHost = modal.querySelector("#rota-copy-modal-employees");
    const shift = shifts[shiftIndex];
    if (!daysHost || !employeesHost || !shift) return;
    daysHost.innerHTML = weekDayIsos()
      .map((iso) => {
        const label = new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "short",
        });
        const checked = iso === shift.shift_date ? " checked" : "";
        return `<label class="rota-copy-day"><input type="checkbox" value="${iso}"${checked} /><span class="rota-copy-day__text">${escapeHtml(label)}</span></label>`;
      })
      .join("");
    employeesHost.innerHTML = activeEmployees()
      .map((emp) => {
        const label = `${employeeShortName(emp)} — ${employeeRoleLabel(emp)}`;
        const isSource = Number(emp.id) === Number(shift.employee_id);
        const checked = isSource ? " checked disabled" : "";
        return `<label class="rota-copy-day"><input type="checkbox" value="${emp.id}"${checked} /><span class="rota-copy-day__text">${escapeHtml(label)}</span></label>`;
      })
      .join("");
    modal.hidden = false;
    const confirm = modal.querySelector("#rota-copy-modal-confirm");
    confirm.onclick = () => {
      const selectedDays = [...daysHost.querySelectorAll("input:checked")].map((input) => input.value);
      const extraEmployees = [...employeesHost.querySelectorAll("input:checked:not(:disabled)")].map((input) =>
        Number(input.value),
      );
      modal.hidden = true;
      if (!selectedDays.length && !extraEmployees.length) {
        setMessage("Select at least one day or employee.", "error");
        return;
      }
      copyShiftToTargets(shiftIndex, {
        dayIsos: selectedDays.length ? selectedDays : [shift.shift_date],
        employeeIds: extraEmployees.length ? extraEmployees : [Number(shift.employee_id)],
      });
    };
  }

  function showCopyDaysModal(shiftIndex) {
    showCopyShiftModal(shiftIndex);
  }

  function renderBulkTimesSection() {
    const host = document.getElementById("rota-bulk-days");
    const section = document.getElementById("rota-bulk-times");
    if (!host || !section) return;
    const candidate = getFormShiftCandidate();
    if (!candidate?.employee_id || isWeekReadOnly()) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    host.innerHTML = weekDayIsos()
      .map((iso) => {
        const label = new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
        });
        const isCurrent = iso === candidate.shift_date;
        return `<label class="rota-bulk-day"><input type="checkbox" value="${iso}"${isCurrent ? " checked" : ""} /><span>${escapeHtml(label)}</span></label>`;
      })
      .join("");
  }

  function applyBulkTimesFromPanel() {
    if (!guardWeekEditable("apply bulk times")) return;
    const candidate = getFormShiftCandidate();
    if (!candidate) {
      setMessage("Set employee, day, start, and end first.", "error");
      return;
    }
    if (candidate.start_time === candidate.end_time) {
      setMessage("Start and end time cannot be the same.", "error");
      return;
    }
    const dayIsos = [...document.querySelectorAll("#rota-bulk-days input:checked")].map((el) => el.value);
    if (!dayIsos.length) {
      setMessage("Select at least one day to apply times to.", "error");
      return;
    }
    let updated = 0;
    let created = 0;
    let skipped = 0;
    dayIsos.forEach((iso) => {
      if (iso === candidate.shift_date && editingShiftIndex != null && shifts[editingShiftIndex]) {
        const trial = { ...shifts[editingShiftIndex], ...payload };
        if (shiftWouldOverlap(trial, editingShiftIndex)) {
          skipped += 1;
          return;
        }
        shifts[editingShiftIndex] = trial;
        updated += 1;
        return;
      }
      const existingIndex = shifts.findIndex(
        (s, idx) =>
          Number(s.employee_id) === Number(candidate.employee_id) &&
          s.shift_date === iso &&
          idx !== editingShiftIndex,
      );
      const payload = {
        employee_id: candidate.employee_id,
        shift_date: iso,
        start_time: candidate.start_time,
        end_time: candidate.end_time,
        role_label: candidate.role_label,
        notes: candidate.notes,
        employee_name: employeeName(candidate.employee_id),
      };
      if (existingIndex >= 0) {
        const trial = { ...shifts[existingIndex], ...payload };
        if (shiftWouldOverlap(trial, existingIndex)) {
          skipped += 1;
          return;
        }
        shifts[existingIndex] = trial;
        updated += 1;
        return;
      }
      if (shiftWouldOverlap(payload)) {
        skipped += 1;
        return;
      }
      shifts.push(payload);
      created += 1;
    });
    if (!updated && !created) {
      setMessage(
        skipped > 0
          ? `Could not apply — ${skipped} day${skipped === 1 ? "" : "s"} would overlap.`
          : "Nothing to apply.",
        "error",
      );
      return;
    }
    shifts.sort((a, b) => `${a.shift_date}${a.start_time}`.localeCompare(`${b.shift_date}${b.start_time}`));
    markDirty();
    const parts = [];
    if (updated) parts.push(`${updated} updated`);
    if (created) parts.push(`${created} added`);
    setMessage(
      `Bulk times: ${parts.join(", ")}${skipped ? ` · ${skipped} skipped` : ""} — click Save draft.`,
      "success",
    );
    renderAll();
    renderBulkTimesSection();
    updateOverlapStatus();
  }

  function markDirty() {
    dirty = true;
  }

  function markClean() {
    dirty = false;
  }

  function renderStatusBadge() {
    const status = document.getElementById("rota-week-status");
    if (!status) return;
    if (weekMeta?.status === "published") {
      status.innerHTML = isWeekReadOnly()
        ? '<span class="rota-status-badge rota-status-badge--locked">Locked</span>'
        : '<span class="rota-status-badge rota-status-badge--published">Published</span>';
      return;
    }
    status.innerHTML = '<span class="rota-status-badge rota-status-badge--draft">Draft</span>';
  }

  function updateReadOnlyUi() {
    const readonly = isWeekReadOnly();
    const copyBlocked = isWeekCopyBlocked();
    const notice = document.getElementById("rota-readonly-notice");
    if (notice) {
      if (readonly) {
        notice.hidden = false;
        notice.textContent = readonlyMessage();
      } else if (copyBlocked) {
        notice.hidden = false;
        notice.textContent = `${copyBlockedMessage()} You can still save draft changes if this week was never published.`;
      } else {
        notice.hidden = true;
        notice.textContent = "";
      }
    }
    document.body.classList.toggle("rota-week-readonly", readonly);

    ["rota-save-btn", "rota-clear-btn", "rota-publish-btn", "rota-mobile-save-btn", "rota-mobile-publish-btn"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = readonly;
    });

    const copyBtn = document.getElementById("rota-copy-prev-btn");
    const mobileCopyBtn = document.getElementById("rota-mobile-copy-prev");
    [copyBtn, mobileCopyBtn].forEach((btn) => {
      if (!btn) return;
      btn.disabled = copyBlocked;
      btn.title = copyBlocked ? copyBlockedMessage() : "Copy all shifts from the previous week";
    });

    if (readonly && panelOpen) closeShiftPanel();
  }

  function updateHeader() {
    document.getElementById("rota-week-label").textContent = formatWeekLabel(currentWeekStart);
    renderStatusBadge();
    const publishBtn = document.getElementById("rota-publish-btn");
    const mobilePublishBtn = document.getElementById("rota-mobile-publish-btn");
    const canPublish = Boolean(
      weekMeta?.version && weekMeta.status !== "published" && shifts.length && !isWeekReadOnly(),
    );
    [publishBtn, mobilePublishBtn].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !canPublish;
      btn.title = isWeekReadOnly()
        ? readonlyMessage()
        : canPublish
          ? dirty
            ? "Save draft and publish so staff see shifts in Time Clock"
            : "Publish so staff see shifts in Time Clock"
          : !shifts.length
            ? "Add shifts before publishing"
            : weekMeta?.status === "published"
              ? "Already published"
              : "Save the rota before publishing";
    });
    updateReadOnlyUi();
  }

  function renderWeekSummary() {
    const el = document.getElementById("rota-week-summary");
    if (!el) return;
    const staff = activeEmployees();
    const shiftCount = shifts.length;
    const scheduledStaff = new Set(shifts.map((s) => s.employee_id)).size;
    if (!staff.length) {
      el.textContent = "";
      return;
    }
    const weekLabel = formatWeekLabel(currentWeekStart);
    if (!shiftCount) {
      el.textContent = `0 shifts · ${staff.length} staff · ${weekLabel}`;
      return;
    }
    el.textContent = `${shiftCount} shift${shiftCount === 1 ? "" : "s"} · ${scheduledStaff} staff · ${weekLabel}`;
  }

  function isRotaSectionActive() {
    const section = document.getElementById("rota");
    return Boolean(section && !section.hidden);
  }

  function syncPanelVisibility() {
    const panel = document.getElementById("rota-shift-panel");
    if (!panel) return;
    if (!isRotaSectionActive() && panelOpen) {
      panelOpen = false;
      editingShiftIndex = null;
    }
    const showPanel =
      isRotaSectionActive() &&
      hasActiveEmployees() &&
      panelOpen &&
      !isWeekReadOnly() &&
      (activeView === "grid" || isMobileViewport());
    if (showPanel) {
      panel.removeAttribute("hidden");
      restorePanelPosition();
    } else {
      panel.setAttribute("hidden", "");
    }
    syncPanelOverlay(showPanel);
    ensureShiftPanelPlacement();
  }

  const PANEL_POS_KEY = "rota-shift-panel-position";

  function restorePanelPosition() {
    if (!isDesktopRotaViewport()) return;
    const panel = document.getElementById("rota-shift-panel");
    if (!panel) return;
    try {
      const raw = sessionStorage.getItem(PANEL_POS_KEY);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (typeof pos.left !== "number" || typeof pos.top !== "number") return;
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
      panel.style.right = "auto";
      panel.classList.add("rota-shift-panel--positioned");
    } catch {
      /* ignore */
    }
  }

  function savePanelPosition(panel) {
    if (!panel || !isDesktopRotaViewport()) return;
    const left = parseFloat(panel.style.left);
    const top = parseFloat(panel.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      sessionStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left, top }));
    }
  }

  function initPanelDrag() {
    const panel = document.getElementById("rota-shift-panel");
    const head = panel?.querySelector(".rota-shift-panel__head");
    if (!panel || !head || head.dataset.dragBound === "1") return;
    head.dataset.dragBound = "1";
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    head.addEventListener("mousedown", (event) => {
      if (!isDesktopRotaViewport()) return;
      if (event.button !== 0 || event.target.closest("button")) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.classList.add("rota-shift-panel--positioned", "rota-shift-panel--dragging");
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      const maxLeft = window.innerWidth - panel.offsetWidth - 8;
      const maxTop = window.innerHeight - panel.offsetHeight - 8;
      const left = Math.max(8, Math.min(maxLeft, startLeft + event.clientX - startX));
      const top = Math.max(8, Math.min(maxTop, startTop + event.clientY - startY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("rota-shift-panel--dragging");
      savePanelPosition(panel);
    });
  }

  function renderEmptyState() {
    const empty = document.getElementById("rota-empty-state");
    const grid = document.getElementById("rota-grid");
    const hasStaff = hasActiveEmployees();
    if (empty) {
      empty.hidden = hasStaff;
      empty.toggleAttribute("hidden", hasStaff);
    }
    if (grid) {
      grid.hidden = !hasStaff;
      grid.toggleAttribute("hidden", !hasStaff);
    }
    if (!hasStaff) {
      panelOpen = false;
      syncPanelVisibility();
    }
  }

  function attendanceForShift(shift) {
    const key = shift.id != null ? String(shift.id) : `${shift.employee_id}-${shift.shift_date}-${shift.start_time}`;
    return attendanceByShiftId.get(key);
  }

  function renderAttendanceTable(items) {
    const panel = document.getElementById("rota-attendance-panel");
    const tbody = document.getElementById("rota-attendance-body");
    const sub = document.getElementById("rota-attendance-sub");
    if (!panel || !tbody) return;
    if (!items?.length || weekMeta?.status !== "published") {
      panel.hidden = true;
      return;
    }
    const flagged = items.filter((row) => row.attendance_status !== "scheduled");
    if (!flagged.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    if (sub) {
      sub.textContent = `${flagged.length} shift${flagged.length === 1 ? "" : "s"} with attendance activity — upcoming scheduled shifts stay in the list above.`;
    }
    renderTableBody(tbody, {
      emptyMessage: "No attendance flags this week.",
      columns: [
        {
          key: "shift_date",
          render: (r) =>
            new Date(`${r.shift_date}T12:00:00`).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
            }),
        },
        { key: "employee_name", render: (r) => escapeHtml(r.employee_name || "") },
        {
          key: "shift",
          render: (r) => `${escapeHtml(r.start_time)}–${escapeHtml(r.end_time)}`,
        },
        {
          key: "attendance_status",
          render: (r) => attendanceStatusPill(r),
        },
        {
          key: "attendance_detail",
          render: (r) => {
            const detail = escapeHtml(r.attendance_detail || "");
            const canOpen = r.shift_date && (r.employee_id || r.employee_name);
            if (!canOpen) return detail;
            return `${detail} <button type="button" class="btn link rota-punch-link" data-rota-punch-employee="${r.employee_id || ""}" data-rota-punch-date="${escapeHtml(r.shift_date)}">View punches</button>`;
          },
        },
      ],
      rows: flagged,
    });
    tbody.querySelectorAll("tr").forEach((row, index) => {
      const item = flagged[index];
      if (!item?.shift_date) return;
      row.classList.add("rota-attendance-row");
      row.addEventListener("click", (event) => {
        if (event.target.closest(".rota-punch-link")) return;
        openPunchRecordsForShift(item.employee_id, item.shift_date);
      });
      row.setAttribute("tabindex", "0");
      row.setAttribute("role", "button");
      row.setAttribute(
        "aria-label",
        `View punch records for ${item.employee_name || "employee"} on ${item.shift_date}`
      );
    });
    tbody.querySelectorAll(".rota-punch-link").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        openPunchRecordsForShift(
          Number(btn.getAttribute("data-rota-punch-employee")) || null,
          btn.getAttribute("data-rota-punch-date")
        );
      });
    });
  }

  function renderShiftCards() {
    const host = document.getElementById("rota-shifts-cards");
    const tableWrap = document.querySelector(".rota-shifts-table-wrap");
    const useCards = window.matchMedia("(max-width: 860px)").matches;
    if (!host) return;
    if (tableWrap) tableWrap.hidden = useCards;
    host.hidden = !useCards;
    if (!useCards) return;

    if (!hasActiveEmployees()) {
      host.innerHTML = '<p class="muted">No active employees — open the Employees section to add team members.</p>';
      return;
    }
    const readonly = isWeekReadOnly();
    if (!shifts.length) {
      host.innerHTML = readonly
        ? '<p class="muted">No shifts this week.</p>'
        : `<div class="rota-list-empty">
        <p class="muted">No shifts this week.</p>
        <button type="button" class="btn primary" id="rota-empty-add-shift">+ Add shift</button>
      </div>`;
      if (!readonly) {
        document.getElementById("rota-empty-add-shift")?.addEventListener("click", () => openShiftPanel());
      }
      return;
    }

    host.innerHTML = shifts
      .map((shift, index) => {
        const day = new Date(`${shift.shift_date}T12:00:00`).toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        });
        const name = escapeHtml(shift.employee_name || employeeName(shift.employee_id));
        const role = escapeHtml(shift.role_label || "General");
        return `
          <article class="rota-shift-card">
            <div class="rota-shift-card__main">
              <span class="rota-shift-card__day">${escapeHtml(day)}</span>
              <span class="rota-shift-card__name">${name}</span>
              <span class="rota-shift-card__time">${escapeHtml(shift.start_time)} – ${escapeHtml(shift.end_time)}</span>
              <span class="rota-shift-card__role muted">${role}</span>
            </div>
            <div class="rota-shift-card__actions">
              ${
                readonly
                  ? ""
                  : `<button type="button" class="btn ghost btn-sm" data-rota-edit="${index}">Edit</button>
              <button type="button" class="btn btn--ghost btn--danger btn-sm" data-rota-remove="${index}">Remove</button>`
              }
            </div>
          </article>`;
      })
      .join("");

    host.querySelectorAll("[data-rota-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        deleteShift(Number(btn.getAttribute("data-rota-remove")));
      });
    });
    host.querySelectorAll("[data-rota-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openShiftPanel({ shiftIndex: Number(btn.getAttribute("data-rota-edit")) });
      });
    });
  }

  function renderShiftTable() {
    renderShiftCards();
    const tbody = document.getElementById("rota-shifts-body");
    if (!tbody || window.matchMedia("(max-width: 860px)").matches) return;
    const readonly = isWeekReadOnly();
    const columns = [
      {
        key: "shift_date",
        render: (r) =>
          new Date(`${r.shift_date}T12:00:00`).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
          }),
      },
      { key: "employee_name", render: (r) => escapeHtml(r.employee_name || employeeName(r.employee_id)) },
      { key: "start_time", render: (r) => escapeHtml(r.start_time) },
      { key: "end_time", render: (r) => escapeHtml(r.end_time) },
      { key: "role_label", render: (r) => formatRoleLabel(r.role_label) },
      {
        key: "punch",
        render: (r) => {
          const a = attendanceForShift(r);
          return a ? attendanceStatusPill(a) : "—";
        },
      },
    ];
    if (!readonly) {
      columns.push({
        key: "actions",
        render: (r) => {
          const index = shifts.indexOf(r);
          return `<button type="button" class="btn ghost btn-sm" data-rota-edit="${index}">Edit</button> <button type="button" class="btn btn--ghost btn--danger btn-sm" data-rota-remove="${index}">Remove</button>`;
        },
      });
    }
    renderTableBody(tbody, {
      emptyMessage: hasActiveEmployees()
        ? readonly
          ? "No shifts this week."
          : "No shifts this week — click + in the grid to add one."
        : "No active employees — open the Employees section to add team members.",
      columns,
      rows: shifts,
    });
    tbody.querySelectorAll("[data-rota-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        deleteShift(Number(btn.getAttribute("data-rota-remove")));
      });
    });
    tbody.querySelectorAll("[data-rota-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openShiftPanel({ shiftIndex: Number(btn.getAttribute("data-rota-edit")) });
      });
    });
  }

  function shiftsOnDate(iso) {
    return shifts.filter((s) => s.shift_date === iso).length;
  }

  function renderGrid() {
    const grid = document.getElementById("rota-grid");
    if (!grid) return;
    renderEmptyState();
    if (!hasActiveEmployees()) return;

    const readonly = isWeekReadOnly();
    grid.classList.toggle("rota-grid--readonly", readonly);

    const days = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
    const todayIso = todayIsoLocal();
    const staff = activeEmployees();

    let html = '<div class="rota-grid-header"><div class="rota-gh-cell">Staff</div>';
    days.forEach((iso) => {
      const label = new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
      });
      const count = shiftsOnDate(iso);
      const level = coverageLevelForDay(iso, count);
      const gapNote =
        window.Admin?.tenantFeatures?.rota_advanced_enabled && gapsOnDate(iso) > 0
          ? ` · ${gapsOnDate(iso)} gap${gapsOnDate(iso) === 1 ? "" : "s"}`
          : "";
      const todayClass = iso === todayIso ? " rota-gh-cell--today" : "";
      html += `<div class="rota-gh-cell${todayClass}">
        <span class="rota-day-sub">${escapeHtml(label)}</span>
        <span class="rota-day-cov"><span class="rota-cov-dot rota-cov-dot--${level}" aria-hidden="true"></span>${count} shift${count === 1 ? "" : "s"}${gapNote}</span>
      </div>`;
    });
    html += "</div>";

    staff.forEach((emp) => {
      const palette = avatarPalette(emp.id);
      html += `<div class="rota-staff-row" data-employee-id="${emp.id}">
        <div class="rota-staff-name-cell">
          <span class="rota-staff-avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(employeeInitials(emp))}</span>
          <span><span class="rota-staff-name">${escapeHtml(employeeShortName(emp))}</span><span class="rota-staff-role">${escapeHtml(employeeRoleLabel(emp))}</span></span>
        </div>`;
      days.forEach((iso) => {
        const cellShifts = shifts
          .map((s, index) => ({ s, index }))
          .filter(({ s }) => Number(s.employee_id) === Number(emp.id) && s.shift_date === iso);
        html += `<div class="rota-shift-cell rota-grid-drop" data-employee-id="${emp.id}" data-shift-date="${iso}">`;
        cellShifts.forEach(({ s, index }) => {
          const a = attendanceForShift(s);
          const attendClass =
            a?.attendance_status === "no_show" ||
            a?.attendance_status === "late" ||
            a?.attendance_status === "attended"
              ? ` rota-shift-block--${a.attendance_status}`
              : "";
          const blockClass = shiftBlockClass(s, emp);
          const roleText = escapeHtml(s.role_label || employeeRoleLabel(emp));
          const blockBody = isDayOffShift(s)
            ? "Day off"
            : `${escapeHtml(s.start_time)}–${escapeHtml(s.end_time)}<span class="rota-shift-block-role">${roleText}</span>`;
          html += `<div class="rota-shift-wrap">
            <button type="button" class="rota-shift-block ${blockClass}${attendClass}" draggable="${readonly ? "false" : "true"}" data-shift-index="${index}" title="${readonly ? "View only" : "Drag to move · Alt+drag to copy"}">${blockBody}</button>
            ${
              readonly
                ? ""
                : `<div class="rota-shift-actions">
              <button type="button" class="rota-shift-action" data-copy-shift="${index}" title="Copy shift to days or staff" aria-label="Copy shift">⧉</button>
              <button type="button" class="rota-shift-action rota-shift-action--danger" data-delete-shift="${index}" title="Delete shift" aria-label="Delete shift">×</button>
            </div>`
            }
          </div>`;
        });
        if (!readonly) {
          html += `<span class="rota-add-cell-hint">+ add</span>`;
        }
        html += "</div>";
      });
      html += "</div>";
    });

    grid.innerHTML = html;

    grid.querySelectorAll(".rota-shift-block").forEach((chip) => {
      chip.addEventListener("dragstart", (event) => {
        dragShiftIndex = Number(chip.getAttribute("data-shift-index"));
        dragCopyMode = Boolean(event.altKey);
        event.dataTransfer?.setData("text/plain", String(dragShiftIndex));
        event.dataTransfer?.setData("application/x-rota-copy", dragCopyMode ? "1" : "0");
        if (dragCopyMode) {
          chip.classList.add("rota-shift-block--drag-copy");
        }
      });
      chip.addEventListener("dragend", () => {
        dragCopyMode = false;
        chip.classList.remove("rota-shift-block--drag-copy");
        grid.querySelectorAll(".rota-grid-drop").forEach((cell) => {
          cell.classList.remove("is-drag-over", "is-drag-over-copy");
        });
      });
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        openShiftPanel({ shiftIndex: Number(chip.getAttribute("data-shift-index")) });
      });
      chip.addEventListener("contextmenu", (event) => {
        showContextMenu(event, Number(chip.getAttribute("data-shift-index")));
      });
    });

    grid.querySelectorAll("[data-copy-shift]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        showCopyShiftModal(Number(btn.getAttribute("data-copy-shift")));
      });
    });

    grid.querySelectorAll("[data-delete-shift]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteShift(Number(btn.getAttribute("data-delete-shift")));
      });
    });

    grid.querySelectorAll(".rota-grid-drop").forEach((cell) => {
      cell.addEventListener("dragover", (event) => {
        event.preventDefault();
        const copyMode = dragCopyMode || event.altKey;
        cell.classList.toggle("is-drag-over-copy", copyMode);
        cell.classList.toggle("is-drag-over", !copyMode);
      });
      cell.addEventListener("dragleave", () => {
        cell.classList.remove("is-drag-over", "is-drag-over-copy");
      });
      cell.addEventListener("drop", (event) => {
        event.preventDefault();
        cell.classList.remove("is-drag-over", "is-drag-over-copy");
        const index = dragShiftIndex ?? Number(event.dataTransfer?.getData("text/plain"));
        if (Number.isNaN(index) || !shifts[index]) return;
        const employeeId = Number(cell.getAttribute("data-employee-id"));
        const shiftDate = cell.getAttribute("data-shift-date");
        const copyMode =
          event.altKey || event.dataTransfer?.getData("application/x-rota-copy") === "1" || dragCopyMode;
        if (copyMode) {
          copyShift(index, employeeId, shiftDate);
        } else {
          moveShift(index, employeeId, shiftDate);
        }
        dragShiftIndex = null;
        dragCopyMode = false;
      });
      cell.addEventListener("click", (event) => {
        if (event.target.closest(".rota-shift-block") || event.target.closest(".rota-shift-actions")) return;
        if (cell.querySelector(".rota-shift-block")) return;
        quickAddShift(Number(cell.getAttribute("data-employee-id")), cell.getAttribute("data-shift-date"));
      });
    });
  }

  function renderAll() {
    renderWeekSummary();
    renderRotaStats();
    if (shouldUseMobileRotaBuilder()) {
      renderMobileRota();
    } else {
      renderGrid();
      renderShiftTable();
    }
    updateHeader();
    syncPanelVisibility();
    syncMobileNotifyChip();
  }

  function setView(view) {
    if (isDesktopRotaViewport() && view === "list") {
      view = "grid";
    }
    activeView = view;
    document.getElementById("rota-grid-view").hidden = view !== "grid";
    document.getElementById("rota-list-panel").hidden = view !== "list";
    document.getElementById("rota-view-grid")?.classList.toggle("is-active", view === "grid");
    document.getElementById("rota-view-list")?.classList.toggle("is-active", view === "list");
    if (view === "list") {
      panelOpen = false;
    }
    syncPanelVisibility();
    renderEmptyState();
    if (view === "grid" && hasActiveEmployees()) {
      renderGrid();
    }
  }

  function closeShiftPanel() {
    editingShiftIndex = null;
    panelOpen = false;
    syncPanelVisibility();
    document.getElementById("rota-add-btn").textContent = "Add to rota";
    document.getElementById("rota-shift-popover-title").textContent = "Add shift";
    const panelCopyBtn = document.getElementById("rota-panel-copy-btn");
    if (panelCopyBtn) panelCopyBtn.hidden = true;
    const panelDeleteBtn = document.getElementById("rota-panel-delete-btn");
    if (panelDeleteBtn) panelDeleteBtn.hidden = true;
    const bulkSection = document.getElementById("rota-bulk-times");
    if (bulkSection) bulkSection.hidden = true;
  }

  function openShiftPanel({ employeeId = null, shiftDate = null, shiftIndex = null } = {}) {
    if (shiftIndex == null && !guardWeekEditable("add shifts")) return;
    if (shiftIndex != null && !guardWeekEditable("edit shifts")) return;
    if (!hasActiveEmployees()) {
      setMessage("Add active employees before building a rota.", "error");
      return;
    }
    panelOpen = true;
    syncPanelVisibility();

    const employeeSelect = document.getElementById("rota-add-employee");
    const daySelect = document.getElementById("rota-add-day");
    const roleInput = document.getElementById("rota-add-role");
    const notesInput = document.getElementById("rota-add-notes");
    const context = document.getElementById("rota-shift-popover-context");
    const addBtn = document.getElementById("rota-add-btn");
    const title = document.getElementById("rota-shift-popover-title");

    populateEmployeeSelect();
    populateDaySelect();

    editingShiftIndex = shiftIndex;

    if (shiftIndex != null && shifts[shiftIndex]) {
      const shift = shifts[shiftIndex];
      if (employeeSelect) employeeSelect.value = String(shift.employee_id);
      if (daySelect) daySelect.value = shift.shift_date;
      populateTimeSelects(shift.start_time, shift.end_time);
      if (roleInput) roleInput.value = shift.role_label || "";
      if (notesInput) notesInput.value = shift.notes || "";
      if (title) title.textContent = "Edit shift";
      if (addBtn) addBtn.textContent = "Save shift";
    } else {
      if (employeeSelect && employeeId) employeeSelect.value = String(employeeId);
      if (daySelect) {
        daySelect.value = shiftDate || (shouldUseMobileRotaBuilder() ? ensureMobileSelectedDay() : daySelect.value);
      }
      populateTimeSelects("09:00", "17:00");
      if (roleInput) roleInput.value = "";
      if (notesInput) notesInput.value = "";
      if (employeeSelect?.value) applyRoleFromEmployee(Number(employeeSelect.value));
      if (title) title.textContent = "Add shift";
      if (addBtn) addBtn.textContent = "Add to rota";
    }

    updatePanelContext();
    updateShiftDurationLabel();
    updateOverlapStatus();
    renderBulkTimesSection();

    const panelCopyBtn = document.getElementById("rota-panel-copy-btn");
    if (panelCopyBtn) {
      if (shiftIndex != null && !isWeekReadOnly()) {
        panelCopyBtn.hidden = false;
        panelCopyBtn.onclick = () => showCopyShiftModal(shiftIndex);
      } else {
        panelCopyBtn.hidden = true;
        panelCopyBtn.onclick = null;
      }
    }

    const panelDeleteBtn = document.getElementById("rota-panel-delete-btn");
    if (panelDeleteBtn) {
      panelDeleteBtn.hidden = !(shiftIndex != null && !isWeekReadOnly());
    }

    const panelBody = document.querySelector("#rota-shift-panel .rota-shift-panel__body");
    if (panelBody) panelBody.scrollTop = 0;
    if (isMobileRotaUi()) {
      document.getElementById("rota-add-employee")?.focus();
    }
  }

  function updatePanelContext() {
    const panel = document.getElementById("rota-shift-panel");
    if (panel?.hasAttribute("hidden")) return;
    const employeeSelect = document.getElementById("rota-add-employee");
    const daySelect = document.getElementById("rota-add-day");
    const context = document.getElementById("rota-shift-popover-context");
    const empId = Number(employeeSelect?.value);
    const dateIso = daySelect?.value;
    if (!context || !empId || !dateIso) return;
    context.textContent = `${employeeName(empId)} · ${new Date(`${dateIso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}`;
  }

  function requestTypePill(type) {
    const raw = String(type || "").trim().toLowerCase();
    const label = raw === "cover" ? "Cover" : raw === "swap" ? "Swap" : type ? String(type) : "—";
    const cls =
      raw === "cover"
        ? "rota-request-type-pill rota-request-type-pill--cover"
        : raw === "swap"
          ? "rota-request-type-pill rota-request-type-pill--swap"
          : "rota-request-type-pill";
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
  }

  async function loadShiftRequests() {
    const tbody = document.getElementById("rota-requests-body");
    const sub = document.getElementById("rota-requests-sub");
    if (!tbody) return;
    try {
      const res = await apiFetch("/admin/rota/shift-requests?status=pending");
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(await readApiError(res, "Could not load shift requests"));
      const rows = data.items || [];
      pendingRequestCount = rows.length;
      renderRotaStats();
      if (sub) {
        sub.textContent = rows.length
          ? `${rows.length} pending request${rows.length === 1 ? "" : "s"}`
          : "No pending cover or swap requests";
      }
      if (!rows.length) {
        tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="5">${emptyStateHtml({
          icon: "clipboard",
          title: "No pending requests",
          message: "When staff request cover or a swap in the employee app, they appear here for approval.",
          compact: true,
        })}</td></tr>`;
        return;
      }
      renderTableBody(tbody, {
        emptyMessage: "No pending cover or swap requests.",
        columns: [
          {
            key: "shift_date",
            render: (r) =>
              `${escapeHtml(r.shift_date || "")} ${escapeHtml(r.start_time || "")}–${escapeHtml(r.end_time || "")}`,
          },
          { key: "requester_name", render: (r) => escapeHtml(r.requester_name) },
          { key: "request_type", render: (r) => requestTypePill(r.request_type) },
          { key: "note", render: (r) => escapeHtml(r.note || "—") },
          {
            key: "actions",
            render: (r) =>
              `<div class="rota-request-actions"><button type="button" class="btn primary btn-sm" data-approve-request="${r.id}">Approve</button><button type="button" class="btn btn--ghost btn--danger btn-sm" data-reject-request="${r.id}">Reject</button></div>`,
          },
        ],
        rows,
      });
      tbody.querySelectorAll("[data-approve-request]").forEach((btn) => {
        btn.addEventListener("click", () => reviewRequest(Number(btn.getAttribute("data-approve-request")), true));
      });
      tbody.querySelectorAll("[data-reject-request]").forEach((btn) => {
        btn.addEventListener("click", () => reviewRequest(Number(btn.getAttribute("data-reject-request")), false));
      });
    } catch {
      pendingRequestCount = 0;
      renderRotaStats();
      if (sub) sub.textContent = "Could not load requests";
      renderTableBody(tbody, {
        columns: [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }, { key: "e" }],
        rows: [],
        emptyMessage: "Could not load shift requests.",
      });
    }
  }

  async function reviewRequest(requestId, approve) {
    try {
      const res = await apiFetch(`/admin/rota/shift-requests/${requestId}/review`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.detail?.message || data.detail || "Review failed.", "error");
        return;
      }
      setMessage(approve ? "Request approved." : "Request rejected.");
      await Promise.all([loadWeek(), loadShiftRequests()]);
    } catch (error) {
      setMessage(error.message || "Review failed.", "error");
    }
  }

  function populateEmployeeSelect() {
    const select = document.getElementById("rota-add-employee");
    const hint = document.getElementById("rota-employee-empty-hint");
    const staff = activeEmployees();
    if (!select) return;
    if (!staff.length) {
      select.innerHTML = '<option value="">No active employees</option>';
      select.disabled = true;
      hint?.removeAttribute("hidden");
      document.getElementById("rota-add-btn")?.setAttribute("disabled", "");
      document.getElementById("rota-shift-head-save")?.setAttribute("disabled", "");
      return;
    }
    select.disabled = false;
    hint?.setAttribute("hidden", "");
    document.getElementById("rota-add-btn")?.removeAttribute("disabled");
    document.getElementById("rota-shift-head-save")?.removeAttribute("disabled");
    select.innerHTML = staff
      .map(
        (e) =>
          `<option value="${e.id}">${escapeHtml(employeeShortName(e))} — ${escapeHtml(employeeRoleLabel(e))}</option>`
      )
      .join("");
  }

  function populateDaySelect() {
    const select = document.getElementById("rota-add-day");
    if (!select) return;
    select.innerHTML = Array.from({ length: 7 }, (_, i) => {
      const iso = addDays(currentWeekStart, i);
      const label = new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
      return `<option value="${iso}">${label}</option>`;
    }).join("");
  }

  async function ensureRotaSession() {
    window.ShiftSwiftNativeApiFetch?.boot?.();
    await window.ShiftSwiftSession?.hydrateNativeSession?.({ force: true });
    if (window.ShiftSwiftSession?.refreshAccessToken) {
      await window.ShiftSwiftSession.refreshAccessToken();
    }
  }

  async function reloadRotaData() {
    if (rotaDataLoadPromise) return rotaDataLoadPromise;
    rotaDataLoadPromise = (async () => {
      try {
        await ensureRotaSession();
        await ensureWeekStartAligned();
        await loadEmployeesList();
        await loadWeek();
      } finally {
        rotaDataLoadPromise = null;
      }
    })();
    return rotaDataLoadPromise;
  }

  function onRotaFeaturesChanged() {
    const prevDay = rotaWeekStartDay;
    syncRotaWeekStartDay(window.Admin?.tenantFeatures?.rota_week_start_day);
    applyRotaModeUi();
    if (!sectionReady) return;
    const realigned = rotaWeekStartIso(new Date());
    if (realigned !== currentWeekStart || prevDay !== rotaWeekStartDay) {
      currentWeekStart = realigned;
      void reloadRotaData();
    }
  }
  async function loadWeek({ retryAfterAlign = true, attempt = 0 } = {}) {
    setMessage("Loading rota…");
    const weekPath = `/admin/rota/weeks/${currentWeekStart}${templateQuerySuffix() ? `?${templateQuerySuffix().slice(1)}` : ""}`;
    try {
      const res = await apiFetch(weekPath);
      const data = await parseApiJson(res);
      if (!res.ok) {
        const message = parseRotaApiDetail(data, "Could not load rota.");
        if (
          retryAfterAlign &&
          typeof message === "string" &&
          message.includes("week_start must be a")
        ) {
          await ensureWeekStartAligned();
          return loadWeek({ retryAfterAlign: false });
        }
        shifts = [];
        renderAll();
        setMessage(message, "error");
        return;
      }
      weekMeta = data.week || { status: "draft", version: 1 };
      rotaPolicy = data.policy || null;
      if (data.week_start_day != null) syncRotaWeekStartDay(data.week_start_day);
      if (data.week_start && data.week_start !== currentWeekStart) {
        currentWeekStart = data.week_start;
      }
      shifts = (data.shifts || []).map((s) => ({ ...s }));
      attendanceByShiftId = new Map();
      (data.attendance?.items || []).forEach((item) => {
        if (item.shift_id != null) attendanceByShiftId.set(String(item.shift_id), item);
      });
      attendanceSummary = data.attendance?.summary || null;
      markClean();
      rotaTemplates = data.templates || [];
      rotaInsights = data.insights || null;
      if (!selectedTemplateId && rotaInsights?.template_id) {
        selectedTemplateId = rotaInsights.template_id;
      }
      renderAdvancedPanel();
      renderAttendanceTable(data.attendance?.items || []);
      renderAll();
      populateDaySelect();
      if (isWeekReadOnly()) {
        setMessage(readonlyMessage(), "info");
      } else if (weekMeta.status === "published") {
        setMessage("Published — shift attendance flags update live.");
      } else if (!hasActiveEmployees()) {
        setMessage("Add active employees before building a rota.");
      } else if (!shifts.length) {
        setMessage(
          shouldUseMobileRotaBuilder()
            ? "No shifts this week — tap a staff member to add one, or use ← to check earlier weeks."
            : "No shifts this week — click a cell to add one, or use ← to check earlier weeks."
        );
      } else {
        setMessage("Unsaved changes? Save draft, then publish when ready.");
      }
    } catch (error) {
      if (attempt < 2) {
        await ensureRotaSession();
        await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
        return loadWeek({ retryAfterAlign, attempt: attempt + 1 });
      }
      shifts = [];
      renderAll();
      setMessage(friendlyNativeError(error, "Could not load rota."), "error");
    }
  }

  async function loadEmployeesList() {
    try {
      const cached = peekEmployeesListCache?.();
      const overview = window.Admin?.getAdminOverviewCache?.();
      const activeCount = Number(overview?.modules?.employees?.active ?? 0);
      const needsForce = Boolean(cached?.length) === false && activeCount > 0;
      employees = await fetchEmployeesList(needsForce ? { force: true } : {});
      if (!employees.length && cached?.length) {
        employees = cached;
      }
    } catch (error) {
      const cached = peekEmployeesListCache?.();
      if (cached?.length) {
        employees = cached;
        return;
      }
      employees = [];
      setMessage(friendlyNativeError(error, "Could not load employees for rota."), "error");
    }
    populateEmployeeSelect();
    populateRoleSuggestions();
    renderEmptyState();
  }

  function addShiftFromForm() {
    if (!guardWeekEditable("save shifts")) return;
    const overlap = findFormOverlap();
    if (overlap) {
      setMessage(overlap, "error");
      updateOverlapStatus();
      return;
    }
    const candidate = getFormShiftCandidate();
    if (!candidate) {
      setMessage("Employee, day, start, and end are required.", "error");
      return;
    }
    const payload = {
      ...candidate,
      employee_name: employeeName(candidate.employee_id),
    };
    if (editingShiftIndex != null && shifts[editingShiftIndex]) {
      shifts[editingShiftIndex] = { ...shifts[editingShiftIndex], ...payload };
      setMessage("Shift updated — click Save draft.", "success");
    } else {
      shifts.push(payload);
      setMessage("Shift added — click Save draft.", "success");
    }
    shifts.sort((a, b) => `${a.shift_date}${a.start_time}`.localeCompare(`${b.shift_date}${b.start_time}`));
    markDirty();
    editingShiftIndex = null;
    renderAll();
    updateOverlapStatus();
    if (isMobileViewport()) {
      closeShiftPanel();
    } else {
      syncPanelVisibility();
    }
  }

  function clearRota() {
    if (!guardWeekEditable("clear this rota")) return;
    if (!shifts.length) return;
    if (
      !window.confirm(
        "Are you sure? This will remove all shifts from the current week. You will still need to save the rota to persist the change.",
      )
    ) {
      return;
    }
    shifts = [];
    markDirty();
    closeShiftPanel();
    renderAll();
    setMessage("Rota cleared — click Save draft to persist.");
  }

  async function saveRota(options = {}) {
    if (!guardWeekEditable("save this rota")) return false;
    const button = options.button || document.getElementById("rota-save-btn") || document.getElementById("rota-mobile-save-btn");
    const statusEl = document.getElementById("rota-admin-message");

    const performSave = async () => {
      const res = await apiFetch(`/admin/rota/weeks/${currentWeekStart}`, {
        method: "PUT",
        body: JSON.stringify({
          shifts: shifts.map((s) => ({
            employee_id: s.employee_id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            role_label: s.role_label || "",
            notes: s.notes || "",
          })),
          expected_version: weekMeta?.version ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setMessage(`${data.detail?.message || "Version conflict."} Reloading…`, "error");
        await loadWeek();
        return false;
      }
      if (!res.ok) {
        throw new Error(data.detail?.message || data.detail || "Save failed.");
      }
      weekMeta = data.week;
      shifts = data.shifts || [];
      markClean();
      renderAll();
      return data.message || "Rota saved — publish when ready.";
    };

    if (button && window.ShiftSwiftAction?.runButtonAction) {
      const result = await window.ShiftSwiftAction.runButtonAction(button, statusEl, {
        loadingLabel: "Saving…",
        successMessage: "Rota saved — publish when ready.",
        errorMessage: "Save failed.",
        successLabel: "Saved",
        onAction: performSave,
      });
      return result.ok;
    }

    setMessage("Saving…");
    try {
      const message = await performSave();
      if (message === false) return false;
      setMessage(message, "success");
      return true;
    } catch (error) {
      setMessage(error.message || "Save failed.", "error");
      return false;
    }
  }

  async function copyPreviousWeek() {
    if (!guardWeekCopy()) return;
    if (!window.confirm("Copy all shifts from last week into this week? Unsaved changes will be lost.")) return;
    setMessage("Copying…");
    try {
      const res = await apiFetch(`/admin/rota/weeks/${currentWeekStart}/copy-previous`, {
        method: "POST",
        body: JSON.stringify({ expected_version: weekMeta?.version ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.detail?.message || data.detail || "Copy failed.", "error");
        return;
      }
      weekMeta = data.week;
      shifts = data.shifts || [];
      markClean();
      await loadWeek();
      setMessage(data.message || "Copied from previous week.");
    } catch (error) {
      setMessage(error.message || "Copy failed.", "error");
    }
  }

  async function exportRotaFile(ext) {
    if (dirty) {
      const proceed = window.confirm(
        "You have unsaved changes on screen. The export uses the last saved rota in ShiftSwift. Continue?"
      );
      if (!proceed) return;
    }
    const label = ext === "csv" ? "CSV" : "PDF";
    setMessage(`Preparing grid ${label}…`, "info");
    try {
      await downloadAuthenticated(
        `/admin/rota/weeks/${currentWeekStart}/export.${ext}`,
        `shiftswift-rota-${currentWeekStart}.${ext}`
      );
      setMessage(`Grid ${label} downloaded.`, "success");
    } catch (error) {
      setMessage(error?.message || `Could not export rota ${label}.`, "error");
    }
  }

  async function exportRotaPdf() {
    return exportRotaFile("pdf");
  }

  async function exportRotaCsv() {
    return exportRotaFile("csv");
  }

  async function exportShiftsAttendance(format, labelPrefix = "Shift list") {
    if (dirty) {
      const proceed = window.confirm(
        "You have unsaved changes on screen. The export uses the last saved rota in ShiftSwift. Continue?"
      );
      if (!proceed) return;
    }
    const ext = format === "csv" ? "csv" : "pdf";
    const exportLabel = `${labelPrefix} ${ext.toUpperCase()}`;
    setMessage(`Preparing ${exportLabel}…`, "info");
    try {
      await downloadAuthenticated(
        `/admin/rota/weeks/${currentWeekStart}/attendance/export.${ext}`,
        `shiftswift-shifts-attendance-${currentWeekStart}.${ext}`
      );
      setMessage(`${exportLabel} downloaded.`, "success");
    } catch (error) {
      setMessage(error?.message || `Could not export ${ext.toUpperCase()}.`, "error");
    }
  }

  async function publishRota() {
    if (!guardWeekEditable("publish this rota")) return;
    if (!shifts.length) {
      setMessage("Add at least one shift before publishing.", "error");
      return;
    }
    if (dirty) {
      setMessage("Saving draft before publish…");
      const saved = await saveRota();
      if (!saved) return;
    }
    if (!weekMeta?.version) {
      setMessage("Save the rota before publishing.", "error");
      return;
    }
    const btn =
      document.getElementById("rota-publish-btn") || document.getElementById("rota-mobile-publish-btn");
    const statusEl = document.getElementById("rota-admin-message");
    const notifyStaff = document.getElementById("rota-notify-staff")?.checked ?? false;

    const performPublish = async () => {
      const res = await apiFetch(`/admin/rota/weeks/${currentWeekStart}/publish`, {
        method: "POST",
        body: JSON.stringify({ expected_version: weekMeta.version, notify_staff: notifyStaff }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data.detail?.message || data.detail || "Publish failed.";
        if (/at least one shift/i.test(String(message))) {
          throw new Error(`${message} Click Save draft first, then publish again.`);
        }
        throw new Error(message);
      }
      weekMeta = data.week;
      shifts = data.shifts || [];
      await loadWeek();
      let msg = data.message || "Rota published — staff can see shifts in Time Clock.";
      if (notifyStaff && data.notifications) {
        const n = data.notifications;
        const sent = n.emails_sent ?? 0;
        const notified = n.employees_notified ?? sent;
        const unchanged = n.employees_unchanged ?? 0;
        if (n.mode === "update") {
          if (notified > 0) {
            msg += ` · ${notified} staff emailed about changes`;
            if (unchanged > 0) {
              msg += ` (${unchanged} unchanged — not emailed)`;
            }
          } else {
            msg += " · no schedule changes — staff not emailed";
          }
        } else if (sent > 0) {
          msg += ` · ${sent} email${sent === 1 ? "" : "s"} sent`;
        } else if ((n.emails_skipped ?? 0) > 0) {
          msg += " · no staff emails sent (check addresses or notification settings)";
        }
      }
      return msg;
    };

    if (btn && window.ShiftSwiftAction?.runButtonAction) {
      await window.ShiftSwiftAction.runButtonAction(btn, statusEl, {
        loadingLabel: "Publishing…",
        successMessage: "Rota published.",
        errorMessage: "Publish failed.",
        successLabel: "Published",
        onAction: performPublish,
      });
      return;
    }

    setMessage("Publishing…");
    try {
      setMessage(await performPublish(), "success");
    } catch (error) {
      setMessage(error.message || "Publish failed.", "error");
    }
  }

  function changeWeek(delta) {
    if (dirty && !window.confirm("You have unsaved shifts. Change week anyway?")) return;
    closeShiftPanel();
    mobileSelectedDay = null;
    currentWeekStart = addDays(currentWeekStart, delta * 7);
    loadWeek();
  }

  function renderAdvancedPanel() {
    const feats = window.Admin?.tenantFeatures || {};
    if (!feats.rota_advanced_enabled) return;

    const select = document.getElementById("rota-template-select");
    if (select) {
      const items = rotaTemplates || [];
      if (!selectedTemplateId && rotaInsights?.template_id) {
        selectedTemplateId = rotaInsights.template_id;
      }
      select.innerHTML = items.length
        ? items
            .map(
              (item) =>
                `<option value="${item.id}" ${Number(item.id) === Number(selectedTemplateId) ? "selected" : ""}>${escapeHtml(item.name)}${item.is_default ? " (default)" : ""}</option>`
            )
            .join("")
        : `<option value="">No templates yet</option>`;
    }

    const gapsHost = document.getElementById("rota-coverage-gaps");
    const hoursHost = document.getElementById("rota-hours-warnings");
    const gaps = rotaInsights?.coverage_gaps || [];
    const warnings = rotaInsights?.hours_warnings || [];

    if (gapsHost) {
      if (!rotaInsights?.has_template) {
        gapsHost.innerHTML =
          '<p class="muted">Create a staffing template in <a href="#settings/rota">Settings → Rota scheduling</a> to track coverage gaps.</p>';
      } else if (!gaps.length) {
        gapsHost.innerHTML = '<p class="muted">All template slots are covered for this week.</p>';
      } else {
        gapsHost.innerHTML = `<ul>${gaps
          .map(
            (gap) =>
              `<li><strong>${escapeHtml(gap.day_name)}</strong> ${escapeHtml(gap.start_time)}–${escapeHtml(gap.end_time)} · ${escapeHtml(gap.role_label || "Any role")} — need ${gap.required}, have ${gap.actual}</li>`
          )
          .join("")}</ul>`;
      }
    }

    if (hoursHost) {
      if (!warnings.length) {
        hoursHost.innerHTML = '<p class="muted">No weekly hours warnings for scheduled staff.</p>';
      } else {
        hoursHost.innerHTML = `<ul>${warnings
          .map((warn) => {
            const cls = warn.severity === "over" ? "rota-hours-warn--over" : "rota-hours-warn--under";
            const label = warn.severity === "over" ? "over" : "under";
            return `<li class="${cls}"><strong>${escapeHtml(warn.employee_name)}</strong> — ${warn.scheduled_hours}h scheduled vs ${warn.contracted_hours}h contracted (${label} by ${Math.abs(warn.delta_hours)}h)</li>`;
          })
          .join("")}</ul>`;
      }
    }

    const genBtn = document.getElementById("rota-generate-draft-btn");
    if (genBtn) genBtn.disabled = !rotaInsights?.has_template || isWeekReadOnly();
  }

  async function generateDraftFromTemplate() {
    if (!guardWeekEditable("generate a draft")) return;
    if (!rotaInsights?.has_template) {
      setMessage("Create a staffing template in Settings first.", "error");
      return;
    }
    if (dirty && !window.confirm("You have unsaved changes. Generate draft anyway?")) return;
    setMessage("Generating draft from template…");
    try {
      const res = await apiFetch(`/admin/rota/weeks/${currentWeekStart}/generate-draft`, {
        method: "POST",
        body: JSON.stringify({
          template_id: selectedTemplateId ? Number(selectedTemplateId) : null,
          expected_version: weekMeta?.version ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.detail?.message || data.detail || "Could not generate draft.", "error");
        return;
      }
      setMessage(data.message || "Draft generated.", "success");
      await loadWeek();
    } catch (error) {
      setMessage(error.message || "Could not generate draft.", "error");
    }
  }

  function bindAdvancedUiOnce() {
    if (advancedUiBound) return;
    advancedUiBound = true;
    document.getElementById("rota-template-select")?.addEventListener("change", (event) => {
      if (dirty && !window.confirm("Discard unsaved changes?")) {
        event.target.value = selectedTemplateId || "";
        return;
      }
      selectedTemplateId = event.target.value ? Number(event.target.value) : null;
      loadWeek();
    });
    document.getElementById("rota-generate-draft-btn")?.addEventListener("click", generateDraftFromTemplate);
  }

  function applyRotaModeUi() {
    const feats = window.Admin?.tenantFeatures || {};
    const badge = document.getElementById("rota-mode-badge");
    const advancedPanel = document.getElementById("rota-advanced-panel");
    const labels = feats.rota_mode_labels || { basic: "Basic", advanced: "Advanced", multi_site: "Multi-site" };
    const mode = feats.rota_mode || "basic";
    if (badge) {
      const label = labels[mode] || mode;
      badge.textContent = String(label).split(" — ")[0].split(" - ")[0];
      badge.hidden = false;
      badge.className = `rota-mode-badge rota-mode-badge--${mode}`;
    }
    if (advancedPanel) {
      advancedPanel.hidden = !feats.rota_advanced_enabled;
    }
    if (feats.rota_advanced_enabled) {
      bindAdvancedUiOnce();
      renderAdvancedPanel();
    }
  }

  async function initSection() {
    ensureShiftPanelPlacement();
    window.addEventListener("resize", ensureShiftPanelPlacement);
    populateTimeSelects("09:00", "17:00");

    document.getElementById("rota-prev-week")?.addEventListener("click", () => changeWeek(-1));
    document.getElementById("rota-next-week")?.addEventListener("click", () => changeWeek(1));
    document.getElementById("rota-this-week")?.addEventListener("click", () => {
      if (dirty && !window.confirm("Discard unsaved changes?")) return;
      closeShiftPanel();
      currentWeekStart = rotaWeekStartIso(new Date());
      loadWeek();
    });
    document.getElementById("rota-add-btn")?.addEventListener("click", addShiftFromForm);
    document.getElementById("rota-shift-head-save")?.addEventListener("click", addShiftFromForm);
    document.getElementById("rota-save-btn")?.addEventListener("click", saveRota);
    document.getElementById("rota-export-csv-btn")?.addEventListener("click", exportRotaCsv);
    document.getElementById("rota-export-pdf-btn")?.addEventListener("click", exportRotaPdf);
    document.getElementById("rota-shifts-export-csv")?.addEventListener("click", () => exportShiftsAttendance("csv", "Shift list"));
    document.getElementById("rota-shifts-export-pdf")?.addEventListener("click", () => exportShiftsAttendance("pdf", "Shift list"));
    document.getElementById("rota-attendance-export-csv")?.addEventListener("click", () => exportShiftsAttendance("csv", "Flags"));
    document.getElementById("rota-attendance-export-pdf")?.addEventListener("click", () => exportShiftsAttendance("pdf", "Flags"));
    document.getElementById("rota-copy-prev-btn")?.addEventListener("click", copyPreviousWeek);
    document.getElementById("rota-clear-btn")?.addEventListener("click", clearRota);
    document.getElementById("rota-publish-btn")?.addEventListener("click", publishRota);
    document.getElementById("rota-reload-btn")?.addEventListener("click", () => {
      if (dirty && !window.confirm("Discard unsaved changes?")) return;
      closeShiftPanel();
      loadWeek();
    });
    document.getElementById("rota-view-grid")?.addEventListener("click", () => setView("grid"));
    document.getElementById("rota-view-list")?.addEventListener("click", () => setView("list"));
    document.getElementById("rota-shift-cancel-btn")?.addEventListener("click", closeShiftPanel);
    document.getElementById("rota-panel-delete-btn")?.addEventListener("click", deleteShiftFromPanel);
    document.getElementById("rota-shift-popover-close")?.addEventListener("click", closeShiftPanel);
    document.getElementById("rota-mobile-prev-week")?.addEventListener("click", () => changeWeek(-1));
    document.getElementById("rota-mobile-next-week")?.addEventListener("click", () => changeWeek(1));
    document.getElementById("rota-mobile-week-label-btn")?.addEventListener("click", () => {
      if (dirty && !window.confirm("Discard unsaved changes?")) return;
      closeShiftPanel();
      mobileSelectedDay = null;
      currentWeekStart = rotaWeekStartIso(new Date());
      loadWeek();
    });
    document.getElementById("rota-mobile-export-csv")?.addEventListener("click", exportRotaCsv);
    document.getElementById("rota-mobile-export-pdf")?.addEventListener("click", exportRotaPdf);
    document.getElementById("rota-mobile-copy-prev")?.addEventListener("click", copyPreviousWeek);
    document.getElementById("rota-mobile-reload")?.addEventListener("click", () => {
      if (dirty && !window.confirm("Discard unsaved changes?")) return;
      closeShiftPanel();
      loadWeek();
    });
    document.getElementById("rota-mobile-clear")?.addEventListener("click", clearRota);
    document.getElementById("rota-mobile-save-btn")?.addEventListener("click", saveRota);
    document.getElementById("rota-mobile-publish-btn")?.addEventListener("click", publishRota);
    document.getElementById("rota-mobile-notify-btn")?.addEventListener("click", () => {
      const notify = document.getElementById("rota-notify-staff");
      if (!notify) return;
      notify.checked = !notify.checked;
      syncMobileNotifyChip();
    });
    document.getElementById("rota-shift-backdrop")?.addEventListener("click", closeShiftPanel);
    document.getElementById("rota-add-employee")?.addEventListener("change", (event) => {
      applyRoleFromEmployee(Number(event.target.value));
      updatePanelContext();
      updateOverlapStatus();
      renderBulkTimesSection();
    });
    document.getElementById("rota-add-day")?.addEventListener("change", () => {
      updatePanelContext();
      updateOverlapStatus();
      renderBulkTimesSection();
    });
    document.getElementById("rota-add-start")?.addEventListener("change", () => {
      updateShiftDurationLabel();
      renderBulkTimesSection();
    });
    document.getElementById("rota-add-end")?.addEventListener("change", () => {
      updateShiftDurationLabel();
      renderBulkTimesSection();
    });
    document.getElementById("rota-bulk-apply-btn")?.addEventListener("click", applyBulkTimesFromPanel);
    document.getElementById("rota-add-role")?.addEventListener("input", updateOverlapStatus);
    document.getElementById("rota-add-notes")?.addEventListener("input", updateOverlapStatus);
    initPanelDrag();

    applyRotaModeUi();
    if (!featuresListenerBound) {
      featuresListenerBound = true;
      window.addEventListener("admin:features", onRotaFeaturesChanged);
    }
    bindAdvancedUiOnce();

    syncViewForViewport();
    window.addEventListener("resize", syncViewForViewport);
    await reloadRotaData();
    syncMobileNotifyChip();
    await loadShiftRequests();
  }

  async function refreshRotaSection() {
    syncViewForViewport();
    if (!sectionReady) return;
    await reloadRotaData();
  }

  function bootRotaSection() {
    if (!sectionReady) {
      sectionReady = true;
      void initSection().catch((error) => {
        console.error("Rota init failed:", error);
        setMessage(friendlyNativeError(error, "Could not load rota."), "error");
      });
      return;
    }
    void refreshRotaSection();
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section !== "rota") return;
    bootRotaSection();
  });

  window.addEventListener("admin:rota-mobile-open", () => {
    if (sectionReady) renderAll();
    else bootRotaSection();
  });

  window.addEventListener("admin:deferred-ready", () => {
    if (document.body.dataset.mobileTab === "rota" || /#rota/i.test(window.location.hash)) {
      bootRotaSection();
    }
  });

  window.addEventListener("admin:portal-native-retry", () => {
    if (document.body.dataset.mobileTab === "rota" || /#rota/i.test(window.location.hash)) {
      bootRotaSection();
    }
  });

  if (parseHashBaseSection(window.location.hash) === "rota") {
    bootRotaSection();
  }
})();
