const { apiFetch, loadFormOptions, mountEditForm, renderTableBody, FORM_SCHEMAS, escapeHtml, statusClass, initNavigation, parseHashBaseSection } = window.Admin;

function renderAbsenceStreaks(items) {
  const list = document.getElementById("absence-streak-summary");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = "<li class='muted'>No sponsored workers tracked.</li>";
    return;
  }
  const atRisk = items.filter((item) => item.risk_level !== "clear");
  if (!atRisk.length) {
    list.innerHTML = `<li class='muted'>All ${items.length} sponsored worker(s) clear. No unexcused streaks at day 7+.</li>`;
    return;
  }
  list.innerHTML = atRisk
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.employee_name)}</strong>: ${escapeHtml(item.unexcused_streak)} unexcused working day(s) · paid leave ${escapeHtml(item.paid_leave_days)}d · unpaid auth. ${escapeHtml(item.unpaid_authorized_days)}d</li>`
    )
    .join("");
}

function renderAbsenceAlerts(items) {
  const list = document.getElementById("absence-alert-list");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = "<li class='muted'>No active day-9 absence alerts.</li>";
    return;
  }
  list.innerHTML = items
    .map(
      (item) =>
        `<li><strong>Employee #${escapeHtml(item.employee_id)}</strong>: ${escapeHtml(item.consecutive_working_days)} consecutive working days absent. Report by ${escapeHtml(item.home_office_report_required_by || "Not set")}.</li>`
    )
    .join("");
}

function renderSmsChanges(items) {
  const list = document.getElementById("sms-change-list");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = "<li class='muted'>No open SMS reporting changes.</li>";
    return;
  }
  list.innerHTML = items
    .map(
      (item) =>
        `<li><span class="status-pill ${statusClass(item.alert_status)}">${escapeHtml(item.alert_status)}</span> Employee #${escapeHtml(item.employee_id)}: <strong>${escapeHtml(item.field_name)}</strong> changed to "${escapeHtml(item.new_value || "")}". SMS deadline ${escapeHtml(item.sms_reporting_deadline)}</li>`
    )
    .join("");
}

