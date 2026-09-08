/** Mobile admin shell — Home / Modules / Rota / Compliance / More tabs. */
(function () {
  "use strict";

  const DETAIL_EXEMPT = new Set(["overview", "rota", "compliance"]);

  let clockEnabled = localStorage.getItem("adminTimeClockEnabled") === "true";
  let currentTab = "home";
  let previousTab = "home";
  let startupResolved = false;
  let lastSyncedTab = null;

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

  function usernameDisplayFallback(username) {
    const local = (username.split("@")[0] || username || "").trim();
    if (!local) return "there";
    const cleaned = local.replace(/\d+$/, "") || local;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  function applyAdminIdentity(user) {
    if (user.username) {
      localStorage.setItem("adminUsername", user.username);
    }
    const displayName =
      (user.display_name || "").trim() ||
      usernameDisplayFallback(user.username || "");
    const firstName =
      (user.first_name || "").trim() ||
      displayName.split(/\s+/)[0] ||
      "there";
    localStorage.setItem("adminDisplayName", displayName);
    localStorage.setItem("adminFirstName", firstName);
  }

  function displayFirstName() {
    const firstName = localStorage.getItem("adminFirstName") || "";
    if (firstName) return firstName;
    const stored = localStorage.getItem("adminDisplayName") || "";
    if (stored) return stored.split(/\s+/)[0];
    const username = localStorage.getItem("adminUsername") || "";
    if (!username) return "there";
    return usernameDisplayFallback(username);
  }

  function syncClockAvailability(enabled) {
    clockEnabled = Boolean(enabled);
    localStorage.setItem("adminTimeClockEnabled", clockEnabled ? "true" : "false");
    document.body.classList.toggle("admin-clock-disabled", !clockEnabled);
  }

  function dispatchPortalReady() {
    window.__SSHR_PORTAL_READY = true;
    window.ShiftSwiftNativeApp?.dismissStartupLoader?.();
    window.dispatchEvent(new CustomEvent("shiftswift:portal-ready"));
  }

  function finishStartup(enabled) {
    syncClockAvailability(enabled);
    const hashSection = window.location.hash.replace("#", "").split("/")[0];
    if (hashSection === "time-punch" && !clockEnabled) {
      window.location.hash = "overview";
    }
    if (startupResolved) return;
    startupResolved = true;
    document.body.classList.remove("portal-startup-pending");
    document.body.classList.add("portal-startup-ready");
    dispatchPortalReady();

    if (!isMobile()) return;

    const saved = localStorage.getItem("adminMobileTab");
    if (hashSection === "time-punch" && clockEnabled) {
      setTab(saved || "home", { skipHash: true });
      return;
    }

    syncTabFromHash();
    setTab(currentTab || saved || "home", { skipHash: true });
  }

  async function refreshGreeting() {
    const greetingEl = document.getElementById("mobile-greeting");
    if (!greetingEl) return;
    try {
      const token = localStorage.getItem("token");
      if (token && window.Admin?.apiFetch) {
        const res = await window.Admin.apiFetch("/auth/verify");
        if (res.ok) {
          applyAdminIdentity(await res.json());
        }
      }
    } catch {
      /* ignore */
    }
    greetingEl.textContent = `${timeGreeting()}, ${displayFirstName()}`;
  }

  function closeMorePanel() {
    document.body.classList.remove("admin-mobile-more-open");
    const morePanel = document.getElementById("mobile-more-panel");
    if (morePanel) morePanel.hidden = true;
  }

  function navigateFromMore(hash) {
    const raw = String(hash || "").replace(/^#/, "");
    const section = raw.split("/")[0];
    if (!section || section === "overview") return;
    previousTab = "more";
    closeMorePanel();
    window.location.hash = raw;
  }

  function syncTabUi(tab) {
    const tabChanged = lastSyncedTab !== tab;
    lastSyncedTab = tab;
    document.body.dataset.mobileTab = tab;
    document.querySelectorAll("[data-mobile-tab]").forEach((el) => {
      if (el.tagName === "BUTTON" || el.tagName === "A") {
        el.classList.toggle("mobile-tab--active", el.dataset.mobileTab === tab);
      }
    });

    const morePanel = document.getElementById("mobile-more-panel");
    const inDetail = document.body.classList.contains("admin-mobile-detail");
    if (morePanel) {
      morePanel.hidden = inDetail || tab !== "more";
    }

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

    if (isMobile() && tabChanged) {
      window.MobileShell?.resetPortalScroll?.();
    }
    syncComplianceDrill();
  }

  function setTab(tab, options = {}) {
    const { skipHash = false, persist = true } = options;
    currentTab = tab;
    if (persist) {
      localStorage.setItem("adminMobileTab", tab);
    }
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
      return;
    }
  }

  function enterDetailView(sectionId) {
    previousTab = currentTab;
    closeMorePanel();
    document.body.classList.add("admin-mobile-detail");
    document.body.dataset.mobileDetail = sectionId;
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
    const returnTab = previousTab || "home";
    if (returnTab === "more") {
      currentTab = "more";
      localStorage.setItem("adminMobileTab", "more");
      syncTabUi("more");
      window.location.hash = "overview";
      return;
    }
    setTab(returnTab);
    const hash =
      returnTab === "rota"
        ? "rota"
        : returnTab === "compliance"
          ? "compliance"
          : "overview";
    window.location.hash = hash;
  }

  function renderMobileCompliance(data) {
    if (!isMobile()) return;
    window.AdminComplianceMobile?.renderShell?.(data);
    window.AdminComplianceMobile?.openSectionFromHash?.();
  }

  function syncComplianceDrill() {
    if (!isMobile()) {
      document.body.classList.remove("compliance-mobile-drill");
      return;
    }
    const hash = window.location.hash.replace("#", "").split("/")[0];
    const sectionHashes = new Set([
      "compliance-rtw",
      "compliance-absence",
      "compliance-working-calendar",
      "compliance-audit-export",
    ]);
    if (sectionHashes.has(hash) && currentTab === "compliance") {
      window.AdminComplianceMobile?.setOpenSection?.(hash, { scroll: true, toggle: false });
      document.body.classList.remove("compliance-mobile-drill");
      const back = document.getElementById("mobile-back-btn");
      const toggle = document.getElementById("sidebar-toggle");
      if (back) back.hidden = true;
      if (toggle) toggle.hidden = false;
      return;
    }
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

  function syncTabFromHash() {
    if (!isMobile()) return;
    const hash = window.location.hash.replace("#", "").split("/")[0];
    if (hash === "rota") {
      currentTab = "rota";
      localStorage.setItem("adminMobileTab", "rota");
    } else if (hash.startsWith("compliance")) {
      currentTab = "compliance";
      localStorage.setItem("adminMobileTab", "compliance");
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

    document.querySelectorAll("#mobile-more-panel .mobile-more-link").forEach((link) => {
      link.addEventListener("click", (event) => {
        if (!isMobile()) return;
        const href = link.getAttribute("href") || "";

        if (link.hasAttribute("data-sign-out")) {
          event.preventDefault();
          closeMorePanel();
          void (window.ShiftSwiftAuthGuard?.signOut?.() ||
            window.ShiftSwiftSession?.signOut?.(window.ShiftSwiftAuthGuard?.loginRedirectUrl?.()));
          return;
        }

        if (link.target === "_blank" && !href.startsWith("#")) {
          closeMorePanel();
          return;
        }

        if (link.dataset.brandSupportMailto || href.startsWith("mailto:")) {
          closeMorePanel();
          return;
        }

        if (!href.startsWith("#") || href === "#") {
          closeMorePanel();
          return;
        }

        event.preventDefault();
        navigateFromMore(href);
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
      window.location.hash = "overview";
      if (isMobile()) {
        setTab("home");
        window.setTimeout(() => window.MobileShell?.scrollToAnchor?.("overview-actions"), 120);
        return;
      }
      window.setTimeout(() => {
        document.getElementById("overview-actions-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
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
      syncTabFromHash();
      if (document.body.dataset.mobileTab !== currentTab) {
        syncTabUi(currentTab);
      }
      syncComplianceDrill();
    });

    window.addEventListener("admin:overview-loaded", (event) => {
      if (event.detail?.data) renderMobileCompliance(event.detail.data);
      finishStartup(Boolean(event.detail?.data?.time_clock_enabled));
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
    syncClockAvailability(clockEnabled);
    if (startupResolved) return;

    if (isMobile()) {
      document.body.classList.add("portal-startup-pending");
      window.setTimeout(() => {
        if (!startupResolved) finishStartup(clockEnabled);
      }, 4000);
      syncComplianceDrill();
    } else {
      delete document.body.dataset.mobileTab;
      document.querySelector("#overview .overview-main")?.removeAttribute("hidden");
      if (!startupResolved) {
        startupResolved = true;
        document.body.classList.remove("portal-startup-pending");
        document.body.classList.add("portal-startup-ready");
        dispatchPortalReady();
      }
    }
  }

  window.AdminMobile = {
    init,
    setTab,
    isMobile,
    refreshGreeting,
    renderMobileCompliance,
    syncClockAvailability,
    finishStartup,
  };
})();
