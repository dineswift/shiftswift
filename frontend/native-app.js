/** Native iOS/Android shell detection (Capacitor) — same UX as installed PWA. */
(function initNativeApp() {
  const UNIFIED_APP_ID = "co.uk.shiftswifthr.app";
  const EMPLOYEE_APP_ID = "co.uk.shiftswifthr.employee";
  const HR_ADMIN_APP_ID = "co.uk.shiftswifthr.hradmin";
  const BUNDLED_ASSET_VERSION = "4";

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
    return `${scheme}://localhost/${filename}?v=${BUNDLED_ASSET_VERSION}`;
  }

  function unifiedNativeLoginUrl() {
    if (isCapacitorNative()) {
      return capacitorAssetUrl("index.html");
    }
    return "./native-app-login.html?source=native";
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
    const onDedicatedLogin =
      path.includes("employee-login") ||
      path.includes("business-login") ||
      (path.endsWith("/login.html") && !path.includes("native-app-login"));
    if (!onDedicatedLogin) return;

    if (isUnifiedNativeApp()) {
      window.location.replace(unifiedNativeLoginUrl());
      return;
    }

    const appId = getNativeAppId();
    if (appId === EMPLOYEE_APP_ID && !path.includes("employee-login")) {
      window.location.replace("./employee-login.html?source=native");
    } else if (appId === HR_ADMIN_APP_ID && !path.includes("business-login")) {
      window.location.replace("./business-login.html?source=native");
    }
  }

  function initNativeChrome() {
    if (!isCapacitorNative()) return;
    injectBundledStylesheet("native-app-chrome.css");

    const statusBar = window.Capacitor?.Plugins?.StatusBar;
    const splash = window.Capacitor?.Plugins?.SplashScreen;
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
    if (splash?.hide) {
      splash.hide().catch(() => null);
    }

    if (appPlugin?.addListener) {
      appPlugin.addListener("appStateChange", ({ isActive }) => {
        if (isActive && splash?.hide) splash.hide().catch(() => null);
      }).catch(() => null);
    }
  }

  applyNativeClasses();
  redirectLegacyLoginPages();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNativeChrome, { once: true });
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
    script.src = `${scheme}://localhost/native-app.js?v=4`;
    script.setAttribute("data-sshr-native-bootstrap", "1");
    script.async = true;
    document.head.appendChild(script);
  } catch {
    /* ignore */
  }
})();
