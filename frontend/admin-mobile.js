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
    if (window.ShiftSwiftNativeLayout?.isMobileViewport) {
      return window.ShiftSwiftNativeLayout.isMobileViewport();
    }
    if (document.documentElement.classList.contains("native-tablet")) return false;
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function isNativeShell() {
    return Boolean(
      window.Capacitor?.isNativePlatform?.() ||
        window.__SSHR_BUNDLED_NATIVE_BOOT ||
        window.__SSHR_PORTAL_GUARD ||
        document.documentElement.classList.contains("native-app"),
    );
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

    // Home = greeting + stats + actions. Modules = module tile grid only.
    const modulesBlock = document.querySelector("#overview .overview-main");
    if (modulesBlock) {
      if (isMobile()) {
        modulesBlock.hidden = tab !== "modules";
      } else {
        modulesBlock.removeAttribute("hidden");
      }
    }

    const homeChrome = [
      document.getElementById("overview-metrics"),
      document.getElementById("overview-actions-panel"),
      document.getElementById("overview-setup-checklist"),
      document.getElementById("overview-trial-note"),
    ];
    homeChrome.forEach((el) => {
      if (!el) return;
      if (!isMobile()) {
        el.hidden = el.id === "overview-setup-checklist" || el.id === "overview-trial-note"
          ? el.hidden
          : false;
        return;
      }
      if (tab === "home") {
        if (el.id === "overview-setup-checklist" || el.id === "overview-trial-note") return;
        el.hidden = false;
        return;
      }
      el.hidden = true;
    });

    document.body.classList.toggle("admin-mobile-more-open", tab === "more");
    if (tab === "more") enhanceMoreMenu();

    if (isMobile() && tabChanged) {
      window.MobileShell?.resetPortalScroll?.();
      window.MobileShell?.pulseContentEnter?.();
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

  function enhanceMoreMenuIcons() {
    document.querySelectorAll("#mobile-more-panel .mobile-more-link[data-more-icon]").forEach((link) => {
      const iconHost = link.querySelector(".mobile-more-link__icon");
      if (!iconHost) return;
      const name = link.getAttribute("data-more-icon");
      if (name) iconHost.setAttribute("data-icon-tone", name);
      if (iconHost.childElementCount) return;
      const markup = window.AdminIcons?.svg?.(name);
      if (markup) iconHost.innerHTML = markup;
    });
  }

  function enhanceTabBarIcons() {
    document.querySelectorAll("#mobile-tab-bar .mobile-tab[data-tab-icon]").forEach((tab) => {
      const iconHost = tab.querySelector(".mobile-tab__icon");
      if (!iconHost || iconHost.childElementCount) return;
      const name = tab.getAttribute("data-tab-icon");
      const markup = window.AdminIcons?.svg?.(name, "mobile-tab__svg");
      if (markup) iconHost.innerHTML = markup;
    });
  }

  function setMoreSub(link, text) {
    const sub = link?.querySelector?.(".mobile-more-link__sub");
    if (sub && text) sub.textContent = text;
  }

  function setMoreCount(link, count) {
    const badge = link?.querySelector?.("[data-more-count]");
    if (!badge) return;
    const n = Number(count) || 0;
    if (n > 0) {
      badge.hidden = false;
      badge.textContent = String(n);
    } else {
      badge.hidden = true;
      badge.textContent = "";
    }
  }

  function refreshMoreMenuStats() {
    const overview = window.Admin?.getAdminOverviewCache?.();
    if (!overview) return;
    const employees = overview.employees || {};
    const modules = overview.modules || {};
    const leave = modules.leave || {};
    const recruitment = modules.recruitment || {};
    const offboarding = modules.offboarding || {};
    const grievance = modules.grievance || {};
    const disciplinary = modules.disciplinary || {};
    const contracts = modules.contracts || {};
    const punch = modules.time_punch || modules.punch || {};
    const profileChanges = modules.profile_changes || {};
    const employmentContracts = modules.employment_contracts || {};

    const byStat = (name) =>
      document.querySelector(`#mobile-more-panel .mobile-more-link[data-more-stat="${name}"]`);

    const employeesLink = byStat("employees");
    if (employeesLink) {
      const active = Number(employees.active ?? 0);
      const limit = employees.limit ?? overview.max_employees;
      setMoreSub(
        employeesLink,
        limit != null ? `${active} active · limit ${limit}` : `${active} active`,
      );
    }

    const recruitmentLink = byStat("recruitment");
    if (recruitmentLink) {
      const open = Number(recruitment.open_vacancies ?? 0);
      setMoreSub(recruitmentLink, open === 1 ? "1 open vacancy" : `${open} open vacancies`);
    }

    const offboardingLink = byStat("offboarding");
    if (offboardingLink) {
      const activeLeavers = Number(offboarding.in_progress ?? offboarding.active ?? 0);
      setMoreSub(
        offboardingLink,
        activeLeavers > 0
          ? `${activeLeavers} active leaver${activeLeavers === 1 ? "" : "s"}`
          : "No active leavers",
      );
    }

    const leaveLink = byStat("leave");
    if (leaveLink) {
      const pending = Number(leave.pending_requests ?? 0);
      setMoreSub(
        leaveLink,
        pending > 0
          ? `${pending} pending request${pending === 1 ? "" : "s"}`
          : "No pending requests",
      );
      setMoreCount(leaveLink, pending);
    }

    const grievanceLink = byStat("grievance");
    if (grievanceLink) {
      const open = Number(grievance.open_cases ?? grievance.open ?? 0);
      setMoreSub(grievanceLink, open > 0 ? `${open} open case${open === 1 ? "" : "s"}` : "No open cases");
    }

    const disciplinaryLink = byStat("disciplinary");
    if (disciplinaryLink) {
      const open = Number(disciplinary.open_cases ?? disciplinary.open ?? 0);
      setMoreSub(
        disciplinaryLink,
        open > 0 ? `${open} open case${open === 1 ? "" : "s"}` : "No open cases",
      );
    }

    const employmentLink = byStat("employment-contracts");
    if (employmentLink) {
      const awaiting = Number(
        employmentContracts.awaiting_signature ?? employmentContracts.pending_signature ?? 0,
      );
      setMoreSub(
        employmentLink,
        awaiting > 0
          ? `${awaiting} awaiting signature`
          : "Issue and track contracts",
      );
      setMoreCount(employmentLink, awaiting);
    }

    const serviceLink = byStat("service-agreements");
    if (serviceLink) {
      const awaiting = Number(contracts.awaiting_signature ?? contracts.pending_signature ?? 0);
      setMoreSub(
        serviceLink,
        awaiting > 0 ? `${awaiting} awaiting signature` : "MSA, DPA and orders",
      );
      setMoreCount(serviceLink, awaiting);
    }

    const punchLink = byStat("time-punch");
    if (punchLink) {
      const clocked = Number(punch.clocked_in_today ?? punch.on_shift ?? punch.today_open ?? 0);
      setMoreSub(
        punchLink,
        clocked > 0
          ? `${clocked} clocked in today`
          : "Sites, punches and timesheets",
      );
    }

    const profileLink = byStat("profile-changes");
    if (profileLink) {
      const pending = Number(
        profileChanges.pending_requests ?? profileChanges.pending ?? 0,
      );
      setMoreSub(
        profileLink,
        pending > 0
          ? `${pending} pending update${pending === 1 ? "" : "s"}`
          : "Emergency contacts and details",
      );
      setMoreCount(profileLink, pending);
    }

    const subscriptionLink = byStat("subscription");
    if (subscriptionLink) {
      const plan = overview.plan_display_name || overview.subscription_plan || "Plan";
      const status = String(overview.subscription_status || "").toLowerCase();
      const active = status === "active" || status === "trialing" || status === "trial";
      setMoreSub(
        subscriptionLink,
        active ? `${plan} · Active` : `${plan}${status ? ` · ${status}` : ""}`,
      );
      const badge = subscriptionLink.querySelector("[data-more-badge]");
      if (badge) {
        badge.hidden = !active;
        badge.textContent = active ? "Active" : "";
      }
    }
  }

  function enhanceMoreMenu() {
    enhanceTabBarIcons();
    enhanceMoreMenuIcons();
    refreshMoreMenuStats();
  }

  function init() {
    const bar = document.getElementById("mobile-tab-bar");
    if (!bar) return;
    if (bar.dataset.sshrMobileBound === "1") return;
    bar.dataset.sshrMobileBound = "1";

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
      if (document.body.classList.contains("emp-profile-open") || /^employees\/\d+/.test(window.location.hash.replace("#", ""))) {
        document.body.classList.remove("emp-profile-open", "admin-mobile-detail");
        delete document.body.dataset.mobileDetail;
        document.getElementById("emp-profile-edit-btn")?.remove();
        if (window.AdminEmployees?.showListView) {
          window.AdminEmployees.showListView();
        } else if (window.ShiftSwiftAdminEmployees?.showListView) {
          window.ShiftSwiftAdminEmployees.showListView();
        } else {
          window.location.hash = "employees";
        }
        const back = document.getElementById("mobile-back-btn");
        if (back) {
          back.hidden = true;
          back.textContent = back.dataset.defaultLabel || "← Back";
        }
        const toggle = document.getElementById("sidebar-toggle");
        if (toggle) toggle.hidden = false;
        window.MobileShell?.resetPortalScroll?.();
        return;
      }
      exitDetailView();
    });

    document.getElementById("topbar-mobile-avatar")?.addEventListener("click", (event) => {
      event.preventDefault();
      if (!isMobile()) return;
      document.body.classList.remove("admin-mobile-detail", "emp-profile-open");
      setTab("more");
    });

    document.getElementById("topbar-alerts-btn")?.addEventListener("click", (event) => {
      if (document.getElementById("topbar-alerts-btn")?.dataset.notificationsBound) return;
      event.preventDefault();
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

    window.addEventListener("admin:deferred-ready", () => {
      if (!isMobile()) return;
      syncTabUi(currentTab);
      syncComplianceDrill();
    });

    window.addEventListener("admin:overview-loaded", (event) => {
      if (event.detail?.data) renderMobileCompliance(event.detail.data);
      finishStartup(Boolean(event.detail?.data?.time_clock_enabled));
      if (isMobile()) syncTabUi(currentTab);
    });

    window.addEventListener("admin:portal-native-retry", () => {
      if (!isMobile()) return;
      syncTabUi(currentTab);
    });

    let lastMobile = isMobile();
    const mobileMq = window.matchMedia("(max-width: 860px)");
    const onShellModeChange = () => {
      const mobile = isMobile();
      if (mobile === lastMobile) return;
      lastMobile = mobile;
      if (!mobile) {
        document.body.classList.remove("admin-mobile-detail", "admin-mobile-more-open");
        delete document.body.dataset.mobileTab;
        document.querySelector("#overview .overview-main")?.removeAttribute("hidden");
        const morePanel = document.getElementById("mobile-more-panel");
        if (morePanel) morePanel.hidden = true;
      } else {
        syncTabUi(currentTab);
      }
      syncComplianceDrill();
    };
    if (mobileMq.addEventListener) mobileMq.addEventListener("change", onShellModeChange);
    else mobileMq.addListener?.(onShellModeChange);
    window.addEventListener("sshr:shell-mode-change", onShellModeChange);

    refreshGreeting();
    syncClockAvailability(clockEnabled);
    enhanceMoreMenu();
    window.addEventListener("admin:overview-loaded", () => refreshMoreMenuStats());
    if (startupResolved) return;

    if (isMobile()) {
      if (isNativeShell()) {
        finishStartup(clockEnabled);
      } else {
        document.body.classList.add("portal-startup-pending");
        window.setTimeout(() => {
          if (!startupResolved) finishStartup(clockEnabled);
        }, 1200);
      }
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
    window.__SSHR_PORTAL_HANDLERS_READY = true;
  }

  window.AdminMobile = {
    init,
    setTab,
    isMobile,
    refreshGreeting,
    renderMobileCompliance,
    syncClockAvailability,
    finishStartup,
    enhanceMoreMenu,
    refreshMoreMenuStats,
  };
})();
