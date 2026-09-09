/** SwiftCRM API helper — separate product, own port. */
window.SwiftCRM = {
  apiBase: localStorage.getItem("swiftcrmApi") || "http://localhost:3100",

  token() {
    return localStorage.getItem("swiftcrmToken") || "";
  },

  async request(path, options = {}) {
    const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
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
    return data;
  },
};
