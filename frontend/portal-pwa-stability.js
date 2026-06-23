/** Shared PWA stability helpers — scroll, shell classes, service worker reload. */
(function initPortalPwaStability() {
  "use strict";

  function markPortalShell() {
    const root = document.documentElement;
    root.classList.add("portal-pwa-shell");
    if (document.getElementById("mobile-tab-bar")) {
      root.classList.add("portal-mobile-shell");
    }
  }

  function lockBodyScroll(lock) {
    const content = document.querySelector("main.content");
    if (lock) {
      document.body.classList.add("no-scroll");
      if (content) {
        content.dataset.scrollLockTop = String(content.scrollTop);
        content.style.overflow = "hidden";
      }
      return;
    }
    document.body.classList.remove("no-scroll");
    if (!content) return;
    const top = Number(content.dataset.scrollLockTop || "0");
    delete content.dataset.scrollLockTop;
    content.style.overflow = "";
    content.scrollTop = top;
  }

  let scrollResetFrame = 0;
  let lastScrollResetAt = 0;

  function resetPortalScrollDebounced(options = {}) {
    const { force = false } = options;
    const now = performance.now();
    if (!force && now - lastScrollResetAt < 80) return;

    if (scrollResetFrame) cancelAnimationFrame(scrollResetFrame);
    scrollResetFrame = requestAnimationFrame(() => {
      scrollResetFrame = 0;
      lastScrollResetAt = performance.now();
      const content = document.querySelector("main.content");
      if (content) {
        if (content.scrollTop !== 0) content.scrollTop = 0;
        return;
      }
      if (document.documentElement.scrollTop) document.documentElement.scrollTop = 0;
      if (document.body.scrollTop) document.body.scrollTop = 0;
      if (window.scrollY) window.scrollTo(0, 0);
    });
  }

  function initTouchPolish() {
    if (!document.getElementById("mobile-tab-bar")) return;
    document.documentElement.classList.add("portal-touch-polish");
  }

  function initServiceWorkerReload(storageKey) {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (sessionStorage.getItem(storageKey) === "1") return;
      sessionStorage.setItem(storageKey, "1");
      window.location.reload();
    });
  }

  markPortalShell();
  initTouchPolish();

  window.ShiftSwiftPortalStability = {
    lockBodyScroll,
    resetPortalScrollDebounced,
    initServiceWorkerReload,
  };
})();
