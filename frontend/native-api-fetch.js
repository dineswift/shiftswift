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

  async function buildNativeRequestPayload(url, options, extra) {
    const method = String(options?.method || "GET").toUpperCase();
    const headers = sanitizeHeaders(headersToObject(options?.headers), method);
    const contentType = headers["Content-Type"] || headers["content-type"] || "";
    const bodyInfo = await readBody(options?.body, contentType);
    const requestPayload = {
      url: String(url),
      method,
      headers,
      connectTimeout: 45000,
      readTimeout: 120000,
    };
    if (extra?.responseType) requestPayload.responseType = extra.responseType;
    if (method !== "GET" && method !== "HEAD" && bodyInfo.data != null) {
      requestPayload.data = bodyInfo.data;
      requestPayload.dataType = bodyInfo.dataType;
    }
    return requestPayload;
  }

  async function nativeBridgeHttpRequest(url, options, extra) {
    const cap = window.Capacitor;
    if (!cap?.nativePromise) throw new Error("Capacitor unavailable");
    const requestPayload = await buildNativeRequestPayload(url, options, extra);
    noteTransport(extra?.transportLabel || "CapacitorHttp.request");
    const nativeResponse = await cap.nativePromise("CapacitorHttp", "request", requestPayload);
    return responseFromNative(nativeResponse, url);
  }

  async function nativeBridgeHttpRequestWithRetries(url, options, attempts) {
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
    let payload = nativeResponse.data;
    if (nativeResponse.status === 204) {
      payload = null;
    } else if (payload != null && typeof payload === "object") {
      payload = JSON.stringify(payload);
    } else if (payload != null && typeof payload !== "string") {
      payload = String(payload);
    }
    const response = new Response(payload, {
      status: nativeResponse.status,
      statusText: nativeResponse.statusText || "",
      headers: nativeResponse.headers || {},
    });
    try {
      Object.defineProperty(response, "url", { value: nativeResponse.url || String(url) });
    } catch {
      /* ignore */
    }
    return response;
  }

  async function nativeAwareFetchInner(input, init) {
    const webFetch = getWebFetch();
    const request = input instanceof Request ? input : new Request(input, init);
    const url = request.url;

    if (!isNative() || !isApiUrl(url)) {
      noteTransport("webFetch");
      return webFetch(input, init);
    }

    const headers = headersToObject(request.headers);
    const body =
      request.method === "GET" || request.method === "HEAD" ? undefined : await request.clone().text();
    const opts = { method: request.method, headers, body: body || undefined };
    const method = String(request.method || "GET").toUpperCase();
    const isRead = method === "GET" || method === "HEAD" || method === "OPTIONS";
    const errors = [];

    const attempts = isRead
      ? [
          function () { return nativeBridgeHttpRequestWithRetries(url, opts, 2); },
          function () { return capacitorHttpFetch(input, init); },
          function () { return capacitorProxyFetch(url, opts); },
        ]
      : [
          function () { return nativeBridgeHttpRequestWithRetries(url, opts, 2); },
          function () { return capacitorHttpFetch(input, init); },
        ];

    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (error) {
        errors.push(error);
        // Keep trying alternate native transports — CapacitorHttp can fail while another path works.
      }
    }

    // WebView fetch works when the portal is served from https://app.shiftswifthr.co.uk.
    try {
      noteTransport("webFetch-fallback");
      return await webFetch(input, init);
    } catch (error) {
      errors.push(error);
    }

    throw errors[0] || new Error("Load failed");
  }

  async function nativeAwareFetch(input, init) {
    if (!isNative()) {
      return nativeAwareFetchInner(input, init);
    }
    const request = input instanceof Request ? input : new Request(input, init);
    if (!isApiUrl(request.url)) {
      return nativeAwareFetchInner(input, init);
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
    if (/admin\.html$/i.test(path)) {
      const grid = document.getElementById("overview-metrics");
      if (grid?.querySelector(".hr-stat-card")) return;
      if (!grid?.querySelector(".overview-error")) return;
      document.getElementById("overview-retry-btn")?.click();
      return;
    }
    if (/employee\.html$/i.test(path)) {
      window.dispatchEvent(new CustomEvent("employee:profile-retry"));
      window.dispatchEvent(new CustomEvent("employee:profile-loaded"));
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
      const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
      if (!response.ok) {
        throw new Error(snippet || `HTTP ${response.status}`);
      }
      throw new Error("Could not read API response");
    }
  }

  window.ShiftSwiftNativeApiFetch = {
    nativeAwareFetch,
    nativeAwareFetchInner,
    nativeBridgeHttpRequest,
    nativeBridgeHttpRequestWithRetries,
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
