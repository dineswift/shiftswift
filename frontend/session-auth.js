/** Shared JWT session helpers — silent refresh without repeating MFA. */
(function () {
  const EMPLOYEE_LOGIN_URL = "./employee-login.html";
  const BUSINESS_LOGIN_URL = "./business-login.html";
  const UNIFIED_LOGIN_URL = "./native-app-login.html";
  const NATIVE_UNIFIED_LOGIN_URL = "./native-app-login.html?source=native";
  const NATIVE_SESSION_KEYS = ["token", "refreshToken", "tenantId", "userRole", "masterTenantId"];

  let refreshInFlight = null;
  let nativeHydrated = false;

  function isCapacitorNative() {
    try {
      return Boolean(window.Capacitor?.isNativePlatform?.());
    } catch {
      return false;
    }
  }

  function isCapacitorUnifiedApp() {
    try {
      return Boolean(
        window.ShiftSwiftNativeApp?.isUnifiedNativeApp?.() ||
          (isCapacitorNative() && window.Capacitor?.config?.appId === "co.uk.shiftswifthr.app"),
      );
    } catch {
      return false;
    }
  }

  function unifiedNativeLoginUrl() {
    if (window.ShiftSwiftNativeApp?.unifiedNativeLoginUrl) {
      return window.ShiftSwiftNativeApp.unifiedNativeLoginUrl();
    }
    try {
      if (
        window.Capacitor?.isNativePlatform?.() &&
        window.Capacitor?.config?.appId === "co.uk.shiftswifthr.app"
      ) {
        const scheme = window.Capacitor.config?.ios?.scheme || "App";
        return `${scheme}://localhost/index.html?build=14&v=14`;
      }
    } catch {
      /* ignore */
    }
    return NATIVE_UNIFIED_LOGIN_URL;
  }

  function isNativeSource() {
    try {
      return new URLSearchParams(window.location.search).get("source") === "native";
    } catch {
      return false;
    }
  }

  function isBundledNativeShell() {
    try {
      const href = window.location.href;
      return /\/\/localhost\//i.test(href) || href.startsWith("capacitor://");
    } catch {
      return false;
    }
  }

  function withNativeSource(url) {
    if (!isCapacitorNative() && !isNativeSource()) return url;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.searchParams.get("source") !== "native") {
        parsed.searchParams.set("source", "native");
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  function portalUrl(path) {
    const clean = String(path || "admin.html").replace(/^\.\//, "");
    if (isCapacitorNative() || isNativeSource()) {
      return withNativeSource(`https://app.shiftswifthr.co.uk/${clean}`);
    }
    return `./${clean}`;
  }

  function getCapacitorAppId() {
    try {
      return window.Capacitor?.config?.appId || "";
    } catch {
      return "";
    }
  }

  function resolveLoginUrl(explicit) {
    if (explicit) return explicit;
    if (getCapacitorAppId() === "co.uk.shiftswifthr.app") return unifiedNativeLoginUrl();
    if (isCapacitorUnifiedApp()) return unifiedNativeLoginUrl();
    const nativeLogin = window.ShiftSwiftNativeApp?.resolveNativeLoginUrl?.();
    if (nativeLogin) return nativeLogin;
    const role = localStorage.getItem("userRole");
    if (role === "employee") return EMPLOYEE_LOGIN_URL;
    if (document.body?.classList?.contains("employee-portal")) return EMPLOYEE_LOGIN_URL;
    if (document.body?.dataset?.loginPage === "employee") return EMPLOYEE_LOGIN_URL;
    const path = window.location.pathname || "";
    if (/employee(-login)?\.html$/i.test(path)) return EMPLOYEE_LOGIN_URL;
    return UNIFIED_LOGIN_URL;
  }

  function getApiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    if (isCapacitorNative()) {
      return window.ShiftSwiftBrand?.urls?.api || "https://api.shiftswifthr.co.uk";
    }
    return localStorage.getItem("apiBaseUrl") || "http://localhost:3000";
  }

  async function preferencesPlugin() {
    return window.Capacitor?.Plugins?.Preferences || null;
  }

  async function persistNativeKey(key, value) {
    const prefKey = `sshr:${key}`;
    try {
      if (value == null || value === "") localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {
      /* ignore */
    }
    if (!isCapacitorNative()) return;
    try {
      const prefs = await preferencesPlugin();
      if (!prefs) return;
      if (value == null || value === "") {
        if (prefs.remove) await prefs.remove({ key: prefKey });
      } else if (prefs.set) {
        await prefs.set({ key: prefKey, value: String(value) });
      }
    } catch {
      /* ignore */
    }
  }

  async function hydrateNativeSession(options = {}) {
    const force = Boolean(options.force);
    if (!isCapacitorNative()) return;
    if (nativeHydrated && !force) return;
    try {
      const prefs = await preferencesPlugin();
      if (!prefs?.get) return;
      for (const key of NATIVE_SESSION_KEYS) {
        const { value } = await prefs.get({ key: `sshr:${key}` });
        if (value) localStorage.setItem(key, value);
      }
      nativeHydrated = true;
    } catch {
      /* ignore */
    }
  }

  function getToken() {
    return localStorage.getItem("token") || "";
  }

  function getRefreshToken() {
    return localStorage.getItem("refreshToken") || "";
  }

  function hasSession() {
    return Boolean(getToken() || getRefreshToken());
  }

  function storeSession(data) {
    if (data.access_token) {
      localStorage.setItem("token", data.access_token);
      void persistNativeKey("token", data.access_token);
    }
    if (data.refresh_token) {
      localStorage.setItem("refreshToken", data.refresh_token);
      void persistNativeKey("refreshToken", data.refresh_token);
    }
    if (data.role) {
      localStorage.setItem("userRole", data.role);
      void persistNativeKey("userRole", data.role);
    }
    if (data.tenant_id != null) {
      const tid = String(data.tenant_id);
      localStorage.setItem("tenantId", tid);
      void persistNativeKey("tenantId", tid);
      localStorage.setItem("masterTenantId", tid);
      void persistNativeKey("masterTenantId", tid);
    }
  }

  async function persistNativeSession() {
    if (!isCapacitorNative()) return;
    await Promise.all(
      NATIVE_SESSION_KEYS.map((key) => persistNativeKey(key, localStorage.getItem(key) || "")),
    );
  }

  function clearSession() {
    for (const key of NATIVE_SESSION_KEYS) {
      localStorage.removeItem(key);
      void persistNativeKey(key, "");
    }
  }

  async function refreshAccessToken(apiBase) {
    if (refreshInFlight) return refreshInFlight;
    await hydrateNativeSession();
    const refresh = getRefreshToken();
    if (!refresh) return false;

    const base = apiBase || getApiBase();
    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${base}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return false;
        storeSession(data);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  }

  function isMasterAdminSession() {
    const role = localStorage.getItem("userRole");
    const tenantId = localStorage.getItem("tenantId");
    const masterId = localStorage.getItem("masterTenantId") || "999";
    return role === "admin" && String(tenantId) === String(masterId);
  }

  async function redirectIfLoggedIn() {
    await hydrateNativeSession();
    if (!hasSession()) return false;
    const refreshed = await refreshAccessToken();
    if (!refreshed && !getToken()) {
      clearSession();
      return false;
    }
    await persistNativeSession();
    try {
      sessionStorage.setItem("sshrPostLoginTransition", "1");
    } catch {
      /* ignore */
    }
    window.ShiftSwiftNativeApp?.showSplash?.();
    if (isMasterAdminSession()) {
      window.location.replace(portalUrl("master.html"));
      return true;
    }
    const role = localStorage.getItem("userRole");
    if (role === "employee") {
      window.location.replace(portalUrl("employee.html"));
      return true;
    }
    if (role && role !== "employee") {
      window.location.replace(portalUrl("admin.html"));
      return true;
    }
    return false;
  }

  function authHeaders(options = {}) {
    const resolved = typeof options === "boolean" ? { json: options } : options || {};
    const { json = true, tenantId } = resolved;
    const token = getToken();
    const headers = {
      Authorization: token ? `Bearer ${token}` : "",
    };
    const tid = tenantId || localStorage.getItem("tenantId");
    if (tid) headers["X-Tenant-Id"] = tid;
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  async function fetchWithAuth(path, options = {}, config = {}) {
    await hydrateNativeSession();
    if (isCapacitorNative() && !hasSession()) {
      await hydrateNativeSession({ force: true });
    }
    const {
      apiBase = getApiBase(),
      loginUrl = resolveLoginUrl(config.loginUrl),
      tenantId,
      forceLogoutOn401 = true,
    } = config;

    const useJson = options.body != null && !(options.body instanceof FormData);
    const buildHeaders = () => ({
      ...authHeaders({ json: useJson, tenantId }),
      ...(options.headers || {}),
    });

    const request = () =>
      fetch(`${apiBase}${path}`, {
        ...options,
        headers: buildHeaders(),
      });

    let response;
    try {
      response = await request();
    } catch (error) {
      if (isCapacitorNative() && (error?.message === "Load failed" || error?.message === "Failed to fetch")) {
        nativeHydrated = false;
        await hydrateNativeSession({ force: true });
        response = await request();
      } else {
        throw error;
      }
    }

    if (response.status === 401) {
      const refreshed = await refreshAccessToken(apiBase);
      if (refreshed) {
        response = await request();
      }
      if (response.status === 401 && forceLogoutOn401) {
        clearSession();
        window.location.href = loginUrl;
        throw new Error("Session expired. Please sign in again.");
      }
    }

    return response;
  }

  window.ShiftSwiftSession = {
    EMPLOYEE_LOGIN_URL,
    BUSINESS_LOGIN_URL,
    UNIFIED_LOGIN_URL,
    NATIVE_UNIFIED_LOGIN_URL,
    unifiedNativeLoginUrl,
    resolveLoginUrl,
    portalUrl,
    withNativeSource,
    isCapacitorNative,
    isCapacitorUnifiedApp,
    isBundledNativeShell,
    getApiBase,
    getToken,
    getRefreshToken,
    hasSession,
    storeSession,
    persistNativeSession,
    clearSession,
    hydrateNativeSession,
    redirectIfLoggedIn,
    refreshAccessToken,
    authHeaders,
    fetchWithAuth,
  };
})();
