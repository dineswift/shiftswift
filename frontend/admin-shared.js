/** Shared admin workspace — API, navigation, forms, tables. */
window.Admin = (() => {
  function getApiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    return localStorage.getItem("apiBaseUrl") || "http://localhost:3000";
  }

  function isLocalDevHost() {
    return window.ShiftSwiftBrand?.isLocalDevHost?.() || false;
  }

  function getMasterCustomerId() {
    return localStorage.getItem("masterTenantId") || "999";
  }

  function resolveWorkspaceTenantId() {
    const stored = localStorage.getItem("tenantId") || "";
    const role = localStorage.getItem("userRole") || "";
    const masterId = getMasterCustomerId();
    // Local dev only: platform master workspace maps to demo tenant 1.
    if (isLocalDevHost() && role === "admin" && stored === masterId) {
      return "1";
    }
    return stored;
  }

  function isPlatformAdmin() {
    const role = localStorage.getItem("userRole") || "";
    const tenantId = localStorage.getItem("tenantId") || "";
    return role === "admin" && tenantId === getMasterCustomerId();
  }

  const TENANT_ID = resolveWorkspaceTenantId();
  const API_BASE = getApiBase();
  const businessName = localStorage.getItem("businessName") || window.ShiftSwiftBrand?.appName || "ShiftSwift HR";

  async function ensureHrPortal() {
    if (!window.ShiftSwiftSession?.hasSession?.()) return;
    try {
      const response = await window.ShiftSwiftSession.fetchWithAuth("/auth/verify", {}, { apiBase: API_BASE });
      if (!response.ok) return;
      const user = await response.json();
      if (user.role === "employee") {
        window.location.replace("./employee.html");
      }
    } catch {
      /* ignore — apiFetch will handle auth errors */
    }
  }

  void ensureHrPortal();

  let formOptions = null;
  let tenantFeatures = {
    payroll_enabled: false,
    sponsor_compliance_enabled: false,
    sponsor_licence_acknowledged: false,
    holds_sponsor_licence: false,
    grievance_enabled: false,
    disciplinary_enabled: false,
    audit_export_enabled: false,
    multi_site_enabled: false,
    api_access_enabled: false,
    rota_mode: "basic",
    rota_mode_options: ["basic"],
    rota_week_start_day: 0,
    rota_advanced_addon: false,
    rota_multi_site_addon: false,
    rota_advanced_enabled: false,
    rota_multi_site_enabled: false,
    crm_addon: false,
    ai_document_addon: false,
    time_clock_enabled: localStorage.getItem("adminTimeClockEnabled") === "true",
    plan_display_name: "Essentials",
    plan_tier: "starter",
  };

  const ADDON_FLAG_KEYS = {
    crm: "crm_addon",
    "ai-document": "ai_document_addon",
  };

  const FEATURE_FLAG_KEYS = {
    payroll: "payroll_enabled",
    "sponsor-compliance": "sponsor_compliance_enabled",
    grievance: "grievance_enabled",
    disciplinary: "disciplinary_enabled",
    "audit-export": "audit_export_enabled",
    "multi-site": "multi_site_enabled",
    "api-access": "api_access_enabled",
  };

  const FEATURE_TO_UPGRADE_KEY = {
    "sponsor-compliance": "sponsor_compliance",
    grievance: "grievance",
    disciplinary: "disciplinary",
    "audit-export": "audit_export",
    "multi-site": "multi_site",
    "api-access": "api_access",
  };

  const FEATURE_UPGRADE_LABELS = {
    "sponsor-compliance": "Sponsor licence compliance is included on Compliance and Multi-site plans.",
    grievance: "Grievance workflows are included on Compliance and Multi-site plans.",
    disciplinary: "Disciplinary workflows are included on Compliance and Multi-site plans.",
    "audit-export": "Home Office audit export is included on Compliance and Multi-site plans.",
    "multi-site": "Multi-site dashboard is included on the Multi-site plan.",
    "api-access": "API access is included on the Multi-site plan.",
  };

  const ADDON_UPGRADE_LABELS = {
    crm: "Sales CRM is a paid add-on at £10/month ex VAT. Add it under Settings → Billing & plan or contact support.",
    "ai-document":
      "AI document assistant is a paid add-on at £10/month ex VAT. Add it under Settings → Billing & plan or contact support.",
  };

  function featureUpgradeMessage(feature) {
    const apiKey = FEATURE_TO_UPGRADE_KEY[feature];
    const fromApi = apiKey && tenantFeatures.upgrade_messages?.[apiKey];
    return fromApi || FEATURE_UPGRADE_LABELS[feature] || "Upgrade your plan to unlock this feature.";
  }

  function showAdminToast(message, { variant = "info", durationMs = 4200 } = {}) {
    let toast = document.getElementById("admin-upgrade-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "admin-upgrade-toast";
      toast.className = "admin-upgrade-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.remove("admin-upgrade-toast--error", "admin-upgrade-toast--visible");
    if (variant === "error") toast.classList.add("admin-upgrade-toast--error");
    window.clearTimeout(showAdminToast._timer);
    window.requestAnimationFrame(() => toast.classList.add("admin-upgrade-toast--visible"));
    showAdminToast._timer = window.setTimeout(() => {
      toast.classList.remove("admin-upgrade-toast--visible");
      window.setTimeout(() => {
        toast.hidden = true;
      }, 220);
    }, durationMs);
  }

  function addonUpgradeMessage(addon) {
    const fromApi = tenantFeatures.upgrade_messages?.[addon];
    return fromApi || ADDON_UPGRADE_LABELS[addon] || "This add-on is not enabled on your workspace.";
  }

  function authHeaders(json = true) {
    const headers = window.ShiftSwiftSession.authHeaders({ json, tenantId: TENANT_ID });
    return headers;
  }

  async function apiFetch(path, options = {}) {
    if (!TENANT_ID) {
      throw new Error("Business not set. Sign in again.");
    }
    return window.ShiftSwiftSession.fetchWithAuth(path, options, {
      apiBase: getApiBase(),
      tenantId: TENANT_ID,
      loginUrl: "./business-login.html",
    });
  }

  let tenantProfileSnapshot = null;
  let tenantProfileLoaded = false;

  function tenantRegisteredAddressCacheKey() {
    return `tenantRegisteredAddress_${localStorage.getItem("tenantId") || TENANT_ID || "default"}`;
  }

  function tenantRegisteredCoordsCacheKey() {
    return `tenantRegisteredCoords_${localStorage.getItem("tenantId") || TENANT_ID || "default"}`;
  }

  function rememberTenantRegisteredAddress(value) {
    const trimmed = String(value || "").trim();
    const key = tenantRegisteredAddressCacheKey();
    if (trimmed) localStorage.setItem(key, trimmed);
    else localStorage.removeItem(key);
  }

  function rememberTenantRegisteredCoords(latitude, longitude) {
    const key = tenantRegisteredCoordsCacheKey();
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      localStorage.setItem(key, JSON.stringify({ latitude: lat, longitude: lng }));
    } else {
      localStorage.removeItem(key);
    }
  }

  function getCachedTenantRegisteredCoordsFromStorage() {
    try {
      const raw = localStorage.getItem(tenantRegisteredCoordsCacheKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const lat = Number(parsed?.latitude);
      const lng = Number(parsed?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { latitude: lat, longitude: lng };
    } catch {
      return null;
    }
  }

  const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
  const MIN_BUSINESS_ADDRESS_LEN = 10;
  const BUSINESS_ADDRESS_EXAMPLE = "156 Front street, Nottingham, NG5 7EG";

  function normalizeBusinessAddress(address) {
    let query = String(address || "").trim();
    if (!query) return "";
    query = query
      .replace(/\u00a0/g, " ")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\r\n]+/g, ", ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s{2,}/g, " ")
      .replace(/(,\s*)+/g, ", ");
    return query.replace(/^[\s,]+|[\s,]+$/g, "");
  }

  function validateBusinessAddress(address, coords = null) {
    const trimmed = normalizeBusinessAddress(address);
    const latitude = coords?.latitude ?? coords?.lat ?? null;
    const longitude = coords?.longitude ?? coords?.lng ?? null;
    const hasCoords = latitude != null && longitude != null;
    if (!trimmed) {
      return {
        ok: false,
        message: "Add your registered business address in Settings → Business profile first.",
      };
    }
    if (hasCoords) {
      return { ok: true, message: "" };
    }
    if (trimmed.length < MIN_BUSINESS_ADDRESS_LEN) {
      return {
        ok: false,
        message: "Enter the full street address including town or city — not just a postcode.",
      };
    }
    if (!UK_POSTCODE_RE.test(trimmed)) {
      return {
        ok: false,
        message: `Include a valid UK postcode (e.g. ${BUSINESS_ADDRESS_EXAMPLE}).`,
      };
    }
    return { ok: true, message: "" };
  }

  function hasPinnedBusinessCoords(source = null) {
    const profile = source || tenantProfileSnapshot || {};
    const lat = profile.registered_latitude;
    const lng = profile.registered_longitude;
    if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return true;
    }
    return Boolean(getCachedTenantRegisteredCoords());
  }

  function getCachedTenantRegisteredAddress() {
    const fromProfile = String(tenantProfileSnapshot?.registered_address || "").trim();
    if (fromProfile) return fromProfile;
    if (tenantProfileLoaded) return "";
    return String(localStorage.getItem(tenantRegisteredAddressCacheKey()) || "").trim();
  }

  function getCachedTenantRegisteredCoords() {
    const lat = tenantProfileSnapshot?.registered_latitude;
    const lng = tenantProfileSnapshot?.registered_longitude;
    if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return { latitude: Number(lat), longitude: Number(lng) };
    }
    if (tenantProfileLoaded) return null;
    return getCachedTenantRegisteredCoordsFromStorage();
  }

  async function saveTenantRegisteredAddress({ address, latitude, longitude }) {
    const trimmed = normalizeBusinessAddress(address);
    if (!trimmed) return null;
    const lat = latitude != null ? Number(latitude) : null;
    const lng = longitude != null ? Number(longitude) : null;
    const body = {
      registered_address: trimmed,
      registered_latitude: Number.isFinite(lat) ? lat : null,
      registered_longitude: Number.isFinite(lng) ? lng : null,
    };
    const res = await apiFetch("/admin/tenant-profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail;
      throw new Error(typeof detail === "string" ? detail : "Could not save address to your account.");
    }
    tenantProfileSnapshot = { ...(tenantProfileSnapshot || {}), ...data };
    tenantProfileLoaded = true;
    rememberTenantRegisteredAddress(data.registered_address);
    rememberTenantRegisteredCoords(data.registered_latitude, data.registered_longitude);
    window.dispatchEvent(new CustomEvent("admin:tenant-profile-saved", { detail: data }));
    return data;
  }

  async function prefetchTenantProfile() {
    try {
      const res = await apiFetch("/admin/tenant-profile");
      if (!res.ok) return tenantProfileSnapshot;
      tenantProfileSnapshot = await res.json();
      tenantProfileLoaded = true;
      rememberTenantRegisteredAddress(tenantProfileSnapshot?.registered_address);
      rememberTenantRegisteredCoords(
        tenantProfileSnapshot?.registered_latitude,
        tenantProfileSnapshot?.registered_longitude,
      );
      return tenantProfileSnapshot;
    } catch {
      return tenantProfileSnapshot;
    }
  }

  void prefetchTenantProfile();

  window.addEventListener("admin:tenant-profile-saved", (event) => {
    if (!event.detail || typeof event.detail !== "object") return;
    tenantProfileSnapshot = { ...(tenantProfileSnapshot || {}), ...event.detail };
    tenantProfileLoaded = true;
    rememberTenantRegisteredAddress(tenantProfileSnapshot.registered_address);
    rememberTenantRegisteredCoords(
      tenantProfileSnapshot.registered_latitude,
      tenantProfileSnapshot.registered_longitude,
    );
  });

  async function loadTenantFeatures() {
    try {
      const res = await apiFetch("/admin/overview");
      if (!res.ok) return tenantFeatures;
      const data = await res.json();
      tenantFeatures = {
        payroll_enabled: Boolean(data.payroll_enabled),
        sponsor_compliance_enabled: Boolean(data.sponsor_compliance_enabled),
        sponsor_licence_acknowledged: Boolean(data.sponsor_licence_acknowledged),
        holds_sponsor_licence: Boolean(data.holds_sponsor_licence),
        grievance_enabled: Boolean(data.grievance_enabled),
        disciplinary_enabled: Boolean(data.disciplinary_enabled),
        audit_export_enabled: Boolean(data.audit_export_enabled),
        multi_site_enabled: Boolean(data.multi_site_enabled),
        api_access_enabled: Boolean(data.api_access_enabled),
        rota_mode: data.rota_mode || "basic",
        rota_mode_options: Array.isArray(data.rota_mode_options) ? data.rota_mode_options : ["basic"],
        rota_week_start_day: Number.isFinite(Number(data.rota_week_start_day))
          ? Number(data.rota_week_start_day)
          : 0,
        rota_advanced_addon: Boolean(data.rota_advanced_addon),
        rota_multi_site_addon: Boolean(data.rota_multi_site_addon),
        rota_advanced_enabled: Boolean(data.rota_advanced_enabled),
        rota_multi_site_enabled: Boolean(data.rota_multi_site_enabled),
        crm_addon: Boolean(data.crm_addon),
        crm_addon_monthly_gbp: data.crm_addon_monthly_gbp,
        ai_document_addon: Boolean(data.ai_document_addon),
        ai_document_addon_monthly_gbp: data.ai_document_addon_monthly_gbp,
        time_clock_enabled: Boolean(data.time_clock_enabled),
        plan_display_name: data.plan_display_name || "Essentials",
        plan_tier: data.plan_tier || "starter",
        sponsored_employees: Number(data.sponsored_employees || 0),
        rota_mode_labels: data.rota_mode_labels || {},
        rota_modes_all: Array.isArray(data.rota_modes_all) ? data.rota_modes_all : ["basic"],
        upgrade_messages: data.upgrade_messages || {},
      };
    } catch {
      /* keep previous values */
    }
    return tenantFeatures;
  }

  function isFeatureEnabled(feature) {
    const key = FEATURE_FLAG_KEYS[feature];
    if (key) return Boolean(tenantFeatures[key]);
    return true;
  }

  function isAddonEnabled(addon) {
    const key = ADDON_FLAG_KEYS[addon];
    if (key) return Boolean(tenantFeatures[key]);
    return false;
  }

  function ensureAddonUpgradeNotice(section, addon, enabled) {
    let notice = section.querySelector(".addon-upgrade-notice");
    if (enabled) {
      if (notice) notice.hidden = true;
      section.dataset.addonDisabled = "false";
      return;
    }
    section.dataset.addonDisabled = "true";
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "addon-upgrade-notice promo-result";
      notice.innerHTML = `<p><strong>${escapeHtml(addonUpgradeMessage(addon))}</strong> <a href="#settings/billing">View billing</a></p>`;
      const header = section.querySelector(".section-header");
      section.insertBefore(notice, header ? header.nextSibling : section.firstChild);
    }
    notice.hidden = false;
  }

  function applyAddonGates() {
    document.querySelectorAll("[data-addon]").forEach((el) => {
      const addon = el.dataset.addon;
      const enabled = isAddonEnabled(addon);
      if (el.matches(".nav-link") || el.matches(".mobile-more-link")) {
        el.hidden = !enabled;
        return;
      }
      if (el.matches(".admin-section")) {
        ensureAddonUpgradeNotice(el, addon, enabled);
        el.querySelectorAll(":scope > *").forEach((child) => {
          if (child.matches(".section-header") || child.matches(".addon-upgrade-notice")) return;
          child.hidden = !enabled;
        });
      }
    });
  }

  function ensureFeatureUpgradeNotice(section, feature, enabled) {
    let notice = section.querySelector(".feature-upgrade-notice");
    if (enabled) {
      if (notice) notice.hidden = true;
      return;
    }
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "feature-upgrade-notice promo-result";
      notice.innerHTML = `<p><strong>${escapeHtml(featureUpgradeMessage(feature))}</strong> <a href="#settings/billing">View billing</a></p>`;
      const header = section.querySelector(".section-header");
      section.insertBefore(notice, header ? header.nextSibling : section.firstChild);
    }
    notice.hidden = false;
  }

  function syncNavLinkLock(link, locked) {
    let meta = link.querySelector(".nav-link__meta");
    if (locked) {
      if (!meta) {
        meta = document.createElement("span");
        meta.className = "nav-link__meta";
        const lockEl = document.createElement("span");
        lockEl.className = "nav-link__lock";
        lockEl.setAttribute("aria-hidden", "true");
        if (window.AdminIcons?.svg) {
          lockEl.innerHTML = window.AdminIcons.svg("lock", "nav-link__lock-svg");
        }
        const upgrade = document.createElement("span");
        upgrade.className = "nav-link__upgrade";
        upgrade.textContent = "Upgrade";
        meta.appendChild(lockEl);
        meta.appendChild(upgrade);
        link.appendChild(meta);
      }
    } else if (meta) {
      meta.remove();
    }
  }

  function applyFeatureGates() {
    document.querySelectorAll("[data-feature]").forEach((el) => {
      const feature = el.dataset.feature;
      const enabled = isFeatureEnabled(feature);
      if (el.matches(".nav-link")) {
        el.hidden = false;
        el.classList.toggle("nav-link--locked", !enabled);
        syncNavLinkLock(el, !enabled);
        el.setAttribute("aria-disabled", enabled ? "false" : "true");
        return;
      }
      if (el.matches(".mobile-more-link")) {
        el.hidden = !enabled;
        return;
      }
      if (el.matches(".mobile-tab")) {
        el.hidden = !enabled;
        return;
      }
      if (el.matches(".admin-section")) {
        el.dataset.featureDisabled = enabled ? "false" : "true";
        ensureFeatureUpgradeNotice(el, feature, enabled);
        return;
      }
      if (el.matches(".feature-gated-panel")) {
        el.classList.toggle("feature-gated-panel--locked", !enabled);
        el.querySelectorAll("button, input, select, textarea").forEach((control) => {
          control.disabled = !enabled;
        });
        let notice = el.querySelector(".feature-upgrade-notice");
        if (!enabled) {
          if (!notice) {
            notice = document.createElement("p");
            notice.className = "feature-upgrade-notice muted";
            notice.textContent =
              FEATURE_UPGRADE_LABELS[feature] || "Upgrade your plan to unlock this feature.";
            el.insertBefore(notice, el.firstChild);
          }
          notice.hidden = false;
        } else if (notice) {
          notice.hidden = true;
        }
      }
    });
    applyAddonGates();
    applyPlatformOnlyGates();
    window.AdminMobile?.syncClockAvailability?.(Boolean(tenantFeatures.time_clock_enabled));
    window.dispatchEvent(new CustomEvent("admin:features", { detail: tenantFeatures }));
    window.Admin.routeFromHash?.();
  }

  function applyPlatformOnlyGates() {
    const show = isPlatformAdmin();
    document.querySelectorAll("[data-platform-only]").forEach((el) => {
      if (el.matches(".nav-link") || el.matches(".mobile-more-link") || el.matches(".admin-section")) {
        el.hidden = !show;
        return;
      }
      el.hidden = !show;
    });
  }

  function parseHashPath(rawHash) {
    const path = rawHash.replace("#", "") || "overview";
    const baseSection = path.split("/")[0] || "overview";
    return { path, baseSection };
  }

  function parseHashBaseSection(rawHash) {
    return resolveSectionFromHash(rawHash);
  }

  function resolveSectionFromHash(rawHash) {
    const { baseSection } = parseHashPath(rawHash);
    if (baseSection === "payroll" || baseSection === "export") return "overview";
    if (baseSection === "overview-actions") return "overview";
    if (baseSection.startsWith("compliance")) return "compliance";
    if (baseSection === "time-punch" && !tenantFeatures.time_clock_enabled) return "overview";
    if (baseSection === "promotions" && !isPlatformAdmin()) return "overview";
    const sectionEl = document.getElementById(baseSection);
    const feature = sectionEl?.dataset?.feature;
    if (feature && !isFeatureEnabled(feature)) return "overview";
    return baseSection || "overview";
  }

  async function loadEmployees() {
    const res = await apiFetch("/admin/employees");
    if (!res.ok) throw new Error("Could not load employees");
    const data = await res.json();
    const options = (data.items || []).map((emp) => ({
      id: emp.id,
      value: String(emp.id),
      label: `${emp.first_name} ${emp.last_name}${emp.job_title ? `, ${emp.job_title}` : ""}`,
      first_name: emp.first_name,
      last_name: emp.last_name,
      status: emp.status,
      job_title: emp.job_title,
      email: emp.email,
      employment_type: emp.employment_type || "full_time",
    }));
    if (!formOptions) formOptions = {};
    formOptions.employees = options;
    return options;
  }

  async function downloadAuthenticated(path, filename) {
    const res = await apiFetch(path);
    if (!res.ok) throw new Error("Download failed");
    let name = filename;
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    if (match) name = match[1];
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadFormOptions() {
    if (formOptions) return formOptions;
    const res = await apiFetch("/admin/metadata");
    if (!res.ok) throw new Error("Could not load form options");
    formOptions = await res.json();
    if (formOptions.brand) {
      window.ShiftSwiftBrand?.mergeBrand?.(formOptions.brand);
      window.ShiftSwiftBrand?.applyBrandDom?.();
    }
    try {
      await loadEmployees();
    } catch {
      formOptions.employees = [];
    }
    return formOptions;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function statusClass(status) {
    if (status === "overdue" || status === "pending" || status === "sent" || status === "draft") {
      return "status-critical";
    }
    if (status === "due_soon" || status === "open" || status === "generated" || status === "inactive") {
      return "status-warning";
    }
    return "status-ok";
  }

  function statusPill(status) {
    return `<span class="status-pill ${statusClass(status)}">${escapeHtml(status)}</span>`;
  }

  function resolveOptions(field, options) {
    if (field.optionsKey && options?.[field.optionsKey]) {
      return options[field.optionsKey];
    }
    if (field.options) return field.options;
    return [];
  }

  function renderField(field, values, options) {
    const name = field.name;
    const value = values?.[name] ?? field.defaultValue ?? "";
    const required = field.required ? " required" : "";
    const id = field.id || `field-${name}`;
    const label = `<span class="edit-label">${escapeHtml(field.label)}</span>`;

    if (field.type === "checkbox") {
      const checked = value === true || value === "true" || field.defaultChecked ? " checked" : "";
      return `<label class="edit-field edit-field--checkbox" data-span="${field.span || 1}">
        <input type="checkbox" id="${id}" name="${name}"${checked} />
        ${label}
      </label>`;
    }

    if (field.type === "select") {
      const emptyOption = field.placeholderOption
        ? `<option value="">${escapeHtml(field.placeholderOption)}</option>`
        : "";
      const opts = resolveOptions(field, options)
        .map(
          (opt) =>
            `<option value="${escapeHtml(opt.value)}"${String(opt.value) === String(value) ? " selected" : ""}>${escapeHtml(opt.label)}</option>`
        )
        .join("");
      return `<label class="edit-field" data-span="${field.span || 1}">
        ${label}
        <select id="${id}" name="${name}"${required}>${emptyOption}${opts}</select>
      </label>`;
    }

    if (field.type === "textarea") {
      return `<label class="edit-field" data-span="${field.span || 2}">
        ${label}
        <textarea id="${id}" name="${name}" rows="${field.rows || 3}" placeholder="${escapeHtml(field.placeholder || "")}"${required}>${escapeHtml(value)}</textarea>
      </label>`;
    }

    const inputType = field.type || "text";
    return `<label class="edit-field" data-span="${field.span || 1}">
      ${label}
      <input id="${id}" name="${name}" type="${inputType}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || "")}"${required} />
    </label>`;
  }

  /**
   * Mount a schema-driven edit form into container.
   * schema: { id, fields, submitLabel, columns }
   */
  function preserveScroll(update) {
    if (typeof window.MobileShell?.preserveScroll === "function") {
      return window.MobileShell.preserveScroll(update);
    }
    return update();
  }

  async function preserveScrollAsync(update) {
    if (typeof window.MobileShell?.preserveScrollAsync === "function") {
      return window.MobileShell.preserveScrollAsync(update);
    }
    return update();
  }

  function mountEditForm(container, schema, { values = {}, onSubmit, statusEl } = {}) {
    if (!container) return null;
    const columns = schema.columns || 2;
    let fieldsHtml;
    if (schema.sections?.length) {
      fieldsHtml = schema.sections
        .map((section) => {
          const sectionFields = section.fields
            .map((field) => renderField(field, values, formOptions))
            .join("");
          return `<h4 class="settings-form-section__title">${escapeHtml(section.title)}</h4>${sectionFields}`;
        })
        .join("");
    } else {
      fieldsHtml = schema.fields.map((field) => renderField(field, values, formOptions)).join("");
    }
    const formMarkup = `
      <form class="edit-form edit-form--cols-${columns}" data-form-id="${escapeHtml(schema.id)}">
        ${fieldsHtml}
        <div class="edit-form-actions" data-span="2">
          <button class="btn" type="submit">${escapeHtml(schema.submitLabel || "Save")}</button>
          ${schema.secondaryAction ? `<button class="btn ghost" type="button" data-secondary>${escapeHtml(schema.secondaryAction.label)}</button>` : ""}
          <p class="edit-form-status muted" ${statusEl ? "" : 'data-status'}></p>
        </div>
      </form>`;

    preserveScroll(() => {
      container.innerHTML = formMarkup;
    });

    const form = container.querySelector("form");
    const status = statusEl || container.querySelector("[data-status]");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (status) status.textContent = "Saving…";
      const payload = readFormPayload(form);
      try {
        await onSubmit(payload, form);
        if (status) status.textContent = schema.successMessage || "Saved.";
      } catch (error) {
        if (status) status.textContent = error.message || "Save failed.";
      }
    });

    const secondary = form.querySelector("[data-secondary]");
    if (secondary && schema.secondaryAction?.onClick) {
      secondary.addEventListener("click", () => schema.secondaryAction.onClick(form));
    }

    return form;
  }

  function readFormPayload(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      data[input.name] = input.checked;
    });
    return data;
  }

  function emptyStateHtml({
    icon = "folder",
    title = "",
    message = "No records yet.",
    actionLabel = "",
    actionHref = "",
    actionId = "",
    compact = false,
  } = {}) {
    const iconSvg = window.AdminIcons?.svg?.(icon) || "";
    const action =
      actionLabel && (actionHref || actionId)
        ? actionHref
          ? `<a class="btn outline btn-sm admin-empty-state__action" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>`
          : `<button type="button" class="btn outline btn-sm admin-empty-state__action" id="${escapeHtml(actionId)}">${escapeHtml(actionLabel)}</button>`
        : "";
    const titleHtml = title ? `<strong class="admin-empty-state__title">${escapeHtml(title)}</strong>` : "";
    return `<div class="admin-empty-state${compact ? " admin-empty-state--compact" : ""}">
      <span class="admin-empty-state__icon" aria-hidden="true">${iconSvg}</span>
      ${titleHtml}
      <p class="admin-empty-state__message muted">${escapeHtml(message)}</p>
      ${action}
    </div>`;
  }

  function renderTableBody(tbody, { columns, rows, emptyMessage = "No records yet.", emptyState = null }) {
    if (!tbody) return;
    if (!rows?.length) {
      if (emptyState) {
        tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="${columns.length}">${emptyStateHtml(emptyState)}</td></tr>`;
      } else {
        tbody.innerHTML = `<tr><td colspan="${columns.length}" class="muted">${escapeHtml(emptyMessage)}</td></tr>`;
      }
      return;
    }
    tbody.innerHTML = rows
      .map((row) => {
        const cells = columns
          .map((col) => {
            const content = typeof col.render === "function" ? col.render(row) : escapeHtml(row[col.key]);
            return `<td>${content ?? "Not set"}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
  }

  function bindNavIcons() {
    document.querySelectorAll("[data-nav-icon]").forEach((el) => {
      const name = el.dataset.navIcon;
      if (window.AdminIcons?.svg && name) {
        el.innerHTML = window.AdminIcons.svg(name, "nav-link__svg");
      }
    });
  }

  function initNavigation() {
    bindNavIcons();
    const sections = [...document.querySelectorAll(".admin-section")];
    const links = [...document.querySelectorAll(".nav-link[data-section]")];
    const sidebarCtl =
      typeof window.MobileShell?.initSidebar === "function" ? window.MobileShell.initSidebar() : null;
    let activeSectionId = null;

    function scrollToHashAnchor() {
      const raw = window.location.hash.replace("#", "");
      if (!raw) return;
      const parts = raw.split("/").filter(Boolean);
      if (parts.length <= 1) return;

      const candidates = [parts[parts.length - 1], parts.join("-"), raw.replace(/\//g, "-")];
      for (const id of candidates) {
        const el = document.getElementById(id);
        if (el && !el.closest(".admin-section[hidden]")) {
          window.MobileShell?.scrollToAnchor?.(id, { block: "nearest", behavior: "auto" });
          return;
        }
      }
    }

    function showSection(sectionId) {
      const sectionChanged = activeSectionId !== sectionId;
      activeSectionId = sectionId;
      sections.forEach((section) => {
        const active = section.id === sectionId;
        section.hidden = !active;
        section.classList.toggle("admin-section--active", active);
      });
      links.forEach((link) => {
        const isActive = link.dataset.section === sectionId;
        link.classList.toggle("active", isActive);
        if (!isActive && link.matches(":focus")) {
          link.blur();
        }
      });
      if (sidebarCtl?.isOpen?.()) {
        sidebarCtl.closeSidebar();
      }
      if (sectionChanged && window.MobileShell?.isMobileViewport?.()) {
        window.MobileShell.resetPortalScroll();
      }
      scrollToHashAnchor();
    }

    function routeFromHash() {
      const { path } = parseHashPath(window.location.hash);
      const sectionId = resolveSectionFromHash(window.location.hash);
      const exists = sections.some((s) => s.id === sectionId);
      const targetSection = exists ? sectionId : "overview";
      const isDeepLink = path.includes("/");

      if (!exists) {
        if (!isDeepLink && path !== targetSection) {
          window.location.hash = targetSection;
          return;
        }
        if (isDeepLink) {
          window.location.hash = "overview";
          return;
        }
      } else if (!isDeepLink && path !== targetSection) {
        window.location.hash = targetSection;
        return;
      }

      showSection(targetSection);
      window.dispatchEvent(new CustomEvent("admin:section", { detail: { section: targetSection } }));
    }

    links.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (link.getAttribute("aria-disabled") === "true") {
          const feature = link.dataset.feature;
          if (feature) showAdminToast(featureUpgradeMessage(feature));
          return;
        }
        const target = link.dataset.section;
        if (target === "promotions" && !isPlatformAdmin()) {
          window.location.hash = "overview";
          return;
        }
        const current = parseHashPath(window.location.hash).baseSection;
        if (current === target) {
          routeFromHash();
        } else {
          window.location.hash = target;
        }
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
    });

    window.addEventListener("hashchange", routeFromHash);
    window.Admin.routeFromHash = routeFromHash;
    routeFromHash();
  }

  const FORM_SCHEMAS = {
    tenantProfile: {
      id: "tenant-profile",
      columns: 2,
      submitLabel: "Save business details",
      successMessage: "Business information updated.",
      sections: [
        {
          title: "Legal & registration",
          fields: [
            { name: "name", label: "Legal company name", type: "text", required: true },
            { name: "trading_name", label: "Trading name", type: "text" },
            { name: "company_number", label: "Company number", type: "text" },
            { name: "vat_number", label: "VAT number", type: "text" },
            {
              name: "registered_address",
              label: "Registered address",
              type: "textarea",
              span: 2,
              placeholder: "Search below for your premises on OpenStreetMap",
            },
          ],
        },
        {
          title: "Contact",
          fields: [
            { name: "phone", label: "Phone", type: "tel" },
            { name: "billing_email", label: "Billing email", type: "email" },
          ],
        },
        {
          title: "Signatory",
          fields: [
            { name: "signatory_name", label: "Signatory name", type: "text" },
            { name: "signatory_title", label: "Signatory title", type: "text", defaultValue: "Director" },
            { name: "signatory_email", label: "Signatory email", type: "email", span: 2 },
          ],
        },
      ],
    },
    employee: {
      id: "employee",
      columns: 2,
      submitLabel: "Add employee",
      successMessage: "Employee saved.",
      fields: [
        { name: "first_name", label: "First name", type: "text", required: true },
        { name: "last_name", label: "Last name", type: "text", required: true },
        { name: "email", label: "Work email", type: "email" },
        { name: "job_title", label: "Job title", type: "text" },
        { name: "salary", label: "Annual salary (£)", type: "number", placeholder: "28000" },
        { name: "work_location", label: "Work location", type: "text", placeholder: "London site" },
        { name: "start_date", label: "Start date", type: "date" },
        { name: "status", label: "Status", type: "select", optionsKey: "employee_statuses", defaultValue: "active" },
        { name: "is_sponsored", label: "Sponsored worker", type: "checkbox" },
      ],
    },
    shareCodeVerify: {
      id: "share-code-verify",
      columns: 2,
      submitLabel: "Verify eVisa share code",
      successMessage: "Share code verified.",
      fields: [
        { name: "employee_id", label: "Employee", type: "select", optionsKey: "employees", required: true },
        { name: "share_code", label: "GOV.UK share code", type: "text", required: true, placeholder: "ABC123XYZ" },
        { name: "date_of_birth", label: "Date of birth", type: "date", required: true },
      ],
    },
    absenceDay: {
      id: "absence-day",
      columns: 2,
      submitLabel: "Record absence day",
      successMessage: "Absence day saved.",
      fields: [
        { name: "employee_id", label: "Sponsored employee", type: "select", optionsKey: "employees", required: true },
        { name: "absence_date", label: "Absence date", type: "date", required: true },
        {
          name: "excuse_type",
          label: "Absence type",
          type: "select",
          optionsKey: "absence_excuse_types",
          defaultValue: "unauthorized",
          required: true,
        },
      ],
    },
    workingCalendar: {
      id: "working-calendar",
      columns: 2,
      submitLabel: "Save calendar day",
      successMessage: "Calendar updated.",
      fields: [
        { name: "calendar_date", label: "Date", type: "date", required: true },
        {
          name: "is_non_working",
          label: "Non-working day (bank holiday / site closed)",
          type: "checkbox",
          defaultChecked: true,
        },
      ],
    },
    grievanceCase: {
      id: "grievance-case",
      columns: 2,
      submitLabel: "Open grievance case",
      successMessage: "Case opened.",
      fields: [
        { name: "employee_id", label: "Employee", type: "select", optionsKey: "employees", required: true },
        { name: "date_received", label: "Date received", type: "date", required: true },
        { name: "allegation_type", label: "Allegation type", type: "select", optionsKey: "grievance_allegation_types", required: true },
        { name: "allegation_type_other", label: "Describe allegation", type: "text", placeholder: "Required when Other is selected" },
        { name: "assigned_investigator", label: "Investigator", type: "select", optionsKey: "grievance_investigators" },
        { name: "acas_notification_date", label: "ACAS notification date (if notified)", type: "date" },
        { name: "linked_absence_context", label: "Absence / dispute context", type: "textarea", span: 2, placeholder: "Optional. Links to sponsor absence monitoring." },
        { name: "initial_note", label: "Initial investigation note (encrypted)", type: "textarea", span: 2 },
      ],
    },
    grievanceNote: {
      id: "grievance-note",
      columns: 2,
      submitLabel: "Add encrypted note",
      successMessage: "Note saved.",
      fields: [
        { name: "body", label: "Note", type: "textarea", span: 2, required: true, rows: 5 },
        {
          name: "note_type",
          label: "Type",
          type: "select",
          options: [
            { value: "investigation", label: "Investigation" },
            { value: "hearing", label: "Hearing" },
            { value: "appeal", label: "Appeal" },
          ],
          defaultValue: "investigation",
        },
      ],
    },
    disciplinaryNote: {
      id: "disciplinary-note",
      columns: 2,
      submitLabel: "Add encrypted note",
      successMessage: "Note saved.",
      fields: [
        { name: "body", label: "Note", type: "textarea", span: 2, required: true, rows: 5 },
        {
          name: "note_type",
          label: "Type",
          type: "select",
          options: [
            { value: "investigation", label: "Investigation" },
            { value: "hearing", label: "Hearing" },
            { value: "appeal", label: "Appeal" },
          ],
          defaultValue: "investigation",
        },
      ],
    },
    document: {
      id: "document",
      columns: 2,
      submitLabel: "Add document",
      successMessage: "Document saved.",
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        { name: "category", label: "Category", type: "select", optionsKey: "document_categories", defaultValue: "general" },
        {
          name: "lifecycle_stage",
          label: "Lifecycle stage",
          type: "select",
          optionsKey: "document_lifecycle_stages",
          defaultValue: "general",
        },
        { name: "document_url", label: "Document URL", type: "url", placeholder: "https://..." },
        { name: "expires_at", label: "Expiry date", type: "date" },
        { name: "notes", label: "Notes", type: "textarea", span: 2 },
      ],
    },
    advert: {
      id: "advert",
      columns: 2,
      submitLabel: "Save advert record",
      successMessage: "Advert record saved.",
      fields: [
        { name: "job_title", label: "Job title", type: "text", required: true, placeholder: "e.g. Sous Chef" },
        { name: "platform", label: "Platform", type: "select", optionsKey: "advert_platforms", required: true },
        { name: "advert_url", label: "Primary advert URL", type: "url", required: true, placeholder: "https://..." },
        { name: "posted_date", label: "Posted date", type: "date", required: true },
        { name: "closing_date", label: "Closing date", type: "date" },
        { name: "job_reference", label: "Job reference", type: "text", placeholder: "VAC-2026-001" },
        { name: "extra_link_label", label: "Extra link label", type: "text", placeholder: "Archive / screenshot link" },
        { name: "extra_link_url", label: "Extra link URL", type: "url", placeholder: "https://..." },
        { name: "is_sponsored_vacancy", label: "Sponsored vacancy", type: "checkbox", defaultChecked: true },
      ],
    },
    contract: {
      id: "contract",
      columns: 2,
      submitLabel: "Generate contracts",
      successMessage: "Contracts generated.",
      fields: [
        { name: "customer_legal_name", label: "Legal company name", type: "text", required: true },
        { name: "customer_trading_name", label: "Trading name", type: "text" },
        { name: "company_number", label: "Company number", type: "text" },
        { name: "vat_number", label: "VAT number", type: "text" },
        { name: "registered_address", label: "Registered address", type: "text" },
        { name: "signatory_email", label: "Signatory email", type: "email", required: true },
        { name: "signatory_name", label: "Signatory name", type: "text" },
        { name: "signatory_title", label: "Signatory title", type: "text", defaultValue: "Director" },
        { name: "plan_id", label: "Plan", type: "select", optionsKey: "platform_plans" },
        { name: "effective_date", label: "Effective date", type: "date", required: true },
        { name: "template_id", label: "Template", type: "select", optionsKey: "contract_templates", defaultValue: "pack" },
      ],
    },
    promoValidate: {
      id: "promo-validate",
      columns: 2,
      submitLabel: "Validate billing codes",
      successMessage: "Codes validated.",
      fields: [
        { name: "plan_id", label: "Platform plan", type: "select", optionsKey: "platform_plans", required: true },
        { name: "discount_code", label: "Discount code", type: "text", placeholder: "e.g. LAUNCH20" },
        { name: "referral_code", label: "Referral code", type: "text", placeholder: "e.g. REF-PUB" },
      ],
    },
  };

  document.title = `${businessName} | Admin Console`;

  return {
    API_BASE,
    getApiBase,
    get TOKEN() {
      return window.ShiftSwiftSession?.getToken?.() || localStorage.getItem("token") || "";
    },
    TENANT_ID,
    businessName,
    get formOptions() {
      return formOptions;
    },
    get tenantFeatures() {
      return tenantFeatures;
    },
    FORM_SCHEMAS,
    authHeaders,
    apiFetch,
    preserveScroll,
    preserveScrollAsync,
    prefetchTenantProfile,
    saveTenantRegisteredAddress,
    rememberTenantRegisteredAddress,
    rememberTenantRegisteredCoords,
    getCachedTenantRegisteredAddress,
    getCachedTenantRegisteredCoords,
    normalizeBusinessAddress,
    validateBusinessAddress,
    hasPinnedBusinessCoords,
    BUSINESS_ADDRESS_EXAMPLE,
    get tenantProfileSnapshot() {
      return tenantProfileSnapshot;
    },
    loadFormOptions,
    loadTenantFeatures,
    applyFeatureGates,
    isFeatureEnabled,
    isAddonEnabled,
    loadEmployees,
    downloadAuthenticated,
    isPlatformAdmin,
    escapeHtml,
    statusClass,
    statusPill,
    mountEditForm,
    readFormPayload,
    renderTableBody,
    emptyStateHtml,
    showAdminToast,
    featureUpgradeMessage,
    initNavigation,
    parseHashPath,
    parseHashBaseSection,
    resolveSectionFromHash,
    routeFromHash: () => window.Admin.routeFromHash?.(),
  };
})();
