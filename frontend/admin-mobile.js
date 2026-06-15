/** Mobile admin shell — Home / Modules / Rota / Compliance / More tabs. */
(function () {
  "use strict";

  const DETAIL_EXEMPT = new Set(["overview", "rota", "compliance"]);

  let currentTab = localStorage.getItem("adminMobileTab") || "home";
  let previousTab = "home";

  function isMobile() {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function isDetailSection(sectionId) {
    return Boolean(sectionId && !DETAIL_EXEMPT.has(sectionId));
  }

  function timeGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }

  function displayFirstName() {
    const stored = localStorage.getItem("adminDisplayName") || "";
    if (stored) return stored;
    const username = localStorage.getItem("adminUsername") || "";
    if (!username) return "there";
    const local = username.split("@")[0] || username;
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  async function refreshGreeting() {
    const greetingEl = document.getElementById("mobile-greeting");
    if (!greetingEl) return;
    try {
      const token = localStorage.getItem("token");
      if (token && window.Admin?.apiFetch) {
        const res = await window.Admin.apiFetch("/auth/verify");
        if (res.ok) {
          const user = await res.json();
          if (user.username) {
            localStorage.setItem("adminUsername", user.username);
          }
        }
      }
    } catch {
      /* ignore */
    }
    greetingEl.textContent = `${timeGreeting()}, ${displayFirstName()}`;
  }

  function syncTabUi(tab) {
    document.body.dataset.mobileTab = tab;
    document.querySelectorAll("[data-mobile-tab]").forEach((el) => {
      if (el.tagName === "BUTTON" || el.tagName === "A") {
        el.classList.toggle("mobile-tab--active", el.dataset.mobileTab === tab);
      }
    });

    const morePanel = document.getElementById("mobile-more-panel");
    if (morePanel) morePanel.hidden = tab !== "more";

    document.querySelectorAll(".admin-mobile-home-only").forEach((el) => {
      if (!isMobile()) {
        el.hidden = false;
        return;
      }
      if (tab !== "home") {
        el.hidden = true;
        return;
      }
      if (el.id === "overview-trial-note" || el.id === "mobile-subscription-card") {
        return;
      }
      el.hidden = false;
    });

    const modulesBlock = document.querySelector("#overview .overview-main");
    if (modulesBlock) {
      if (isMobile()) {
        modulesBlock.hidden = tab !== "modules";
      } else {
        modulesBlock.removeAttribute("hidden");
      }
    }

    document.body.classList.toggle("admin-mobile-more-open", tab === "more");

    if (isMobile()) {
      window.MobileShell?.resetPortalScroll?.();
    }
    syncComplianceDrill();
  }

  function setTab(tab, options = {}) {
    const { skipHash = false } = options;
    currentTab = tab;
    localStorage.setItem("adminMobileTab", tab);
    syncTabUi(tab);

    if (skipHash || !isMobile()) return;

    if (tab === "home" || tab === "modules") {
      const base = window.Admin?.resolveSectionFromHash?.(window.location.hash) || "overview";
      if (base !== "overview") window.location.hash = "overview";
      return;
    }
    if (tab === "rota") {
      window.location.hash = "rota";
      return;
    }
    if (tab === "compliance") {
      window.location.hash = "compliance";
      return;
    }
    if (tab === "more") {
      document.querySelectorAll(".admin-section").forEach((section) => {
        section.hidden = true;
      });
    }
  }

  function enterDetailView(sectionId) {
    previousTab = currentTab;
    document.body.classList.add("admin-mobile-detail");
    document.body.dataset.mobileDetail = sectionId;
    document.body.classList.remove("admin-mobile-more-open");
    const back = document.getElementById("mobile-back-btn");
    const toggle = document.getElementById("sidebar-toggle");
    if (back) back.hidden = false;
    if (toggle) toggle.hidden = true;
    window.MobileShell?.resetPortalScroll?.();
  }

  function exitDetailView() {
    document.body.classList.remove("admin-mobile-detail");
    delete document.body.dataset.mobileDetail;
    const back = document.getElementById("mobile-back-btn");
    const toggle = document.getElementById("sidebar-toggle");
    if (back) back.hidden = true;
    if (toggle) toggle.hidden = false;
    setTab(previousTab || "home");
    const hash =
      previousTab === "rota"
        ? "rota"
        : previousTab === "compliance"
          ? "compliance"
          : "overview";
    window.location.hash = hash;
  }

  function renderMobileCompliance(data) {
    const host = document.getElementById("mobile-compliance-dashboard");
    if (!host) return;
    const absence = data.modules?.absence || {};
    const rtw = data.modules?.rtw || {};
    const day9 = Number(absence.day9_alerts) || 0;
    const escapeHtml =
      window.Admin?.escapeHtml ||
      ((v) =>
        String(v ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;"));

    host.innerHTML = `
      ${
        day9
          ? `<article class="mobile-urgent-card">
              <span class="mobile-urgent-card__dot" aria-hidden="true"></span>
              <div>
                <strong>${escapeHtml(day9)} day-9 absence alert${day9 === 1 ? "" : "s"}</strong>
                <p class="muted">Sponsored worker absences need immediate Home Office action.</p>
              </div>
              <a class="btn primary btn-sm" href="#compliance-absence">Review</a>
            </article>`
          : ""
      }
      <div class="mobile-compliance-grid">
        <a class="mobile-compliance-tile" href="#compliance-rtw">
          ${window.AdminIcons?.svg?.("passport") || ""}
          <span class="mobile-compliance-tile__title">Right to work</span>
          <span class="mobile-compliance-tile__value">${escapeHtml(rtw.needs_review ?? 0)} need review</span>
        </a>
        <a class="mobile-compliance-tile" href="#compliance-absence">
          ${window.AdminIcons?.svg?.("medical") || ""}
          <span class="mobile-compliance-tile__title">Absences</span>
          <span class="mobile-compliance-tile__value">${escapeHtml(absence.active_this_month ?? 0)} days this month</span>
        </a>
        <a class="mobile-compliance-tile" href="#compliance">
          ${window.AdminIcons?.svg?.("scale") || ""}
          <span class="mobile-compliance-tile__title">Sponsor licence</span>
          <span class="mobile-compliance-tile__value">Duty checklist</span>
        </a>
        <a class="mobile-compliance-tile" href="#compliance-audit-export">
          ${window.AdminIcons?.svg?.("folder") || ""}
          <span class="mobile-compliance-tile__title">Audit export</span>
          <span class="mobile-compliance-tile__value">Download pack</span>
        </a>
      </div>
      <button type="button" class="btn primary mobile-compliance-export" id="mobile-audit-export-btn">
        Export audit pack
      </button>`;

    document.getElementById("mobile-audit-export-btn")?.addEventListener("click", () => {
      document.getElementById("sponsor-banner-export-btn")?.click();
    });
  }

  function syncComplianceDrill() {
    if (!isMobile()) {
      document.body.classList.remove("compliance-mobile-drill");
      return;
    }
    const hash = window.location.hash.replace("#", "").split("/")[0];
    const drill = hash.startsWith("compliance-") && hash !== "compliance";
    const active = drill && currentTab === "compliance";
    document.body.classList.toggle("compliance-mobile-drill", active);
    const back = document.getElementById("mobile-back-btn");
    const toggle = document.getElementById("sidebar-toggle");
    if (active) {
      if (back) back.hidden = false;
      if (toggle) toggle.hidden = true;
      window.setTimeout(() => window.MobileShell?.scrollToAnchor?.(hash), 80);
    } else if (!document.body.classList.contains("admin-mobile-detail")) {
      if (back) back.hidden = true;
      if (toggle) toggle.hidden = false;
    }
  }

  function init() {
    const bar = document.getElementById("mobile-tab-bar");
    if (!bar) return;

    bar.querySelectorAll("[data-mobile-tab]").forEach((tab) => {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        document.body.classList.remove("admin-mobile-detail");
        setTab(tab.dataset.mobileTab);
        if (tab.dataset.mobileTab === "rota") {
          window.dispatchEvent(new CustomEvent("admin:rota-mobile-open"));
        }
      });
    });

    document.getElementById("mobile-back-btn")?.addEventListener("click", (event) => {
      event.preventDefault();
      if (document.body.classList.contains("compliance-mobile-drill")) {
        document.body.classList.remove("compliance-mobile-drill");
        window.location.hash = "compliance";
        syncComplianceDrill();
        window.MobileShell?.resetPortalScroll?.();
        return;
      }
      exitDetailView();
    });

    document.getElementById("topbar-alerts-btn")?.addEventListener("click", () => {
      if (!isMobile()) return;
      setTab("home");
      window.location.hash = "overview";
      window.setTimeout(() => window.MobileShell?.scrollToAnchor?.("overview-actions"), 120);
    });

    window.addEventListener("admin:section", (event) => {
      if (!isMobile()) return;
      const section = event.detail?.section;
      if (isDetailSection(section)) {
        enterDetailView(section);
        syncComplianceDrill();
        return;
      }
      document.body.classList.remove("admin-mobile-detail");
      if (section === "overview") {
        syncTabUi(currentTab);
      } else if (section === "rota" && currentTab !== "rota") {
        syncTabUi("rota");
        currentTab = "rota";
      } else if (section === "compliance" && currentTab !== "compliance") {
        syncTabUi("compliance");
        currentTab = "compliance";
      }
      syncComplianceDrill();
    });

    window.addEventListener("hashchange", () => {
      if (!isMobile()) return;
      syncComplianceDrill();
    });

    window.addEventListener("admin:overview-loaded", (event) => {
      if (event.detail?.data) renderMobileCompliance(event.detail.data);
    });

    window.addEventListener("resize", () => {
      if (!isMobile()) {
        document.body.classList.remove("admin-mobile-detail", "admin-mobile-more-open");
        delete document.body.dataset.mobileTab;
        document.querySelector("#overview .overview-main")?.removeAttribute("hidden");
        const morePanel = document.getElementById("mobile-more-panel");
        if (morePanel) morePanel.hidden = true;
      } else {
        syncTabUi(currentTab);
      }
      syncComplianceDrill();
    });

    refreshGreeting();
    if (isMobile()) {
      if (currentTab === "rota" || currentTab === "compliance") {
        window.location.hash = currentTab;
      } else if (currentTab === "more") {
        setTab("more", { skipHash: true });
      } else {
        if (!window.location.hash || window.location.hash === "#") {
          window.location.hash = "overview";
        }
        setTab(currentTab, { skipHash: true });
      }
      syncComplianceDrill();
    } else {
      delete document.body.dataset.mobileTab;
      document.querySelector("#overview .overview-main")?.removeAttribute("hidden");
    }
  }

  window.AdminMobile = {
    init,
    setTab,
    isMobile,
    refreshGreeting,
    renderMobileCompliance,
  };
})();
