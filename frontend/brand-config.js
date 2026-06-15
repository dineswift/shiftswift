/** ShiftSwift HR — client-side brand defaults (merged with /setup/brand in production). */
window.ShiftSwiftBrand = {
  appName: "ShiftSwift HR",
  tradingName: "ShiftSwift HR",
  companyLegalName: "Datasoftware Analytics Ltd",
  companyNumber: "14568900",
  registeredAddress: "235 Charlbury Road, Nottingham, NG8 1NF",
  legalNotice:
    "ShiftSwift HR is a trading name of Datasoftware Analytics Ltd (Company No. 14568900), registered in England and Wales.",
  domain: "shiftswifthr.co.uk",
  tagline: "UK HR & sponsor licence compliance software",
  urls: {
    marketing: "https://www.shiftswifthr.co.uk",
    app: "https://app.shiftswifthr.co.uk",
    api: "https://api.shiftswifthr.co.uk",
    localApp: "http://localhost:5173",
    localApi: "http://localhost:3000",
  },
  emails: {
    hello: "support@shiftswifthr.co.uk",
    support: "support@shiftswifthr.co.uk",
    legal: "legal@shiftswifthr.co.uk",
    noreply: "noreply@shiftswifthr.co.uk",
    compliance: "compliance@shiftswifthr.co.uk",
    admin: "admin@shiftswifthr.co.uk",
    hr: "hr@shiftswifthr.co.uk",
    employee: "employee@shiftswifthr.co.uk",
  },
};

window.ShiftSwiftBrand.isLocalDevHost = function isLocalDevHost() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
};

window.ShiftSwiftBrand.mergeBrand = function mergeBrand(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.app_name) this.appName = payload.app_name;
  if (payload.trading_name) this.tradingName = payload.trading_name;
  if (payload.company_legal_name) this.companyLegalName = payload.company_legal_name;
  if (payload.company_number) this.companyNumber = payload.company_number;
  if (payload.registered_address) this.registeredAddress = payload.registered_address;
  if (payload.legal_notice) this.legalNotice = payload.legal_notice;
  if (payload.domain) this.domain = payload.domain;
  if (payload.tagline) this.tagline = payload.tagline;
  if (payload.urls && typeof payload.urls === "object") {
    Object.assign(this.urls, payload.urls);
  }
  if (payload.emails && typeof payload.emails === "object") {
    Object.assign(this.emails, payload.emails);
  }
};

window.ShiftSwiftBrand.deriveApiBaseFromHost = function deriveApiBaseFromHost() {
  const host = window.location.hostname;
  const protocol = window.location.protocol || "https:";
  if (host.startsWith("app.")) {
    return `${protocol}//${host.replace(/^app\./, "api.")}`;
  }
  if (host.startsWith("api.")) {
    return `${protocol}//${host}`;
  }
  if (host.includes(".")) {
    const parts = host.split(".");
    if (parts.length >= 2) {
      return `${protocol}//api.${parts.slice(-2).join(".")}`;
    }
  }
  return this.urls.api;
};

window.ShiftSwiftBrand.resolveApiBase = function resolveApiBase() {
  if (this.isLocalDevHost()) {
    return this.urls.localApi;
  }

  const stored = localStorage.getItem("apiBaseUrl");
  if (stored && !/localhost|127\.0\.0\.1/.test(stored)) {
    return stored.replace(/\/$/, "");
  }
  if (stored) {
    localStorage.removeItem("apiBaseUrl");
  }

  return this.deriveApiBaseFromHost().replace(/\/$/, "");
};

window.ShiftSwiftBrand.getApiBase = function getApiBase() {
  return this.resolveApiBase();
};

window.ShiftSwiftBrand.supportEmail = function supportEmail() {
  return this.emails.support || this.emails.hello;
};

window.ShiftSwiftBrand.supportMailto = function supportMailto(subject) {
  const email = this.supportEmail();
  if (!subject) return `mailto:${email}`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
};

window.ShiftSwiftBrand.marketingUrl = function marketingUrl() {
  const configured = this.urls.marketing;
  if (configured) return configured.replace(/\/$/, "");
  return `https://www.${this.domain}`;
};

window.ShiftSwiftBrand.appUrl = function appUrl(path) {
  const base = (this.isLocalDevHost() ? this.urls.localApp : this.urls.app).replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
};

window.ShiftSwiftBrand.appHost = function appHost() {
  const base = this.isLocalDevHost() ? this.urls.localApp : this.urls.app;
  return base.replace(/^https?:\/\//, "").replace(/\/$/, "");
};

/** Labelled app portals for login cards, QR printouts, and admin copy. */
window.ShiftSwiftBrand.portals = function portals(options = {}) {
  const host = this.appHost();
  const includeMaster = options.includeMaster === true;
  const items = [
    {
      id: "business",
      label: "Business HR",
      description: "Admin dashboard & compliance",
      href: this.appUrl("/business-login.html"),
      display: `${host}/business-login.html`,
    },
    {
      id: "employee",
      label: "Employee",
      description: "Payslips, documents & leave",
      href: this.appUrl("/business-login.html?portal=employee"),
      display: `${host}/business-login.html`,
    },
    {
      id: "master",
      label: "Master",
      description: "Platform operations (authorised staff)",
      href: this.appUrl("/ops-9x7k2.html"),
      display: `${host}/ops-9x7k2.html`,
    },
    {
      id: "clock",
      label: "Time Clock",
      description: "Clock in & out on site",
      href: this.appUrl("/punch.html"),
      display: `${host}/punch.html`,
    },
  ];
  if (!includeMaster) {
    return items.filter((item) => item.id !== "master");
  }
  return items;
};

window.ShiftSwiftBrand.applyBrandDom = function applyBrandDom(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-brand-support-mailto]").forEach((el) => {
    el.setAttribute("href", this.supportMailto(el.dataset.brandSupportMailto || ""));
  });
  scope.querySelectorAll("[data-brand-marketing-url]").forEach((el) => {
    el.setAttribute("href", this.marketingUrl());
    if (el.dataset.brandMarketingLabel === "domain") {
      el.textContent = this.domain;
    }
  });
  scope.querySelectorAll("[data-secure-host]").forEach((el) => {
    el.textContent = this.domain;
  });
};

window.ShiftSwiftBrand.bootstrapBrand = async function bootstrapBrand() {
  try {
    const res = await fetch(`${this.resolveApiBase()}/setup/brand`);
    if (res.ok) {
      this.mergeBrand(await res.json());
    }
  } catch {
    /* defaults are fine offline */
  }
  this.applyBrandDom();
  return this;
};

document.addEventListener("DOMContentLoaded", () => {
  void window.ShiftSwiftBrand.bootstrapBrand();
});
