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

  function resetPortalScrollDebounced() {
    if (scrollResetFrame) cancelAnimationFrame(scrollResetFrame);
    scrollResetFrame = requestAnimationFrame(() => {
      scrollResetFrame = 0;
      const content = document.querySelector("main.content");
      if (content) {
        content.scrollTop = 0;
        return;
      }
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
    });
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

  window.ShiftSwiftPortalStability = {
    lockBodyScroll,
    resetPortalScrollDebounced,
    initServiceWorkerReload,
  };
})();
