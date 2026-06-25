/** Native iOS/Android shell detection (Capacitor) — same UX as installed PWA. */
(function initNativeApp() {
  const UNIFIED_APP_ID = "co.uk.shiftswifthr.app";
  const EMPLOYEE_APP_ID = "co.uk.shiftswifthr.employee";
  const HR_ADMIN_APP_ID = "co.uk.shiftswifthr.hradmin";
const BUNDLED_ASSET_VERSION = "13";
const BUNDLED_LOGIN_PAGE = `index.html?build=${BUNDLED_ASSET_VERSION}`;

  function isCapacitorNative() {
    try {
      return Boolean(
        window.Capacitor?.isNativePlatform?.() ||
          (window.Capacitor?.getPlatform?.() && window.Capacitor.getPlatform() !== "web"),
      );
    } catch {
      return false;
    }
  }

  function getNativeAppId() {
    try {
      return window.Capacitor?.config?.appId || "";
    } catch {
      return "";
    }
  }

  function isUnifiedNativeApp() {
    return isCapacitorNative() && getNativeAppId() === UNIFIED_APP_ID;
  }

  function isNativeSource() {
    try {
      return new URLSearchParams(window.location.search).get("source") === "native";
    } catch {
      return false;
    }
  }

  function isNativeApp() {
    if (isCapacitorNative()) return true;
    if (isNativeSource()) {
      try {
        localStorage.setItem("sshrNativeApp", "1");
      } catch {
        /* ignore */
      }
      return true;
    }
    try {
      return localStorage.getItem("sshrNativeApp") === "1";
    } catch {
      return false;
    }
  }

  function capacitorAssetUrl(filename) {
    const scheme = window.Capacitor?.config?.ios?.scheme || "App";
    const raw = String(filename || "");
    const [path, query = ""] = raw.split("?");
    const params = new URLSearchParams(query);
    if (!params.has("v")) params.set("v", BUNDLED_ASSET_VERSION);
    const qs = params.toString();
    return `${scheme}://localhost/${path}${qs ? `?${qs}` : ""}`;
  }

  function isBundledNativeShell() {
    try {
      const href = window.location.href || "";
      return /\/\/localhost\//i.test(href) || href.startsWith("capacitor://");
    } catch {
      return false;
    }
  }

  function unifiedNativeLoginUrl() {
    if (isCapacitorNative()) {
      return capacitorAssetUrl(BUNDLED_LOGIN_PAGE);
    }
    return "./native-app-login.html?source=native";
  }

  function redirectUnifiedAppToBundledLogin() {
    if (!isUnifiedNativeApp() || isBundledNativeShell()) return;
    try {
      const href = window.location.href || "";
      if (!href.includes("app.shiftswifthr.co.uk")) return;
      const path = window.location.pathname || "";
      if (!/(login|native-app-login|business-login|employee-login)/i.test(path)) return;
      window.location.replace(unifiedNativeLoginUrl());
    } catch {
      /* ignore */
    }
  }

  function resolveNativeLoginUrl() {
    if (isUnifiedNativeApp()) return unifiedNativeLoginUrl();
    const appId = getNativeAppId();
    if (appId === EMPLOYEE_APP_ID) return "./employee-login.html?source=native";
    if (appId === HR_ADMIN_APP_ID) return "./business-login.html?source=native";
    if (isNativeApp()) return unifiedNativeLoginUrl();
    return null;
  }

  function applyNativeClasses() {
    if (!isNativeApp()) return;
    document.documentElement.classList.add("native-app", "pwa-standalone", "ios-device");
    if (document.body) document.body.classList.add("native-app", "pwa-standalone");
    try {
      localStorage.setItem("sshrNativeApp", "1");
    } catch {
      /* ignore */
    }
    if (isUnifiedNativeApp()) {
      document.documentElement.classList.add("native-app--unified");
      if (document.body) document.body.classList.add("native-app--unified");
      try {
        localStorage.setItem("sshrUnifiedNativeApp", "1");
      } catch {
        /* ignore */
      }
    }
  }

  function injectBundledStylesheet(filename) {
    if (!isCapacitorNative()) return;
    const href = capacitorAssetUrl(filename);
    if (document.querySelector(`link[data-sshr-native="${filename}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-sshr-native", filename);
    document.head.appendChild(link);
  }

  function redirectLegacyLoginPages() {
    if (!isCapacitorNative()) return;
    const path = window.location.pathname || "";
    const href = window.location.href || "";

    if (isUnifiedNativeApp()) {
      if (
        path.includes("native-app-login") ||
        path.includes("employee-login") ||
        path.includes("business-login") ||
        (path.endsWith("/login.html") && !path.includes("native-app-login"))
      ) {
        window.location.replace(unifiedNativeLoginUrl());
        return;
      }
      if (href.includes("app.shiftswifthr.co.uk") && !href.includes("source=native")) {
        const onPortal =
          path.endsWith("/admin.html") ||
          path.endsWith("/employee.html") ||
          path.endsWith("/master.html");
        if (onPortal) return;
      }
      return;
    }

    const onDedicatedLogin =
      path.includes("employee-login") ||
      path.includes("business-login") ||
      (path.endsWith("/login.html") && !path.includes("native-app-login"));
    if (!onDedicatedLogin) return;

    const appId = getNativeAppId();
    if (appId === EMPLOYEE_APP_ID && !path.includes("employee-login")) {
      window.location.replace("./employee-login.html?source=native");
    } else if (appId === HR_ADMIN_APP_ID && !path.includes("business-login")) {
      window.location.replace("./business-login.html?source=native");
    }
  }

  function splashPlugin() {
    return window.Capacitor?.Plugins?.SplashScreen;
  }

  function showSplash() {
    const splash = splashPlugin();
    if (splash?.show) {
      splash.show({ autoHide: false, showDuration: 0 }).catch(() => null);
    }
  }

  function hideSplash() {
    const splash = splashPlugin();
    if (splash?.hide) {
      splash.hide().catch(() => null);
    }
  }

  function isInternalNavigation(href) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return false;
    }
    if (href.startsWith("javascript:")) return false;
    try {
      const url = new URL(href, window.location.href);
      return url.origin === window.location.origin;
    } catch {
      return href.startsWith("./") || href.startsWith("/");
    }
  }

  function bindNavigationSplash() {
    if (!isCapacitorNative()) return;

    document.addEventListener(
      "click",
      (event) => {
        const link = event.target.closest?.("a[href]");
        if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
        if (!isInternalNavigation(link.getAttribute("href") || "")) return;
        showSplash();
      },
      true,
    );

    document.addEventListener(
      "submit",
      (event) => {
        const form = event.target;
        if (form?.id === "portal-login-form" || form?.id === "mfa-form") return;
        showSplash();
      },
      true,
    );
  }

  async function unregisterNativeServiceWorkers() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch {
      /* ignore */
    }
  }

  function forceHideSplash() {
    hideSplash();
    try {
      window.Capacitor?.Plugins?.SplashScreen?.hide?.()?.catch?.(() => null);
    } catch {
      /* ignore */
    }
  }

  function scheduleSplashHide() {
    const hide = () => window.setTimeout(forceHideSplash, 80);
    if (document.getElementById("native-startup-loader")) {
      window.addEventListener(
        "shiftswift:startup-loader-done",
        () => window.setTimeout(forceHideSplash, 40),
        { once: true },
      );
      window.setTimeout(forceHideSplash, 4500);
      return;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", hide, { once: true });
    } else {
      hide();
    }
    window.addEventListener("load", hide, { once: true });
    window.setTimeout(forceHideSplash, 4000);

    document.addEventListener(
      "touchstart",
      () => {
        const loader = document.getElementById("native-startup-loader");
        if (loader && !loader.classList.contains("is-done")) return;
        forceHideSplash();
      },
      { once: true, passive: true },
    );
  }

  function initNativeChrome() {
    if (!isCapacitorNative()) return;
    void unregisterNativeServiceWorkers();
    applyNativeClasses();
    injectBundledStylesheet("native-app-chrome.css");
    bindNavigationSplash();
    scheduleSplashHide();

    const statusBar = window.Capacitor?.Plugins?.StatusBar;
    const appPlugin = window.Capacitor?.Plugins?.App;

    if (statusBar?.setStyle) {
      statusBar.setStyle({ style: "LIGHT" }).catch(() => null);
    }
    if (statusBar?.setBackgroundColor) {
      statusBar.setBackgroundColor({ color: "#0f6e56" }).catch(() => null);
    }
    if (statusBar?.setOverlaysWebView) {
      statusBar.setOverlaysWebView({ overlay: true }).catch(() => null);
    }

    if (appPlugin?.addListener) {
      appPlugin.addListener("appStateChange", ({ isActive }) => {
        if (isActive) scheduleSplashHide();
      }).catch(() => null);
    }
  }

  applyNativeClasses();
  redirectUnifiedAppToBundledLogin();
  redirectLegacyLoginPages();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initNativeChrome();
    }, { once: true });
  } else {
    initNativeChrome();
  }

  window.ShiftSwiftNativeApp = {
    isNativeApp,
    isCapacitorNative,
    isUnifiedNativeApp,
    unifiedNativeLoginUrl,
    resolveNativeLoginUrl,
    capacitorAssetUrl,
    showSplash,
    hideSplash,
  };
})();

/** Load bundled native shell on production pages inside the Capacitor WebView. */
(function bootstrapNativeShellFromBundle() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    if (window.ShiftSwiftNativeApp?.isCapacitorNative) return;
    if (document.querySelector("script[data-sshr-native-bootstrap]")) return;
    const scheme = window.Capacitor.config?.ios?.scheme || "App";
    const script = document.createElement("script");
    script.src = `${scheme}://localhost/native-app.js?v=13`;
    script.setAttribute("data-sshr-native-bootstrap", "1");
    script.async = true;
    document.head.appendChild(script);
  } catch {
    /* ignore */
  }
})();
