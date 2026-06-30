/** Compliance admin tools — RTW, absence, calendar, audit export, reporting triggers. */
(async function initAdminComplianceTools() {
  const { apiFetch, loadFormOptions, loadEmployees, mountEditForm, renderTableBody, FORM_SCHEMAS, escapeHtml, statusPill, downloadAuthenticated, authHeaders, API_BASE, parseHashBaseSection } = window.Admin;

  let complianceReady = false;
  let ackPanelBound = false;
  let lastAckData = null;
  let lastDashboardData = null;

  const AUDIT_EXPORT_FLAG_KEY = `sponsor_audit_export_done_${window.Admin?.TENANT_ID ?? "default"}`;

  const SETUP_STEPS = [
    {
      id: "enabled",
      label: "Sponsor compliance enabled",
      href: null,
    },
    {
      id: "sponsored_worker",
      label: "First sponsored worker added",
      href: "#employees",
    },
    {
      id: "rtw_upload",
      label: "Upload right-to-work documents",
      href: "#compliance-rtw",
    },
    {
      id: "absence_monitoring",
      label: "Enable absence monitoring for sponsored workers",
      href: "#compliance-absence",
    },
    {
      id: "audit_export",
      label: "Test audit pack export",
      href: "#compliance-audit-export",
    },
  ];

  const DUTY_CARD_ICONS = {
    "Right to Work checks": "id",
    "Worker absences": "calendar-off",
    "SMS change reporting": "message",
    "Recruitment & adverts": "speakerphone",
    "Record keeping & inspections": "folder",
  };

  function formatAckDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function auditExportTested() {
    return localStorage.getItem(AUDIT_EXPORT_FLAG_KEY) === "1";
  }

  function markAuditExportTested() {
    localStorage.setItem(AUDIT_EXPORT_FLAG_KEY, "1");
  }

  function setupStepComplete(stepId, ackData, overview) {
    switch (stepId) {
      case "enabled":
        return Boolean(ackData?.acknowledged);
      case "sponsored_worker":
        return (overview?.sponsored_worker_count ?? 0) > 0;
      case "rtw_upload":
        return (overview?.rtw_total_checks ?? 0) > 0;
      case "absence_monitoring":
        return (overview?.absence_days_recorded ?? 0) > 0;
      case "audit_export":
        return auditExportTested();
      default:
        return false;
    }
  }

  function renderSetupChecklist(ackData, overview) {
    const card = document.getElementById("sponsor-setup-checklist");
    const list = document.getElementById("sponsor-setup-steps");
    const progress = document.getElementById("sponsor-setup-progress");
    if (!card || !list) return;
    if (!ackData?.acknowledged) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const completed = SETUP_STEPS.filter((step) => setupStepComplete(step.id, ackData, overview)).length;
    if (progress) progress.textContent = `${completed} of ${SETUP_STEPS.length} complete`;
    list.innerHTML = SETUP_STEPS.map((step, index) => {
      const done = setupStepComplete(step.id, ackData, overview);
      const stepClass = done ? "sponsor-setup-step sponsor-setup-step--done" : "sponsor-setup-step";
      const circle = done
        ? `<span class="sponsor-setup-step__circle sponsor-setup-step__circle--done" aria-hidden="true">✓</span>`
        : `<span class="sponsor-setup-step__circle">${index + 1}</span>`;
      const textClass = done ? "sponsor-setup-step__text sponsor-setup-step__text--done" : "sponsor-setup-step__text";
      const link = !done && step.href
        ? `<a class="sponsor-setup-step__link" href="${escapeHtml(step.href)}">Go →</a>`
        : "";
      return `<li class="${stepClass}">${circle}<span class="${textClass}">${escapeHtml(step.label)}</span>${link}</li>`;
    }).join("");
  }

  function dutyStatusBadge(label, tone) {
    const cls =
      tone === "warn" ? "sponsor-duty-status sponsor-duty-status--warn" : tone === "none" ? "sponsor-duty-status sponsor-duty-status--none" : "sponsor-duty-status sponsor-duty-status--ok";
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
  }

  function renderDutyCards(duties, overview) {
    const grid = document.getElementById("sponsor-duty-cards");
    if (!grid || !Array.isArray(duties)) return;
    grid.hidden = false;
    const o = overview || {};
    const cards = duties.map((duty) => {
      let cardClass = "sponsor-duty-card";
      let statusLabel = "Not started";
      let statusTone = "none";
      let statHtml = "";

      if (duty.title === "Right to Work checks") {
        const total = o.rtw_total_checks ?? 0;
        statusLabel = total ? `${total} record${total === 1 ? "" : "s"}` : "0 records";
        statusTone = total ? "ok" : "none";
        if ((o.rtw_expiring_within_30_days ?? 0) > 0) {
          statHtml = `<p class="sponsor-duty-stat">${o.rtw_expiring_within_30_days} expiry due within 30 days</p>`;
        }
      } else if (duty.title === "Worker absences") {
        const alerts = o.absence_open_alerts ?? 0;
        const warning = o.absence_top_warning;
        if (alerts > 0 || warning) {
          cardClass += " sponsor-duty-card--alert";
          statusLabel = alerts ? `${alerts} open alert${alerts === 1 ? "" : "s"}` : "Streak warning";
          statusTone = "warn";
          if (warning) {
            statHtml = `<p class="sponsor-duty-stat sponsor-duty-stat--warn">${escapeHtml(warning.employee_name)} — day ${escapeHtml(warning.unexcused_streak)} of absence</p>`;
          }
        } else {
          statusLabel = "Clear";
          statusTone = "ok";
        }
      } else if (duty.title === "SMS change reporting") {
        const pending = o.sms_pending ?? 0;
        statusLabel = `${pending} pending`;
        statusTone = pending ? "warn" : "none";
      } else if (duty.title === "Recruitment & adverts") {
        const logged = o.advert_logged ?? 0;
        statusLabel = logged ? `${logged} logged` : "0 logged";
        statusTone = logged ? "ok" : "none";
      } else if (duty.title === "Record keeping & inspections") {
        statusLabel = (o.rtw_total_checks ?? 0) > 0 || auditExportTested() ? "Audit pack ready" : "Setup needed";
        statusTone = statusLabel === "Audit pack ready" ? "ok" : "none";
        const exportedNote = auditExportTested() ? "Audit export tested" : "Export not tested yet";
        statHtml = `<p class="sponsor-duty-stat"><button type="button" class="sponsor-duty-stat-link" id="sponsor-duty-export-now">${escapeHtml(exportedNote)} · Export now</button></p>`;
      }

      const fullWidth = duty.title === "Record keeping & inspections" ? " sponsor-duty-card--wide" : "";
      const icon = DUTY_CARD_ICONS[duty.title] || "shield-check";

      return `<article class="${cardClass}${fullWidth}">
        <div class="sponsor-duty-card__head">
          <h4 class="sponsor-duty-card__title">${escapeHtml(duty.title)}</h4>
          ${dutyStatusBadge(statusLabel, statusTone)}
        </div>
        <p class="sponsor-duty-card__duty"><strong>Your duty:</strong> ${escapeHtml(duty.customer_duty)}</p>
        <p class="sponsor-duty-card__sw"><strong>ShiftSwift HR:</strong> ${escapeHtml(duty.software_role)}</p>
        ${statHtml}
      </article>`;
    });
    grid.innerHTML = cards.join("");
    document.getElementById("sponsor-duty-export-now")?.addEventListener("click", () => {
      document.getElementById("audit-export-pdf")?.click();
    });
  }

  function renderEnabledBanner(ackData) {
    const banner = document.getElementById("sponsor-enabled-banner");
    const meta = document.getElementById("sponsor-enabled-meta");
    if (!banner) return;
    if (!ackData?.acknowledged) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const when = formatAckDate(ackData.acknowledged_at);
    const who = ackData.acknowledged_by || "Admin";
    if (meta) meta.textContent = when ? `Enabled ${when} by ${who}` : `Enabled by ${who}`;
  }

  function applyAcknowledgedLayout(acknowledged) {
    const panel = document.getElementById("sponsor-licence-ack-panel");
    const content = document.getElementById("compliance-tools-content");
    if (acknowledged) {
      if (panel) panel.hidden = true;
      content?.removeAttribute("hidden");
      window.dispatchEvent(new CustomEvent("admin:compliance-tools-ready"));
    } else {
      if (panel) panel.hidden = false;
      content?.setAttribute("hidden", "");
    }
  }

  function showEnabledOverview(ackData, dashboardData) {
    lastAckData = ackData;
    lastDashboardData = dashboardData;
    renderEnabledBanner(ackData);
    renderSetupChecklist(ackData, dashboardData?.duty_overview);
    renderDutyCards(ackData.duties, dashboardData?.duty_overview);
  }

  function hideEnabledOverview() {
    document.getElementById("sponsor-enabled-banner")?.setAttribute("hidden", "");
    document.getElementById("sponsor-setup-checklist")?.setAttribute("hidden", "");
    document.getElementById("sponsor-duty-cards")?.setAttribute("hidden", "");
  }

  async function refreshSponsorOverview() {
    try {
      const [ackRes, dashRes] = await Promise.all([
        apiFetch("/compliance/sponsor-licence/acknowledgement"),
        apiFetch("/compliance/sponsor-licence/dashboard"),
      ]);
      if (!ackRes.ok) return;
      const ackData = await ackRes.json();
      lastAckData = ackData;
      const dashboardData = dashRes.ok ? await dashRes.json() : lastDashboardData;
      if (dashboardData) lastDashboardData = dashboardData;
      if (ackData.acknowledged) {
        applyAcknowledgedLayout(true);
        showEnabledOverview(ackData, dashboardData);
      } else {
        applyAcknowledgedLayout(false);
        hideEnabledOverview();
      }
    } catch {
      /* overview is optional */
    }
  }

  function updateAckCheckboxState() {
    const holds = document.getElementById("sponsor-licence-holds");
    const understand = document.getElementById("sponsor-licence-understand");
    const accept = document.getElementById("sponsor-licence-accept");
    const btn = document.getElementById("sponsor-licence-ack-btn");
    const progress = document.getElementById("sponsor-ack-progress");
    const checked = [holds, understand, accept].filter((el) => el?.checked).length;
    const ready = checked === 3;
    if (btn) {
      btn.disabled = !ready;
      btn.classList.toggle("sponsor-ack-enable-btn--ready", ready);
    }
    if (progress) {
      progress.textContent = ready
        ? "All 3 confirmed — ready to enable"
        : `Tick all 3 boxes to continue — ${checked} of 3 confirmed`;
      progress.classList.toggle("sponsor-ack-progress--ready", ready);
    }
  }

  function populateAckPanel(data) {
    const disclaimer = document.getElementById("sponsor-licence-ack-disclaimer");
    if (disclaimer) {
      const parts = [data.tools_notice, data.ack_text].filter(Boolean);
      disclaimer.textContent = parts.join(" ");
    }
    ["sponsor-licence-holds", "sponsor-licence-understand", "sponsor-licence-accept"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    updateAckCheckboxState();
  }

  async function ensureSponsorLicenceAcknowledged() {
    const panel = document.getElementById("sponsor-licence-ack-panel");
    const content = document.getElementById("compliance-tools-content");
    if (!panel || !content) return true;

    try {
      const res = await apiFetch("/compliance/sponsor-licence/acknowledgement");
      if (res.status === 403) {
        panel.hidden = true;
        content.hidden = false;
        hideEnabledOverview();
        return true;
      }
      if (!res.ok) return false;
      const data = await res.json();
      lastAckData = data;
      if (data.acknowledged) {
        applyAcknowledgedLayout(true);
        populateAckPanel(data);
        let dashboardData = lastDashboardData;
        try {
          const dashRes = await apiFetch("/compliance/sponsor-licence/dashboard");
          if (dashRes.ok) {
            dashboardData = await dashRes.json();
            lastDashboardData = dashboardData;
          }
        } catch {
          /* dashboard optional */
        }
        showEnabledOverview(data, dashboardData);
        return true;
      }
      hideEnabledOverview();
      applyAcknowledgedLayout(false);
      populateAckPanel(data);
      bindAckPanel();
      return false;
    } catch {
      return false;
    }
  }

  function bindSponsorOverviewActions() {
    if (document.body.dataset.sponsorOverviewBound === "true") return;
    document.body.dataset.sponsorOverviewBound = "true";

    document.getElementById("sponsor-reread-duties")?.addEventListener("click", async () => {
      const section = document.getElementById("sponsor-duties-section");
      const cards = document.getElementById("sponsor-duty-cards");
      const status = document.getElementById("sponsor-licence-ack-status");
      if (status) status.textContent = "";

      if (lastAckData?.acknowledged) {
        applyAcknowledgedLayout(true);
      }

      if (lastAckData?.duties?.length) {
        renderDutyCards(lastAckData.duties, lastDashboardData?.duty_overview);
        renderSetupChecklist(lastAckData, lastDashboardData?.duty_overview);
        renderEnabledBanner(lastAckData);
      } else {
        await refreshSponsorOverview();
      }

      (section || cards)?.scrollIntoView({ behavior: "smooth", block: "start" });
      section?.classList.add("sponsor-duties-grid--highlight");
      window.setTimeout(() => section?.classList.remove("sponsor-duties-grid--highlight"), 1200);
    });

    document.getElementById("sponsor-banner-export-btn")?.addEventListener("click", () => {
      document.getElementById("audit-export-pdf")?.click();
    });
  }

  function bindAckPanel() {
    if (ackPanelBound) return;
    ackPanelBound = true;
    bindSponsorOverviewActions();

    ["sponsor-licence-holds", "sponsor-licence-understand", "sponsor-licence-accept"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", updateAckCheckboxState);
    });

    document.getElementById("sponsor-licence-ack-btn")?.addEventListener("click", async () => {
      const status = document.getElementById("sponsor-licence-ack-status");
      const holds = document.getElementById("sponsor-licence-holds");
      const understand = document.getElementById("sponsor-licence-understand");
      const accept = document.getElementById("sponsor-licence-accept");
      if (!holds?.checked || !understand?.checked || !accept?.checked) {
        updateAckCheckboxState();
        if (status) status.textContent = "Tick all three boxes before enabling.";
        return;
      }
      if (status) status.textContent = "Saving…";
      try {
        const res = await apiFetch("/compliance/sponsor-licence/acknowledgement", {
          method: "POST",
          body: JSON.stringify({ holds_sponsor_licence: true, accept_terms: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Could not save confirmation");
        if (status) status.textContent = "Confirmed. Loading compliance tools…";
        applyAcknowledgedLayout(true);
        lastAckData = data;
        showEnabledOverview(data, lastDashboardData);
        await initComplianceTools(true);
        if (status) status.textContent = "";
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    });
  }

  function riskPill(level) {
    const cls = level === "alert" ? "status-critical" : level === "warning" ? "status-warning" : "status-ok";
    const label = level === "alert" ? "Day 9+" : level === "warning" ? "Day 7–8" : "Clear";
    return `<span class="status-pill ${cls}">${escapeHtml(label)}</span>`;
  }

  async function loadAbsenceStreaks() {
    const tbody = document.getElementById("absence-streak-body");
    if (!tbody) return;
    try {
      const res = await apiFetch("/compliance/sponsor-licence/absence-streaks");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      renderTableBody(tbody, {
        emptyMessage: "No sponsored workers. Mark employees as sponsored to track absences.",
        columns: [
          {
            key: "employee_name",
            render: (r) => `<strong>${escapeHtml(r.employee_name)}</strong><div class="muted">#${escapeHtml(r.employee_id)}</div>`,
          },
          {
            key: "unexcused_streak",
            render: (r) => `<strong>${escapeHtml(r.unexcused_streak)}</strong> working days`,
          },
          { key: "paid_leave_days", render: (r) => escapeHtml(r.paid_leave_days) },
          { key: "unpaid_authorized_days", render: (r) => escapeHtml(r.unpaid_authorized_days) },
          { key: "risk_level", render: (r) => riskPill(r.risk_level) },
        ],
        rows: data.items || [],
      });
    } catch {
      renderTableBody(tbody, {
        columns: [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }, { key: "e" }],
        rows: [],
        emptyMessage: "No absence streak data yet — log absences as they occur.",
      });
    }
  }

  async function loadAbsenceDays() {
    const tbody = document.getElementById("absence-days-body");
    if (!tbody) return;
    try {
      const res = await apiFetch("/compliance/sponsor-licence/absence-days?limit=50");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      renderTableBody(tbody, {
        emptyMessage: "No absence days recorded yet.",
        columns: [
          { key: "absence_date", render: (r) => escapeHtml(r.absence_date) },
          {
            key: "employee_name",
            render: (r) => `<strong>${escapeHtml(r.employee_name)}</strong>`,
          },
          { key: "excuse_label", render: (r) => escapeHtml(r.excuse_label) },
          {
            key: "paid",
            render: (r) => (r.paid ? "Paid" : "Unpaid"),
          },
          {
            key: "is_excused",
            render: (r) => (r.is_excused ? "<span class='muted'>No</span>" : `<strong>Yes</strong>`),
          },
          {
            key: "actions",
            render: (r) =>
              `<button type="button" class="btn ghost" data-del-absence="${escapeHtml(r.employee_id)}" data-del-date="${escapeHtml(r.absence_date)}">Remove</button>`,
          },
        ],
        rows: data.items || [],
      });

      tbody.querySelectorAll("[data-del-absence]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!window.confirm("Remove this absence day record?")) return;
          await apiFetch(
            `/compliance/sponsor-licence/absence-days/${btn.dataset.delAbsence}/${btn.dataset.delDate}`,
            { method: "DELETE" }
          );
          await loadAbsenceDays();
          await loadAbsenceStreaks();
          window.dispatchEvent(new CustomEvent("admin:compliance-refresh"));
          window.dispatchEvent(new CustomEvent("admin:absence-refresh"));
        });
      });
    } catch {
      renderTableBody(tbody, {
        columns: [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }, { key: "e" }, { key: "f" }],
        rows: [],
        emptyMessage: "No absence days recorded yet.",
      });
    }
  }

  async function loadWorkingCalendar() {
    const tbody = document.getElementById("working-calendar-body");
    if (!tbody) return;
    const year = new Date().getFullYear();
    try {
      const res = await apiFetch(
        `/compliance/sponsor-licence/working-calendar?from_date=${year}-01-01&to_date=${year}-12-31&non_working_only=true`
      );
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      renderTableBody(tbody, {
        emptyMessage: "No custom calendar entries. All weekdays count as working days.",
        columns: [
          { key: "calendar_date", render: (r) => escapeHtml(r.calendar_date) },
          { key: "label", render: (r) => escapeHtml(r.label) },
          {
            key: "actions",
            render: (r) =>
              `<button type="button" class="btn ghost" data-reset-cal="${escapeHtml(r.calendar_date)}">Mark working day</button>`,
          },
        ],
        rows: data.items || [],
      });

      tbody.querySelectorAll("[data-reset-cal]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await apiFetch("/compliance/sponsor-licence/working-calendar", {
            method: "PUT",
            body: JSON.stringify({
              entries: [{ calendar_date: btn.dataset.resetCal, is_working_day: true }],
            }),
          });
          loadWorkingCalendar();
        });
      });
    } catch {
      renderTableBody(tbody, {
        columns: [{ key: "a" }, { key: "b" }, { key: "c" }],
        rows: [],
        emptyMessage: "No custom calendar entries. All weekdays count as working days.",
      });
    }
  }

  async function mountAbsenceDayForm() {
    const host = document.getElementById("absence-day-form");
    if (!host || host.dataset.mounted === "true") return;
    await loadFormOptions();
    await loadEmployees();
    mountEditForm(host, FORM_SCHEMAS.absenceDay, {
      onSubmit: async (payload) => {
        const res = await apiFetch("/compliance/sponsor-licence/absence-days", {
          method: "POST",
          body: JSON.stringify({
            employee_id: Number(payload.employee_id),
            absence_date: payload.absence_date,
            excuse_type: payload.excuse_type,
            source: "admin",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Save failed");
        await loadAbsenceDays();
        await loadAbsenceStreaks();
        window.dispatchEvent(new CustomEvent("admin:compliance-refresh"));
        window.dispatchEvent(new CustomEvent("admin:absence-refresh"));
      },
    });
    host.dataset.mounted = "true";
  }

  async function mountWorkingCalendarForm() {
    const host = document.getElementById("working-calendar-form");
    if (!host || host.dataset.mounted === "true") return;
    mountEditForm(host, FORM_SCHEMAS.workingCalendar, {
      onSubmit: async (payload) => {
        const res = await apiFetch("/compliance/sponsor-licence/working-calendar", {
          method: "PUT",
          body: JSON.stringify({
            entries: [
              {
                calendar_date: payload.calendar_date,
                is_working_day: !payload.is_non_working,
              },
            ],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Save failed");
        await loadWorkingCalendar();
      },
    });
    host.dataset.mounted = "true";
  }

  async function loadReportingTriggers() {
    const tbody = document.getElementById("reporting-triggers-body");
    if (!tbody) return;
    try {
      const res = await apiFetch("/compliance/sponsor-licence/reporting-triggers?status=open");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      renderTableBody(tbody, {
        emptyMessage: "No open Home Office reporting triggers.",
        columns: [
          { key: "trigger_type", render: (r) => `<strong>${escapeHtml(r.trigger_type)}</strong>` },
          { key: "employee_id", render: (r) => escapeHtml(r.employee_id) },
          { key: "description", render: (r) => escapeHtml(r.description) },
          { key: "deadline_date", render: (r) => escapeHtml(r.deadline_date || "Not set") },
          {
            key: "actions",
            render: (r) =>
              `<div class="table-actions">
                <button type="button" class="btn ghost btn-sm" data-ack="${r.id}">Acknowledge</button>
                <button type="button" class="btn ghost btn-sm" data-report="${r.id}">Reported</button>
              </div>`,
          },
        ],
        rows: data.items || [],
      });

      tbody.querySelectorAll("[data-ack]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await apiFetch(`/compliance/sponsor-licence/reporting-triggers/${btn.dataset.ack}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "acknowledged" }),
          });
          loadReportingTriggers();
        });
      });
      tbody.querySelectorAll("[data-report]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const ref = window.prompt("Home Office SMS report reference:");
          if (!ref) return;
          await apiFetch(`/compliance/sponsor-licence/reporting-triggers/${btn.dataset.report}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "reported", report_reference: ref }),
          });
          loadReportingTriggers();
        });
      });
    } catch {
      renderTableBody(tbody, {
        columns: [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }, { key: "e" }],
        rows: [],
        emptyMessage: "No open reporting triggers.",
      });
    }
  }

  async function mountShareCodeForm() {
    const host = document.getElementById("share-code-form");
    if (!host || host.dataset.mounted === "true") return;
    await loadFormOptions();
    await loadEmployees();
    mountEditForm(host, FORM_SCHEMAS.shareCodeVerify, {
      onSubmit: async (payload) => {
        const res = await apiFetch("/compliance/sponsor-licence/rtw-verify-share-code", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Verification failed");
        const panel = document.getElementById("share-code-result");
        if (panel) {
          panel.hidden = false;
          panel.innerHTML = `<p class="promo-result-message promo-result-message--ok">${escapeHtml(data.message || "Verified")} · RTW: ${escapeHtml(data.rtw_status)} · Expiry: ${escapeHtml(data.expiry_date || "Not set")} · Mode: ${escapeHtml(data.mode)}</p>`;
        }
        window.dispatchEvent(new CustomEvent("admin:rtw-refresh"));
      },
    });
    host.dataset.mounted = "true";
  }

  function mountRtwUploadForm() {
    const host = document.getElementById("rtw-upload-form");
    if (!host || host.dataset.mounted === "true") return;
    host.innerHTML = `
      <form class="edit-form edit-form--cols-2" id="rtw-upload">
        <label class="edit-field"><span class="edit-label">Employee ID</span><input name="employee_id" type="number" required /></label>
        <label class="edit-field"><span class="edit-label">Check date</span><input name="check_date" type="date" required /></label>
        <label class="edit-field"><span class="edit-label">Method</span><input name="check_method" value="Manual PDF upload" required /></label>
        <label class="edit-field"><span class="edit-label">Outcome</span>
          <select name="outcome" required>
            <option value="pass">Pass</option>
            <option value="time_limited">Time limited</option>
            <option value="fail">Fail</option>
          </select>
        </label>
        <label class="edit-field"><span class="edit-label">Expiry date</span><input name="expiry_date" type="date" /></label>
        <label class="edit-field" data-span="2"><span class="edit-label">RTW evidence PDF</span><input name="evidence_pdf" type="file" accept="application/pdf" required /></label>
        <div class="edit-form-actions" data-span="2">
          <button class="btn" type="submit">Store immutable RTW PDF</button>
          <p class="edit-form-status muted" data-status></p>
        </div>
      </form>`;
    host.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = form.querySelector("[data-status]");
      if (status) status.textContent = "Uploading…";
      const fd = new FormData(form);
      fd.set("checker_user_id", localStorage.getItem("username") || "hr");
      try {
        const res = await fetch(`${API_BASE}/compliance/sponsor-licence/rtw-checks`, {
          method: "POST",
          headers: authHeaders(false),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Upload failed");
        if (status) status.textContent = `Stored check #${data.check_id} · SHA ${data.content_sha256?.slice(0, 12)}…`;
        form.reset();
        window.dispatchEvent(new CustomEvent("admin:compliance-refresh"));
        window.dispatchEvent(new CustomEvent("admin:rtw-refresh"));
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    });
    host.dataset.mounted = "true";
  }

  async function initComplianceTools(skipAckCheck = false) {
    bindSponsorOverviewActions();
    if (!skipAckCheck) {
      const ready = await ensureSponsorLicenceAcknowledged();
      if (!ready) return;
    }
    mountRtwUploadForm();
    await Promise.all([
      mountShareCodeForm(),
      mountAbsenceDayForm(),
      mountWorkingCalendarForm(),
      loadWorkingCalendar(),
      loadReportingTriggers(),
    ]);

    document.getElementById("audit-export-json")?.addEventListener("click", async () => {
      const employeeId = document.getElementById("audit-export-employee")?.value;
      const path = employeeId
        ? `/compliance/sponsor-licence/audit-export?employee_id=${encodeURIComponent(employeeId)}`
        : "/compliance/sponsor-licence/audit-export";
      const res = await apiFetch(path);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-pack-business-${window.Admin.TENANT_ID}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById("audit-export-pdf")?.addEventListener("click", async () => {
      const employeeId = document.getElementById("audit-export-employee")?.value;
      let path = "/compliance/sponsor-licence/audit-export?format=pdf";
      if (employeeId) path += `&employee_id=${encodeURIComponent(employeeId)}`;
      await downloadAuthenticated(path, `audit-pack-business-${window.Admin.TENANT_ID}.pdf`);
      markAuditExportTested();
      refreshSponsorOverview();
    });

    window.dispatchEvent(new CustomEvent("admin:rtw-refresh"));
    window.dispatchEvent(new CustomEvent("admin:absence-refresh"));
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "compliance" && !complianceReady) {
      complianceReady = true;
      initComplianceTools();
    }
  });

  window.refreshSponsorComplianceOverview = refreshSponsorOverview;

  window.addEventListener("admin:deferred-ready", () => {
    if (
      document.body.dataset.mobileTab === "compliance" ||
      /#compliance/i.test(window.location.hash)
    ) {
      if (!complianceReady) {
        complianceReady = true;
        initComplianceTools();
        return;
      }
      refreshSponsorOverview();
    }
  });

  window.addEventListener("admin:compliance-refresh", () => {
    refreshSponsorOverview();
  });

  if (parseHashBaseSection(window.location.hash) === "compliance") {
    complianceReady = true;
    initComplianceTools();
  }
})();
