(function () {
  "use strict";

  function parseHashSection(rawHash, defaultSection) {
    const section = (rawHash.replace("#", "") || defaultSection).split("/")[0];
    return section || defaultSection;
  }

  let sidebarCtl = null;

  function initSidebar(options = {}) {
    if (sidebarCtl) return sidebarCtl;

    const toggle = document.getElementById(options.toggleId || "sidebar-toggle");
    const closeBtn = document.getElementById(options.closeId || "sidebar-close");
    const sidebar = document.querySelector(options.sidebarSelector || ".sidebar");
    const overlay = document.getElementById(options.overlayId || "sidebar-overlay");

    function setExpanded(open) {
      toggle?.setAttribute("aria-expanded", open ? "true" : "false");
      overlay?.setAttribute("aria-hidden", open ? "false" : "true");
    }

    function closeSidebar() {
      sidebar?.classList.remove("sidebar--open");
      overlay?.classList.remove("sidebar-overlay--visible");
      window.ShiftSwiftPortalStability?.lockBodyScroll?.(false);
      setExpanded(false);
    }

    function openSidebar() {
      sidebar?.classList.add("sidebar--open");
      overlay?.classList.add("sidebar-overlay--visible");
      window.ShiftSwiftPortalStability?.lockBodyScroll?.(true);
      setExpanded(true);
    }

    toggle?.addEventListener("click", () => {
      if (sidebar?.classList.contains("sidebar--open")) closeSidebar();
      else openSidebar();
    });
    closeBtn?.addEventListener("click", closeSidebar);
    overlay?.addEventListener("click", closeSidebar);
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeSidebar();
    });

    sidebarCtl = {
      openSidebar,
      closeSidebar,
      isOpen: () => Boolean(sidebar?.classList.contains("sidebar--open")),
    };
    return sidebarCtl;
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function getScrollRoot() {
    if (isMobileViewport()) {
      const content = document.querySelector("main.content");
      if (content) return content;
    }
    return document.documentElement;
  }

  function readScrollTop(root) {
    return root === document.documentElement ? window.scrollY : root.scrollTop;
  }

  function writeScrollTop(root, top) {
    if (root === document.documentElement) {
      window.scrollTo({ top, left: 0, behavior: "auto" });
      return;
    }
    root.scrollTop = top;
  }

  function restoreScrollTop(root, top) {
    writeScrollTop(root, top);
    requestAnimationFrame(() => writeScrollTop(root, top));
  }

  function preserveScroll(update) {
    const root = getScrollRoot();
    const top = readScrollTop(root);
    const result = update();
    restoreScrollTop(root, top);
    return result;
  }

  async function preserveScrollAsync(update) {
    const root = getScrollRoot();
    const top = readScrollTop(root);
    const result = await update();
    restoreScrollTop(root, top);
    return result;
  }

  function resetPortalScroll() {
    if (window.ShiftSwiftPortalStability?.resetPortalScrollDebounced) {
      window.ShiftSwiftPortalStability.resetPortalScrollDebounced();
      return;
    }
    const content = document.querySelector("main.content");
    if (content) content.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function scrollToAnchor(anchorId, options = {}) {
    if (!anchorId) return;
    const el = document.getElementById(anchorId);
    if (!el) return;
    const block = options.block || "nearest";
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: options.behavior || "auto", block });
    });
  }

  function initBottomTabs(options = {}) {
    const bar = document.getElementById(options.barId || "mobile-tab-bar");
    if (!bar) return;

    const resolveSection =
      options.resolveSection ||
      ((rawHash) => {
        const section = parseHashSection(rawHash, "overview");
        if (section.startsWith("compliance")) return "compliance";
        if (section === "overview-actions") return "overview";
        return section;
      });

    function syncActive() {
      const section = resolveSection(window.location.hash);
      bar.querySelectorAll("[data-section]").forEach((tab) => {
        tab.classList.toggle("mobile-tab--active", tab.dataset.section === section);
      });
    }

    bar.querySelectorAll("[data-section]").forEach((tab) => {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        window.location.hash = tab.dataset.section;
      });
    });

    document.getElementById("mobile-tab-more")?.addEventListener("click", () => {
      sidebarCtl?.openSidebar?.();
    });

    document.getElementById("topbar-alerts-btn")?.addEventListener("click", (event) => {
      if (document.getElementById("topbar-alerts-btn")?.dataset.notificationsBound) return;
      event.preventDefault();
      if (resolveSection(window.location.hash) !== "overview") {
        window.location.hash = "overview";
        window.setTimeout(() => scrollToAnchor("overview-actions"), 120);
      } else {
        scrollToAnchor("overview-actions");
      }
    });

    window.addEventListener("admin:section", syncActive);
    window.addEventListener("hashchange", syncActive);
    syncActive();
  }

  function linkSectionId(link, defaultSection) {
    if (link.dataset.section) return link.dataset.section;
    const href = link.getAttribute("href") || "";
    if (href.startsWith("#")) {
      return href.slice(1).split("/")[0] || defaultSection;
    }
    return null;
  }

  function initHashSections(options) {
    const defaultSection = options.defaultSection || "overview";
    const sectionSelector = options.sectionSelector || ".admin-section";
    const linkSelector = options.linkSelector || ".nav-link";
    const sectionEvent = options.sectionEvent || null;
    const resolveSection = options.resolveSection || null;
    const sidebar = options.sidebar || null;

    const sections = [...document.querySelectorAll(sectionSelector)];
    const links = [...document.querySelectorAll(linkSelector)];
    let activeSectionId = null;

    function showSection(sectionId) {
      const exists = sections.some((section) => section.id === sectionId);
      const target = exists ? sectionId : defaultSection;
      const sectionChanged = activeSectionId !== target;
      activeSectionId = target;

      sections.forEach((section) => {
        const active = section.id === target;
        section.hidden = !active;
        section.classList.toggle("admin-section--active", active);
      });

      links.forEach((link) => {
        const id = linkSectionId(link, defaultSection);
        if (id) link.classList.toggle("active", id === target);
      });

      if (sidebar?.isOpen?.()) sidebar.closeSidebar();

      if (sectionChanged && isMobileViewport()) {
        resetPortalScroll();
      }

      if (sectionEvent) {
        window.dispatchEvent(new CustomEvent(sectionEvent, { detail: { section: target } }));
      }

      return target;
    }

    function routeFromHash() {
      const rawHash = window.location.hash;
      let sectionId = parseHashSection(rawHash, defaultSection);
      if (typeof resolveSection === "function") {
        sectionId = resolveSection(rawHash) || defaultSection;
      }
      const target = showSection(sectionId);
      const path = rawHash.replace("#", "");
      if (!sections.some((section) => section.id === sectionId) && path !== target) {
        window.location.hash = target;
      }
      return target;
    }

    links.forEach((link) => {
      const id = linkSectionId(link, defaultSection);
      if (!id) return;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        window.location.hash = id;
      });
    });

    window.addEventListener("hashchange", routeFromHash);
    routeFromHash();
    return { routeFromHash, showSection };
  }

  window.MobileShell = {
    initSidebar,
    initBottomTabs,
    initHashSections,
    parseHashSection,
    scrollToAnchor,
    resetPortalScroll,
    preserveScroll,
    preserveScrollAsync,
    getScrollRoot,
    isMobileViewport,
  };
})();
