/** ShiftSwift HR — client-side brand defaults (overridden in production via /setup/brand). */
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

window.ShiftSwiftBrand.resolveApiBase = function resolveApiBase() {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (isLocal) {
    return window.ShiftSwiftBrand.urls.localApi;
  }

  const stored = localStorage.getItem("apiBaseUrl");
  if (stored && !/localhost|127\.0\.0\.1/.test(stored)) {
    return stored;
  }
  if (stored) {
    localStorage.removeItem("apiBaseUrl");
  }

  if (host.startsWith("app.") || host.includes("shiftswifthr")) {
    return window.ShiftSwiftBrand.urls.api;
  }
  return window.ShiftSwiftBrand.urls.localApi;
};

window.ShiftSwiftBrand.appUrl = function appUrl(path) {
  const base = window.ShiftSwiftBrand.urls.app.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
};

window.ShiftSwiftBrand.appHost = function appHost() {
  return window.ShiftSwiftBrand.urls.app.replace(/^https?:\/\//, "").replace(/\/$/, "");
};

/** Labelled app portals for login cards, QR printouts, and admin copy. */
window.ShiftSwiftBrand.portals = function portals() {
  const host = window.ShiftSwiftBrand.appHost();
  return [
    {
      id: "business",
      label: "Business HR",
      description: "Admin dashboard & compliance",
      href: window.ShiftSwiftBrand.appUrl("/business-login.html"),
      display: `${host}/business-login.html`,
    },
    {
      id: "employee",
      label: "Employee",
      description: "Payslips, documents & leave",
      href: window.ShiftSwiftBrand.appUrl("/employee.html"),
      display: `${host}/employee.html`,
    },
    {
      id: "master",
      label: "Master",
      description: "Platform operations (authorised staff)",
      href: window.ShiftSwiftBrand.appUrl("/ops-9x7k2.html"),
      display: `${host}/ops-9x7k2.html`,
    },
    {
      id: "clock",
      label: "Time Clock",
      description: "Clock in & out on site",
      href: window.ShiftSwiftBrand.appUrl("/punch.html"),
      display: `${host}/punch.html`,
    },
  ];
};

window.ShiftSwiftBrand.getApiBase = function getApiBase() {
  return window.ShiftSwiftBrand.resolveApiBase();
};
