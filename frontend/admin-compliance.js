/** Compliance admin tools — RTW, absence, calendar, audit export, reporting triggers. */
(async function initAdminComplianceTools() {
  const { apiFetch, loadFormOptions, loadEmployees, mountEditForm, renderTableBody, FORM_SCHEMAS, escapeHtml, statusPill, downloadAuthenticated, authHeaders, API_BASE, parseHashBaseSection, readApiError, parseApiDetail, formatDisplayDate, friendlyNativeError } = window.Admin;

  let complianceReady = false;
  let ackPanelBound = false;
  let lastAckData = null;
  let lastDashboardData = null;

  const AUDIT_EXPORT_FLAG_KEY = `sponsor_audit_export_done_${window.Admin?.TENANT_ID ?? "default"}`;
  const DUTIES_EXPANDED_KEY = `sponsor_duties_expanded_${window.Admin?.TENANT_ID ?? "default"}`;

  const SETUP_STEPS = [
    {
      id: "enabled",
      label: "Enabled",
      fullLabel: "Employer compliance enabled",
      href: null,
    },
    {
      id: "sponsored_worker",
      label: "Sponsored worker",
      fullLabel: "First sponsored worker added",
      href: "#employees",
    },
    {
      id: "rtw_upload",
      label: "RTW documents",
      fullLabel: "Upload right-to-work documents",
      href: "#compliance/rtw",
    },
    {
      id: "absence_monitoring",
      label: "Absence monitoring",
      fullLabel: "Enable absence monitoring for sponsored workers",
      href: "#compliance/absence",
    },
    {
      id: "audit_export",
      label: "Audit pack",
      fullLabel: "Test audit pack export",
      href: "#compliance/audit-export",
    },
  ];

  const DUTY_CARD_LINKS = {
    "Right to Work checks": "#compliance/rtw",
    "Worker absences": "#compliance/absence",
    "SMS change reporting": "#compliance/reporting",
    "Recruitment & adverts": "#compliance/adverts",
    "Record keeping & inspections": "#compliance/audit-export",
  };

  const DUTY_CARD_ICONS = {
    "Right to Work checks": "passport",
    "Worker absences": "calendar-off",
    "SMS change reporting": "mail",
    "Recruitment & adverts": "sparkles",
    "Record keeping & inspections": "folder",
  };

  function formatAckDate(iso) {
    const text = formatDisplayDate ? formatDisplayDate(iso) : "";
    return !text || text === "—" ? "" : text;
  }

  function fillAuditExportEmployees(employees) {
    const select = document.getElementById("audit-export-employee");
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">All employees</option>${(employees || [])
      .map((emp) => `<option value="${escapeHtml(emp.value)}">${escapeHtml(emp.label)}</option>`)
      .join("")}`;
    if (current && [...select.options].some((opt) => opt.value === current)) {
      select.value = current;
    }
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

  function dutiesExpanded() {
    return localStorage.getItem(DUTIES_EXPANDED_KEY) === "1";
  }

  function applyDutiesExpanded(expanded) {
    const section = document.getElementById("sponsor-duties-section");
    const btn = document.getElementById("sponsor-toggle-duties");
    section?.classList.toggle("sponsor-duties-section--open", expanded);
    if (!btn) return;
    btn.setAttribute("aria-pressed", expanded ? "true" : "false");
    btn.textContent = expanded ? "Hide duties" : "Show duties & responsibilities";
    btn.classList.toggle("sponsor-duties-toggle--on", expanded);
  }

  function setDutiesExpanded(expanded) {
    localStorage.setItem(DUTIES_EXPANDED_KEY, expanded ? "1" : "0");
    applyDutiesExpanded(expanded);
  }

  const COMPLIANCE_PANE_IDS = {
    dashboard: ["compliance-absence"],
    absence: ["compliance-absence"],
    rtw: ["compliance-rtw"],
    reporting: ["compliance-reporting"],
    adverts: ["compliance-adverts"],
    "audit-export": ["compliance-audit-export"],
  };

  const COMPLIANCE_PANE_HASH = {
    dashboard: "compliance",
    rtw: "compliance/rtw",
    reporting: "compliance/reporting",
    adverts: "compliance/adverts",
    "audit-export": "compliance/audit-export",
  };

  const COMPLIANCE_PANE_ARTICLE_IDS = [
    "compliance-absence",
    "compliance-rtw",
    "compliance-reporting",
    "compliance-adverts",
    "compliance-audit-export",
  ];

  function compliancePaneFromHash(rawHash = window.location.hash) {
    const raw = String(rawHash || "").replace("#", "");
    const parts = raw.split("/").filter(Boolean);
    const idPanes = {
      "compliance-rtw": "rtw",
      "compliance-absence": "dashboard",
      "compliance-reporting": "reporting",
      "compliance-adverts": "adverts",
      "compliance-audit-export": "audit-export",
    };
    if (idPanes[parts[0]]) return idPanes[parts[0]];
    if (parts[0] !== "compliance") return "dashboard";
    const sub = parts[1] || "dashboard";
    if (sub === "absence" || sub === "dashboard") return "dashboard";
    if (COMPLIANCE_PANE_IDS[sub]) return sub;
    return "dashboard";
  }

  function syncLeaveSponsorCalendar(acknowledged = tenantAlreadyAcknowledged()) {
    const host = document.getElementById("leave-sponsor-calendar");
    if (host) host.hidden = !acknowledged;
  }

  function renderAlertBoard(dashboardData) {
    const host = document.getElementById("sponsor-alert-board");
    if (!host) return;
    const o = dashboardData?.duty_overview || {};
    const rtw = dashboardData?.rtw || {};
    const day9 = Number(o.absence_open_alerts ?? dashboardData?.absence_alerts?.length ?? 0);
    const warning = o.absence_top_warning;
    const rtwExpiring = Number(o.rtw_expiring_within_30_days ?? rtw.expiring_within_30_days ?? 0);
    const rtwExpired = Number(rtw.expired_checks ?? 0);
    const smsPending = Number(o.sms_pending ?? dashboardData?.sms_change_alerts?.length ?? 0);
    const reporting = Number(o.open_reporting_triggers ?? 0);
    const items = [];
    if (day9 > 0 || warning) {
      const detail = warning
        ? `${escapeHtml(warning.employee_name)} — day ${escapeHtml(warning.unexcused_streak)}`
        : "Home Office reporting window";
      items.push({
        tone: "danger",
        href: "#compliance",
        title: day9 ? `${day9} day-9 absence alert${day9 === 1 ? "" : "s"}` : "Absence streak warning",
        detail,
      });
    }
    if (rtwExpired > 0) {
      items.push({
        tone: "danger",
        href: "#compliance/rtw",
        title: `${rtwExpired} RTW record${rtwExpired === 1 ? "" : "s"} expired`,
        detail: "Needs a new check",
      });
    }
    if (rtwExpiring > 0) {
      items.push({
        tone: "warn",
        href: "#compliance/rtw",
        title: `${rtwExpiring} RTW expiring within 30 days`,
        detail: "All staff with time-limited status",
      });
    }
    if (smsPending > 0) {
      items.push({
        tone: "warn",
        href: "#compliance/reporting",
        title: `${smsPending} SMS change${smsPending === 1 ? "" : "s"} pending`,
        detail: "Report via Home Office SMS",
      });
    }
    if (reporting > 0) {
      items.push({
        tone: "warn",
        href: "#compliance/reporting",
        title: `${reporting} reporting trigger${reporting === 1 ? "" : "s"} open`,
        detail: "Suspension or offboarding follow-up",
      });
    }
    host.hidden = false;
    if (!items.length) {
      host.innerHTML = `<article class="sponsor-alert-card sponsor-alert-card--ok">
        <strong>All clear</strong>
        <p>No day-9, RTW expiry, or SMS alerts for staff right now.</p>
      </article>`;
      return;
    }
    host.innerHTML = items
      .map(
        (item) => `<a class="sponsor-alert-card sponsor-alert-card--${item.tone}" href="${escapeHtml(item.href)}">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${item.detail}</p>
        </a>`
      )
      .join("");
  }

  function syncCompliancePane(rawHash = window.location.hash) {
    const raw = String(rawHash || "").replace("#", "");
    const parts = raw.split("/").filter(Boolean);
    if (
      raw === "compliance-holidays" ||
      raw === "compliance-working-calendar" ||
      (parts[0] === "compliance" && (parts[1] === "holidays" || parts[1] === "working-calendar"))
    ) {
      window.location.hash = "leave";
      return;
    }
    const pane = compliancePaneFromHash(rawHash);
    const section = document.getElementById("compliance");
    section?.setAttribute("data-compliance-pane", pane);
    document.querySelectorAll("#compliance-subnav [data-compliance-pane]").forEach((link) => {
      const active = link.dataset.compliancePane === pane;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const visible = new Set(COMPLIANCE_PANE_IDS[pane] || COMPLIANCE_PANE_IDS.dashboard);
    COMPLIANCE_PANE_ARTICLE_IDS.forEach((id) => {
      const article = document.getElementById(id);
      if (!article) return;
      const show = visible.has(id);
      article.classList.toggle("compliance-pane--active", show);
      article.toggleAttribute("hidden", !show);
    });
    document.querySelectorAll("#compliance-pane-stage > .legal-note").forEach((article) => {
      const show = pane === "dashboard";
      article.classList.toggle("compliance-pane--active", show);
      article.toggleAttribute("hidden", !show);
    });
  }

  function setComplianceHash(hash) {
    const next = String(hash || "compliance").replace(/^#/, "");
    const target = `#${next}`;
    const subnav = document.getElementById("compliance-subnav");
    const pin = subnav?.getBoundingClientRect().top;
    if ((window.location.hash || "#") !== target) {
      history.replaceState(null, "", target);
    }
    syncCompliancePane(target);
    if (pin != null && subnav) {
      const delta = subnav.getBoundingClientRect().top - pin;
      if (Math.abs(delta) > 1) window.scrollBy(0, delta);
    }
  }

  function bindCompliancePaneNav() {
    const section = document.getElementById("compliance");
    if (!section || section.dataset.paneNavBound === "true") return;
    section.dataset.paneNavBound = "true";
    section.addEventListener("click", (event) => {
      const tab = event.target.closest("#compliance-subnav [data-compliance-pane]");
      if (tab) {
        event.preventDefault();
        const pane = tab.dataset.compliancePane || "dashboard";
        setComplianceHash(COMPLIANCE_PANE_HASH[pane] || "compliance");
        if (pane === "rtw") window.dispatchEvent(new CustomEvent("admin:rtw-refresh"));
        return;
      }
      const link = event.target.closest('a[href^="#compliance"]');
      if (!link || link.target === "_blank") return;
      const href = link.getAttribute("href") || "";
      if (!href.startsWith("#compliance")) return;
      event.preventDefault();
      setComplianceHash(href);
      if (/#compliance\/rtw/i.test(href)) window.dispatchEvent(new CustomEvent("admin:rtw-refresh"));
    });
  }

  function renderSetupChecklist(ackData, overview) {
    const card = document.getElementById("sponsor-setup-checklist");
    const list = document.getElementById("sponsor-setup-steps");
    const progress = document.getElementById("sponsor-setup-progress");
    const bar = document.getElementById("sponsor-setup-bar");
    if (!card || !list) return;
    if (!ackData?.acknowledged) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const completed = SETUP_STEPS.filter((step) => setupStepComplete(step.id, ackData, overview)).length;
    const percent = Math.round((completed / SETUP_STEPS.length) * 100);
    if (progress) progress.textContent = `${completed} of ${SETUP_STEPS.length}`;
    if (bar) bar.style.width = `${percent}%`;
    card.classList.toggle("sponsor-setup-rail--complete", completed === SETUP_STEPS.length);
    list.innerHTML = SETUP_STEPS.map((step, index) => {
      const done = setupStepComplete(step.id, ackData, overview);
      const mark = done
        ? `<span class="sponsor-setup-chip__mark" aria-hidden="true">✓</span>`
        : `<span class="sponsor-setup-chip__mark">${index + 1}</span>`;
      const title = escapeHtml(step.fullLabel || step.label);
      const label = `<span class="sponsor-setup-chip__label">${escapeHtml(step.label)}</span>`;
      const chipClass = done
        ? "sponsor-setup-chip sponsor-setup-chip--done"
        : "sponsor-setup-chip sponsor-setup-chip--todo";
      if (!done && step.href) {
        return `<li class="${chipClass}" title="${title}"><a class="sponsor-setup-chip__link" href="${escapeHtml(step.href)}">${mark}${label}<span class="sponsor-setup-chip__go">Go</span></a></li>`;
      }
      return `<li class="${chipClass}" title="${title}">${mark}${label}</li>`;
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
      const icon = DUTY_CARD_ICONS[duty.title] || "shield";
      const href = DUTY_CARD_LINKS[duty.title] || "";
      const hrefAttr = href
        ? ` data-href="${escapeHtml(href)}" role="link" tabindex="0"`
        : "";

      return `<article class="${cardClass}${fullWidth}${href ? " sponsor-duty-card--link" : ""}"${hrefAttr}>
        <div class="sponsor-duty-card__head">
          <span class="sponsor-duty-card__icon" aria-hidden="true">${window.AdminIcons?.svg?.(icon) || ""}</span>
          <h4 class="sponsor-duty-card__title">${escapeHtml(duty.title)}</h4>
          ${dutyStatusBadge(statusLabel, statusTone)}
        </div>
        ${statHtml}
        <div class="sponsor-duty-card__details">
          <div class="sponsor-duty-note sponsor-duty-note--you">
            <span class="sponsor-duty-note__label">Your duty</span>
            <p>${escapeHtml(duty.customer_duty)}</p>
          </div>
          <div class="sponsor-duty-note sponsor-duty-note--app">
            <span class="sponsor-duty-note__label">ShiftSwift HR</span>
            <p>${escapeHtml(duty.software_role)}</p>
          </div>
        </div>
      </article>`;
    });
    grid.innerHTML = cards.join("");
    document.getElementById("sponsor-duty-export-now")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.getElementById("audit-export-pdf")?.click();
    });
    grid.querySelectorAll("[data-href]").forEach((card) => {
      const go = () => {
        const href = card.getAttribute("data-href") || "";
        const hash = href.replace(/^#/, "");
        const sectionId = hash.includes("/") ? hash.replace("/", "-") : hash;
        if (hash) setComplianceHash(hash);
        window.AdminComplianceMobile?.setOpenSection?.(sectionId, { scroll: false, toggle: false });
        if (hash.includes("rtw")) window.dispatchEvent(new CustomEvent("admin:rtw-refresh"));
      };
      card.addEventListener("click", (event) => {
        if (event.target.closest("button, a")) return;
        go();
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("button, a")) return;
        event.preventDefault();
        go();
      });
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

  function tenantAlreadyAcknowledged() {
    return Boolean(window.Admin?.tenantFeatures?.sponsor_licence_acknowledged);
  }

  function markTenantAcknowledged() {
    if (window.Admin?.tenantFeatures) {
      window.Admin.tenantFeatures.sponsor_licence_acknowledged = true;
      window.Admin.tenantFeatures.holds_sponsor_licence = true;
    }
  }

  function applyAcknowledgedLayout(acknowledged) {
    const panel = document.getElementById("sponsor-licence-ack-panel");
    const content = document.getElementById("compliance-tools-content");
    if (acknowledged) {
      if (panel) {
        panel.hidden = true;
        panel.setAttribute("hidden", "");
      }
      content?.removeAttribute("hidden");
      syncLeaveSponsorCalendar(true);
      syncCompliancePane();
      window.dispatchEvent(new CustomEvent("admin:compliance-tools-ready"));
    } else {
      if (panel) {
        panel.hidden = false;
        panel.removeAttribute("hidden");
      }
      content?.setAttribute("hidden", "");
      syncLeaveSponsorCalendar(false);
    }
  }

  function showEnabledOverview(ackData, dashboardData) {
    lastAckData = ackData;
    lastDashboardData = dashboardData;
    renderEnabledBanner(ackData);
    renderSetupChecklist(ackData, dashboardData?.duty_overview);
    renderDutyCards(ackData.duties, dashboardData?.duty_overview);
    renderAlertBoard(dashboardData);
    applyDutiesExpanded(dutiesExpanded());
    syncLeaveSponsorCalendar(true);
    syncCompliancePane();
  }

  function hideEnabledOverview() {
    document.getElementById("sponsor-enabled-banner")?.setAttribute("hidden", "");
    document.getElementById("sponsor-setup-checklist")?.setAttribute("hidden", "");
    document.getElementById("sponsor-duty-cards")?.setAttribute("hidden", "");
    document.getElementById("sponsor-alert-board")?.setAttribute("hidden", "");
    syncLeaveSponsorCalendar(false);
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
      if (ackData.acknowledged || tenantAlreadyAcknowledged()) {
        markTenantAcknowledged();
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
      const notice = data.tools_notice ? `<p>${escapeHtml(data.tools_notice)}</p>` : "";
      const ack = data.ack_text ? `<p>${escapeHtml(data.ack_text)}</p>` : "";
      disclaimer.innerHTML = notice + ack;
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
      if (!res.ok) {
        if (tenantAlreadyAcknowledged()) {
          applyAcknowledgedLayout(true);
          return true;
        }
        hideEnabledOverview();
        applyAcknowledgedLayout(false);
        bindAckPanel();
        const status = document.getElementById("sponsor-licence-ack-status");
        if (status) status.textContent = "Could not load sponsor confirmation. Refresh and try again.";
        const disclaimer = document.getElementById("sponsor-licence-ack-disclaimer");
        if (disclaimer && !disclaimer.innerHTML.trim()) {
          disclaimer.innerHTML = "<p>We could not load the sponsor duty notice. Refresh the page, or confirm the three statements below if you already know your duties.</p>";
        }
        return false;
      }
      const data = await res.json();
      lastAckData = data;
      if (data.acknowledged || tenantAlreadyAcknowledged()) {
        markTenantAcknowledged();
        applyAcknowledgedLayout(true);
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
      if (tenantAlreadyAcknowledged()) {
        applyAcknowledgedLayout(true);
        return true;
      }
      hideEnabledOverview();
      applyAcknowledgedLayout(false);
      bindAckPanel();
      const status = document.getElementById("sponsor-licence-ack-status");
      if (status) status.textContent = "Could not load sponsor confirmation. Check your connection and try again.";
      const disclaimer = document.getElementById("sponsor-licence-ack-disclaimer");
      if (disclaimer && !disclaimer.innerHTML.trim()) {
        disclaimer.innerHTML = "<p>We could not load the sponsor duty notice. Check your connection and try again.</p>";
      }
      return false;
    }
  }

  function bindSponsorOverviewActions() {
    if (document.body.dataset.sponsorOverviewBound === "true") return;
    document.body.dataset.sponsorOverviewBound = "true";
    bindCompliancePaneNav();

    document.getElementById("sponsor-toggle-duties")?.addEventListener("click", () => {
      setDutiesExpanded(!dutiesExpanded());
    });

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

      setDutiesExpanded(true);
      (section || cards)?.scrollIntoView({ behavior: "smooth", block: "start" });
      cards?.classList.add("sponsor-duties-grid--highlight");
      window.setTimeout(() => cards?.classList.remove("sponsor-duties-grid--highlight"), 1200);
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
        if (!res.ok) throw new Error(await readApiError(res, "Could not save confirmation"));
        const data = await res.json();
        if (status) status.textContent = "Confirmed. Loading compliance tools…";
        markTenantAcknowledged();
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

  function calendarRangeQuery() {
    const year = new Date().getFullYear();
    return `from_date=${year - 1}-01-01&to_date=${year + 1}-12-31`;
  }

  function isWeekendIso(iso) {
    const date = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(date.getTime())) return false;
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  async function saveCalendarDay(calendarDate, isWorkingDay) {
    const res = await apiFetch("/compliance/sponsor-licence/working-calendar", {
      method: "PUT",
      body: JSON.stringify({
        entries: [{ calendar_date: calendarDate, is_working_day: isWorkingDay }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseApiDetail(data, "Could not save calendar date"));
    await Promise.all([loadBankHolidays(), loadWorkingCalendar()]);
  }

  async function fetchCalendarItems(nonWorkingOnly = false) {
    const extra = nonWorkingOnly ? "&non_working_only=true" : "";
    const res = await apiFetch(`/compliance/sponsor-licence/working-calendar?${calendarRangeQuery()}${extra}`);
    if (!res.ok) throw new Error("Could not load calendar dates");
    const data = await res.json();
    return data.items || [];
  }

  async function loadBankHolidays() {
    const tbody = document.getElementById("holidays-body");
    if (!tbody) return;
    try {
      const items = await fetchCalendarItems(true);
      renderTableBody(tbody, {
        emptyMessage: "No holidays added yet. Weekdays still count as working days.",
        columns: [
          { key: "calendar_date", label: "Date", render: (r) => escapeHtml(formatDisplayDate(r.calendar_date, { weekday: true })) },
          { key: "label", label: "Type", render: () => "Closed / bank holiday" },
          {
            key: "actions",
            label: "Actions",
            render: (r) =>
              `<button type="button" class="btn ghost" data-reset-holiday="${escapeHtml(r.calendar_date)}">Remove holiday</button>`,
          },
        ],
        rows: items,
      });
      tbody.querySelectorAll("[data-reset-holiday]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await saveCalendarDay(btn.dataset.resetHoliday, true);
          } catch (error) {
            window.Admin?.showAdminToast?.(error.message || "Could not update holiday");
          }
        });
      });
    } catch {
      renderTableBody(tbody, {
        columns: [{ key: "a" }, { key: "b" }, { key: "c" }],
        rows: [],
        emptyMessage: "Could not load holidays. Try again.",
      });
    }
  }

  async function loadWorkingCalendar() {
    const tbody = document.getElementById("working-calendar-body");
    if (!tbody) return;
    try {
      const items = (await fetchCalendarItems(false)).filter((row) => row.is_working_day && isWeekendIso(row.calendar_date));
      renderTableBody(tbody, {
        emptyMessage: "No extra working days. Weekdays are working days by default.",
        columns: [
          { key: "calendar_date", label: "Date", render: (r) => escapeHtml(formatDisplayDate(r.calendar_date, { weekday: true })) },
          { key: "label", label: "Status", render: () => "Site open" },
          {
            key: "actions",
            label: "Actions",
            render: (r) =>
              `<button type="button" class="btn ghost" data-reset-cal="${escapeHtml(r.calendar_date)}">Remove</button>`,
          },
        ],
        rows: items,
      });

      tbody.querySelectorAll("[data-reset-cal]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await saveCalendarDay(btn.dataset.resetCal, false);
          } catch (error) {
            window.Admin?.showAdminToast?.(error.message || "Could not update working day");
          }
        });
      });
    } catch {
      renderTableBody(tbody, {
        columns: [{ key: "a" }, { key: "b" }, { key: "c" }],
        rows: [],
        emptyMessage: "Could not load working calendar. Try again.",
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

  async function mountBankHolidayForm() {
    const host = document.getElementById("bank-holiday-form");
    if (!host || host.dataset.mounted === "true") return;
    mountEditForm(host, FORM_SCHEMAS.bankHoliday, {
      onSubmit: async (payload, form) => {
        if (!payload.calendar_date) throw new Error("Choose a holiday date");
        await saveCalendarDay(payload.calendar_date, false);
        form.reset();
        window.Admin?.bindDateInputs?.(form);
      },
    });
    host.dataset.mounted = "true";
  }

  async function mountWorkingCalendarForm() {
    const host = document.getElementById("working-calendar-form");
    if (!host || host.dataset.mounted === "true") return;
    mountEditForm(host, FORM_SCHEMAS.workingCalendar, {
      onSubmit: async (payload, form) => {
        if (!payload.calendar_date) throw new Error("Choose a date");
        await saveCalendarDay(payload.calendar_date, true);
        form.reset();
        window.Admin?.bindDateInputs?.(form);
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
          { key: "trigger_type", label: "Type", render: (r) => `<strong>${escapeHtml(r.trigger_type)}</strong>` },
          { key: "employee_id", label: "Employee", render: (r) => escapeHtml(r.employee_id) },
          { key: "description", label: "Description", render: (r) => escapeHtml(r.description) },
          { key: "deadline_date", label: "Deadline", render: (r) => escapeHtml(formatDisplayDate(r.deadline_date)) },
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

  function localIsoDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function isoDateField(form, name) {
    const value = String(form.querySelector(`[name="${name}"]`)?.value || "").trim();
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const slash = value.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
    if (slash) return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
    return value.slice(0, 10);
  }

  function rtwFormError(error, fallback = "Could not store RTW evidence") {
    const message =
      friendlyNativeError?.(error, fallback) ||
      window.Admin?.formatErrorMessage?.(error, fallback) ||
      error?.message ||
      fallback;
    if (/^(Load failed|Failed to fetch)$/i.test(message) || /XHR network error/i.test(message)) {
      return `${fallback}. Check your connection and try again.`;
    }
    return message;
  }

  function isRtwNetworkError(error) {
    const message = String(error?.message || error || "");
    return /^(Load failed|Failed to fetch|XHR network error)$/i.test(message) || /failed to fetch|load failed|network error/i.test(message);
  }

  function rtwMultipartHeaders() {
    const headers = authHeaders(false);
    delete headers["Content-Type"];
    delete headers["content-type"];
    return headers;
  }

  async function materializeUploadFile(file) {
    if (!file) return file;
    try {
      const buffer = await file.arrayBuffer();
      return new File([buffer], file.name || "rtw-evidence.pdf", {
        type: file.type || "application/octet-stream",
      });
    } catch {
      return file;
    }
  }

  function buildRtwEvidenceFormData({ employeeId, checkDate, checkMethod, outcome, visaExpiry, rtwExpiry, file }) {
    const fd = new FormData();
    fd.set("employee_id", String(employeeId));
    fd.set("check_date", checkDate);
    fd.set("check_method", checkMethod);
    fd.set("outcome", outcome);
    fd.set("checker_user_id", localStorage.getItem("username") || "hr");
    if (visaExpiry) fd.set("visa_expiry_date", visaExpiry);
    if (rtwExpiry) fd.set("rtw_check_expiry_date", rtwExpiry);
    fd.set("evidence_pdf", file, file.name || "rtw-evidence.pdf");
    return fd;
  }

  async function xhrPostRtwEvidence(path, formData) {
    const apiBase = window.Admin.getApiBase?.() || API_BASE;
    if (!apiBase) throw new Error("API URL not configured. Hard refresh and sign in again.");
    const headers = rtwMultipartHeaders();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiBase}${path}`);
      Object.entries(headers).forEach(([key, value]) => {
        if (key && value && key.toLowerCase() !== "content-type") xhr.setRequestHeader(key, String(value));
      });
      xhr.timeout = 120000;
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText || "{}");
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }
        reject(new Error(parseApiDetail(data, `Could not store RTW evidence (HTTP ${xhr.status})`)));
      };
      xhr.onerror = () => reject(new Error("Load failed"));
      xhr.ontimeout = () => reject(new Error("Upload timed out. Try a smaller PDF or photo."));
      xhr.send(formData);
    });
  }

  async function postRtwEvidence(fields) {
    const path = "/compliance/sponsor-licence/rtw-checks";
    try {
      const res = await apiFetch(path, {
        method: "POST",
        headers: rtwMultipartHeaders(),
        body: buildRtwEvidenceFormData(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiDetail(data, `Could not store RTW evidence (HTTP ${res.status})`));
      return data;
    } catch (error) {
      if (!isRtwNetworkError(error)) throw error;
      return xhrPostRtwEvidence(path, buildRtwEvidenceFormData(fields));
    }
  }

  function isoDateOnly(value) {
    if (!value) return "";
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
  }

  function employeeOptionRecord(employeeId) {
    if (!employeeId) return null;
    const fromOptions = (window.Admin.formOptions?.employees || []).find(
      (emp) => String(emp.value) === String(employeeId) || String(emp.id) === String(employeeId)
    );
    if (fromOptions) return fromOptions;
    return (window.Admin.peekEmployeesListCache?.() || []).find((emp) => String(emp.id) === String(employeeId)) || null;
  }

  function rememberEmployeeField(employeeId, key, value) {
    if (!employeeId || !value) return;
    const options = window.Admin.formOptions?.employees || [];
    const row = options.find((emp) => String(emp.value) === String(employeeId) || String(emp.id) === String(employeeId));
    if (row) row[key] = value;
  }

  async function lookupEmployeeDob(employeeId) {
    if (!employeeId) return "";
    const local = isoDateOnly(employeeOptionRecord(employeeId)?.date_of_birth);
    if (local) return local;
    try {
      const res = await apiFetch(`/admin/employees/${encodeURIComponent(employeeId)}/workspace`);
      if (!res.ok) return "";
      const data = await res.json();
      const dob = isoDateOnly(data?.employee?.date_of_birth);
      const shareCode = data?.employee?.sponsorship?.share_code || data?.employee?.share_code;
      if (dob) rememberEmployeeField(employeeId, "date_of_birth", dob);
      if (shareCode) rememberEmployeeField(employeeId, "share_code", shareCode);
      return dob;
    } catch {
      return "";
    }
  }

  async function applyShareCodeEmployee(employeeId) {
    const form = document.getElementById("share-code-verify-form");
    if (!form) return;
    const field = form.querySelector("[data-share-code-dob-field]");
    const input = form.querySelector("input[name='date_of_birth']");
    const note = form.querySelector("[data-share-code-dob-note]");
    const shareInput = form.querySelector("input[name='share_code']");
    const employeeSelect = form.querySelector("select[name='employee_id']");
    if (employeeSelect && employeeId && employeeSelect.value !== String(employeeId)) {
      employeeSelect.value = String(employeeId);
    }
    const record = employeeOptionRecord(employeeId);
    if (shareInput && record?.share_code && !String(shareInput.value || "").trim()) {
      shareInput.value = record.share_code;
    }
    if (!employeeId) {
      if (field) field.hidden = true;
      if (input) {
        input.value = "";
        input.required = false;
        input.hidden = true;
      }
      if (note) note.hidden = true;
      return;
    }
    if (field) field.hidden = false;
    if (note) {
      note.hidden = false;
      note.textContent = "Checking date of birth on file…";
    }
    const dob = await lookupEmployeeDob(employeeId);
    const latest = employeeOptionRecord(employeeId);
    if (shareInput && latest?.share_code && !String(shareInput.value || "").trim()) {
      shareInput.value = latest.share_code;
    }
    if (dob) {
      if (input) {
        input.value = dob;
        input.required = false;
        input.hidden = true;
      }
      if (field) {
        const label = field.querySelector(".edit-label");
        if (label) label.hidden = true;
      }
      if (note) {
        note.hidden = false;
        note.textContent = "Using the date of birth already on this employee record.";
      }
      return;
    }
    if (field) {
      const label = field.querySelector(".edit-label");
      if (label) label.hidden = false;
    }
    if (input) {
      input.hidden = false;
      input.required = true;
    }
    if (note) {
      note.hidden = false;
      note.textContent = "Date of birth is not on file yet — enter it once and it will be saved on the employee record.";
    }
  }

  function currentRtwAddEmployeeId() {
    return (
      document.querySelector("#rtw-upload [name='employee_id']")?.value ||
      document.querySelector("#share-code-form [name='employee_id']")?.value ||
      ""
    );
  }

  function setRtwAddMethod(method) {
    const panel = document.getElementById("rtw-add-panel");
    if (!panel) return;
    const next = method === "share-code" ? "share-code" : "upload";
    panel.querySelectorAll("[data-rtw-add-method]").forEach((btn) => {
      const active = btn.dataset.rtwAddMethod === next;
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.classList.toggle("outline", !active);
    });
    panel.querySelectorAll("[data-rtw-add-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.rtwAddPane !== next;
    });
    const result = document.getElementById("share-code-result");
    if (result && next !== "share-code") result.hidden = true;
    const employeeId = currentRtwAddEmployeeId();
    if (employeeId) {
      panel.querySelectorAll("select[name='employee_id']").forEach((select) => {
        select.value = employeeId;
      });
    }
    if (next === "share-code") void applyShareCodeEmployee(employeeId);
  }

  function bindRtwAddMethodTabs() {
    const panel = document.getElementById("rtw-add-panel");
    if (!panel || panel.dataset.methodTabsBound === "true") return;
    panel.dataset.methodTabsBound = "true";
    panel.querySelectorAll("[data-rtw-add-method]").forEach((btn) => {
      btn.addEventListener("click", () => setRtwAddMethod(btn.dataset.rtwAddMethod));
    });
    panel.addEventListener("change", (event) => {
      const select = event.target?.closest?.("select[name='employee_id']");
      if (!select) return;
      const employeeId = select.value;
      panel.querySelectorAll("select[name='employee_id']").forEach((other) => {
        if (other !== select) other.value = employeeId;
      });
      void applyShareCodeEmployee(employeeId);
    });
    setRtwAddMethod("upload");
  }

  async function mountShareCodeForm() {
    const host = document.getElementById("share-code-form");
    if (!host || host.dataset.mounted === "true") return;
    bindRtwAddMethodTabs();
    try {
      await loadFormOptions();
      await loadEmployees();
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(rtwFormError(error, "Could not load employees for share-code checks."))}</p>`;
      return;
    }
    const employees = window.Admin.formOptions?.employees || [];
    const employeeOptions = [
      `<option value="">Select employee</option>`,
      ...employees.map((emp) => `<option value="${escapeHtml(emp.value)}">${escapeHtml(emp.label)}</option>`),
    ].join("");
    host.innerHTML = `
      <p class="muted rtw-share-code-note">Verify an eVisa with the GOV.UK share code. Date of birth is taken from the employee record when it is already stored.</p>
      <form class="edit-form edit-form--cols-2" id="share-code-verify-form">
        <label class="edit-field"><span class="edit-label">Employee</span><select name="employee_id" required>${employeeOptions}</select></label>
        <label class="edit-field"><span class="edit-label">GOV.UK share code</span><input name="share_code" type="text" required placeholder="ABC123XYZ" autocomplete="off" /></label>
        <label class="edit-field" data-share-code-dob-field data-span="2" hidden>
          <span class="edit-label">Date of birth</span>
          <input name="date_of_birth" type="date" hidden />
          <span class="muted rtw-dob-on-file" data-share-code-dob-note hidden></span>
        </label>
        <div class="edit-form-actions" data-span="2">
          <button class="btn" type="submit">Verify eVisa share code</button>
          <p class="edit-form-status muted" data-status></p>
        </div>
      </form>`;
    const form = host.querySelector("form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-status]");
      const employeeId = form.querySelector("select[name='employee_id']")?.value;
      const shareCode = String(form.querySelector("input[name='share_code']")?.value || "").trim();
      const dobInput = form.querySelector("input[name='date_of_birth']");
      if (!employeeId) {
        if (status) status.textContent = "Select an employee.";
        return;
      }
      if (shareCode.length < 6) {
        if (status) status.textContent = "Enter the GOV.UK share code.";
        return;
      }
      const storedDob = isoDateOnly(employeeOptionRecord(employeeId)?.date_of_birth);
      const enteredDob = isoDateOnly(dobInput?.value);
      if (!storedDob && !enteredDob) {
        if (status) status.textContent = "Date of birth is not on this employee record. Add it here or in Personal information first.";
        return;
      }
      if (status) status.textContent = "Verifying…";
      const payload = { employee_id: Number(employeeId), share_code: shareCode };
      if (enteredDob && !storedDob) payload.date_of_birth = enteredDob;
      try {
        const res = await apiFetch("/compliance/sponsor-licence/rtw-verify-share-code", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(parseApiDetail(data, "Verification failed"));
        if (enteredDob) rememberEmployeeField(employeeId, "date_of_birth", enteredDob);
        if (status) status.textContent = "";
        const panel = document.getElementById("share-code-result");
        if (panel) {
          panel.hidden = false;
          panel.innerHTML = `<p class="promo-result-message promo-result-message--ok">${escapeHtml(data.message || "Verified")} · RTW: ${escapeHtml(data.rtw_status)} · Visa expiry: ${escapeHtml(formatDisplayDate(data.visa_expiry_date))} · RTW check expiry: ${escapeHtml(formatDisplayDate(data.rtw_check_expiry_date || data.expiry_date))} · Mode: ${escapeHtml(data.mode)}</p>`;
        }
        window.dispatchEvent(new CustomEvent("admin:rtw-refresh"));
      } catch (error) {
        if (status) status.textContent = rtwFormError(error, "Verification failed");
      }
    });
    host.dataset.mounted = "true";
    const selected = currentRtwAddEmployeeId();
    if (selected) {
      const select = form.querySelector("select[name='employee_id']");
      if (select) select.value = selected;
      void applyShareCodeEmployee(selected);
    }
  }

  async function mountRtwUploadForm() {
    const host = document.getElementById("rtw-upload-form");
    if (!host || host.dataset.mounted === "true") return;
    bindRtwAddMethodTabs();
    await loadEmployees();
    const employees = window.Admin.formOptions?.employees || [];
    const employeeOptions = [
      `<option value="">Select employee</option>`,
      ...employees.map(
        (emp) => `<option value="${escapeHtml(emp.value)}">${escapeHtml(emp.label)}</option>`
      ),
    ].join("");
    const today = localIsoDate();
    host.innerHTML = `
      <form class="edit-form edit-form--cols-2" id="rtw-upload">
        <label class="edit-field"><span class="edit-label">Employee</span><select name="employee_id" required>${employeeOptions}</select><span class="muted edit-hint">You can store more than one RTW check for the same person.</span></label>
        <label class="edit-field"><span class="edit-label">Check date</span><input name="check_date" type="date" required value="${today}" /></label>
        <label class="edit-field"><span class="edit-label">Method</span>
          <select name="check_method" required>
            <option value="Manual evidence upload" selected>Manual evidence upload</option>
            <option value="Follow-up check">Follow-up check</option>
            <option value="ID document check">ID document check</option>
          </select>
        </label>
        <label class="edit-field"><span class="edit-label">Outcome</span>
          <select name="outcome" required>
            <option value="pass">Pass</option>
            <option value="time_limited">Time limited</option>
            <option value="fail">Fail</option>
          </select>
        </label>
        <label class="edit-field"><span class="edit-label">Visa expiry</span><input name="visa_expiry_date" type="date" data-empty="true" /></label>
        <label class="edit-field"><span class="edit-label">RTW check expiry</span><input name="rtw_check_expiry_date" type="date" data-empty="true" /></label>
        <div class="edit-field" data-span="2">
          <span class="edit-label">Evidence</span>
          <div class="doc-upload-dropzone doc-upload-dropzone--compact" id="rtw-upload-dropzone">
            <input name="evidence_pdf" type="file" id="rtw-upload-file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hidden />
            <input type="file" id="rtw-upload-camera" accept="image/*" capture="environment" hidden />
            <p class="doc-upload-dropzone__lead">Drag &amp; drop here, or <button type="button" class="doc-upload-browse">browse</button><span class="doc-upload-dropzone__or" aria-hidden="true"> · </span><button type="button" class="doc-upload-camera">take photo</button></p>
            <p class="doc-upload-dropzone__hint muted">PDF, JPEG or PNG · max 10 MB</p>
            <p class="doc-upload-filename" id="rtw-upload-filename" hidden></p>
          </div>
        </div>
        <div class="edit-form-actions" data-span="2">
          <button class="btn" type="submit">Store RTW evidence</button>
          <p class="edit-form-status muted" data-status></p>
        </div>
      </form>`;
    window.Admin?.bindDateInputs?.(host);
    window.AdminDocuments?.bindFileDropzone?.({
      dropzone: document.getElementById("rtw-upload-dropzone"),
      fileInput: document.getElementById("rtw-upload-file"),
      filenameEl: document.getElementById("rtw-upload-filename"),
      cameraInput: document.getElementById("rtw-upload-camera"),
    });
    host.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = form.querySelector("[data-status]");
      const fileInput = form.querySelector("#rtw-upload-file");
      const employeeId = String(form.querySelector("[name='employee_id']")?.value || "").trim();
      const checkDate = isoDateField(form, "check_date");
      if (!employeeId) {
        if (status) status.textContent = "Choose an employee.";
        return;
      }
      if (!checkDate) {
        if (status) status.textContent = "Choose a check date.";
        return;
      }
      let file = window.AdminDocuments?.readSelectedFile?.(fileInput) || fileInput?.files?.[0];
      try {
        if (file && window.AdminDocuments?.prepareUploadFile) {
          file = await window.AdminDocuments.prepareUploadFile(file);
        }
      } catch (error) {
        if (status) status.textContent = error.message || "Choose a JPEG or PNG photo.";
        return;
      }
      if (!file) {
        if (status) status.textContent = "Choose a file or take a photo.";
        return;
      }
      try {
        file = await materializeUploadFile(file);
      } catch {
        /* keep the original file */
      }
      if (status) status.textContent = "Uploading…";
      const fields = {
        employeeId,
        checkDate,
        checkMethod: form.querySelector("[name='check_method']")?.value || "Manual evidence upload",
        outcome: form.querySelector("[name='outcome']")?.value || "pass",
        visaExpiry: isoDateField(form, "visa_expiry_date"),
        rtwExpiry: isoDateField(form, "rtw_check_expiry_date"),
        file,
      };
      try {
        const data = await postRtwEvidence(fields);
        if (status) {
          status.textContent = `Stored check #${data.check_id}. You can add another RTW check for the same employee.`;
        }
        form.reset();
        const checkDateInput = form.querySelector("[name='check_date']");
        if (checkDateInput) checkDateInput.value = localIsoDate();
        const employeeSelect = form.querySelector("[name='employee_id']");
        if (employeeSelect) employeeSelect.value = employeeId;
        const methodSelect = form.querySelector("[name='check_method']");
        if (methodSelect && [...methodSelect.options].some((opt) => opt.value === "Follow-up check")) {
          methodSelect.value = "Follow-up check";
        }
        const heading = document.querySelector("#rtw-add-panel h4");
        if (heading) heading.textContent = "Add another RTW check";
        if (fileInput) {
          fileInput.value = "";
          fileInput._sshrPendingFile = null;
        }
        const filenameEl = document.getElementById("rtw-upload-filename");
        if (filenameEl) {
          filenameEl.hidden = true;
          filenameEl.textContent = "";
        }
        window.Admin?.bindDateInputs?.(form);
        window.dispatchEvent(new CustomEvent("admin:compliance-refresh"));
        window.dispatchEvent(new CustomEvent("admin:rtw-refresh"));
      } catch (error) {
        if (status) status.textContent = rtwFormError(error);
      }
    });
    host.dataset.mounted = "true";
  }

  async function initComplianceTools(skipAckCheck = false) {
    bindSponsorOverviewActions();
    bindRtwAddMethodTabs();
    syncCompliancePane();
    if (!skipAckCheck) {
      const ready = await ensureSponsorLicenceAcknowledged();
      if (!ready) return;
    }
    await Promise.all([
      mountRtwUploadForm(),
      mountShareCodeForm(),
      mountAbsenceDayForm(),
      mountBankHolidayForm(),
      mountWorkingCalendarForm(),
      loadBankHolidays(),
      loadWorkingCalendar(),
      loadReportingTriggers(),
    ]);
    fillAuditExportEmployees(window.Admin.formOptions?.employees || (await loadEmployees()));

    if (document.body.dataset.auditExportBound !== "true") {
      document.body.dataset.auditExportBound = "true";
      document.getElementById("audit-export-json")?.addEventListener("click", async () => {
        try {
          const employeeId = document.getElementById("audit-export-employee")?.value;
          const path = employeeId
            ? `/compliance/sponsor-licence/audit-export?employee_id=${encodeURIComponent(employeeId)}`
            : "/compliance/sponsor-licence/audit-export";
          const res = await apiFetch(path);
          if (!res.ok) throw new Error(await readApiError(res, "Could not export JSON audit pack"));
          const data = await res.json();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `audit-pack-business-${window.Admin.TENANT_ID}.json`;
          link.click();
          URL.revokeObjectURL(url);
          markAuditExportTested();
          refreshSponsorOverview();
        } catch (error) {
          window.Admin?.showAdminToast?.(error.message || "Could not export JSON audit pack");
        }
      });

      document.getElementById("audit-export-pdf")?.addEventListener("click", async () => {
        try {
          const employeeId = document.getElementById("audit-export-employee")?.value;
          let path = "/compliance/sponsor-licence/audit-export?format=pdf";
          if (employeeId) path += `&employee_id=${encodeURIComponent(employeeId)}`;
          await downloadAuthenticated(path, `audit-pack-business-${window.Admin.TENANT_ID}.pdf`);
          markAuditExportTested();
          refreshSponsorOverview();
        } catch (error) {
          window.Admin?.showAdminToast?.(error.message || "Could not export PDF audit pack");
        }
      });

      document.getElementById("audit-export-zip")?.addEventListener("click", async () => {
        try {
          const employeeId = document.getElementById("audit-export-employee")?.value;
          let path = "/compliance/sponsor-licence/audit-export?format=zip";
          if (employeeId) path += `&employee_id=${encodeURIComponent(employeeId)}`;
          await downloadAuthenticated(path, `audit-pack-business-${window.Admin.TENANT_ID}.zip`);
          markAuditExportTested();
          refreshSponsorOverview();
        } catch (error) {
          window.Admin?.showAdminToast?.(error.message || "Could not export ZIP audit pack");
        }
      });
    }

    window.dispatchEvent(new CustomEvent("admin:rtw-refresh"));
    window.dispatchEvent(new CustomEvent("admin:absence-refresh"));
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "compliance") {
      syncCompliancePane();
      if (!complianceReady) {
        complianceReady = true;
        initComplianceTools();
      }
    }
    if (event.detail?.section === "leave") {
      syncLeaveSponsorCalendar();
      void Promise.all([
        mountBankHolidayForm(),
        mountWorkingCalendarForm(),
        loadBankHolidays(),
        loadWorkingCalendar(),
      ]).catch(() => {
        /* leave calendar is optional when sponsor tools are off */
      });
    }
  });

  window.addEventListener("hashchange", () => {
    if (parseHashBaseSection(window.location.hash) === "compliance") syncCompliancePane();
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
