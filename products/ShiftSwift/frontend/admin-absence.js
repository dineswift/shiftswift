/** Absence monitoring workspace — day-9 alerts, active table, detail panel. */
(function initAdminAbsenceWorkspace() {
  const { apiFetch, escapeHtml, parseHashBaseSection } = window.Admin;

  let sectionReady = false;
  let dashboardData = null;
  let selectedEmployeeId = null;

  const AVATAR_PALETTES = [
    { bg: "#E1F5EE", color: "#0F6E56" },
    { bg: "#E6F1FB", color: "#185FA5" },
    { bg: "#FAEEDA", color: "#854F0B" },
    { bg: "#FBEAF0", color: "#993556" },
    { bg: "#FCEBEB", color: "#A32D2D" },
  ];

  function avatarStyle(employeeId, critical = false) {
    if (critical) return AVATAR_PALETTES[4];
    return AVATAR_PALETTES[Math.abs(Number(employeeId)) % 4];
  }

  function employeeInitials(name) {
    const parts = String(name || "").trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).toUpperCase() || "?";
  }

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function typeBadgeClass(tone) {
    if (tone === "danger") return "absence-badge absence-badge--danger";
    if (tone === "warn") return "absence-badge absence-badge--warn";
    if (tone === "ok") return "absence-badge absence-badge--ok";
    return "absence-badge absence-badge--grey";
  }

  function statusBadgeClass(statusKey) {
    if (statusKey === "report_now") return "absence-badge absence-badge--danger";
    if (statusKey === "monitor") return "absence-badge absence-badge--warn";
    if (statusKey === "authorized") return "absence-badge absence-badge--ok";
    return "absence-badge absence-badge--grey";
  }

  function progressBarColor(item) {
    if (item.unexcused_streak >= 9) return "#E24B4A";
    if (item.unexcused_streak > 0) return "#EF9F27";
    return "#0F6E56";
  }

  function renderStats(stats) {
    document.getElementById("absence-stat-day9").textContent = String(stats?.day9_alerts ?? 0);
    document.getElementById("absence-stat-active").textContent = String(stats?.active_absences ?? 0);
    document.getElementById("absence-stat-resolved").textContent = String(stats?.resolved_this_month ?? 0);
    document.getElementById("absence-stat-sponsored").textContent = String(stats?.sponsored_workers ?? 0);
    const monthEl = document.getElementById("absence-stat-month");
    if (monthEl) {
      monthEl.textContent = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    }
    const activeCount = document.getElementById("absence-active-count");
    if (activeCount) activeCount.textContent = `${stats?.active_absences ?? 0} active`;
    const resolvedCount = document.getElementById("absence-resolved-count");
    if (resolvedCount) resolvedCount.textContent = `${stats?.resolved_this_month ?? 0} this month`;
    window.dispatchEvent(
      new CustomEvent("admin:absence-stats", { detail: { active: stats?.active_absences ?? 0 } })
    );
  }

  function emptyStateHtml(message) {
    return `<div class="compliance-empty-state">
      <span class="compliance-empty-state__icon" aria-hidden="true">${window.AdminIcons?.svg?.("medical") || "📋"}</span>
      <p>${escapeHtml(message)}</p>
    </div>`;
  }

  function isMobileView() {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function renderMobileAbsenceCards(items) {
    const host = document.getElementById("absence-mobile-cards");
    if (!host) return;
    if (!items?.length) {
      host.hidden = false;
      host.innerHTML = emptyStateHtml("No active absences — sponsored workers are all clear.");
      return;
    }
    host.hidden = false;
    host.innerHTML = items
      .map((item) => {
        const palette = avatarStyle(item.employee_id, item.is_critical);
        const dayLabel =
          item.unexcused_streak > 0 ? `Day ${item.unexcused_streak}` : `Day ${item.working_days}`;
        return `<button type="button" class="absence-record-card${item.is_critical ? " is-critical" : ""}" data-employee-id="${item.employee_id}">
          <span class="absence-record-card__avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(employeeInitials(item.employee_name))}</span>
          <span class="absence-record-card__body">
            <span class="absence-record-card__name">${escapeHtml(item.employee_short_name || item.employee_name)}</span>
            <span class="absence-record-card__meta muted">${escapeHtml(item.type_label)} · Since ${escapeHtml(formatDate(item.start_date))}</span>
          </span>
          <span class="${statusBadgeClass(item.status_key)}">${escapeHtml(item.status_label || dayLabel)}</span>
        </button>`;
      })
      .join("");
    host.querySelectorAll(".absence-record-card").forEach((card) => {
      card.addEventListener("click", () => selectEmployee(Number(card.dataset.employeeId)));
    });
  }

  function renderPrimaryBanner(alert) {
    const banner = document.getElementById("absence-primary-banner");
    if (!banner) return;
    if (!alert?.is_critical) {
      banner.hidden = true;
      banner.innerHTML = "";
      return;
    }
    banner.hidden = false;
    banner.innerHTML = `
      <div class="absence-primary-banner__icon" aria-hidden="true">!</div>
      <div class="absence-primary-banner__text">
        <strong>Day-9 threshold reached — ${escapeHtml(alert.employee_short_name || alert.employee_name)}</strong><br>
        ${escapeHtml(alert.employee_name)} has been absent for ${escapeHtml(alert.unexcused_streak)} consecutive working days.
        You are required to report this unauthorised absence to the Home Office via SMS today.
      </div>
      <button type="button" class="absence-primary-banner__action" data-select-employee="${alert.employee_id}">View record →</button>`;
    banner.querySelector("[data-select-employee]")?.addEventListener("click", () => {
      selectEmployee(alert.employee_id);
    });
  }

  function renderActiveTable(items) {
    const tbody = document.getElementById("absence-active-body");
    if (tbody) {
      if (!items?.length) {
        tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml("No active absences — sponsored workers are all clear.")}</td></tr>`;
      } else {
        tbody.innerHTML = items
      .map((item) => {
        const palette = avatarStyle(item.employee_id, item.is_critical);
        const selected = Number(selectedEmployeeId) === Number(item.employee_id) ? " is-selected" : "";
        const critical = item.is_critical ? " is-critical" : "";
        const dayLabel =
          item.unexcused_streak > 0
            ? `Day ${item.unexcused_streak}`
            : `Day ${item.working_days}`;
        const dayClass = item.unexcused_streak >= 9 ? "absence-day-label--danger" : item.unexcused_streak > 0 ? "absence-day-label--warn" : "";
        return `<tr class="absence-table-row${selected}${critical}" data-employee-id="${item.employee_id}" tabindex="0">
          <td><span class="absence-avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(employeeInitials(item.employee_name))}</span></td>
          <td>
            <span class="absence-emp-name">${escapeHtml(item.employee_short_name || item.employee_name)}</span>
            <span class="absence-emp-role">${escapeHtml(item.employee_role)} · Sponsored</span>
          </td>
          <td><span class="${typeBadgeClass(item.type_tone)}">${escapeHtml(item.type_label)}</span></td>
          <td class="muted">${escapeHtml(formatDate(item.start_date))}</td>
          <td><strong class="absence-day-label ${dayClass}">${escapeHtml(dayLabel)}</strong></td>
          <td>
            <div class="absence-progress">
              <div class="absence-progress__bar"><span style="width:${item.progress_pct}%;background:${progressBarColor(item)}"></span></div>
              <span class="absence-progress__hint">${escapeHtml(item.progress_hint)}</span>
            </div>
          </td>
          <td><span class="${statusBadgeClass(item.status_key)}">${escapeHtml(item.status_label)}</span></td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".absence-table-row").forEach((row) => {
      const open = () => selectEmployee(Number(row.getAttribute("data-employee-id")));
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
      }
    }
    if (isMobileView()) renderMobileAbsenceCards(items);
    else {
      const host = document.getElementById("absence-mobile-cards");
      if (host) host.hidden = true;
    }
  }

  function renderResolvedTable(items) {
    const tbody = document.getElementById("absence-resolved-body");
    if (!tbody) return;
    if (!items?.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No resolved absences yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = items
      .map((item) => {
        const palette = avatarStyle(item.employee_id);
        const sponsored = item.is_sponsored ? "Sponsored" : "Standard";
        return `<tr>
          <td><span class="absence-avatar absence-avatar--muted" style="background:${palette.bg};color:${palette.color}">${escapeHtml(employeeInitials(item.employee_name))}</span></td>
          <td>
            <span class="absence-emp-name">${escapeHtml(item.employee_short_name || item.employee_name)}</span>
            <span class="absence-emp-role">${escapeHtml(item.employee_role)} · ${sponsored}</span>
          </td>
          <td><span class="absence-badge absence-badge--grey">${escapeHtml(item.resolution === "Returned" ? "Authorised" : "Unauthorised")}</span></td>
          <td class="muted">—</td>
          <td class="muted">${escapeHtml(String(item.days || "—"))} days</td>
          <td><span class="absence-badge absence-badge--ok">${escapeHtml(item.resolution)}</span></td>
          <td class="muted">${escapeHtml(item.reported || "N/A")}</td>
        </tr>`;
      })
      .join("");
  }

  function renderTimeline(timeline) {
    if (!timeline?.length) return "";
    return `<div class="absence-timeline">${timeline
      .map(
        (event) => `<div class="absence-timeline__item">
          <span class="absence-timeline__dot absence-timeline__dot--${escapeHtml(event.tone)}"></span>
          <div>
            <div class="absence-timeline__label${event.tone === "danger" ? " absence-timeline__label--danger" : ""}${event.tone === "muted" ? " absence-timeline__label--muted" : ""}">${escapeHtml(event.label)}</div>
            <div class="absence-timeline__sub">${escapeHtml(event.sub || "")}</div>
          </div>
        </div>`
      )
      .join("")}</div>`;
  }

  function renderDetailPanel(item) {
    const panel = document.getElementById("absence-detail-panel");
    const content = document.getElementById("absence-detail-content");
    const badge = document.getElementById("absence-detail-badge");
    if (!panel || !content || !item) return;
    panel.hidden = false;
    if (badge) {
      if (item.panel_badge) {
        badge.hidden = false;
        badge.textContent = item.panel_badge;
        badge.className = `absence-panel-badge${item.is_critical ? " absence-panel-badge--danger" : " absence-panel-badge--warn"}`;
      } else {
        badge.hidden = true;
      }
    }
    const palette = avatarStyle(item.employee_id, item.is_critical);
    const criticalAlert = item.is_critical
      ? `<div class="absence-detail-alert">
          <strong>Day-9 threshold reached</strong>
          <p>You must report this unauthorised absence to the Home Office via SMS today. ShiftSwift HR has logged the absence — you must submit the report yourself.</p>
        </div>`
      : item.unexcused_streak >= 7
        ? `<div class="absence-detail-alert absence-detail-alert--warn">
            <strong>Approaching day-9 threshold</strong>
            <p>Monitor closely — unauthorised absences must be reported to the Home Office within 10 consecutive working days.</p>
          </div>`
        : "";
    const actionBox =
      item.unexcused_streak >= 9
        ? `<div class="absence-action-box">
            <strong>Next step — report via SMS</strong>
            <p>Log in to the Home Office Sponsorship Management System and submit the unauthorised absence report. Then mark as reported below.</p>
          </div>`
        : "";

    content.innerHTML = `
      <div class="absence-detail-employee">
        <span class="absence-avatar absence-avatar--lg" style="background:${palette.bg};color:${palette.color}">${escapeHtml(employeeInitials(item.employee_name))}</span>
        <div>
          <strong>${escapeHtml(item.employee_name)}</strong>
          <span class="muted">${escapeHtml(item.employee_role)} · Sponsored worker</span>
        </div>
      </div>
      ${criticalAlert}
      <dl class="absence-detail-meta">
        <div><dt>Absence type</dt><dd>${escapeHtml(item.excuse_label)}</dd></div>
        <div><dt>Start date</dt><dd>${escapeHtml(formatDate(item.start_date))}</dd></div>
        <div><dt>Consecutive working days</dt><dd class="${item.unexcused_streak >= 9 ? "absence-day-label--danger" : ""}">${escapeHtml(String(item.unexcused_streak || item.working_days))} days${item.unexcused_streak >= 9 ? " — reporting required" : ""}</dd></div>
        <div><dt>Logged by</dt><dd>${escapeHtml(item.logged_by)} · ${escapeHtml(formatDate(item.logged_at?.slice(0, 10) || item.start_date))}</dd></div>
      </dl>
      ${renderTimeline(item.timeline)}
      ${actionBox}
      <label class="absence-notes-field">
        <span class="absence-notes-field__label">Notes</span>
        <textarea id="absence-detail-notes" rows="2" placeholder="Add notes — e.g. contact attempts, context…"></textarea>
      </label>`;
    const hoWrap = document.getElementById("absence-ho-ref-wrap");
    const hoInput = document.getElementById("absence-ho-ref-input");
    if (hoWrap && hoInput) {
      const showRef = item.unexcused_streak >= 9 && item.alert_status !== "reported";
      hoWrap.hidden = !showRef;
      hoInput.value = item.home_office_report_reference || "";
    }
  }

  async function selectEmployee(employeeId) {
    selectedEmployeeId = employeeId;
    renderActiveTable(dashboardData?.active || []);
    try {
      const res = await apiFetch(`/compliance/sponsor-licence/absence-monitoring/${employeeId}`);
      if (!res.ok) throw new Error("Could not load record");
      renderDetailPanel(await res.json());
    } catch {
      const fallback = dashboardData?.active?.find((row) => Number(row.employee_id) === Number(employeeId));
      if (fallback) renderDetailPanel({ ...fallback, timeline: [] });
    }
  }

  async function loadDashboard() {
    const tbody = document.getElementById("absence-active-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="muted">Loading absence records…</td></tr>`;
    try {
      const res = await apiFetch("/compliance/sponsor-licence/absence-monitoring");
      if (!res.ok) throw new Error("Load failed");
      dashboardData = await res.json();
      renderStats(dashboardData.stats);
      renderPrimaryBanner(dashboardData.primary_alert);
      renderActiveTable(dashboardData.active);
      renderResolvedTable(dashboardData.resolved);
      if (selectedEmployeeId && dashboardData.active?.some((row) => Number(row.employee_id) === Number(selectedEmployeeId))) {
        await selectEmployee(selectedEmployeeId);
      } else {
        selectedEmployeeId = null;
        document.getElementById("absence-detail-panel")?.setAttribute("hidden", "");
      }
    } catch {
      dashboardData = null;
      renderStats({ day9_alerts: 0, active_absences: 0, resolved_this_month: 0, sponsored_workers: 0 });
      const banner = document.getElementById("absence-primary-banner");
      if (banner) {
        banner.hidden = true;
        banner.innerHTML = "";
      }
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml("No active absences — sponsored workers are all clear.")}</td></tr>`;
      }
      renderMobileAbsenceCards([]);
    }
  }

  function exportLog() {
    const blob = new Blob([JSON.stringify(dashboardData || {}, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `absence-log-tenant-${window.Admin.TENANT_ID}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function markSmsReported() {
    if (!selectedEmployeeId) return;
    const reference = document.getElementById("absence-ho-ref-input")?.value?.trim() || null;
    const btn = document.getElementById("absence-mark-sms-btn");
    const run = window.ShiftSwiftAction?.runButtonActionAuto;
    const action = async () => {
      const res = await apiFetch(
        `/compliance/sponsor-licence/absence-monitoring/${selectedEmployeeId}/mark-sms-reported`,
        {
          method: "POST",
          body: JSON.stringify({ home_office_report_reference: reference }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not update record");
      await loadDashboard();
      return "Marked as SMS reported.";
    };
    if (run && btn) {
      await run(btn, action, {
        loadingLabel: "Saving…",
        successMessage: "Marked as SMS reported.",
        successLabel: "Saved",
      });
      return;
    }
    try {
      await action();
    } catch (error) {
      window.ShiftSwiftAction?.showActionToast?.(error.message || "Could not mark as reported.", "error");
    }
  }

  async function markReturned() {
    if (!selectedEmployeeId) return;
    if (!window.confirm("Mark this worker as returned and clear active absence days from the log?")) return;
    const btn = document.getElementById("absence-mark-returned-btn");
    const run = window.ShiftSwiftAction?.runButtonActionAuto;
    const action = async () => {
      const res = await apiFetch(
        `/compliance/sponsor-licence/absence-monitoring/${selectedEmployeeId}/mark-returned`,
        { method: "POST", body: JSON.stringify({}) },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not update record");
      selectedEmployeeId = null;
      await loadDashboard();
      return "Marked as returned.";
    };
    if (run && btn) {
      await run(btn, action, {
        loadingLabel: "Saving…",
        successMessage: "Marked as returned.",
        successLabel: "Saved",
      });
      return;
    }
    try {
      await action();
    } catch (error) {
      window.ShiftSwiftAction?.showActionToast?.(error.message || "Could not mark returned.", "error");
    }
  }

  function bindWorkspace() {
    if (document.body.dataset.absenceWorkspaceBound === "true") return;
    document.body.dataset.absenceWorkspaceBound = "true";

    document.getElementById("absence-export-log-btn")?.addEventListener("click", exportLog);
    document.getElementById("absence-log-btn")?.addEventListener("click", () => {
      document.getElementById("absence-log-panel")?.removeAttribute("hidden");
      document.getElementById("absence-log-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("absence-log-panel-close")?.addEventListener("click", () => {
      document.getElementById("absence-log-panel")?.setAttribute("hidden", "");
    });
    document.getElementById("absence-mark-sms-btn")?.addEventListener("click", markSmsReported);
    document.getElementById("absence-mark-returned-btn")?.addEventListener("click", markReturned);

    window.addEventListener("admin:absence-refresh", () => loadDashboard());
  }

  async function initAbsenceSection() {
    bindWorkspace();
    await loadDashboard();
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "compliance" && !sectionReady) {
      sectionReady = true;
      initAbsenceSection();
    }
  });

  if (parseHashBaseSection(window.location.hash) === "compliance") {
    sectionReady = true;
    initAbsenceSection();
  }
})();
