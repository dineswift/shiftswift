(function () {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const loginUrl = session.EMPLOYEE_LOGIN_URL;

  if (!session.hasSession()) return;

  const listEl = document.getElementById("employee-week-shifts");
  const weekLabelEl = document.getElementById("employee-shifts-week-label");
  const messageEl = document.getElementById("employee-shift-message");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function apiFetch(path, options = {}) {
    const tenantId = localStorage.getItem("tenantId");
    return session.fetchWithAuth(path, options, { apiBase: API_BASE, tenantId, loginUrl });
  }

  function setMessage(text) {
    if (messageEl) messageEl.textContent = text || "";
  }

  function setShiftsSummary(text) {
    const source = document.getElementById("employee-shifts-summary");
    if (source) source.textContent = text;
    document.querySelectorAll('[data-mirror="employee-shifts-summary"]').forEach((el) => {
      el.textContent = text;
    });
  }

  function setHomeToday(items) {
    const wrap = document.getElementById("employee-home-today");
    const value = document.getElementById("employee-home-today-value");
    if (!wrap || !value) return;
    wrap.hidden = false;
    const todayIso = new Date().toISOString().slice(0, 10);
    const today = (items || []).filter((item) => item.shift_date === todayIso);
    if (!today.length) {
      value.textContent = "No published shift today";
      wrap.classList.remove("employee-home-today--active");
      return;
    }
    const first = today[0];
    const more = today.length > 1 ? ` · +${today.length - 1} more` : "";
    const role = first.role_label ? ` · ${first.role_label}` : "";
    value.textContent = `${first.start_time}–${first.end_time}${role}${more}`;
    wrap.classList.add("employee-home-today--active");
  }

  function parseApiError(data, fallback) {
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
    return fallback;
  }

  function formatWeekLabel(weekStart, weekEnd) {
    if (!weekStart || !weekEnd) return "";
    const start = new Date(`${weekStart}T12:00:00`);
    const end = new Date(`${weekEnd}T12:00:00`);
    const sameMonth = start.getMonth() === end.getMonth();
    const startText = start.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const endText = end.toLocaleDateString("en-GB", {
      day: "numeric",
      month: sameMonth ? undefined : "short",
      year: start.getFullYear() === end.getFullYear() ? undefined : "numeric",
    });
    return `Week ${startText} – ${endText}`;
  }

  function formatShiftSummary(items) {
    if (!items.length) return "No shifts published this week.";
    const countLabel = items.length === 1 ? "1 shift this week" : `${items.length} shifts this week`;
    const next = items[0];
    const day = new Date(`${next.shift_date}T12:00:00`).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const time = `${next.start_time}–${next.end_time}`;
    return `${countLabel} · next ${day} ${time}`;
  }

  function renderPlaceholder(text, { retry = false } = {}) {
    if (!listEl) return;
    listEl.innerHTML = `
      <div class="employee-shifts-empty">
        <p class="employee-shifts-empty__text muted">${escapeHtml(text)}</p>
        ${retry ? '<button type="button" class="btn ghost btn-sm" id="employee-shifts-retry">Try again</button>' : ""}
      </div>`;
    if (retry) {
      document.getElementById("employee-shifts-retry")?.addEventListener("click", loadShifts);
    }
  }

  let reminderConfig = { minutes_before_start: 10, minutes_before_end: 10 };

  function renderReminderBanner() {
    const host = document.getElementById("employee-shift-reminders-info");
    if (!host) return;
    const startMin = Number(reminderConfig.minutes_before_start) || 10;
    const endMin = Number(reminderConfig.minutes_before_end) || 10;
    host.hidden = false;
    host.innerHTML = `
      <div class="employee-shift-alerts-banner__copy">
        <span class="employee-shift-alerts-banner__title">Shift reminders active</span>
        <span class="employee-shift-alerts-banner__sub">Reminder at shift start · ${startMin} min before start · ${endMin} min before end</span>
      </div>
      <span class="employee-shift-alerts-banner__icon" aria-hidden="true">🔔</span>`;
  }

  function renderShiftCard(shift) {
    const date = new Date(`${shift.shift_date}T12:00:00`);
    const todayIso = new Date().toISOString().slice(0, 10);
    const isToday = shift.shift_date === todayIso;
    const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
    const dayNum = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const role = shift.role_label ? `<p class="employee-shift-card__role">${escapeHtml(shift.role_label)}</p>` : "";
    const notes = shift.notes
      ? `<p class="employee-shift-card__notes muted">${escapeHtml(shift.notes)}</p>`
      : "";
    const startMin = Number(reminderConfig.minutes_before_start) || 10;
    const endMin = Number(reminderConfig.minutes_before_end) || 10;
    const reminderHint = isToday
      ? `<p class="employee-shift-card__reminder-hint">🔔 Reminders at ${startMin} min before start · ${endMin} min before end</p>`
      : "";

    return `
      <article class="employee-shift-card${isToday ? " employee-shift-card--today" : ""}">
        <div class="employee-shift-card__date">
          <span class="employee-shift-card__weekday">${escapeHtml(weekday)}</span>
          <span class="employee-shift-card__day">${escapeHtml(dayNum)}</span>
          ${isToday ? '<span class="employee-shift-card__today">Today</span>' : ""}
        </div>
        <div class="employee-shift-card__body">
          <div class="employee-shift-card__main">
            <p class="employee-shift-card__time">${escapeHtml(shift.start_time)}–${escapeHtml(shift.end_time)}</p>
            ${role}
            ${notes}
            ${reminderHint}
          </div>
          <button type="button" class="btn ghost btn-sm employee-shift-card__cover" data-cover-shift="${shift.id}">
            Cover
          </button>
        </div>
      </article>`;
  }

  async function requestCover(shiftId) {
    const note = window.prompt("Why do you need cover? (optional note)") || "";
    const targetRaw = window.prompt("Colleague employee ID for cover (ask HR if unsure):") || "";
    const targetEmployeeId = targetRaw.trim() ? Number(targetRaw) : null;
    if (!targetEmployeeId) {
      setMessage("Cover request needs a colleague employee ID — ask your manager.");
      return;
    }
    setMessage("Submitting cover request…");
    const res = await apiFetch(`/rota/shifts/${shiftId}/requests`, {
      method: "POST",
      body: JSON.stringify({
        request_type: "cover",
        target_employee_id: targetEmployeeId,
        note,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(parseApiError(data, "Request failed."));
      return;
    }
    setMessage("Cover request sent to your manager.");
  }

  async function loadShifts() {
    if (!listEl) return;
    if (!localStorage.getItem("tenantId")) {
      renderPlaceholder("Loading your account…");
      return;
    }

    renderPlaceholder("Loading shifts…");
    setMessage("");
    if (weekLabelEl) weekLabelEl.hidden = true;

    try {
      const res = await apiFetch("/rota/my-shifts", { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorText = parseApiError(data, "Could not load shifts.");
        renderPlaceholder(errorText, { retry: true });
        setShiftsSummary("Could not load shifts.");
        setHomeToday([]);
        return;
      }

      const items = data.shifts || [];
      if (data.shift_reminders) {
        reminderConfig = {
          minutes_before_start: data.shift_reminders.minutes_before_start ?? 10,
          minutes_before_end: data.shift_reminders.minutes_before_end ?? 10,
        };
      }
      renderReminderBanner();
      window.dispatchEvent(new CustomEvent("employee:shifts-loaded", { detail: data }));
      setShiftsSummary(formatShiftSummary(items));
      setHomeToday(items);

      if (weekLabelEl) {
        const label = formatWeekLabel(data.week_start, data.week_end);
        if (label) {
          weekLabelEl.textContent = label;
          weekLabelEl.hidden = false;
        } else {
          weekLabelEl.hidden = true;
        }
      }

      if (!items.length) {
        renderPlaceholder("No published shifts this week yet. Check back after your manager publishes the rota.");
        return;
      }

      listEl.innerHTML = items.map(renderShiftCard).join("");
      listEl.querySelectorAll("[data-cover-shift]").forEach((btn) => {
        btn.addEventListener("click", () => requestCover(Number(btn.getAttribute("data-cover-shift"))));
      });
    } catch {
      renderPlaceholder("Could not reach the server. Check your connection.", { retry: true });
      setShiftsSummary("Could not load shifts.");
      setHomeToday([]);
    }
  }

  loadShifts();
  window.addEventListener("employee:profile-loaded", loadShifts);
})();
