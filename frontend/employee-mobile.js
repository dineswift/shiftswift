/** Mobile employee shell — Home / Shifts / Clock / Leave / More tabs. */
(function () {
  "use strict";

  const TAB_SECTIONS = {
    home: "overview",
    shifts: "my-shifts",
    clock: "time-clock",
    leave: "leave",
  };

  const DETAIL_EXEMPT = new Set(["overview", "my-shifts", "time-clock", "leave"]);

  let currentTab = localStorage.getItem("employeeMobileTab") || "clock";
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
    const stored = localStorage.getItem("employeeDisplayName") || "";
    if (stored) return stored;
    const username = localStorage.getItem("employeeUsername") || "";
    if (!username) return "there";
    const local = username.split("@")[0] || username;
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  function refreshGreeting() {
    const greetingEl = document.getElementById("mobile-greeting");
    if (!greetingEl) return;
    greetingEl.textContent = `${timeGreeting()}, ${displayFirstName()}`;
  }

  function syncTabUi(tab) {
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

    if (isMobile()) {
      window.MobileShell?.resetPortalScroll?.();
    }
  }

  function setTab(tab, options = {}) {
    const { skipHash = false } = options;
    currentTab = tab;
    localStorage.setItem("employeeMobileTab", tab);
    syncTabUi(tab);

    if (skipHash || !isMobile()) return;

    if (tab === "more") {
      document.querySelectorAll(".admin-section").forEach((section) => {
        section.hidden = true;
      });
      return;
    }

    const section = TAB_SECTIONS[tab] || "overview";
    if (window.location.hash.replace("#", "").split("/")[0] !== section) {
      window.location.hash = section;
    }
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
        currentTab = "clock";
        syncTabUi("clock");
      } else if (section === "leave" && currentTab !== "leave") {
        currentTab = "leave";
        syncTabUi("leave");
      }
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
    if (isMobile()) {
      if (currentTab === "more") {
        setTab("more", { skipHash: true });
      } else if (TAB_SECTIONS[currentTab]) {
        if (!window.location.hash || window.location.hash === "#") {
          window.location.hash = TAB_SECTIONS[currentTab];
        }
        setTab(currentTab, { skipHash: true });
      } else {
        setTab("home", { skipHash: true });
      }
    } else {
      syncTabUi(currentTab);
    }
  }

  window.EmployeeMobile = {
    init,
    setTab,
    isMobile,
    refreshGreeting,
  };
})();
