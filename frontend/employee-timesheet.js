(function () {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const loginUrl = session.EMPLOYEE_LOGIN_URL;

  if (!session.hasSession()) return;

  let weekStart = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function apiFetch(path) {
    const tenantId = localStorage.getItem("tenantId");
    return session.fetchWithAuth(path, { method: "GET" }, { apiBase: API_BASE, tenantId, loginUrl });
  }

  function parseApiError(data, fallback) {
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    return fallback;
  }

  function formatWeekLabel(startIso, endIso) {
    if (!startIso || !endIso) return "";
    const start = new Date(`${startIso}T12:00:00`);
    const end = new Date(`${endIso}T12:00:00`);
    const startText = start.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const endText = end.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return `${startText} – ${endText}`;
  }

  function formatSegmentTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  }

  function approvalLabel(status) {
    if (status === "approved") return "Approved by HR";
    if (status === "rejected") return "Query from HR";
    return "Pending HR review";
  }

  function approvalClass(status) {
    if (status === "approved") return "ok";
    if (status === "rejected") return "danger";
    return "warn";
  }

  function shiftWeek(deltaDays) {
    const base = weekStart ? new Date(`${weekStart}T12:00:00`) : new Date();
    base.setDate(base.getDate() + deltaDays);
    weekStart = base.toISOString().slice(0, 10);
    loadTimesheet();
  }

  function renderDayCard(day) {
    const hours = Number(day.total_hours || 0);
    const hasPunches = (day.punches || []).length > 0;
    const hasHours = hours > 0;
    if (!hasPunches && !hasHours) {
      return `
        <article class="employee-timesheet-day employee-timesheet-day--empty">
          <div class="employee-timesheet-day__head">
            <span class="employee-timesheet-day__label">${escapeHtml(day.label)}</span>
            <span class="employee-timesheet-day__date muted">${escapeHtml(
              new Date(`${day.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
            )}</span>
          </div>
          <p class="employee-timesheet-day__empty muted">No punches</p>
        </article>`;
    }

    const segments = (day.segments || [])
      .map(
        (seg) =>
          `<li>${escapeHtml(formatSegmentTime(seg.clock_in))} → ${escapeHtml(formatSegmentTime(seg.clock_out))} · ${escapeHtml(String(seg.hours))}h</li>`,
      )
      .join("");

    const punches = (day.punches || [])
      .map((punch) => {
        const dist =
          punch.distance_meters != null ? ` · ${Math.round(punch.distance_meters)}m` : "";
        const method = punch.punch_method === "site_qr" ? " · QR" : "";
        return `<li><strong>${escapeHtml(punch.label)}</strong> ${escapeHtml(punch.time)} · ${escapeHtml(punch.site_name || "site")}${dist}${method}</li>`;
      })
      .join("");

    const issues =
      day.issues && day.issues.length
        ? `<p class="employee-timesheet-day__issues">${escapeHtml(day.issues.join(" · "))}</p>`
        : "";

    return `
      <article class="employee-timesheet-day${day.complete === false ? " employee-timesheet-day--warn" : ""}">
        <div class="employee-timesheet-day__head">
          <div>
            <span class="employee-timesheet-day__label">${escapeHtml(day.label)}</span>
            <span class="employee-timesheet-day__date muted">${escapeHtml(
              new Date(`${day.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
            )}</span>
          </div>
          <span class="employee-timesheet-day__hours">${escapeHtml(hours.toFixed(2))}h</span>
        </div>
        ${segments ? `<ul class="employee-timesheet-day__segments">${segments}</ul>` : ""}
        ${punches ? `<ul class="employee-timesheet-day__punches">${punches}</ul>` : ""}
        ${day.break_minutes ? `<p class="employee-timesheet-day__break muted">${escapeHtml(String(day.break_minutes))}m break</p>` : ""}
        ${issues}
      </article>`;
  }

  async function loadTimesheet() {
    const host = document.getElementById("employee-timesheet-days");
    const weekLabel = document.getElementById("employee-timesheet-week-label");
    const summaryEl = document.getElementById("employee-timesheet-summary");
    if (!host) return;

    if (!localStorage.getItem("tenantId")) {
      host.innerHTML = `<p class="employee-timesheet-placeholder muted">Loading your account…</p>`;
      return;
    }

    host.innerHTML = `<p class="employee-timesheet-placeholder muted">Loading your hours…</p>`;
    if (summaryEl) summaryEl.textContent = "";

    const query = weekStart ? `?week_start=${encodeURIComponent(weekStart)}` : "";
    try {
      const res = await apiFetch(`/time-punch/my-timesheet${query}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        host.innerHTML = `<p class="employee-timesheet-placeholder muted">${escapeHtml(parseApiError(data, "Could not load your hours."))}</p>`;
        return;
      }

      weekStart = data.week_start;
      if (weekLabel) weekLabel.textContent = formatWeekLabel(data.week_start, data.week_end);
      if (summaryEl) {
        summaryEl.innerHTML = `
          <span class="employee-timesheet-summary__hours"><strong>${escapeHtml(String(data.week_total_hours))}h</strong> this week</span>
          <span class="employee-timesheet-summary__break muted">${escapeHtml(String(data.week_break_minutes || 0))}m breaks</span>
          <span class="employee-timesheet-pill employee-timesheet-pill--${approvalClass(data.approval_status)}">${escapeHtml(approvalLabel(data.approval_status))}</span>`;
      }

      const days = data.days || [];
      if (!days.some((day) => (day.punches || []).length || Number(day.total_hours) > 0)) {
        host.innerHTML = `<p class="employee-timesheet-placeholder muted">No punches recorded this week yet.</p>`;
        return;
      }

      host.innerHTML = days.map(renderDayCard).join("");
    } catch {
      host.innerHTML = `<p class="employee-timesheet-placeholder muted">Could not reach the server.</p>`;
    }
  }

  document.getElementById("employee-timesheet-prev")?.addEventListener("click", () => shiftWeek(-7));
  document.getElementById("employee-timesheet-next")?.addEventListener("click", () => shiftWeek(7));
  document.getElementById("employee-timesheet-this-week")?.addEventListener("click", () => {
    weekStart = null;
    loadTimesheet();
  });

  window.addEventListener("employee:profile-loaded", loadTimesheet);
  window.addEventListener("hashchange", () => {
    if (window.location.hash.replace("#", "").split("/")[0] === "time-clock") {
      loadTimesheet();
    }
  });

  window.EmployeeTimesheet = { reload: loadTimesheet };

  if (window.location.hash.replace("#", "").split("/")[0] === "time-clock") {
    loadTimesheet();
  }
})();
