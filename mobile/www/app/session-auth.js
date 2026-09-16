/** Shared JWT session helpers — silent refresh without repeating MFA. */
(function () {
  const EMPLOYEE_LOGIN_URL = "./employee-login.html";
  const BUSINESS_LOGIN_URL = "./business-login.html";
  const UNIFIED_LOGIN_URL = "./sign-in.html";
  const NATIVE_UNIFIED_LOGIN_URL = "./sign-in.html?source=native";
  const LEGACY_UNIFIED_LOGIN_URL = "./native-app-login.html";
  const NATIVE_SESSION_KEYS = ["token", "refreshToken", "tenantId", "userRole", "masterTenantId"];
  const IDENTITY_KEYS = [
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
  ];

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
      const scheme =
        window.Capacitor?.config?.server?.iosScheme ||
        window.Capacitor?.config?.ios?.scheme ||
        (window.Capacitor?.isNativePlatform?.() ? "App" : "capacitor");
      if (window.Capacitor?.isNativePlatform?.()) {
        return `${scheme}://localhost/index.html?build=27&v=39`;
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

  function bundledPortalUrl(path) {
    const clean = String(path || "").replace(/^\.\//, "");
    if (window.ShiftSwiftNativeBundledUrl?.assetUrl) {
      const url = window.ShiftSwiftNativeBundledUrl.assetUrl(clean, "bundled-portal");
      try {
        const parsed = new URL(url);
        if (parsed.searchParams.get("source") !== "native") {
          parsed.searchParams.set("source", "native");
        }
        return parsed.toString();
      } catch {
        return url;
      }
    }
    try {
      const scheme =
        window.Capacitor?.config?.server?.iosScheme ||
        window.Capacitor?.config?.ios?.scheme ||
        "App";
      const parsed = new URL(`${scheme}://localhost/${clean}`);
      parsed.searchParams.set("source", "native");
      return parsed.toString();
    } catch {
      return `./${clean}?source=native`;
    }
  }

  const BUNDLED_UNIFIED_PORTALS = new Set(["employee.html", "admin.html"]);

  function isUnifiedIphoneApp() {
    try {
      if (getCapacitorAppId() === "co.uk.shiftswifthr.app") return true;
      if (localStorage.getItem("sshrUnifiedNativeApp") === "1") return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function shouldBundleUnifiedPortal(path) {
    const clean = String(path || "").replace(/^\.\//, "");
    if (!BUNDLED_UNIFIED_PORTALS.has(clean)) return false;
    if (isCapacitorUnifiedApp()) return true;
    if (getCapacitorAppId() === "co.uk.shiftswifthr.app") return true;
    try {
      if (localStorage.getItem("sshrUnifiedNativeApp") === "1") return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function bundledRelativePortalUrl(path) {
    const clean = String(path || "").replace(/^\.\//, "");
    if (isNativeSource()) return `./${clean}`;
    return `./${clean}?source=native`;
  }

  function portalUrl(path) {
    const clean = String(path || "admin.html").replace(/^\.\//, "");
    if (shouldBundleUnifiedPortal(clean)) {
      if (isBundledNativeShell()) return bundledRelativePortalUrl(clean);
      return bundledPortalUrl(clean);
    }
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

  function isUnifiedNativeLoginContext() {
    try {
      if (window.ShiftSwiftNativeApp?.isUnifiedNativeApp?.()) return true;
      if (getCapacitorAppId() === "co.uk.shiftswifthr.app") return true;
      if (isCapacitorUnifiedApp()) return true;
      if (localStorage.getItem("sshrUnifiedNativeApp") === "1") return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function resolveLoginUrl(explicit) {
    if (explicit) return explicit;
    if (isUnifiedNativeLoginContext()) {
      if (isCapacitorNative()) {
        const role = localStorage.getItem("userRole");
        if (role === "employee") {
          return (
            window.ShiftSwiftNativeApp?.capacitorAssetUrl?.("employee-login.html?source=native") ||
            bundledPortalUrl("employee-login.html")
          );
        }
        return (
          window.ShiftSwiftNativeApp?.capacitorAssetUrl?.("business-login.html?source=native") ||
          bundledPortalUrl("business-login.html")
        );
      }
      return UNIFIED_LOGIN_URL;
    }
    const nativeLogin = window.ShiftSwiftNativeApp?.resolveNativeLoginUrl?.();
    if (nativeLogin) return nativeLogin;
    if (isCapacitorNative()) {
      const role = localStorage.getItem("userRole");
      if (role === "employee") return EMPLOYEE_LOGIN_URL;
      return BUSINESS_LOGIN_URL;
    }
    const path = window.location.pathname || "";
    if (/employee(-login)?\.html$/i.test(path) && /[?&]legacy=1/.test(window.location.search || "")) {
      return EMPLOYEE_LOGIN_URL;
    }
    if (/business-login\.html$/i.test(path) && /[?&]legacy=1/.test(window.location.search || "")) {
      return BUSINESS_LOGIN_URL;
    }
    return UNIFIED_LOGIN_URL;
  }

  function getApiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    if (isCapacitorNative()) {
      return window.ShiftSwiftBrand?.urls?.api || "https://api.shiftswifthr.co.uk";
    }
    const stored = localStorage.getItem("apiBaseUrl");
    if (stored && /localhost|127\.0\.0\.1/.test(stored)) {
      try {
        localStorage.removeItem("apiBaseUrl");
      } catch {
        /* ignore */
      }
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

  function readTokenTenantId() {
    const token = getToken();
    if (!token) return null;
    try {
      const part = token.split(".")[1];
      if (!part) return null;
      const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
      if (payload?.tenant_id == null || payload?.tenant_id === "") return null;
      return String(payload.tenant_id);
    } catch {
      return null;
    }
  }

  async function hydrateNativeSession(options = {}) {
    const force = Boolean(options.force);
    const overwrite = Boolean(options.overwrite);
    if (!isCapacitorNative()) return;
    if (nativeHydrated && !force && !overwrite) return;
    try {
      const prefs = await preferencesPlugin();
      if (!prefs?.get) return;
      for (const key of NATIVE_SESSION_KEYS) {
        const { value } = await prefs.get({ key: `sshr:${key}` });
        if (!value) continue;
        const current = localStorage.getItem(key);
        if (!current || overwrite) {
          localStorage.setItem(key, value);
        }
      }
      for (const key of ["employeeUsername", "employeeDisplayName", "employeeFirstName"]) {
        const { value } = await prefs.get({ key: `sshr:${key}` });
        if (!value) continue;
        const current = localStorage.getItem(key);
        if (!current || overwrite) {
          localStorage.setItem(key, value);
        }
      }
      const tokenTenant = readTokenTenantId();
      if (tokenTenant) {
        localStorage.setItem("tenantId", tokenTenant);
        try {
          sessionStorage.setItem("sshrVerifiedTenantId", tokenTenant);
        } catch {
          /* ignore */
        }
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
    try {
      sessionStorage.removeItem("sshrSignedOut");
    } catch {
      /* ignore */
    }
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
      try {
        sessionStorage.setItem("sshrVerifiedTenantId", tid);
        sessionStorage.setItem("sshrVerifiedTenantAt", String(Date.now()));
      } catch {
        /* ignore */
      }
    }
    const username = data.username || data.email || "";
    if (username) {
      localStorage.setItem("employeeUsername", String(username));
      void persistNativeKey("employeeUsername", String(username));
    }
  }

  async function persistNativeSession() {
    if (!isCapacitorNative()) return;
    await Promise.all(
      NATIVE_SESSION_KEYS.map((key) => persistNativeKey(key, localStorage.getItem(key) || "")),
    );
  }

  function bridgeNativeSessionForNextPage() {
    if (!isCapacitorNative()) return;
    try {
      const payload = { ts: Date.now() };
      for (const key of NATIVE_SESSION_KEYS) {
        const value = localStorage.getItem(key);
        if (value) payload[key] = value;
      }
      sessionStorage.setItem("sshrNativeSessionBridge", JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  function restoreNativeSessionBridge() {
    if (!isCapacitorNative()) return false;
    try {
      const raw = sessionStorage.getItem("sshrNativeSessionBridge");
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data?.ts || Date.now() - data.ts > 120000) {
        sessionStorage.removeItem("sshrNativeSessionBridge");
        return false;
      }
      let restored = false;
      for (const key of NATIVE_SESSION_KEYS) {
        if (data[key]) {
          localStorage.setItem(key, String(data[key]));
          restored = true;
        }
      }
      sessionStorage.removeItem("sshrNativeSessionBridge");
      return restored;
    } catch {
      return false;
    }
  }

  function consumeNativeSessionHandoff() {
    try {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get("sshr_handoff");
      if (!encoded) return false;
      const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
      const data = JSON.parse(json);
      if (!data?.ts || Date.now() - data.ts > 120000) return false;
      for (const key of NATIVE_SESSION_KEYS) {
        if (data[key]) localStorage.setItem(key, String(data[key]));
      }
      params.delete("sshr_handoff");
      const query = params.toString();
      const clean = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
      window.history.replaceState(null, "", clean);
      window.__SSHR_HANDOFF_CONSUMED = true;
      void persistNativeSession();
      return true;
    } catch {
      return false;
    }
  }

  function appendSessionHandoffToUrl(url) {
    if (!isCapacitorNative()) return url;
    const payload = { ts: Date.now() };
    for (const key of NATIVE_SESSION_KEYS) {
      const value = localStorage.getItem(key);
      if (value) payload[key] = value;
    }
    const encoded = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    try {
      const parsed = new URL(String(url), window.location.href);
      parsed.searchParams.set("sshr_handoff", encoded);
      return parsed.toString();
    } catch {
      const join = String(url).includes("?") ? "&" : "?";
      return `${url}${join}sshr_handoff=${encodeURIComponent(encoded)}`;
    }
  }

  function buildNativePortalRedirectUrl(path) {
    const clean = String(path || "employee.html").replace(/^\.\//, "");
    if (shouldBundleUnifiedPortal(clean)) {
      const base = isBundledNativeShell() ? bundledRelativePortalUrl(clean) : bundledPortalUrl(clean);
      return appendSessionHandoffToUrl(base);
    }
    return appendSessionHandoffToUrl(portalUrl(clean));
  }

  function buildNativeEmployeePortalUrl() {
    return buildNativePortalRedirectUrl("employee.html");
  }

  function isMasterTenantId(tenantId) {
    if (tenantId == null) return false;
    const masterId = localStorage.getItem("masterTenantId") || "999";
    return String(tenantId) === String(masterId);
  }

  function nativePortalRedirectAfterLogin(data, fallbackRedirect) {
    let path = "admin.html";
    if (data?.role === "employee") {
      path = "employee.html";
    } else if (data?.role === "admin" && isMasterTenantId(data?.tenant_id)) {
      path = "master.html";
    } else {
      try {
        const parsed = new URL(String(fallbackRedirect || ""), window.location.href);
        const leaf = parsed.pathname.split("/").filter(Boolean).pop();
        if (leaf && /\.html$/i.test(leaf)) path = leaf;
      } catch {
        /* keep admin default */
      }
    }
    return buildNativePortalRedirectUrl(path);
  }

  async function confirmNativeSessionPersisted() {
    if (!isCapacitorNative()) return;
    bridgeNativeSessionForNextPage();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await persistNativeSession();
      try {
        const prefs = await preferencesPlugin();
        if (!prefs?.get) return;
        const token = await prefs.get({ key: "sshr:token" });
        const refresh = await prefs.get({ key: "sshr:refreshToken" });
        if (token?.value || refresh?.value) return;
      } catch {
        /* ignore */
      }
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
  }

  async function waitForNativeSession(options = {}) {
    consumeNativeSessionHandoff();
    restoreNativeSessionBridge();
    const postLogin = sessionStorage.getItem("sshrPostLoginTransition") === "1";
    const maxMs = Number(options.maxMs) || (postLogin ? 10000 : 4000);
    const deadline = Date.now() + maxMs;

    while (Date.now() < deadline) {
      restoreNativeSessionBridge();
      await hydrateNativeSession({ force: true });
      if (hasSession()) {
        if (!getToken() && getRefreshToken()) {
          await refreshAccessToken();
          await hydrateNativeSession({ force: true });
        }
        if (hasSession()) return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return hasSession();
  }

  async function clearSession() {
    nativeHydrated = false;
    const keys = [...NATIVE_SESSION_KEYS, ...IDENTITY_KEYS];
    await Promise.all(
      keys.map(async (key) => {
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        if (NATIVE_SESSION_KEYS.includes(key)) {
          await persistNativeKey(key, "");
        }
      }),
    );
    try {
      sessionStorage.setItem("sshrSignedOut", "1");
      sessionStorage.removeItem("sshrVerifiedTenantId");
      sessionStorage.removeItem("sshrVerifiedTenantAt");
    } catch {
      /* ignore */
    }
  }

  async function signOut(loginUrl) {
    await clearSession();
    try {
      sessionStorage.removeItem("sshrPostLoginTransition");
      sessionStorage.removeItem("impersonationActive");
      sessionStorage.setItem("sshrSignedOut", "1");
    } catch {
      /* ignore */
    }
    window.ShiftSwiftNativeApp?.hideSplash?.();
    window.location.replace(loginUrl || resolveLoginUrl());
  }

  function isApiRequestUrl(url) {
    try {
      const parsed = new URL(String(url), window.location.href);
      return (
        /(^|\.)api\.shiftswifthr\.co\.uk$/i.test(parsed.host) ||
        (parsed.hostname === "localhost" && parsed.port === "3000")
      );
    } catch {
      return /api\.shiftswifthr\.co\.uk/i.test(String(url || ""));
    }
  }

  function canUseProductionWebApiFetch(url) {
    if (!isCapacitorNative() || !isApiRequestUrl(url)) return false;
    try {
      return /(^|\.)app\.shiftswifthr\.co\.uk$/i.test(window.location.hostname);
    } catch {
      return false;
    }
  }

  function isTransientNetworkError(error) {
    const msg = String(error?.message || error || "").toLowerCase();
    return (
      msg.includes("could not connect") ||
      msg.includes("failed to fetch") ||
      msg.includes("load failed") ||
      msg.includes("network") ||
      msg.includes("timed out") ||
      msg.includes("internet connection") ||
      msg.includes("hostname could not be found")
    );
  }

  async function nativeApiRequest(url, init = {}) {
    const target = String(url);
    if (!isCapacitorNative() || !isApiRequestUrl(target)) {
      return fetch(target, init);
    }

    if (canUseProductionWebApiFetch(target)) {
      return fetch(target, init);
    }

    window.ShiftSwiftNativeApiFetch?.boot?.();

    const timeoutMs = isCapacitorNative() && String(init?.method || "GET").toUpperCase() === "GET" ? 90000 : 45000;
    const run = async () => {
      const http = window.ShiftSwiftNativeApiFetch;
      if (http?.nativeAwareFetch) {
        return http.nativeAwareFetch(target, init);
      }
      if (http?.nativeHttpRequest) {
        return http.nativeHttpRequest(target, init);
      }
      if (http?.isCapacitorHttpEnabled?.()) {
        const capFetch = http.getCapacitorFetch?.() || window.fetch.bind(window);
        return capFetch(target, init);
      }
      return fetch(target, init);
    };

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    });
    try {
      return await Promise.race([run(), timeout]);
    } finally {
      window.clearTimeout(timer);
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
        const url = `${base}/auth/refresh`;
        const reqInit = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refresh }),
        };
        let response;
        response = await nativeApiRequest(url, reqInit);
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

  async function canUseStoredSession() {
    if (!hasSession()) return false;
    const refreshed = await refreshAccessToken();
    if (!refreshed && !getToken()) {
      await clearSession();
      return false;
    }
    try {
      const verifyUrl = `${getApiBase()}/auth/verify`;
      const reqInit = { headers: authHeaders({ json: false }) };
      let response;
      response = await nativeApiRequest(verifyUrl, reqInit);
      if (!response.ok) {
        if (isCapacitorNative() && hasSession()) return true;
        await clearSession();
        return false;
      }
      return true;
    } catch {
      return Boolean(getToken() || getRefreshToken());
    }
  }

  async function redirectIfLoggedIn() {
    try {
      if (sessionStorage.getItem("sshrAuthBouncedToLogin") === "1") return false;
      if (sessionStorage.getItem("sshrSignedOut") === "1") {
        sessionStorage.removeItem("sshrSignedOut");
        await clearSession();
        return false;
      }
    } catch {
      /* ignore */
    }
    await waitForNativeSession({ maxMs: 6000 });
    if (!(await canUseStoredSession())) return false;
    await persistNativeSession();
    try {
      sessionStorage.setItem("sshrPostLoginTransition", "1");
    } catch {
      /* ignore */
    }
    window.ShiftSwiftNativeApp?.hideSplash?.();
    if (isMasterAdminSession()) {
      window.location.replace(
        isCapacitorNative() ? buildNativePortalRedirectUrl("master.html") : portalUrl("master.html"),
      );
      return true;
    }
    const role = localStorage.getItem("userRole");
    if (role === "employee") {
      window.location.replace(
        isCapacitorNative() ? buildNativePortalRedirectUrl("employee.html") : portalUrl("employee.html"),
      );
      return true;
    }
    if (role && role !== "employee") {
      window.location.replace(
        isCapacitorNative() ? buildNativePortalRedirectUrl("admin.html") : portalUrl("admin.html"),
      );
      return true;
    }
    return false;
  }

  function authHeaders(options = {}) {
    const resolved = typeof options === "boolean" ? { json: options } : options || {};
    const { json = true, tenantId } = resolved;
    const token = getToken();
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const tid = tenantId || readTokenTenantId() || localStorage.getItem("tenantId");
    if (tid) headers["X-Tenant-Id"] = String(tid);
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

    const request = () => {
      const url = `${apiBase}${path}`;
      const reqInit = {
        ...options,
        headers: buildHeaders(),
      };
      return nativeApiRequest(url, reqInit);
    };

    const requestWithRetry = async (attempts = 3) => {
      let lastError = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await request();
        } catch (error) {
          lastError = error;
          if (!isCapacitorNative() || !isTransientNetworkError(error) || attempt >= attempts - 1) {
            throw error;
          }
          window.ShiftSwiftNativeApiFetch?.boot?.();
          await hydrateNativeSession({ force: true });
          await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
      throw lastError || new Error("Failed to fetch");
    };

    let response;
    try {
      response = await requestWithRetry(isCapacitorNative() ? 3 : 1);
    } catch (error) {
      if (isCapacitorNative() && isTransientNetworkError(error)) {
        nativeHydrated = false;
        await hydrateNativeSession({ force: true });
        if (window.ShiftSwiftNativeApiFetch?.nativeAwareFetch) {
          const url = `${apiBase}${path}`;
          const reqInit = { ...options, headers: buildHeaders() };
          try {
            response = await window.ShiftSwiftNativeApiFetch.nativeAwareFetch(url, reqInit);
          } catch {
            response = await request();
          }
        } else {
          response = await request();
        }
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
        await clearSession();
        window.location.replace(loginUrl);
        throw new Error("Session expired. Please sign in again.");
      }
    }

    return response;
  }

  try {
    consumeNativeSessionHandoff();
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        consumeNativeSessionHandoff();
        void hydrateNativeSession({ force: true });
        window.ShiftSwiftNativeApiFetch?.boot?.();
      },
      { once: true },
    );
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
    isUnifiedIphoneApp,
    canUseProductionWebApiFetch,
    getApiBase,
    getToken,
    getRefreshToken,
    readTokenTenantId,
    hasSession,
    storeSession,
    persistNativeSession,
    clearSession,
    signOut,
    hydrateNativeSession,
    waitForNativeSession,
    bridgeNativeSessionForNextPage,
    restoreNativeSessionBridge,
    consumeNativeSessionHandoff,
    buildNativeEmployeePortalUrl,
    buildNativePortalRedirectUrl,
    nativePortalRedirectAfterLogin,
    confirmNativeSessionPersisted,
    redirectIfLoggedIn,
    refreshAccessToken,
    authHeaders,
    fetchWithAuth,
  };
})();
