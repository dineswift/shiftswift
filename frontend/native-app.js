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
const BUNDLED_ASSET_VERSION = "36";
const BUNDLED_LOGIN_PAGE = `index.html?build=${BUNDLED_ASSET_VERSION}`;
  const STOREFRONT_URL = "https://www.shiftswifthr.co.uk";
  const BUSINESS_SIGNUP_URL = "https://app.shiftswifthr.co.uk/signup.html";

  /** Open marketing / signup outside the WebView (Safari / Chrome). */
  async function openExternalUrl(url) {
    const target = String(url || "").trim();
    if (!target) return false;
    try {
      const browser = window.Capacitor?.Plugins?.Browser;
      if (browser?.open) {
        await browser.open({ url: target });
        return true;
      }
    } catch {
      /* fall through */
    }
    try {
      const anchor = document.createElement("a");
      anchor.href = target;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } catch {
      /* fall through */
    }
    try {
      window.open(target, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  }

  function bindExternalSignupLinks(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-sshr-external-url]").forEach((el) => {
      if (el.dataset.sshrExternalBound === "1") return;
      el.dataset.sshrExternalBound = "1";
      el.addEventListener("click", (event) => {
        event.preventDefault();
        const href =
          el.getAttribute("data-sshr-external-url") ||
          el.getAttribute("href") ||
          BUSINESS_SIGNUP_URL;
        void openExternalUrl(href);
      });
    });
  }

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
    if (isCapacitorNative() && getNativeAppId() === UNIFIED_APP_ID) return true;
    try {
      return localStorage.getItem("sshrUnifiedNativeApp") === "1";
    } catch {
      return false;
    }
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

  function getCapacitorScheme() {
    try {
      if (window.ShiftSwiftNativeBundledUrl?.scheme) {
        return window.ShiftSwiftNativeBundledUrl.scheme();
      }
      const platform = window.Capacitor?.getPlatform?.();
      if (platform === "android") {
        return String(window.Capacitor?.config?.server?.androidScheme || "https");
      }
      const scheme =
        window.Capacitor?.config?.server?.iosScheme ||
        window.Capacitor?.config?.ios?.scheme;
      if (scheme) return String(scheme);
      const match = String(location.href || "").match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/localhost/);
      if (match) return match[1];
      if (window.Capacitor?.isNativePlatform?.()) return "App";
    } catch {
      /* ignore */
    }
    return "capacitor";
  }

  function capacitorAssetUrl(filename) {
    const scheme = getCapacitorScheme();
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
    return "./sign-in.html?source=native";
  }

  function redirectUnifiedAppToBundledLogin() {
    /* Unified app uses production or bundled business-login — never force bundled index tabs. */
  }

  function resolveNativeLoginUrl() {
    if (isUnifiedNativeApp()) {
      if (isBundledNativeShell()) {
        try {
          if (localStorage.getItem("userRole") === "employee") {
            return capacitorAssetUrl("employee-login.html?source=native");
          }
        } catch {
          /* ignore */
        }
        return capacitorAssetUrl("index.html?source=native");
      }
      return productionBusinessLoginUrl();
    }
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

  function injectBundledScript(filename) {
    if (!isCapacitorNative()) return;
    if (document.querySelector(`script[data-sshr-native="${filename}"]`)) return;
    const script = document.createElement("script");
    script.src = capacitorAssetUrl(filename);
    script.setAttribute("data-sshr-native", filename);
    document.head.appendChild(script);
  }

  function productionBusinessLoginUrl() {
    return "https://app.shiftswifthr.co.uk/business-login.html?source=native";
  }

  function redirectLegacyLoginPages() {
    if (!isCapacitorNative()) return;
    const path = window.location.pathname || "";
    const href = window.location.href || "";

    if (isUnifiedNativeApp()) {
      if (/app\.shiftswifthr\.co\.uk/i.test(href)) {
        if (
          /\/business-login\.html$/i.test(path) ||
          /\/admin\.html$/i.test(path) ||
          /\/employee\.html$/i.test(path) ||
          /\/master\.html$/i.test(path)
        ) {
          return;
        }
      }
      if (/\/\/localhost\//i.test(href)) {
        if (
          /index\.html$/i.test(path) ||
          /business-login\.html$/i.test(path) ||
          /employee-login\.html$/i.test(path) ||
          /admin\.html$/i.test(path) ||
          /employee\.html$/i.test(path)
        ) {
          return;
        }
      }
      if (path.includes("native-app-login") || path.includes("sign-in")) {
        window.location.replace(capacitorAssetUrl("index.html?source=native"));
        return;
      }
      return;
    }

    const onDedicatedLogin =
      path.includes("employee-login") ||
      path.includes("business-login") ||
      (path.endsWith("/login.html") && !path.includes("sign-in") && !path.includes("native-app-login"));
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
    if (isPortalShellPage()) return;
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
    /* Disabled — showSplash() sets isUserInteractionEnabled=false on the native root view. */
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

  let splashHidden = false;

  function forceHideSplash() {
    if (splashHidden) return;
    splashHidden = true;
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
    const onLogin = document.body?.classList?.contains("portal-login-page");
    if (onLogin) {
      window.addEventListener("shiftswift:startup-loader-done", () => forceHideSplash(), { once: true });
      return;
    }

    const hide = () => window.setTimeout(forceHideSplash, 80);

    if (document.getElementById("native-startup-loader")) {
      window.addEventListener(
        "shiftswift:startup-loader-done",
        () => window.setTimeout(forceHideSplash, 40),
        { once: true },
      );
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

  function redirectProductionPortalToBundle() {
    /* Unified iPhone app keeps business admin on app.shiftswifthr.co.uk (same as website login). */
  }

  function initNativeChrome() {
    if (!isCapacitorNative()) return;
    redirectProductionPortalToBundle();
    const onLogin = document.body?.classList?.contains("portal-login-page");
    const onEmployeePortal = document.body?.classList?.contains("employee-portal");
    void unregisterNativeServiceWorkers();
    applyNativeClasses();
    bindExternalSignupLinks();
    injectBundledScript("native-keyboard.js");
    injectBundledScript("native-haptics.js");
    if (!onLogin) {
      injectBundledStylesheet("native-app-chrome.css");
    }
    window.setTimeout(() => {
      window.ShiftSwiftNativeKeyboard?.bind?.({ scope: onLogin ? "login" : "portal" });
    }, 0);
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
        if (!isActive || document.body?.classList?.contains("portal-login-page")) return;
        if (isPortalShellPage()) forceHideSplash();
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
    productionBusinessLoginUrl,
    resolveNativeLoginUrl,
    capacitorAssetUrl,
    showSplash,
    hideSplash,
    dismissStartupLoader,
    patchNativeSignOut,
    sanitizeNativeApiBase,
    openExternalUrl,
    bindExternalSignupLinks,
    STOREFRONT_URL,
    BUSINESS_SIGNUP_URL,
  };
})();

/** Load bundled native shell on production pages inside the Capacitor WebView. */
(function bootstrapNativeShellFromBundle() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    if (window.ShiftSwiftNativeApp?.isCapacitorNative) return;
    if (document.querySelector("script[data-sshr-native-bootstrap]")) return;
    const scheme =
      window.ShiftSwiftNativeBundledUrl?.scheme?.() ||
      (window.Capacitor?.getPlatform?.() === "android"
        ? window.Capacitor?.config?.server?.androidScheme || "https"
        : window.Capacitor.config?.ios?.scheme || "App");
    const script = document.createElement("script");
    script.src = `${scheme}://localhost/native-app.js?v=27`;
    script.setAttribute("data-sshr-native-bootstrap", "1");
    script.async = true;
    document.head.appendChild(script);
  } catch {
    /* ignore */
  }
})();
