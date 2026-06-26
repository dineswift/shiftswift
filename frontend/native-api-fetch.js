/** Native Capacitor HTTP — reliable API calls from bundled + production portal pages. */
(function initNativeApiFetch() {
  function isNative() {
    try {
      return Boolean(window.Capacitor?.isNativePlatform?.());
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
    return window.__SSHR_WEB_FETCH__ || window.fetch.bind(window);
  }

  async function nativeHttpRequest(url, options) {
    const cap = window.Capacitor;
    const method = String(options?.method || "GET").toUpperCase();
    const headers = headersToObject(options?.headers);
    const contentType = headers["Content-Type"] || headers["content-type"] || "";
    const bodyInfo = await readBody(options?.body, contentType);

    if (cap?.nativePromise) {
      const nativeResponse = await cap.nativePromise("CapacitorHttp", "request", {
        url: String(url),
        method: method,
        headers: headers,
        data: bodyInfo.data,
        dataType: bodyInfo.dataType,
      });
      return responseFromNative(nativeResponse, url);
    }

    if (cap?.Plugins?.CapacitorHttp?.request) {
      const nativeResponse = await cap.Plugins.CapacitorHttp.request({
        url: String(url),
        method: method,
        headers: headers,
        data: bodyInfo.data,
        dataType: bodyInfo.dataType,
      });
      return responseFromNative(nativeResponse, url);
    }

    return xhrRequest(url, { method, headers, body: options?.body });
  }

  function responseFromNative(nativeResponse, url) {
    const responseType =
      nativeResponse.headers?.["Content-Type"] ||
      nativeResponse.headers?.["content-type"] ||
      "";
    let payload = nativeResponse.data;
    if (nativeResponse.status === 204) {
      payload = null;
    } else if (payload != null && typeof payload === "object" && /json/i.test(responseType)) {
      payload = JSON.stringify(payload);
    } else if (payload != null && typeof payload !== "string") {
      payload = String(payload);
    }
    const response = new Response(payload, {
      status: nativeResponse.status,
      headers: nativeResponse.headers || {},
    });
    try {
      Object.defineProperty(response, "url", { value: nativeResponse.url || String(url) });
    } catch {
      /* ignore */
    }
    return response;
  }

  function xhrRequest(url, options) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open(options.method || "GET", String(url), true);
      const headers = headersToObject(options.headers);
      Object.keys(headers).forEach(function (key) {
        xhr.setRequestHeader(key, headers[key]);
      });
      xhr.onload = function () {
        resolve(
          new Response(xhr.responseText, {
            status: xhr.status,
            headers: { "Content-Type": xhr.getResponseHeader("Content-Type") || "text/plain" },
          }),
        );
      };
      xhr.onerror = function () {
        reject(new Error("Failed to fetch"));
      };
      xhr.send(options.body == null ? null : options.body);
    });
  }

  async function nativeAwareFetch(input, init) {
    const webFetch = getWebFetch();
    const request = input instanceof Request ? input : new Request(input, init);
    const url = request.url;
    if (!isNative() || !isApiUrl(url)) {
      return webFetch(input, init);
    }
    try {
      const headers = headersToObject(request.headers);
      const body =
        request.method === "GET" || request.method === "HEAD" ? undefined : await request.clone().text();
      return await nativeHttpRequest(url, {
        method: request.method,
        headers: headers,
        body: body || undefined,
      });
    } catch {
      return webFetch(input, init);
    }
  }

  function patchFetch() {
    if (!isNative() || window.__SSHR_NATIVE_FETCH_PATCHED) return;
    window.__SSHR_NATIVE_FETCH_PATCHED = true;
    if (!window.__SSHR_WEB_FETCH__) {
      window.__SSHR_WEB_FETCH__ = window.fetch.bind(window);
    }
    const webFetch = getWebFetch();
    window.fetch = async function patchedFetch(input, init) {
      try {
        return await nativeAwareFetch(input, init);
      } catch (error) {
        return webFetch(input, init);
      }
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
    if (window.__SSHR_PORTAL_DATA_RETRIED) return;
    window.__SSHR_PORTAL_DATA_RETRIED = true;
    const path = String(window.location.pathname || "");
    if (/admin\.html$/i.test(path)) {
      const section = String(window.location.hash || "").replace("#", "").split("/")[0] || "overview";
      window.dispatchEvent(new CustomEvent("admin:section", { detail: { section } }));
      if (section === "overview") {
        document.getElementById("overview-retry-btn")?.click();
      }
    }
  }

  function boot() {
    if (!isNative()) return;
    patchFetch();
    patchSessionFetch();
  }

  boot();
  document.addEventListener("DOMContentLoaded", boot, { once: true });
  window.addEventListener("load", () => {
    boot();
    window.setTimeout(retryPortalData, 900);
  }, { once: true });
  window.addEventListener("shiftswift:portal-ready", () => {
    boot();
    retryPortalData();
  }, { once: true });
  window.addEventListener("shiftswift:native-session-ready", () => {
    boot();
    window.setTimeout(retryPortalData, 200);
  }, { once: true });

  window.ShiftSwiftNativeApiFetch = {
    nativeAwareFetch,
    nativeHttpRequest,
    patchFetch,
    patchSessionFetch,
    boot,
    retryPortalData,
  };
})();
