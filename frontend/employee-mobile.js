/** Mobile employee shell — Home / Shifts / Clock / Leave / More tabs. */
(function () {
  "use strict";

  const TAB_SECTIONS = {
    home: "overview",
    shifts: "my-shifts",
    clock: "time-clock",
    leave: "leave",
  };

  const SECTION_TABS = Object.fromEntries(
    Object.entries(TAB_SECTIONS).map(([tab, section]) => [section, tab]),
  );

  const DETAIL_EXEMPT = new Set(["overview", "my-shifts", "time-clock", "leave"]);

  let clockEnabled = localStorage.getItem("employeeTimeClockEnabled") === "true";
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

  function displayFirstName() {
    const firstName = localStorage.getItem("employeeFirstName") || "";
    if (firstName) return firstName;
    const stored = localStorage.getItem("employeeDisplayName") || "";
    if (stored) return stored.split(/\s+/)[0];
    const username = localStorage.getItem("employeeUsername") || "";
    if (!username) return "there";
    const local = username.split("@")[0] || username;
    const cleaned = local.replace(/\d+$/, "") || local;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  function refreshGreeting() {
    const greetingEl = document.getElementById("mobile-greeting");
    if (!greetingEl) return;
    greetingEl.textContent = `${timeGreeting()}, ${displayFirstName()}`;
  }

  function syncClockAvailability(enabled) {
    clockEnabled = Boolean(enabled);
    localStorage.setItem("employeeTimeClockEnabled", clockEnabled ? "true" : "false");
    document.body.classList.toggle("employee-clock-disabled", !clockEnabled);
  }

  function normalizeTab(tab) {
    if (tab === "clock" && !clockEnabled) return "home";
    if (tab && TAB_SECTIONS[tab]) return tab;
    return "home";
  }

  function tabFromHash() {
    const section = window.location.hash.replace("#", "").split("/")[0];
    if (!section) return null;
    const tab = SECTION_TABS[section];
    return tab ? normalizeTab(tab) : null;
  }

  function resolveStartupTab() {
    const fromHash = tabFromHash();
    if (fromHash) return fromHash;

    const saved = localStorage.getItem("employeeMobileTab");
    if (saved) return normalizeTab(saved);

    return clockEnabled ? "clock" : "home";
  }

  function syncTabUi(tab) {
    const tabChanged = lastSyncedTab !== tab;
    lastSyncedTab = tab;
    document.body.dataset.mobileTab = tab;
    document.querySelectorAll("#mobile-tab-bar [data-mobile-tab]").forEach((el) => {
      el.classList.toggle("mobile-tab--active", el.dataset.mobileTab === tab);
    });

    const morePanel = document.getElementById("mobile-more-panel");
    if (morePanel) morePanel.hidden = tab !== "more";

    document.querySelectorAll(".employee-mobile-home-only").forEach((el) => {
      el.hidden = tab !== "home";
    });

    document.body.classList.toggle("employee-mobile-more-open", tab === "more");

    if (isMobile() && tabChanged) {
      window.MobileShell?.resetPortalScroll?.();
    }
  }

  function setTab(tab, options = {}) {
    const { skipHash = false, persist = true } = options;
    currentTab = normalizeTab(tab);
    if (persist) {
      localStorage.setItem("employeeMobileTab", currentTab);
    }
    syncTabUi(currentTab);

    if (skipHash || !isMobile()) return;

    if (currentTab === "more") {
      return;
    }

    const section = TAB_SECTIONS[currentTab] || "overview";
    if (window.location.hash.replace("#", "").split("/")[0] !== section) {
      window.location.hash = section;
    }
  }

  function dispatchPortalReady() {
    window.__SSHR_PORTAL_READY = true;
    window.ShiftSwiftNativeApp?.dismissStartupLoader?.();
    window.dispatchEvent(new CustomEvent("shiftswift:portal-ready"));
  }

  function finishStartup(enabled) {
    syncClockAvailability(enabled);
    if (window.location.hash.replace("#", "").split("/")[0] === "time-clock" && !clockEnabled) {
      window.location.hash = "overview";
    }
    if (startupResolved) return;
    const tab = resolveStartupTab();
    startupResolved = true;
    document.body.classList.remove("portal-startup-pending");
    document.body.classList.add("portal-startup-ready");
    dispatchPortalReady();
    if (isMobile()) {
      setTab(tab);
      return;
    }
    syncTabUi(tab);
  }

  function enterDetailView(sectionId) {
    previousTab = currentTab;
    document.body.classList.add("employee-mobile-detail");
    document.body.dataset.mobileDetail = sectionId;
    document.body.classList.remove("employee-mobile-more-open");
    const back = document.getElementById("mobile-back-btn");
    const toggle = document.getElementById("sidebar-toggle");
    if (back) back.hidden = false;
    if (toggle) toggle.hidden = true;
    const morePanel = document.getElementById("mobile-more-panel");
    if (morePanel) morePanel.hidden = true;
    window.MobileShell?.resetPortalScroll?.();
  }

  function exitDetailView() {
    document.body.classList.remove("employee-mobile-detail");
    delete document.body.dataset.mobileDetail;
    const back = document.getElementById("mobile-back-btn");
    const toggle = document.getElementById("sidebar-toggle");
    if (back) back.hidden = true;
    if (toggle) toggle.hidden = false;
    setTab(previousTab || "home");
    const hash = TAB_SECTIONS[previousTab] || "overview";
    window.location.hash = hash;
  }

  function init() {
    const bar = document.getElementById("mobile-tab-bar");
    if (!bar) return;

    syncClockAvailability(clockEnabled);

    bar.querySelectorAll("[data-mobile-tab]").forEach((tab) => {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        document.body.classList.remove("employee-mobile-detail");
        setTab(tab.dataset.mobileTab);
      });
    });

    document.getElementById("mobile-back-btn")?.addEventListener("click", (event) => {
      event.preventDefault();
      exitDetailView();
    });

    window.addEventListener("employee:section", (event) => {
      if (!isMobile()) return;
      const section = event.detail?.section;
      if (isDetailSection(section)) {
        enterDetailView(section);
        return;
      }
      document.body.classList.remove("employee-mobile-detail");
      if (section === "overview") {
        syncTabUi(currentTab);
      } else if (section === "my-shifts" && currentTab !== "shifts") {
        currentTab = "shifts";
        syncTabUi("shifts");
      } else if (section === "time-clock" && currentTab !== "clock") {
        if (!clockEnabled) {
          setTab("home");
          return;
        }
        currentTab = "clock";
        syncTabUi("clock");
      } else if (section === "leave" && currentTab !== "leave") {
        currentTab = "leave";
        syncTabUi("leave");
      }
    });

    window.addEventListener("employee:profile-loaded", (event) => {
      finishStartup(Boolean(event.detail?.user?.time_clock_enabled));
    });

    window.addEventListener("resize", () => {
      if (!isMobile()) {
        document.body.classList.remove("employee-mobile-detail", "employee-mobile-more-open");
        delete document.body.dataset.mobileTab;
        const morePanel = document.getElementById("mobile-more-panel");
        if (morePanel) morePanel.hidden = true;
        document.querySelectorAll(".employee-mobile-home-only").forEach((el) => {
          el.hidden = false;
        });
      } else {
        syncTabUi(currentTab);
      }
    });

    refreshGreeting();

    if (startupResolved) return;

    if (isMobile()) {
      document.body.classList.add("portal-startup-pending");
      window.setTimeout(() => {
        if (!startupResolved) finishStartup(clockEnabled);
      }, 4000);
    } else {
      syncTabUi("home");
      if (!startupResolved) {
        startupResolved = true;
        document.body.classList.remove("portal-startup-pending");
        document.body.classList.add("portal-startup-ready");
        dispatchPortalReady();
      }
    }
  }

  window.EmployeeMobile = {
    init,
    setTab,
    isMobile,
    refreshGreeting,
    syncClockAvailability,
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type !== "SHIFT_NAVIGATE" || !event.data.hash) return;
      window.location.hash = String(event.data.hash).replace(/^#/, "");
    });
  }
})();
