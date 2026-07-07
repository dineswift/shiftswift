/** Native iPad — desktop sidebar layout instead of phone bottom tabs. */
(function () {
  "use strict";

  function isNativeShell() {
    return Boolean(
      window.Capacitor?.isNativePlatform?.() ||
        document.documentElement.classList.contains("native-app") ||
        document.documentElement.classList.contains("capacitor-native"),
    );
  }

  function isPadDevice() {
    const ua = navigator.userAgent || "";
    if (/iPad/i.test(ua)) return true;
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
    const w = window.screen?.width || 0;
    const h = window.screen?.height || 0;
    const minSide = Math.min(w, h);
    const maxSide = Math.max(w, h);
    return minSide >= 744 && maxSide >= 1024;
  }

  function shouldUseTabletLayout() {
    if (!isNativeShell()) return false;
    if (isPadDevice()) return true;
    return window.matchMedia("(min-width: 861px)").matches;
  }

  function clearMobileShellState() {
    const body = document.body;
    if (!body) return;

    body.classList.remove(
      "admin-mobile-detail",
      "admin-mobile-more-open",
      "employee-mobile-detail",
      "employee-mobile-more-open",
      "compliance-mobile-drill",
    );
    delete body.dataset.mobileTab;
    delete body.dataset.mobileDetail;

    document.querySelectorAll(".employees-page-header .employees-lifecycle-shortcuts").forEach((el) => {
      el.hidden = false;
      el.removeAttribute("aria-hidden");
    });

    const more = document.getElementById("mobile-more-panel");
    if (more) more.hidden = true;

    document.querySelector("#overview .overview-main")?.removeAttribute("hidden");
    document.querySelectorAll(".admin-mobile-home-only").forEach((el) => {
      el.hidden = false;
    });

    const sidebar = document.getElementById("app-sidebar");
    sidebar?.classList.remove("sidebar--open");
    document.getElementById("sidebar-overlay")?.classList.remove("sidebar-overlay--visible");

    const back = document.getElementById("mobile-back-btn");
    if (back) back.hidden = true;
  }

  function finalizeTabletPortal() {
    if (!shouldUseTabletLayout()) return;
    clearMobileShellState();
    window.dispatchEvent(new Event("hashchange"));
  }

  function isLargeTabletLayout() {
    if (!document.documentElement.classList.contains("native-tablet")) return false;
    if (window.matchMedia("(min-width: 1024px)").matches) return true;
    const w = window.screen?.width || 0;
    const h = window.screen?.height || 0;
    return Math.max(w, h) >= 1194;
  }

  function syncTabletClass() {
    const root = document.documentElement;
    const tablet = shouldUseTabletLayout();
    const wasTablet = root.classList.contains("native-tablet");
    root.classList.toggle("native-tablet", tablet);
    root.classList.toggle("native-tablet-large", tablet && isLargeTabletLayout());
    if (tablet) clearMobileShellState();
    if (tablet !== wasTablet) {
      window.dispatchEvent(new Event("resize"));
      if (tablet) finalizeTabletPortal();
    }
    return tablet;
  }

  syncTabletClass();
  document.addEventListener("DOMContentLoaded", () => {
    syncTabletClass();
    finalizeTabletPortal();
  });
  window.addEventListener("resize", syncTabletClass);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(() => {
      syncTabletClass();
      finalizeTabletPortal();
    }, 150);
  });

  function isMobileViewport() {
    if (document.documentElement.classList.contains("native-tablet")) return false;
    return window.matchMedia("(max-width: 860px)").matches;
  }

  window.isShiftSwiftMobileViewport = isMobileViewport;

  window.ShiftSwiftNativeLayout = {
    isTablet: () => document.documentElement.classList.contains("native-tablet"),
    isLargeTablet: () => document.documentElement.classList.contains("native-tablet-large"),
    isMobileViewport,
    sync: syncTabletClass,
    finalize: finalizeTabletPortal,
  };
})();
