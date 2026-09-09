/** SwiftCRM API helper — separate product, own port. */
window.SwiftCRM = {
  apiBase: localStorage.getItem("swiftcrmApi") || "http://localhost:3100",
  _cache: new Map(),

  token() {
    return localStorage.getItem("swiftcrmToken") || "";
  },

  clearCache() {
    this._cache.clear();
  },

  async request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
    const cacheable = method === "GET" && !path.startsWith("/telephony");
    if (cacheable) {
      const hit = this._cache.get(path);
      if (hit && Date.now() - hit.at < 4000) return hit.data;
    } else if (method !== "GET") {
      this._cache.clear();
    }
    const headers = { ...(options.headers || {}) };
    if (!isForm && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${this.apiBase}${path}`, { ...options, headers });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const detail = data?.detail || res.statusText;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    if (cacheable) this._cache.set(path, { at: Date.now(), data });
    return data;
  },
};
