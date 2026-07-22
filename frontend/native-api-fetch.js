/** Native Capacitor HTTP — reliable API calls from bundled + production portal pages. */
(function initNativeApiFetch() {
  if (!window.__SSHR_BROWSER_FETCH__) {
    try {
      window.__SSHR_BROWSER_FETCH__ = window.fetch.bind(window);
    } catch {
      /* ignore */
    }
  }

  let bootAttempts = 0;
  let apiChain = Promise.resolve();

  function isNative() {
    try {
      return Boolean(window.Capacitor?.isNativePlatform?.());
    } catch {
      return false;
    }
  }

  function isCapacitorHttpEnabled() {
    try {
      return Boolean(window.Capacitor?.config?.plugins?.CapacitorHttp?.enabled);
    } catch {
      return false;
    }
  }

  function isApiUrl(url) {
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

  /** Rewrite mistaken local-dev API hosts to production when running on-device. */
  function rewriteNativeApiUrl(url) {
    if (!isNative()) return String(url || "");
    try {
      const parsed = new URL(String(url), window.location.href);
      if (
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
        (parsed.port === "3000" || parsed.port === "")
      ) {
        return `https://api.shiftswifthr.co.uk${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      /* keep original */
    }
    return String(url || "");
  }

  function headersToObject(headers) {
    const out = {};
    if (!headers) return out;
    if (headers instanceof Headers) {
      headers.forEach(function (value, key) {
        out[key] = value;
      });
      return out;
    }
    if (Array.isArray(headers)) {
      headers.forEach(function (entry) {
        if (entry && entry.length >= 2) out[entry[0]] = entry[1];
      });
      return out;
    }
    return Object.assign({}, headers);
  }

  async function readBody(body, contentType) {
    if (body == null) return { data: undefined, dataType: undefined };
    if (typeof body === "string") {
      if (/json/i.test(contentType || "")) return { data: body, dataType: "json" };
      return { data: body, dataType: "text" };
    }
    if (body instanceof URLSearchParams) return { data: body.toString(), dataType: "text" };
    if (body instanceof FormData) {
      const data = {};
      body.forEach(function (value, key) {
        data[key] = value;
      });
      return { data: data, dataType: "formData" };
    }
    try {
      return { data: JSON.stringify(body), dataType: "json" };
    } catch {
      return { data: String(body), dataType: "text" };
    }
  }

  function getWebFetch() {
    return window.__SSHR_WEB_FETCH__ || window.__SSHR_BROWSER_FETCH__ || window.fetch.bind(window);
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

  function noteTransport(name) {
    try {
      window.__SSHR_LAST_TRANSPORT = name;
    } catch {
      /* ignore */
    }
  }

  function sanitizeHeaders(headers, method) {
    const out = {};
    const m = String(method || "GET").toUpperCase();
    const skipBodyHeaders = m === "GET" || m === "HEAD";
    Object.keys(headers || {}).forEach(function (key) {
      if (skipBodyHeaders && /^(content-type|content-length)$/i.test(key)) return;
      const value = headers[key];
      if (value == null || value === "") return;
      out[key] = String(value);
    });
    return out;
  }

  function createCapacitorProxyUrl(url) {
    const cap = window.Capacitor;
    const serverUrl = cap?.getServerUrl?.();
    const target = String(url || "");
    if (!serverUrl || !/^https?:\/\//i.test(target)) return target;
    const bridgeUrl = new URL(serverUrl);
    bridgeUrl.pathname = "/_capacitor_http_interceptor_";
    bridgeUrl.searchParams.set("u", target);
    return bridgeUrl.toString();
  }

  function withRequestTimeout(promise, timeoutMs, label) {
    const limit = Number(timeoutMs) || 12000;
    let timer;
    const timeout = new Promise(function (_, reject) {
      timer = window.setTimeout(function () {
        reject(new Error(String(label || "Request") + " timed out"));
      }, limit);
    });
    return Promise.race([promise, timeout]).finally(function () {
      window.clearTimeout(timer);
    });
  }

  function runQueuedApi(fn, timeoutMs) {
    const limit = Number(timeoutMs) || 30000;
    const run = apiChain.then(function () {
      return withRequestTimeout(fn(), limit);
    });
    apiChain = run.catch(function () {
      return null;
    });
    return run;
  }

  function capacitorBridgeReady() {
    try {
      const capWeb = window.CapacitorWebFetch;
      const current = window.fetch?.bind?.(window);
      return Boolean(window.Capacitor?.nativePromise && capWeb && current && current !== capWeb);
    } catch {
      return false;
    }
  }

  function captureCapacitorHttpFetch() {
    if (window.__SSHR_CAP_HTTP_FETCH__) return window.__SSHR_CAP_HTTP_FETCH__;
    try {
      const capWeb = window.CapacitorWebFetch;
      const current = window.fetch?.bind?.(window);
      if (current && capWeb && current !== capWeb) {
        window.__SSHR_CAP_HTTP_FETCH__ = current;
      }
    } catch {
      /* ignore */
    }
    return window.__SSHR_CAP_HTTP_FETCH__ || null;
  }

  function looksLikeGatewayHtml(text) {
    const raw = String(text || "").trim();
    return /^</.test(raw) || /<\s*html[\s>]/i.test(raw) || /cloudflare/i.test(raw);
  }

  function humanizeNonJsonBody(text, status) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return status ? `Request failed (HTTP ${status})` : "Request failed";
    if (looksLikeGatewayHtml(raw)) {
      if (Number(status) === 400) {
        return "API request was rejected (bad request). Pull to refresh or sign out and sign in again.";
      }
      if (Number(status) >= 500) {
        return `API is temporarily unavailable (HTTP ${status}). Try again in a moment.`;
      }
      return status
        ? `Could not load data from the API (HTTP ${status}).`
        : "Could not load data from the API.";
    }
    return raw.slice(0, 160);
  }

  /**
   * CapHttp.request can return Cloudflare HTML error pages as a normal Response
   * (so transport fallbacks never run). Treat those as transport failures.
   */
  async function ensureTransportResponse(response) {
    if (!response) throw new Error("Empty native HTTP response");
    if (response.ok) return response;
    // Real API auth/validation errors must pass through to app handlers.
    if ([401, 402, 403, 404, 409, 422, 429].includes(Number(response.status))) {
      return response;
    }
    let text = "";
    try {
      text = await response.clone().text();
    } catch {
      return response;
    }
    if (looksLikeGatewayHtml(text)) {
      throw new Error(humanizeNonJsonBody(text, response.status));
    }
    return response;
  }

  async function buildNativeRequestPayload(url, options, extra) {
    const method = String(options?.method || "GET").toUpperCase();
    const headers = sanitizeHeaders(headersToObject(options?.headers), method);
    const contentType = headers["Content-Type"] || headers["content-type"] || "";
    const bodyInfo = await readBody(options?.body, contentType);

    // Pass the absolute URL through unchanged (including ?query). Cap iOS is patched so
    // URL(string:) accepts it. Do NOT move query into Cap `params` — that path force-casts
    // values in Swift and has been a source of native request failures.
    const requestUrl = String(url);

    const requestPayload = {
      url: requestUrl,
      method,
      headers,
      connectTimeout: Number(extra?.connectTimeout) || 45000,
      readTimeout: Number(extra?.readTimeout) || 120000,
    };
    if (extra?.responseType) requestPayload.responseType = extra.responseType;
    if (method !== "GET" && method !== "HEAD" && bodyInfo.data != null) {
      requestPayload.data = bodyInfo.data;
      requestPayload.dataType = bodyInfo.dataType;
    }
    return requestPayload;
  }

  async function shiftSwiftHttpRequest(url, options, extra) {
    const cap = window.Capacitor;
    try {
      if (cap?.registerPlugin && !window.__SSHR_SHIFT_HTTP_REGISTERED) {
        cap.registerPlugin("ShiftSwiftHttp");
        window.__SSHR_SHIFT_HTTP_REGISTERED = true;
      }
    } catch {
      /* ignore */
    }

    const method = String(options?.method || "GET").toUpperCase();
    const headers = sanitizeHeaders(headersToObject(options?.headers), method);
    const contentType = headers["Content-Type"] || headers["content-type"] || "";
    const bodyInfo = await readBody(options?.body, contentType);
    noteTransport(extra?.transportLabel || "ShiftSwiftHttp");
    const payload = {
      url: rewriteNativeApiUrl(url),
      method: method,
      headers: headers,
      connectTimeout: Number(extra?.connectTimeout) || 15000,
      readTimeout: Number(extra?.readTimeout) || 30000,
    };
    if (method !== "GET" && method !== "HEAD" && bodyInfo.data != null) {
      payload.data = typeof bodyInfo.data === "string" ? bodyInfo.data : JSON.stringify(bodyInfo.data);
    }

    let nativeResponse;
    if (cap?.nativePromise) {
      nativeResponse = await cap.nativePromise("ShiftSwiftHttp", "request", payload);
    } else {
      const plugin = cap?.Plugins?.ShiftSwiftHttp;
      if (!plugin?.request) throw new Error("ShiftSwiftHttp plugin unavailable");
      nativeResponse = await plugin.request(payload);
    }
    return responseFromNative(nativeResponse, url);
  }

  async function capacitorPluginsHttpRequest(url, options, extra) {
    const plugin = window.Capacitor?.Plugins?.CapacitorHttp;
    if (!plugin?.request) throw new Error("CapacitorHttp plugin unavailable");
    const requestPayload = await buildNativeRequestPayload(url, options, extra);
    noteTransport(extra?.transportLabel || "CapacitorHttp.plugin");
    const nativeResponse = await plugin.request(requestPayload);
    return responseFromNative(nativeResponse, url);
  }

  async function nativeBridgeHttpRequest(url, options, extra) {
    const cap = window.Capacitor;
    const requestPayload = await buildNativeRequestPayload(url, options, extra);
    if (cap?.nativePromise) {
      noteTransport(extra?.transportLabel || "CapacitorHttp.request");
      try {
        const nativeResponse = await cap.nativePromise("CapacitorHttp", "request", requestPayload);
        return responseFromNative(nativeResponse, url);
      } catch (error) {
        // Fall through to the plugin JS wrapper when the bridge call is flaky.
        if (!cap?.Plugins?.CapacitorHttp?.request) throw error;
      }
    }
    return capacitorPluginsHttpRequest(url, options, {
      transportLabel: extra?.transportLabel || "CapacitorHttp.plugin",
      connectTimeout: extra?.connectTimeout,
      readTimeout: extra?.readTimeout,
    });
  }

  async function nativeBridgeHttpRequestWithRetries(url, options, attempts, extra) {
    const tries = Number(attempts) || 3;
    let lastError = null;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      try {
        if (attempt > 0) {
          window.ShiftSwiftNativeApiFetch?.bootWhenReady?.();
          await new Promise(function (resolve) {
            window.setTimeout(resolve, 400 * attempt);
          });
        }
        return await nativeBridgeHttpRequest(url, options, {
          transportLabel: attempt ? "CapacitorHttp.request-retry" : "CapacitorHttp.request",
          connectTimeout: extra?.connectTimeout,
          readTimeout: extra?.readTimeout,
        });
      } catch (error) {
        lastError = error;
        if (!isTransientNetworkError(error) || attempt >= tries - 1) throw error;
      }
    }
    throw lastError || new Error("Load failed");
  }

  async function capacitorHttpFetch(input, init) {
    const capFetch = captureCapacitorHttpFetch();
    if (!capFetch) throw new Error("Capacitor HTTP fetch unavailable");
    noteTransport("CapacitorHttp.fetch");
    return capFetch(input, init);
  }

  async function capacitorProxyFetch(url, options) {
    const baseFetch = window.CapacitorWebFetch || window.__SSHR_BROWSER_FETCH__ || window.fetch.bind(window);
    const proxyUrl = createCapacitorProxyUrl(url);
    noteTransport("CapacitorHttp.proxy");
    const method = String(options?.method || "GET").toUpperCase();
    const headers = sanitizeHeaders(headersToObject(options?.headers), method);
    const init = { method, headers };
    if (method !== "GET" && method !== "HEAD" && options?.body != null) {
      init.body = options.body;
    }
    return baseFetch(proxyUrl, init);
  }

  function responseFromNative(nativeResponse, url) {
    let payload = nativeResponse?.data;
    if (nativeResponse?.status === 204) {
      payload = null;
    } else if (payload != null && typeof payload === "object") {
      payload = JSON.stringify(payload);
    } else if (payload != null && typeof payload !== "string") {
      payload = String(payload);
    }
    const status = Number(nativeResponse?.status);
    const safeStatus = Number.isFinite(status) && status >= 200 && status <= 599 ? status : 502;
    const headers = {};
    const rawHeaders = nativeResponse?.headers;
    if (rawHeaders && typeof rawHeaders === "object") {
      Object.keys(rawHeaders).forEach(function (key) {
        const value = rawHeaders[key];
        if (value == null) return;
        headers[key] = Array.isArray(value) ? String(value[0] ?? "") : String(value);
      });
    }
    if (!headers["content-type"] && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const response = new Response(payload == null ? null : payload, {
      status: safeStatus,
      statusText: String(nativeResponse?.statusText || ""),
      headers,
    });
    try {
      Object.defineProperty(response, "url", { value: nativeResponse?.url || String(url) });
    } catch {
      /* ignore */
    }
    return response;
  }

  function isPriorityApiUrl(url) {
    try {
      const path = new URL(String(url), "https://api.shiftswifthr.co.uk").pathname;
      return /\/admin\/rota\//i.test(path) || /\/rota\//i.test(path);
    } catch {
      return /\/admin\/rota\/|\/rota\//i.test(String(url || ""));
    }
  }

  async function xhrBridgeFetch(url, options) {
    // CapHttp-enabled XHR uses the native interceptor (CORS-safe).
    noteTransport("XHR");
    const method = String(options?.method || "GET").toUpperCase();
    const headers = sanitizeHeaders(headersToObject(options?.headers), method);
    return await new Promise(function (resolve, reject) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open(method, String(url), true);
        Object.keys(headers).forEach(function (key) {
          xhr.setRequestHeader(key, headers[key]);
        });
        xhr.timeout = Number(options?.sshrTimeoutMs) || 20000;
        xhr.onload = function () {
          resolve(
            new Response(xhr.responseText, {
              status: xhr.status || 502,
              statusText: xhr.statusText || "",
              headers: { "Content-Type": xhr.getResponseHeader("Content-Type") || "application/json" },
            }),
          );
        };
        xhr.onerror = function () {
          reject(new Error("XHR network error"));
        };
        xhr.ontimeout = function () {
          reject(new Error("XHR timed out"));
        };
        if (method !== "GET" && method !== "HEAD" && options?.body != null) {
          xhr.send(options.body);
        } else {
          xhr.send();
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async function nativeAwareFetchInner(input, init) {
    const webFetch = getWebFetch();
    let url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input || "");
    url = rewriteNativeApiUrl(url);

    if (!isNative() || !isApiUrl(url)) {
      noteTransport("webFetch");
      return webFetch(input, init);
    }

    // Prefer init.headers — Request.headers can drop Authorization in WKWebView.
    const method = String(
      init?.method || (input instanceof Request ? input.method : "GET") || "GET",
    ).toUpperCase();
    const isGet = method === "GET" || method === "HEAD";
    let headers = headersToObject(init?.headers);
    if (!Object.keys(headers).length && input instanceof Request) {
      headers = headersToObject(input.headers);
    }
    let body;
    if (!isGet) {
      if (init?.body != null) body = typeof init.body === "string" ? init.body : String(init.body);
      else if (input instanceof Request) body = await input.clone().text();
    }
    const opts = { method, headers, body: body || undefined };
    const errors = [];

    const nativePlatform = String(window.Capacitor?.getPlatform?.() || "").toLowerCase();

    // iOS disables CapHttp and uses the app's URLSession plugin. Android keeps
    // CapacitorHttp enabled, because ShiftSwiftHttp is not registered there.
    function ssHttpOnce() {
      return withRequestTimeout(
        shiftSwiftHttpRequest(url, opts, {
          connectTimeout: 20000,
          readTimeout: 45000,
          transportLabel: "ShiftSwiftHttp",
        }),
        50000,
        "ShiftSwiftHttp",
      );
    }

    function capacitorHttpOnce() {
      return withRequestTimeout(
        nativeBridgeHttpRequestWithRetries(url, opts, 2, {
          connectTimeout: 20000,
          readTimeout: 45000,
        }),
        50000,
        "CapacitorHttp",
      );
    }

    const attempts =
      nativePlatform === "ios"
        ? [ssHttpOnce]
        : [
            capacitorHttpOnce,
            function capacitorFetchOnce() {
              return withRequestTimeout(
                capacitorHttpFetch(url, opts),
                50000,
                "CapacitorHttp fetch",
              );
            },
          ];

    for (const attempt of attempts) {
      try {
        return await ensureTransportResponse(await attempt());
      } catch (error) {
        errors.push(error);
        try {
          window.__SSHR_LAST_TRANSPORT_ERRORS = errors.map(function (err) {
            return humanizeNonJsonBody(String(err?.message || err || "failed"));
          }).slice(0, 6);
        } catch {
          /* ignore */
        }
      }
    }

    // Do not fall back to App:// CORS fetch — it always fails and hides the real error.
    const detail = errors
      .map(function (err) {
        return String(err?.message || err || "failed");
      })
      .filter(Boolean)
      .slice(0, 4)
      .join(" | ");
    try {
      window.__SSHR_LAST_TRANSPORT_ERRORS = errors.map(function (err) {
        return String(err?.message || err || "failed");
      }).slice(0, 6);
    } catch {
      /* ignore */
    }
    const failedTransport = nativePlatform === "ios" ? "ShiftSwiftHttp" : "CapacitorHttp";
    noteTransport(`${failedTransport}-failed`);
    throw new Error(detail || `${failedTransport} failed`);
  }

  async function nativeAwareFetch(input, init) {
    if (!isNative()) {
      return nativeAwareFetchInner(input, init);
    }
    const request = input instanceof Request ? input : new Request(input, init);
    if (!isApiUrl(request.url)) {
      return nativeAwareFetchInner(input, init);
    }
    // Rota must not wait behind the shared queue — keep a tight outer budget.
    if (isPriorityApiUrl(request.url) || init?.sshrPriority) {
      return withRequestTimeout(nativeAwareFetchInner(input, init), 35000, "Rota request");
    }
    const method = String(init?.method || request.method || "GET").toUpperCase();
    const queueTimeout = method === "GET" || method === "HEAD" ? 90000 : 45000;
    return runQueuedApi(function () {
      return nativeAwareFetchInner(input, init);
    }, queueTimeout);
  }

  function patchFetch() {
    if (!isNative() || window.__SSHR_NATIVE_FETCH_PATCHED) return;
    captureCapacitorHttpFetch();
    window.__SSHR_NATIVE_FETCH_PATCHED = true;

    if (!window.__SSHR_WEB_FETCH__) {
      window.__SSHR_WEB_FETCH__ = window.CapacitorWebFetch?.bind?.(window)
        || window.__SSHR_BROWSER_FETCH__
        || window.fetch.bind(window);
    }
    const webFetch = window.__SSHR_WEB_FETCH__;
    window.fetch = async function patchedFetch(input, init) {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input || "");
      if (isApiUrl(url)) {
        return nativeAwareFetch(input, init);
      }
      return webFetch(input, init);
    };
  }

  function patchSessionFetch() {
    const session = window.ShiftSwiftSession;
    if (!session || session.__sshrNativeFetchPatched || !isNative()) return;
    const original = session.fetchWithAuth?.bind(session);
    if (!original) return;
    session.__sshrNativeFetchPatched = true;
    session.fetchWithAuth = async function patchedFetchWithAuth(path, options, config) {
      patchFetch();
      return original(path, options, config);
    };
  }

  function retryPortalData() {
    if (!isNative()) return;
    const path = String(window.location.pathname || "");
    const hash = String(window.location.hash || "");
    const mobileTab = String(document.body?.dataset?.mobileTab || "");
    if (/admin\.html$/i.test(path)) {
      if (mobileTab === "rota" || /#rota/i.test(hash)) {
        window.dispatchEvent(new CustomEvent("admin:portal-native-retry"));
        window.dispatchEvent(new CustomEvent("admin:rota-mobile-open"));
        window.dispatchEvent(new CustomEvent("admin:section", { detail: { section: "rota" } }));
        return;
      }
      const grid = document.getElementById("overview-metrics");
      if (grid?.querySelector(".hr-stat-card")) return;
      if (!grid?.querySelector(".overview-error")) return;
      document.getElementById("overview-retry-btn")?.click();
      return;
    }
    if (/employee\.html$/i.test(path)) {
      window.dispatchEvent(new CustomEvent("employee:profile-retry"));
      window.dispatchEvent(new CustomEvent("employee:profile-loaded"));
      window.dispatchEvent(new CustomEvent("employee:shifts-retry"));
      window.ShiftSwiftEmployeeRota?.reload?.();
    }
  }

  function boot() {
    if (!isNative()) return;
    patchFetch();
    patchSessionFetch();
  }

  function bootWhenReady() {
    if (!isNative()) return;
    if (!capacitorBridgeReady() && bootAttempts < 200) {
      bootAttempts += 1;
      window.setTimeout(bootWhenReady, 50);
      return;
    }
    boot();
  }

  bootWhenReady();
  document.addEventListener("DOMContentLoaded", bootWhenReady, { once: true });
  window.addEventListener("load", function () {
    bootWhenReady();
    window.setTimeout(retryPortalData, 900);
  }, { once: true });
  window.addEventListener("shiftswift:portal-ready", function () {
    bootWhenReady();
    retryPortalData();
  });
  window.addEventListener("shiftswift:native-session-ready", function () {
    bootWhenReady();
    window.setTimeout(retryPortalData, 200);
  });

  async function parseResponseJson(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new Error(humanizeNonJsonBody(text, response.status));
      }
      throw new Error("Could not read API response");
    }
  }

  window.ShiftSwiftNativeApiFetch = {
    shiftSwiftHttpRequest,
    nativeAwareFetch,
    nativeAwareFetchInner,
    nativeBridgeHttpRequest,
    nativeBridgeHttpRequestWithRetries,
    capacitorPluginsHttpRequest,
    capacitorHttpFetch,
    capacitorProxyFetch,
    captureCapacitorHttpFetch,
    runQueuedApi,
    withRequestTimeout,
    parseResponseJson,
    patchFetch,
    patchSessionFetch,
    boot,
    bootWhenReady,
    retryPortalData,
    isCapacitorHttpEnabled,
  };
})();