function renderGovLinks(links) {
  const container = document.getElementById("gov-recruitment-links");
  if (!container) return;
  if (!links?.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = links
    .map((item) => `<a class="link-chip" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`)
    .join("");
}

function renderAdvertRecords(items) {
  const body = document.getElementById("advert-records-body");
  if (!body) return;
  renderTableBody(body, {
    emptyMessage: "No advertisement records yet. Add a vacancy advert with its primary URL.",
    columns: [
      {
        key: "job_title",
        render: (item) =>
          `<strong>${escapeHtml(item.job_title)}</strong>${item.job_reference ? `<div class="muted">${escapeHtml(item.job_reference)}</div>` : ""}`,
      },
      { key: "platform", render: (item) => escapeHtml(item.platform) },
      { key: "posted_date", render: (item) => escapeHtml(item.posted_date || "Not set") },
      {
        key: "advert_url",
        render: (item) => `<a href="${escapeHtml(item.advert_url)}" target="_blank" rel="noopener">Open advert</a>`,
      },
      {
        key: "links",
        render: (item) => {
          const extra = [...(item.links || []), ...(item.additional_links || [])];
          if (!extra.length) return "<span class='muted'>None</span>";
          return `<ul class="link-list">${extra
            .map((link) => {
              const url = link.url || link.link_url;
              const label = link.label || link.link_label || "Link";
              return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a></li>`;
            })
            .join("")}</ul>`;
        },
      },
    ],
    rows: items,
  });
}

function updateAdvertSummary(summary) {
  const active = document.getElementById("advert-active-count");
  const sponsored = document.getElementById("advert-sponsored-count");
  if (active) active.textContent = String(summary?.active_records ?? 0);
  if (sponsored) sponsored.textContent = String(summary?.sponsored_vacancy_records ?? 0);
  const pill = document.getElementById("advert-status-pill");
  if (pill) {
    const needsReview = (summary?.needs_review ?? 0) > 0;
    pill.textContent = needsReview ? "Review" : "Logged";
    pill.className = `status-pill ${needsReview ? "status-warning" : "status-ok"}`;
  }
}

async function loadAdvertRecords() {
  try {
    const res = await apiFetch("/compliance/sponsor-licence/advertisement-records");
    if (!res.ok) throw new Error("API unavailable");
    const data = await res.json();
    renderAdvertRecords(data.items || []);
  } catch {
    renderAdvertRecords([]);
  }
}

async function loadComplianceDashboard() {
  const checklistLink = document.getElementById("rtw-checklist-link");
  try {
    const linksRes = await apiFetch("/compliance/sponsor-licence/recruitment-links");
    if (linksRes.ok) {
      const linksData = await linksRes.json();
      renderGovLinks(linksData.links || []);
    }
  } catch {
    renderGovLinks([]);
  }

  try {
    const checklistRes = await apiFetch("/compliance/sponsor-licence/checklist");
    if (checklistRes.ok) {
      const checklist = await checklistRes.json();
      if (checklistLink && checklist.url) checklistLink.href = checklist.url;
    }
  } catch {
    if (checklistLink) checklistLink.removeAttribute("href");
  }

  try {
    const res = await apiFetch("/compliance/sponsor-licence/dashboard");
    if (!res.ok) throw new Error("API unavailable");
    const data = await res.json();

    const rtwValid = document.getElementById("rtw-valid-count");
    if (rtwValid) rtwValid.textContent = String(data.rtw?.valid_checks ?? 0);
    const rtwExpired = document.getElementById("rtw-expired-count");
    if (rtwExpired) rtwExpired.textContent = String(data.rtw?.expired_checks ?? 0);
    const rtwPill = document.getElementById("rtw-status-pill");
    if (rtwPill) {
      rtwPill.textContent = (data.rtw?.expired_checks ?? 0) > 0 ? "Action required" : "Compliant";
      rtwPill.className = `status-pill ${(data.rtw?.expired_checks ?? 0) > 0 ? "status-warning" : "status-ok"}`;
    }

    renderAbsenceAlerts(data.absence_alerts || []);
    renderAbsenceStreaks(data.absence_streaks || []);
    renderSmsChanges(data.sms_change_alerts || []);
    updateAdvertSummary(data.advertisement_records || {});
    renderAdvertRecords(data.recent_advertisement_records || []);
    if (data.gov_recruitment_links) renderGovLinks(data.gov_recruitment_links);

    const absencePill = document.getElementById("absence-status-pill");
    if (absencePill) {
      const alerts = data.absence_alerts || [];
      const streaks = data.absence_streaks || [];
      const atRisk = streaks.some((s) => s.risk_level === "alert" || s.risk_level === "warning");
      if (alerts.length) {
        absencePill.textContent = "Alerts active";
        absencePill.className = "status-pill status-critical";
      } else if (atRisk) {
        absencePill.textContent = "Streak warning";
        absencePill.className = "status-pill status-warning";
      } else {
        absencePill.textContent = "Clear";
        absencePill.className = "status-pill status-ok";
      }
    }
    const smsPill = document.getElementById("sms-status-pill");
    if (smsPill) {
      const overdue = (data.sms_change_alerts || []).some((x) => x.alert_status === "overdue");
      smsPill.textContent = overdue ? "Overdue" : "Monitoring";
      smsPill.className = `status-pill ${overdue ? "status-critical" : "status-warning"}`;
    }
    if (typeof window.refreshSponsorComplianceOverview === "function") {
      window.refreshSponsorComplianceOverview();
    }
  } catch {
    const rtwValid = document.getElementById("rtw-valid-count");
    if (rtwValid) rtwValid.textContent = "0";
    const rtwExpired = document.getElementById("rtw-expired-count");
    if (rtwExpired) rtwExpired.textContent = "0";
    const advertActive = document.getElementById("advert-active-count");
    if (advertActive) advertActive.textContent = "0";
    const advertSponsored = document.getElementById("advert-sponsored-count");
    if (advertSponsored) advertSponsored.textContent = "0";
    renderAbsenceAlerts([]);
    renderSmsChanges([]);
    renderAdvertRecords([]);
    const note = document.querySelector(".legal-note-copy");
    if (note) {
      note.textContent +=
        " Connect the backend API to load live sponsor-compliance alerts.";
    }
  }
}

async function mountAdvertForm() {
  const host = document.getElementById("advert-form");
  if (!host) return;
  try {
    await loadFormOptions();
  } catch {
    /* metadata optional for retry on submit */
  }
  mountEditForm(host, FORM_SCHEMAS.advert, {
    onSubmit: async (payload, form) => {
      const body = {
        job_title: payload.job_title,
        platform: payload.platform,
        advert_url: payload.advert_url,
        posted_date: payload.posted_date,
        closing_date: payload.closing_date || null,
        job_reference: payload.job_reference || null,
        is_sponsored_vacancy: Boolean(payload.is_sponsored_vacancy),
        extra_links: payload.extra_link_url
          ? [{ label: payload.extra_link_label || "Related link", url: payload.extra_link_url, type: "archive" }]
          : [],
      };
      const res = await apiFetch("/compliance/sponsor-licence/advertisement-records", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Save failed");
      form.reset();
      const sponsored = form.querySelector('[name="is_sponsored_vacancy"]');
      if (sponsored) sponsored.checked = true;
      await loadComplianceDashboard();
      await loadAdvertRecords();
    },
  });
}

initNavigation();
window.AdminMobile?.init?.();

let complianceReady = false;

window.addEventListener("admin:section", (event) => {
  if (event.detail?.section === "compliance" && !complianceReady) {
    complianceReady = true;
    loadComplianceDashboard();
    mountAdvertForm();
  }
});

if (parseHashBaseSection(window.location.hash) === "compliance") {
  complianceReady = true;
  loadComplianceDashboard();
  mountAdvertForm();
}
