/** Native phone vs tablet layout — iPhone, iPad, Android phones & tablets. */
(function () {
  "use strict";

  function isNativeShell() {
    return Boolean(
      window.Capacitor?.isNativePlatform?.() ||
        document.documentElement.classList.contains("native-app") ||
        document.documentElement.classList.contains("capacitor-native"),
    );
  }

  function screenSides() {
    const w = Number(window.screen?.width) || 0;
    const h = Number(window.screen?.height) || 0;
    return { minSide: Math.min(w, h), maxSide: Math.max(w, h) };
  }

  function isPadDevice() {
    const ua = navigator.userAgent || "";

    // iPad (including iPadOS 13+ desktop UA)
    if (/iPad/i.test(ua)) return true;
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;

    // Android tablets: typically "Android" without "Mobile" in the UA
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return true;

    const { minSide, maxSide } = screenSides();
    // iPad-class CSS pixels
    if (minSide >= 744 && maxSide >= 1024) return true;
    // 7–8" Android tablets (e.g. Galaxy Tab A7 Lite ~600×1000 CSS px)
    if (/Android/i.test(ua) && minSide >= 600 && maxSide >= 900) return true;

    return false;
  }

  function shouldUseTabletLayout() {
    if (!isNativeShell()) return false;
    if (!isPadDevice()) return false;
    // Narrow split-view / Stage Manager: use phone chrome so content stays usable
    if (window.matchMedia("(max-width: 600px)").matches) return false;
    return true;
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
    document.documentElement.classList.remove("portal-mobile-shell");
    window.dispatchEvent(new Event("hashchange"));
  }

  function isLargeTabletLayout() {
    if (!document.documentElement.classList.contains("native-tablet")) return false;
    if (window.matchMedia("(min-width: 1024px)").matches) return true;
    const { maxSide } = screenSides();
    return maxSide >= 1194;
  }

  function syncPlatformClass() {
    const root = document.documentElement;
    let platform = "";
    try {
      platform = String(window.Capacitor?.getPlatform?.() || "");
    } catch {
      /* ignore */
    }
    if (!platform) {
      const ua = navigator.userAgent || "";
      if (/Android/i.test(ua)) platform = "android";
      else if (/iPhone|iPad|iPod/i.test(ua)) platform = "ios";
    }
    root.classList.toggle("native-android", platform === "android");
    root.classList.toggle("native-ios", platform === "ios");
  }

  function syncTabletClass() {
    const root = document.documentElement;
    syncPlatformClass();
    const tablet = shouldUseTabletLayout();
    const wasTablet = root.classList.contains("native-tablet");
    root.classList.toggle("native-tablet", tablet);
    root.classList.toggle("native-tablet-large", tablet && isLargeTabletLayout());
    root.classList.toggle("native-phone", !tablet && isNativeShell());
    if (tablet) {
      clearMobileShellState();
      root.classList.remove("portal-mobile-shell");
    } else if (isNativeShell() && document.getElementById("mobile-tab-bar")) {
      root.classList.add("portal-mobile-shell");
    }
    if (tablet !== wasTablet) {
      window.dispatchEvent(new CustomEvent("sshr:shell-mode-change", { detail: { tablet } }));
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
    isPhone: () => document.documentElement.classList.contains("native-phone"),
    isPadDevice,
    isMobileViewport,
    sync: syncTabletClass,
    finalize: finalizeTabletPortal,
  };
})();
