/** Mobile compliance hub — accordion shell, stat grid, section toggles. */
(function initAdminComplianceMobile() {
  "use strict";

  const SECTIONS = [
    { id: "compliance-rtw", title: "Right to Work records", icon: "passport", openDefault: true },
    { id: "compliance-absence", title: "Absence monitoring", icon: "medical", badgeId: "compliance-mobile-absence-badge" },
    { id: "compliance-working-calendar", title: "Working calendar", icon: "calendar" },
    { id: "compliance-audit-export", title: "Home Office audit export", icon: "folder" },
  ];

  let openSectionId = "compliance-rtw";

  function isMobileComplianceHub() {
    return (
      window.matchMedia("(max-width: 860px)").matches &&
      document.body.dataset.mobileTab === "compliance" &&
      !document.body.classList.contains("compliance-mobile-drill")
    );
  }

  function escapeHtml(value) {
    if (window.Admin?.escapeHtml) return window.Admin.escapeHtml(value);
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function icon(name) {
    return window.AdminIcons?.svg?.(name) || "";
  }

  function setOpenSection(sectionId, options = {}) {
    const { scroll = false, toggle = true } = options;
    if (toggle && sectionId && openSectionId === sectionId) {
      openSectionId = "";
      delete document.body.dataset.complianceMobileSection;
      document.querySelectorAll("[data-compliance-section]").forEach((btn) => {
        btn.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
      });
      document.querySelectorAll("#compliance-tools-content > article").forEach((article) => {
        article.classList.remove("compliance-section--open");
      });
      return;
    }

    openSectionId = sectionId || "";
    if (openSectionId) document.body.dataset.complianceMobileSection = openSectionId;
    else delete document.body.dataset.complianceMobileSection;

    document.querySelectorAll("[data-compliance-section]").forEach((btn) => {
      const active = btn.dataset.complianceSection === openSectionId;
      btn.classList.toggle("is-open", active);
      btn.setAttribute("aria-expanded", active ? "true" : "false");
    });

    document.querySelectorAll("#compliance-tools-content > article").forEach((article) => {
      article.classList.toggle("compliance-section--open", article.id === openSectionId);
    });

    if (scroll && isMobileComplianceHub()) {
      const target = document.getElementById(openSectionId);
      window.setTimeout(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
  }

  function syncMobileStats(stats = {}) {
    const map = {
      "compliance-mobile-stat-total": stats.total ?? 0,
      "compliance-mobile-stat-verified": stats.verified ?? 0,
      "compliance-mobile-stat-expiring": stats.expiring_soon ?? 0,
      "compliance-mobile-stat-review": stats.needs_review ?? 0,
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    });
  }

  function renderShell(overviewData) {
    const host = document.getElementById("mobile-compliance-shell");
    if (!host) return;

    const rtw = overviewData?.modules?.rtw || {};
    const absence = overviewData?.modules?.absence || {};
    const day9 = Number(absence.day9_alerts) || 0;
    const govLink = document.getElementById("rtw-checklist-link")?.href || "#";

    host.innerHTML = `
      <header class="compliance-mobile-header">
        <h2 class="compliance-mobile-title">Sponsor licence safeguards</h2>
        <p class="compliance-mobile-lead muted">
          Recording tools and alerts for UK sponsor duties — your organisation remains legally responsible for checks, SMS reporting, and Home Office submissions.
        </p>
        <a class="btn secondary btn-sm compliance-mobile-gov-link" href="${escapeHtml(govLink)}" target="_blank" rel="noopener">GOV.UK guidance →</a>
      </header>

      ${
        day9
          ? `<article class="mobile-urgent-card">
              <span class="mobile-urgent-card__dot" aria-hidden="true"></span>
              <div>
                <strong>${escapeHtml(day9)} day-9 absence alert${day9 === 1 ? "" : "s"}</strong>
                <p class="muted">Sponsored worker absences need immediate Home Office action.</p>
              </div>
              <button type="button" class="btn primary btn-sm" data-compliance-section="compliance-absence">Review</button>
            </article>`
          : ""
      }

      <div class="compliance-mobile-actions">
        <button type="button" class="btn outline" id="compliance-mobile-export-btn">Export all records</button>
        <button type="button" class="btn" id="compliance-mobile-add-rtw-btn">+ Add RTW check</button>
      </div>

      <div class="compliance-mobile-stat-grid" aria-label="RTW summary">
        <div class="compliance-mobile-stat compliance-mobile-stat--neutral">
          <span class="compliance-mobile-stat__value" id="compliance-mobile-stat-total">${escapeHtml(rtw.total ?? 0)}</span>
          <span class="compliance-mobile-stat__label">Total checks</span>
        </div>
        <div class="compliance-mobile-stat compliance-mobile-stat--ok">
          <span class="compliance-mobile-stat__value" id="compliance-mobile-stat-verified">${escapeHtml(rtw.verified ?? 0)}</span>
          <span class="compliance-mobile-stat__label">Verified</span>
        </div>
        <div class="compliance-mobile-stat compliance-mobile-stat--warn">
          <span class="compliance-mobile-stat__value" id="compliance-mobile-stat-expiring">${escapeHtml(rtw.expiring_soon ?? 0)}</span>
          <span class="compliance-mobile-stat__label">Expiring soon</span>
          <span class="compliance-mobile-stat__hint">Within 30 days</span>
        </div>
        <div class="compliance-mobile-stat compliance-mobile-stat--danger">
          <span class="compliance-mobile-stat__value" id="compliance-mobile-stat-review">${escapeHtml(rtw.needs_review ?? 0)}</span>
          <span class="compliance-mobile-stat__label">Needs review</span>
          <span class="compliance-mobile-stat__hint">Action required</span>
        </div>
      </div>

      <div class="compliance-mobile-accordions" role="tablist" aria-label="Compliance sections">
        ${SECTIONS.map((section) => {
          const badge =
            section.badgeId && section.id === "compliance-absence"
              ? `<span class="compliance-mobile-section-badge" id="${section.badgeId}">${escapeHtml(absence.active_absences ?? 0)} active</span>`
              : "";
          return `<button type="button" class="compliance-mobile-section${section.openDefault ? " is-open" : ""}"
            role="tab"
            data-compliance-section="${section.id}"
            aria-expanded="${section.openDefault ? "true" : "false"}"
            aria-controls="${section.id}">
            <span class="compliance-mobile-section__icon">${icon(section.icon)}</span>
            <span class="compliance-mobile-section__title">${escapeHtml(section.title)}</span>
            ${badge}
            <span class="compliance-mobile-section__chevron" aria-hidden="true"></span>
          </button>`;
        }).join("")}
      </div>`;

    host.querySelector("#compliance-mobile-export-btn")?.addEventListener("click", () => {
      document.getElementById("rtw-export-all-btn")?.click();
    });
    host.querySelector("#compliance-mobile-add-rtw-btn")?.addEventListener("click", () => {
      setOpenSection("compliance-rtw");
      document.getElementById("rtw-add-check-btn")?.click();
    });

    host.querySelectorAll("[data-compliance-section]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sectionId = btn.dataset.complianceSection;
        if (!sectionId) return;
        setOpenSection(sectionId, { scroll: openSectionId !== sectionId });
      });
    });

    const defaultOpen = SECTIONS.find((s) => s.openDefault)?.id || "compliance-rtw";
    setOpenSection(defaultOpen);
  }

  function openSectionFromHash() {
    const hash = window.location.hash.replace("#", "").split("/")[0];
    const match = SECTIONS.find((s) => s.id === hash);
    if (match) setOpenSection(match.id, { scroll: true, toggle: false });
  }

  window.AdminComplianceMobile = {
    renderShell,
    syncMobileStats,
    setOpenSection,
    openSectionFromHash,
    isMobileComplianceHub,
  };

  window.addEventListener("admin:rtw-stats", (event) => {
    syncMobileStats(event.detail?.stats);
  });

  window.addEventListener("admin:absence-stats", (event) => {
    const badge = document.getElementById("compliance-mobile-absence-badge");
    if (badge) badge.textContent = `${event.detail?.active ?? 0} active`;
  });

  window.addEventListener("hashchange", () => {
    if (isMobileComplianceHub()) openSectionFromHash();
  });
})();
