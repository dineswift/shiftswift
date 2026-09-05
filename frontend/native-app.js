(function initNativeApp() {
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      document.documentElement.classList.add("native-app", "capacitor-native");
      if (document.body) document.body.classList.add("native-app");
    }
  } catch {
    /* ignore */
  }

  const UNIFIED_APP_ID = "co.uk.shiftswifthr.app";
  const EMPLOYEE_APP_ID = "co.uk.shiftswifthr.employee";
  const HR_ADMIN_APP_ID = "co.uk.shiftswifthr.hradmin";
const BUNDLED_ASSET_VERSION = "27";
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
    try {
      if (
        !isCapacitorNative() &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(min-width: 960px)").matches
      ) {
        return;
      }
    } catch {
      /* ignore */
    }
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

  function isPortalShellPage() {
    const cls = document.body?.classList;
    return Boolean(
      cls?.contains("admin-portal") || cls?.contains("employee-portal") || cls?.contains("master-app"),
    );
  }

  function dismissStartupLoader() {
    const loader = document.getElementById("native-startup-loader");
    if (loader) loader.remove();
    document.documentElement.classList.remove("native-startup-active");
    document.body?.classList.remove("native-startup-active");
    forceHideSplash();
    window.dispatchEvent(new CustomEvent("shiftswift:startup-loader-done"));
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

    if (isPortalShellPage()) {
      dismissStartupLoader();
      window.addEventListener("shiftswift:portal-ready", () => hide(), { once: true });
      window.setTimeout(forceHideSplash, 6000);
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

  function sanitizeNativeApiBase() {
    if (!isCapacitorNative()) return;
    try {
      const stored = localStorage.getItem("apiBaseUrl");
      if (stored && /localhost|127\.0\.0\.1/.test(stored)) {
        localStorage.removeItem("apiBaseUrl");
      }
    } catch {
      /* ignore */
    }
  }

  function patchNativeSignOut() {
    if (!isCapacitorNative() || !isPortalShellPage()) return;
    const session = window.ShiftSwiftSession;
    if (!session || session.__sshrNativeSignOutPatched) return;
    session.__sshrNativeSignOutPatched = true;

    const SESSION_KEYS = ["token", "refreshToken", "tenantId", "userRole", "masterTenantId"];
    const LOCAL_IDENTITY_KEYS = [
      "adminUsername",
      "adminFirstName",
      "adminDisplayName",
      "adminMobileTab",
      "adminTimeClockEnabled",
      "employeeUsername",
      "employeeFirstName",
      "employeeDisplayName",
      "employeeMobileTab",
      "employeeTimeClockEnabled",
      "sshrNativeApp",
    ];

    async function clearNativeSessionStorage() {
      for (const key of [...SESSION_KEYS, ...LOCAL_IDENTITY_KEYS]) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      }
      for (const key of SESSION_KEYS) {
        try {
          const prefs = await window.Capacitor?.Plugins?.Preferences;
          if (prefs?.remove) await prefs.remove({ key: `sshr:${key}` });
        } catch {
          /* ignore */
        }
      }
      try {
        sessionStorage.removeItem("sshrPostLoginTransition");
        sessionStorage.removeItem("impersonationActive");
        sessionStorage.setItem("sshrSignedOut", "1");
      } catch {
        /* ignore */
      }
    }

    async function nativeSignOut(loginUrl) {
      await clearNativeSessionStorage();
      forceHideSplash();
      const url =
        loginUrl ||
        window.ShiftSwiftAuthGuard?.loginRedirectUrl?.() ||
        session.unifiedNativeLoginUrl?.() ||
        session.resolveLoginUrl?.() ||
        unifiedNativeLoginUrl();
      window.location.replace(url);
    }

    session.clearSession = clearNativeSessionStorage;
    session.signOut = nativeSignOut;
    window.ShiftSwiftAuthGuard = {
      ...(window.ShiftSwiftAuthGuard || {}),
      loginRedirectUrl: window.ShiftSwiftAuthGuard?.loginRedirectUrl || unifiedNativeLoginUrl,
      signOut: () => nativeSignOut(window.ShiftSwiftAuthGuard?.loginRedirectUrl?.()),
    };

    function rebindSignOut(selector, handler) {
      document.querySelectorAll(selector).forEach((el) => {
        const node = el.cloneNode(true);
        el.replaceWith(node);
        node.addEventListener("click", (event) => {
          event.preventDefault();
          void handler();
        });
      });
    }

    rebindSignOut("[data-sign-out]", () =>
      nativeSignOut(window.ShiftSwiftAuthGuard?.loginRedirectUrl?.()),
    );
    rebindSignOut("[data-master-sign-out]", () => nativeSignOut(session.resolveLoginUrl?.()));

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target?.closest?.("[data-sign-out], [data-master-sign-out]");
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        void nativeSignOut(
          target.hasAttribute("data-master-sign-out")
            ? session.resolveLoginUrl?.()
            : window.ShiftSwiftAuthGuard?.loginRedirectUrl?.(),
        );
      },
      true,
    );
  }

  function initNativeChrome() {
    if (!isCapacitorNative()) return;
    const onLogin = document.body?.classList?.contains("portal-login-page");
    const onEmployeePortal = document.body?.classList?.contains("employee-portal");
    void unregisterNativeServiceWorkers();
    applyNativeClasses();
    if (!onLogin) {
      injectBundledStylesheet("native-app-chrome.css");
    }
    bindNavigationSplash();
    scheduleSplashHide();
    if (onEmployeePortal) {
      forceHideSplash();
    }
    if (!onLogin) {
      sanitizeNativeApiBase();
      window.ShiftSwiftNativeApiFetch?.boot?.();
      patchNativeSignOut();
      dismissStartupLoader();
    } else {
      window.ShiftSwiftNativeApiFetch?.boot?.();
      forceHideSplash();
    }
    if (!onLogin) {
      window.addEventListener("load", () => window.setTimeout(patchNativeSignOut, 0), { once: true });
      window.addEventListener("shiftswift:portal-ready", patchNativeSignOut, { once: true });
    }

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

    window.ShiftSwiftAction?.bootNativePortal?.();
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
    dismissStartupLoader,
    patchNativeSignOut,
    sanitizeNativeApiBase,
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
    script.src = `${scheme}://localhost/native-app.js?v=27`;
    script.setAttribute("data-sshr-native-bootstrap", "1");
    script.async = true;
    document.head.appendChild(script);
  } catch {
    /* ignore */
  }
})();
