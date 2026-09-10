window.SwiftHelp = {
  apiBase: localStorage.getItem("swifthelpApi") || "http://localhost:3200",
  token() {
    return localStorage.getItem("swifthelpToken") || "";
  },
  async request(path, options = {}) {
    const headers = { ...(options.headers || {}), "Content-Type": "application/json" };
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${this.apiBase}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.detail || res.statusText;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data;
  },
};
