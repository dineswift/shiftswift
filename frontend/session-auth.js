/** Shared JWT session helpers — silent refresh without repeating MFA. */
(function () {
  const EMPLOYEE_LOGIN_URL = "./employee-login.html";
  const BUSINESS_LOGIN_URL = "./business-login.html";
  const NATIVE_UNIFIED_LOGIN_URL = "./native-app-login.html?source=native";

  let refreshInFlight = null;

  function isCapacitorUnifiedApp() {
    try {
      return Boolean(
        window.ShiftSwiftNativeApp?.isUnifiedNativeApp?.() ||
          (window.Capacitor?.isNativePlatform?.() &&
            window.Capacitor?.config?.appId === "co.uk.shiftswifthr.app"),
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
      const scheme = window.Capacitor?.config?.ios?.scheme || "App";
      return `${scheme}://localhost/index.html`;
    } catch {
      return NATIVE_UNIFIED_LOGIN_URL;
    }
  }

  function resolveLoginUrl(explicit) {
    if (explicit) return explicit;
    if (isCapacitorUnifiedApp()) return unifiedNativeLoginUrl();
    const nativeLogin = window.ShiftSwiftNativeApp?.resolveNativeLoginUrl?.();
    if (nativeLogin) return nativeLogin;
    const role = localStorage.getItem("userRole");
    if (role === "employee") return EMPLOYEE_LOGIN_URL;
    if (document.body?.classList?.contains("employee-portal")) return EMPLOYEE_LOGIN_URL;
    if (document.body?.dataset?.loginPage === "employee") return EMPLOYEE_LOGIN_URL;
    const path = window.location.pathname || "";
    if (/employee(-login)?\.html$/i.test(path)) return EMPLOYEE_LOGIN_URL;
    return BUSINESS_LOGIN_URL;
  }

  function getApiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    return localStorage.getItem("apiBaseUrl") || "http://localhost:3000";
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
    if (data.access_token) localStorage.setItem("token", data.access_token);
    if (data.refresh_token) localStorage.setItem("refreshToken", data.refresh_token);
    if (data.role) localStorage.setItem("userRole", data.role);
    if (data.tenant_id != null) localStorage.setItem("tenantId", String(data.tenant_id));
  }

  function clearSession() {
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("tenantId");
    localStorage.removeItem("userRole");
  }

  async function refreshAccessToken(apiBase) {
    if (refreshInFlight) return refreshInFlight;
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

  function authHeaders(options = {}) {
    const resolved = typeof options === "boolean" ? { json: options } : options || {};
    const { json = true, tenantId } = resolved;
    const token = getToken();
    const headers = {
      Authorization: token ? `Bearer ${token}` : "",
    };
    const tid = tenantId ?? localStorage.getItem("tenantId");
    if (tid) headers["X-Tenant-Id"] = tid;
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  async function fetchWithAuth(path, options = {}, config = {}) {
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
      throw error;
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
    NATIVE_UNIFIED_LOGIN_URL,
    unifiedNativeLoginUrl,
    resolveLoginUrl,
    getApiBase,
    getToken,
    getRefreshToken,
    hasSession,
    storeSession,
    clearSession,
    refreshAccessToken,
    authHeaders,
    fetchWithAuth,
  };
})();
