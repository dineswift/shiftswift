/** Settings workspace — left nav, plan badge, business profile, billing, notifications. */
(function initAdminSettings() {
  const { apiFetch, escapeHtml, isFeatureEnabled, parseHashPath, mountEditForm, FORM_SCHEMAS, emptyStateHtml } = window.Admin;

  const PANELS = ["business", "documents", "billing", "notifications", "rota", "users", "security", "addons"];
  const PANEL_ICONS = {
    business: "building",
    documents: "folder",
    billing: "card",
    notifications: "bell",
    rota: "calendar",
    users: "users",
    security: "lock",
    addons: "sparkles",
  };
  const ADDON_TOGGLES = [
    {
      id: "multi-site",
      title: "Multi-site dashboard",
      description: "Manage staff records and compliance across multiple locations from one workspace.",
      supportSubject: "Multi-site upgrade",
      helpEnabled: "Contact support to add additional sites to your account.",
    },
    {
      id: "api-access",
      title: "API access",
      description: "Integrate ShiftSwift HR with your accountant, BI tools, or internal systems.",
      supportSubject: "API keys and documentation",
      helpEnabled: "Email support for API keys and documentation.",
    },
  ];
  const PANEL_COPY = {
    business: {
      title: "Business information",
      subtitle: "Your organisation's legal details, signatory, and contact information.",
    },
    documents: {
      title: "Document store",
      subtitle: "Upload files or register external document links for audits and offboarding.",
    },
    billing: {
      title: "Billing & plan",
      subtitle: "Current subscription, trial status, and billing contacts.",
    },
    notifications: {
      title: "Notifications",
      subtitle: "Choose how your organisation receives compliance and workforce alerts.",
    },
    rota: {
      title: "Rota scheduling",
      subtitle: "Basic manual rota is included on your plan. Advanced tools are optional paid add-ons.",
    },
    users: {
      title: "Users & access",
      subtitle: "People who can sign in to this ShiftSwift HR workspace.",
    },
    security: {
      title: "Security",
      subtitle: "Two-factor authentication for your HR admin sign-in.",
    },
    addons: {
      title: "Add-ons & integrations",
      subtitle: "Turn Scale plan features on or off for your workspace.",
    },
  };
  const SAVED_AT_KEY = `settings_business_saved_${window.Admin?.TENANT_ID ?? "default"}`;

  function cacheRegisteredAddress(profileOrValue) {
    if (profileOrValue && typeof profileOrValue === "object") {
      window.Admin?.rememberTenantRegisteredAddress?.(profileOrValue.registered_address);
      window.Admin?.rememberTenantRegisteredCoords?.(
        profileOrValue.registered_latitude,
        profileOrValue.registered_longitude
      );
      return;
    }
    window.Admin?.rememberTenantRegisteredAddress?.(profileOrValue);
  }

  let sectionReady = false;
  let settingsNavBound = false;

  function settingsPanelId() {
    const { path } = parseHashPath(window.location.hash || "#settings");
    const segments = path.split("/").filter(Boolean);
    if (segments.length <= 1) return null;
    const part = segments[1];
    if (part === "multisite" || part === "api") return "addons";
    return PANELS.includes(part) ? part : null;
  }

  function showSettingsToast(message, options = {}) {
    const toast = document.getElementById("settings-toast");
    if (!toast) return;
    const variant = options.variant || "success";
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.remove("settings-toast--error", "settings-toast--warn");
    if (variant === "error") toast.classList.add("settings-toast--error");
    if (variant === "warn") toast.classList.add("settings-toast--warn");
    toast.classList.add("settings-toast--visible");
    window.clearTimeout(showSettingsToast._timer);
    showSettingsToast._timer = window.setTimeout(() => {
      toast.classList.remove("settings-toast--visible");
      window.setTimeout(() => {
        toast.hidden = true;
      }, 300);
    }, options.duration ?? 3200);
  }

  function formatSavedAt(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function updateLastSavedLabel(iso) {
    const el = document.getElementById("tenant-profile-last-saved");
    if (!el) return;
    const when = formatSavedAt(iso);
    el.textContent = when ? `Saved · ${when}` : "";
  }

  function isMobileSettingsLayout() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function mountSettingsHub() {
    const hub = document.getElementById("settings-hub");
    if (!hub || hub.dataset.ready === "1") return;

    hub.innerHTML = PANELS.map((panelId) => {
      const copy = PANEL_COPY[panelId] || PANEL_COPY.business;
      const icon = PANEL_ICONS[panelId] || "settings";
      const meta =
        panelId === "addons"
          ? '<span class="settings-hub-card__meta muted">Multi-site · API access</span>'
          : "";
      return `<button type="button" class="settings-hub-card" data-settings-hub="${panelId}">
        <span class="settings-hub-card__icon" data-settings-icon="${icon}" aria-hidden="true"></span>
        <span class="settings-hub-card__body">
          <strong class="settings-hub-card__title">${escapeHtml(copy.title)}</strong>
          <span class="settings-hub-card__sub muted">${escapeHtml(copy.subtitle)}</span>
          ${meta}
        </span>
        <span class="settings-hub-card__chevron" aria-hidden="true">›</span>
      </button>`;
    }).join("");

    hub.querySelectorAll("[data-settings-hub]").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.hash = `settings/${btn.dataset.settingsHub}`;
      });
    });

    hub.dataset.ready = "1";
    bindSettingsNavIcons();
  }

  function loadPanelContent(panelId) {
    if (panelId === "business") {
      void loadBusinessPanel();
    }
    if (panelId === "security") {
      void loadSecurityPanel();
    }
    if (panelId === "billing") {
      void loadBillingPanel(true);
    }
    if (panelId === "rota") {
      void loadRotaPanel();
    }
    if (panelId === "documents") {
      void window.AdminDocuments?.loadSettingsDocuments?.();
    }
    if (panelId === "notifications") {
      loadNotificationsPanel();
    }
    if (panelId === "users") {
      loadUsersPanel();
    }
    if (panelId === "addons") {
      void loadAddonsPanel(true);
    }
  }

  function activateSettingsPanel(panelId) {
    const workspace = document.querySelector(".settings-workspace");
    const hub = document.getElementById("settings-hub");
    const backBtn = document.getElementById("settings-back-btn");
    const titleEl = document.getElementById("settings-panel-title");
    const subtitleEl = document.getElementById("settings-panel-subtitle");
    const isHub = !panelId;

    window.MobileShell?.preserveScroll?.(() => {
      workspace?.classList.toggle("settings-workspace--hub", isHub);
      workspace?.classList.toggle("settings-workspace--detail", !isHub);
      if (hub) hub.hidden = !isHub;
      if (backBtn) backBtn.hidden = isHub;
      if (isHub) void renderSettingsSetupBanner();

      document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
        panel.hidden = isHub || panel.dataset.settingsPanel !== panelId;
      });

      if (isHub) {
        if (titleEl) titleEl.textContent = "Settings";
        if (subtitleEl) subtitleEl.textContent = "Choose a section to manage.";
        return;
      }

      const copy = PANEL_COPY[panelId] || PANEL_COPY.business;
      if (titleEl) titleEl.textContent = copy.title;
      if (subtitleEl) subtitleEl.textContent = copy.subtitle;
    });

    if (isHub) {
      window.MobileShell?.resetPortalScroll?.();
      return;
    }

    loadPanelContent(panelId);
  }

  function bindSettingsNav() {
    if (settingsNavBound) return;
    settingsNavBound = true;
    document.getElementById("settings-back-btn")?.addEventListener("click", () => {
      window.location.hash = "settings";
    });
    window.addEventListener("hashchange", () => {
      if (parseHashPath(window.location.hash).baseSection === "settings") {
        activateSettingsPanel(settingsPanelId());
      }
    });
  }

  async function loadPlanBadge() {
    const label = document.getElementById("settings-plan-label");
    if (!label) return;
    const businessName = localStorage.getItem("businessName") || "Your business";
    label.classList.add("settings-plan-label--loading");
    label.textContent = "Loading plan…";
    try {
      const [overviewRes, billingRes] = await Promise.all([
        apiFetch("/admin/overview"),
        apiFetch("/billing/status"),
      ]);
      let planName = "Essentials";
      if (overviewRes.ok) {
        const overview = await overviewRes.json();
        planName = overview.plan_display_name || overview.subscription_plan || "Essentials";
      } else if (billingRes.ok) {
        const billing = await billingRes.json();
        planName = (billing.subscription_plan || "site_starter_monthly").replace(/_/g, " ");
      }
      label.classList.remove("settings-plan-label--loading");
      label.textContent = `${planName} plan · ${businessName}`;
    } catch {
      label.classList.remove("settings-plan-label--loading");
      label.innerHTML = `${escapeHtml(businessName)} · <button type="button" class="btn ghost btn-sm" id="settings-plan-retry">Retry</button>`;
      document.getElementById("settings-plan-retry")?.addEventListener("click", () => loadPlanBadge());
    }
  }

  async function renderSettingsSetupBanner() {
    const host = document.getElementById("settings-setup-banner");
    if (!host) return;
    try {
      const res = await apiFetch("/admin/overview");
      if (!res.ok) throw new Error("Overview unavailable");
      const data = await res.json();
      const checklist = data.setup_checklist;
      if (!checklist || data.setup_complete) {
        host.hidden = true;
        host.innerHTML = "";
        return;
      }
      const clockEnabled = Boolean(data.time_clock_enabled);
      const steps = [
        { key: "business_address", label: "Business address", href: "#settings/business" },
        { key: "first_employee", label: "First employee", href: "#employees" },
        { key: "rtw_started", label: "Right-to-work check", href: "#compliance-rtw" },
        { key: "punch_site", label: "Time punch site", href: "#time-punch" },
        { key: "rota_published", label: "Published rota", href: "#rota" },
        { key: "accountant_email", label: "Accountant email", href: "#time-punch/accountant" },
      ].filter((step) => {
        if (!clockEnabled && (step.key === "punch_site" || step.key === "accountant_email")) return false;
        return true;
      });
      const done = steps.filter((step) => checklist[step.key]).length;
      host.hidden = false;
      host.innerHTML = `
        <div class="settings-setup-banner__inner">
          <div>
            <strong>Workspace setup · ${done}/${steps.length}</strong>
            <p class="muted">Finish these steps so clock-in, compliance, and payroll export work smoothly.</p>
          </div>
          <div class="settings-setup-banner__actions">
            <a class="btn outline btn-sm" href="#overview">View checklist</a>
            <a class="btn ghost btn-sm" href="${escapeHtml(steps.find((s) => !checklist[s.key])?.href || "#settings/business")}">Next step</a>
          </div>
        </div>`;
    } catch {
      host.hidden = true;
      host.innerHTML = "";
    }
  }

  async function startUpgrade() {
    try {
      const res = await apiFetch("/billing/upgrade", { method: "POST", body: JSON.stringify({}) });
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      window.location.href = "./index.html#pricing";
    } catch {
      window.location.href = "./index.html#pricing";
    }
  }

  function bindUpgradeActions() {
    document.getElementById("settings-upgrade-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.hash = "settings/billing";
      activateSettingsPanel("billing");
      void loadBillingPanel();
    });
    document.querySelectorAll("[data-settings-upgrade]").forEach((btn) => {
      btn.addEventListener("click", startUpgrade);
    });
  }

  function bindSettingsNavIcons() {
    document.querySelectorAll("[data-settings-icon]").forEach((el) => {
      const name = el.dataset.settingsIcon;
      if (window.AdminIcons?.svg && name) {
        el.innerHTML = window.AdminIcons.svg(name, "settings-nav__svg");
      }
    });
  }

  function applyGatedPanels() {
    document.querySelectorAll(".settings-gated-card").forEach((card) => {
      const feature = card.dataset.feature;
      const enabled = feature ? isFeatureEnabled(feature) : true;
      card.classList.toggle("settings-gated-card--locked", !enabled);
      const locked = card.querySelector(".settings-gated-card__locked");
      const unlocked = card.querySelector(".settings-gated-card__unlocked");
      if (locked) locked.hidden = enabled;
      if (unlocked) unlocked.hidden = !enabled;
    });
  }

  function businessFormMounted() {
    const host = document.getElementById("tenant-profile-form");
    return Boolean(host?.querySelector('[data-form-id="tenant-profile"]'));
  }

  async function loadBusinessPanel() {
    const host = document.getElementById("tenant-profile-form");
    if (!host || businessFormMounted()) return;

    host.innerHTML = '<p class="muted">Loading business details…</p>';

    let values = {};
    let loadError = null;
    try {
      const res = await apiFetch("/admin/tenant-profile");
      if (res.ok) {
        values = await res.json();
      } else {
        loadError = "Could not load business profile.";
      }
    } catch (error) {
      loadError = error?.message || "Could not load business profile.";
    }
    if (!Object.keys(values).length && window.Admin?.fetchAdminOverview) {
      try {
        const overview = await window.Admin.fetchAdminOverview(false);
        values = {
          name: overview.tenant_name || overview.trading_name || "",
          trading_name: overview.trading_name || overview.tenant_name || "",
          billing_email: overview.billing_email || "",
          signatory_name: overview.signatory_name || "",
          signatory_email: overview.signatory_email || "",
          signatory_title: overview.signatory_title || "Director",
          registered_address: overview.registered_address || "",
          registered_latitude: overview.registered_latitude ?? null,
          registered_longitude: overview.registered_longitude ?? null,
        };
        loadError = null;
      } catch {
        /* keep profile error */
      }
    }
    if (loadError && !Object.keys(values).length) {
      host.innerHTML = `<div class="overview-error"><p class="muted">${escapeHtml(loadError)}</p><button type="button" class="btn outline btn-sm" id="business-profile-retry-btn">Retry</button></div>`;
      host.querySelector("#business-profile-retry-btn")?.addEventListener("click", () => {
        host.innerHTML = "";
        void loadBusinessPanel();
      });
      return;
    }
    cacheRegisteredAddress(values);

    try {
      host.innerHTML = '<div id="tenant-profile-form-mount"></div><p id="tenant-profile-last-saved" class="settings-last-saved muted"></p>';
      const mountHost = document.getElementById("tenant-profile-form-mount");
      const savedAt = localStorage.getItem(SAVED_AT_KEY);
      updateLastSavedLabel(savedAt);
      const initialAddress = window.Admin?.normalizeBusinessAddress?.(values.registered_address) || "";
      const initialLatitude = values.registered_latitude ?? null;
      const initialLongitude = values.registered_longitude ?? null;

      mountEditForm(mountHost, FORM_SCHEMAS.tenantProfile, {
        values,
        onSubmit: async (payload) => {
          if (payload.registered_address) {
            payload.registered_address =
              window.Admin?.normalizeBusinessAddress?.(payload.registered_address) ||
              payload.registered_address;
          }
          payload.registered_latitude = payload.registered_latitude ? Number(payload.registered_latitude) : null;
          payload.registered_longitude = payload.registered_longitude ? Number(payload.registered_longitude) : null;
          const addressChanged = payload.registered_address !== initialAddress;
          const hasCoords = payload.registered_latitude != null && payload.registered_longitude != null;
          if (!hasCoords && initialLatitude != null && initialLongitude != null && !addressChanged) {
            payload.registered_latitude = initialLatitude;
            payload.registered_longitude = initialLongitude;
          }
          const effectiveCoords =
            payload.registered_latitude != null && payload.registered_longitude != null
              ? { latitude: payload.registered_latitude, longitude: payload.registered_longitude }
              : null;
          if (payload.registered_address) {
            const check = window.Admin?.validateBusinessAddress?.(payload.registered_address, effectiveCoords);
            if (check && !check.ok) throw new Error(check.message);
          }
          if (payload.registered_address && addressChanged && !effectiveCoords) {
            throw new Error("Search OpenStreetMap and pick your premises so Time punch can geofence accurately.");
          }
          const res = await apiFetch("/admin/tenant-profile", {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "Update failed");
          const now = new Date().toISOString();
          localStorage.setItem(SAVED_AT_KEY, now);
          updateLastSavedLabel(now);
          const sync = data.punch_site_sync;
          let toast = "Business details saved ✓";
          if (sync?.ok) {
            toast = `${toast} Punch site synced: ${sync.site_name}.`;
          } else if (sync?.message) {
            toast = `${toast} Punch site sync failed: ${sync.message}`;
          }
          showSettingsToast(toast);
          cacheRegisteredAddress(data);
          window.dispatchEvent(new CustomEvent("admin:tenant-profile-saved", { detail: data }));
        },
      });
      const profileForm = mountHost.querySelector('[data-form-id="tenant-profile"]');
      window.AdminAddressPicker?.enhanceForm?.(profileForm, {
        latitude: values.registered_latitude,
        longitude: values.registered_longitude,
      });
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load business form.")}</p>`;
    }
  }

  function renderAddonToggleRow(addon, enabled, planName) {
    const locked = !enabled;
    return `<article class="settings-feature-toggle${locked ? " settings-feature-toggle--locked" : ""}">
      <div class="settings-feature-toggle__copy">
        <h4 class="settings-feature-toggle__title">${escapeHtml(addon.title)}</h4>
        <p class="muted">${escapeHtml(addon.description)}</p>
        ${
          enabled
            ? `<p class="muted settings-feature-toggle__help"><a href="#" data-brand-support-mailto="${escapeHtml(addon.supportSubject)}">Contact support</a> — ${escapeHtml(addon.helpEnabled)}</p>`
            : `<p class="muted settings-feature-toggle__help">Included on <strong>Scale</strong> plans. You are on <strong>${escapeHtml(planName)}</strong>.</p>`
        }
      </div>
      <label class="settings-toggle" title="${enabled ? "Enabled on your account" : "Upgrade your plan to enable"}">
        <input type="checkbox" data-addon-toggle="${escapeHtml(addon.id)}" ${enabled ? "checked" : ""} ${enabled ? "disabled" : ""} />
        <span class="settings-toggle__track" aria-hidden="true"></span>
        <span class="visually-hidden">${enabled ? "Enabled" : "Disabled"}</span>
      </label>
    </article>`;
  }

  function bindAddonToggles(host) {
    host.querySelectorAll("[data-addon-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        const feature = input.dataset.addonToggle;
        if (isFeatureEnabled(feature)) {
          input.checked = true;
          showSettingsToast("Contact support if you need to disable this add-on.");
          return;
        }
        input.checked = false;
        showSettingsToast("Upgrade your plan to enable this add-on.");
        void startUpgrade();
      });
    });
  }

  async function loadAddonsPanel(force = false) {
    const host = document.getElementById("settings-addons-content");
    if (!host || (host.dataset.ready === "true" && !force)) return;

    host.innerHTML = `<p class="muted">Loading add-ons…</p>`;
    try {
      await window.Admin.loadTenantFeatures();
      const overviewRes = await apiFetch("/admin/overview");
      const overview = overviewRes.ok ? await overviewRes.json() : {};
      const planName = overview.plan_display_name || "Starter";
      const scaleLocked = !isFeatureEnabled("multi-site") && !isFeatureEnabled("api-access");

      host.innerHTML = `
        <p class="muted">Use toggles to see which Scale features are active on your account. Self-service enablement is coming soon — contact support or upgrade your plan today.</p>
        ${
          scaleLocked
            ? `<div class="alert-card alert-card-warning settings-addons-upgrade">
                <p class="alert-copy">Multi-site and API access are included on <strong>Scale</strong>. Upgrade to unlock both, or email support if you are already on Scale.</p>
                <button type="button" class="btn outline" data-settings-upgrade>View plans</button>
              </div>`
            : ""
        }
        <div class="settings-feature-toggles">
          ${ADDON_TOGGLES.map((addon) => renderAddonToggleRow(addon, isFeatureEnabled(addon.id), planName)).join("")}
        </div>
        <p class="muted settings-addons-foot">Rota add-ons (Advanced scheduling, Multi-site rota) are managed under <a href="#settings/rota">Rota scheduling</a> and <a href="#settings/billing">Billing &amp; plan</a>.</p>`;

      host.querySelector("[data-settings-upgrade]")?.addEventListener("click", startUpgrade);
      bindAddonToggles(host);
      window.ShiftSwiftBrand?.applyBrandDom?.(host);
      host.dataset.ready = "true";
    } catch {
      host.innerHTML = `<p class="muted">Could not load add-ons.</p>`;
    }
  }

  async function loadBillingPanel(force = false) {
    const host = document.getElementById("settings-billing-content");
    if (!host || (host.dataset.ready === "true" && !force)) return;
    try {
      const [overviewRes, billingRes] = await Promise.all([
        apiFetch("/admin/overview"),
        apiFetch("/billing/status"),
      ]);
      const overview = overviewRes.ok ? await overviewRes.json() : {};
      const billing = billingRes.ok ? await billingRes.json() : {};
      const planName = overview.plan_display_name || "Starter";
      const status = billing.subscription_status || overview.subscription_status || "trial";
      const offlineBilling = billing.offline_billing || billing.billing_mode === "offline";
      const trialDays = offlineBilling ? null : billing.days_remaining;
      const trialEnds =
        !offlineBilling && billing.trial_ends_at
          ? new Date(billing.trial_ends_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
          : null;
      const advancedAddon = Boolean(overview.rota_advanced_addon);
      const multiSiteAddon = Boolean(overview.rota_multi_site_addon);
      const aiDocumentAddon = Boolean(overview.ai_document_addon);
      const aiDocumentPrice =
        overview.ai_document_addon_monthly_gbp != null && overview.ai_document_addon_monthly_gbp !== ""
          ? Number(overview.ai_document_addon_monthly_gbp).toFixed(2)
          : "10.00";
      const crmAddon = Boolean(overview.crm_addon);
      const crmAddonPrice =
        overview.crm_addon_monthly_gbp != null && overview.crm_addon_monthly_gbp !== ""
          ? Number(overview.crm_addon_monthly_gbp).toFixed(2)
          : "10.00";

      host.innerHTML = `
        <div class="settings-billing-summary">
          <div class="settings-billing-row"><span class="muted">Current plan</span><strong>${escapeHtml(planName)}</strong></div>
          <div class="settings-billing-row"><span class="muted">Status</span><strong>${escapeHtml(String(status).replace(/_/g, " "))}</strong></div>
          ${offlineBilling ? `<div class="settings-billing-row"><span class="muted">Billing</span><strong>Offline / invoice (managed by ShiftSwift)</strong></div>` : ""}
          ${trialEnds ? `<div class="settings-billing-row"><span class="muted">Trial ends</span><strong>${escapeHtml(trialEnds)}${trialDays != null ? ` (${escapeHtml(trialDays)} days left)` : ""}</strong></div>` : ""}
          <div class="settings-billing-row"><span class="muted">Employee limit</span><strong>${escapeHtml(overview.max_employees ?? billing.max_employees ?? "—")}</strong></div>
        </div>
        <div class="settings-billing-addons">
          <h4 class="settings-billing-addons__title">Add-ons</h4>
          <ul class="settings-billing-addons__list">
            <li class="settings-billing-addons__item">
              <span>Advanced rota</span>
              <span class="settings-billing-addons__pill ${advancedAddon ? "is-active" : "is-inactive"}">${advancedAddon ? "Active" : "Not enabled"}</span>
            </li>
            <li class="settings-billing-addons__item">
              <span>Multi-site rota</span>
              <span class="settings-billing-addons__pill ${multiSiteAddon ? "is-active" : "is-inactive"}">${multiSiteAddon ? "Active" : "Not enabled"}</span>
            </li>
            <li class="settings-billing-addons__item">
              <span>AI document assistant</span>
              <span class="settings-billing-addons__pill ${aiDocumentAddon ? "is-active" : "is-inactive"}">${aiDocumentAddon ? `Active · £${escapeHtml(aiDocumentPrice)}/mo` : `£${escapeHtml(aiDocumentPrice)}/mo — not enabled`}</span>
            </li>
            <li class="settings-billing-addons__item">
              <span>Sales CRM</span>
              <span class="settings-billing-addons__pill ${crmAddon ? "is-active" : "is-inactive"}">${crmAddon ? `Active · £${escapeHtml(crmAddonPrice)}/mo` : `£${escapeHtml(crmAddonPrice)}/mo — not enabled`}</span>
            </li>
          </ul>
          <p class="muted settings-billing-addons__note">Basic manual rota is included on all plans. Add-ons are enabled by ${escapeHtml(window.ShiftSwiftBrand?.appName || "ShiftSwift HR")} support until self-service billing is live — <a href="#" data-brand-support-mailto="Subscription add-on">request an add-on</a>.</p>
        </div>
        <div class="link-row settings-billing-actions">
          <button type="button" class="btn outline" data-settings-upgrade>Upgrade plan</button>
          <a class="btn ghost" href="./payment-terms.html" target="_blank" rel="noopener">Payment terms</a>
          <a class="btn ghost" href="#" data-brand-support-mailto="Billing enquiry">Contact billing</a>
        </div>
        <p class="muted settings-billing-note">Invoice history and self-service cancellation will appear here once Stripe live billing is enabled.</p>`;
      host.querySelector("[data-settings-upgrade]")?.addEventListener("click", startUpgrade);
      window.ShiftSwiftBrand?.applyBrandDom?.(host);
      host.dataset.ready = "true";
    } catch {
      host.innerHTML = `<p class="muted">Could not load billing details.</p>`;
    }
  }

  const NOTIFICATION_EVENTS = [
    { id: "rtw_expiry", label: "RTW expiry approaching", default: "email_push" },
    { id: "absence_day5", label: "Absence day-5 warning", default: "email" },
    { id: "absence_day9", label: "Absence day-9 alert", default: "email_sms" },
    { id: "rota_published", label: "Rota published", default: "email" },
    { id: "missed_punch_hr", label: "Missed clock-in (HR alert)", default: "email_push" },
    { id: "leave_request_hr", label: "New leave request (HR alert)", default: "email_push" },
    { id: "missed_punch_employee", label: "Missed clock-in (employee reminder)", default: "email" },
  ];

  const HR_PUSH_DELIVERY = [
    { value: "email_push", label: "Email + push alert" },
    { value: "email", label: "Email only" },
    { value: "push", label: "Push alert only" },
    { value: "off", label: "Off" },
  ];

  const HR_PUSH_EVENT_IDS = new Set(["missed_punch_hr", "leave_request_hr", "rtw_expiry"]);

  const SIGNIN_REMINDER_DELIVERY = [
    { value: "email_push", label: "Email + push alert" },
    { value: "email", label: "Email only" },
    { value: "push", label: "Push alert only" },
    { value: "off", label: "Off" },
  ];

  const OPENING_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  function collectOpeningHours(host) {
    const opening_hours = {};
    OPENING_DAY_KEYS.forEach((day) => {
      opening_hours[day] = {
        closed: Boolean(host.querySelector(`#settings-hours-${day}-closed`)?.checked),
        open: host.querySelector(`#settings-hours-${day}-open`)?.value || "09:00",
        close: host.querySelector(`#settings-hours-${day}-close`)?.value || "22:00",
      };
    });
    return opening_hours;
  }

  function renderOpeningHoursRows(schedule) {
    const hours = schedule?.opening_hours || {};
    const labels = schedule?.day_labels || {
      mon: "Monday",
      tue: "Tuesday",
      wed: "Wednesday",
      thu: "Thursday",
      fri: "Friday",
      sat: "Saturday",
      sun: "Sunday",
    };
    return OPENING_DAY_KEYS.map((day) => {
      const row = hours[day] || { closed: day === "sun", open: "09:00", close: "22:00" };
      return `
        <tr>
          <td>${escapeHtml(labels[day] || day)}</td>
          <td><input type="checkbox" id="settings-hours-${day}-closed" data-hours-day="${day}" ${row.closed ? "checked" : ""} aria-label="${escapeHtml(labels[day] || day)} closed" /></td>
          <td><input type="time" id="settings-hours-${day}-open" value="${escapeHtml(row.open || "09:00")}" ${row.closed ? "disabled" : ""} /></td>
          <td><input type="time" id="settings-hours-${day}-close" value="${escapeHtml(row.close || "22:00")}" ${row.closed ? "disabled" : ""} /></td>
        </tr>`;
    }).join("");
  }

  function syncSigninTimingFields(host) {
    const timing = host.querySelector("#settings-signin-reminder-timing")?.value || "fixed_hour";
    host.querySelector("#settings-signin-fixed-hour-wrap")?.toggleAttribute("hidden", timing !== "fixed_hour");
    host.querySelector("#settings-signin-before-open-wrap")?.toggleAttribute("hidden", timing !== "before_opening");
  }

  async function saveNotificationPreferences(host) {
    const preferences = {};
    host.querySelectorAll(".settings-notify-select").forEach((el) => {
      preferences[el.dataset.notifyId] = el.value;
    });
    const signinDelivery = host.querySelector("#settings-signin-reminder-delivery")?.value;
    if (signinDelivery) preferences.employee_signin_reminder = signinDelivery;
    const displayInput = host.querySelector("#settings-employee-display-name");
    const intervalRaw = host.querySelector("#settings-signin-reminder-interval")?.value;
    const hourRaw = host.querySelector("#settings-signin-reminder-hour")?.value;
    const payload = {
      preferences,
      employee_display_name: displayInput ? displayInput.value.trim() : "",
      business_timezone: host.querySelector("#settings-business-timezone")?.value,
      opening_hours: collectOpeningHours(host),
      shift_reminder_minutes_before: Number(host.querySelector("#settings-shift-reminder-before")?.value || 10),
      shift_end_reminder_minutes_before: Number(
        host.querySelector("#settings-shift-end-reminder-before")?.value || 10,
      ),
      missed_clock_in_early_minutes: Number(host.querySelector("#settings-missed-clock-early")?.value || 10),
      missed_clock_in_late_minutes: Number(host.querySelector("#settings-missed-clock-late")?.value || 30),
      missed_punch_alert_minutes: Number(host.querySelector("#settings-missed-punch-alert")?.value || 15),
      signin_reminder_timing: host.querySelector("#settings-signin-reminder-timing")?.value || "fixed_hour",
      signin_reminder_minutes_before_open: Number(
        host.querySelector("#settings-signin-minutes-before-open")?.value || 60,
      ),
    };
    if (intervalRaw) payload.signin_reminder_interval_days = Number(intervalRaw);
    if (hourRaw !== undefined && hourRaw !== "") payload.signin_reminder_hour_uk = Number(hourRaw);
    try {
      const saveRes = await apiFetch("/admin/notification-preferences", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.detail || "Save failed");
      showSettingsToast("Notification preferences saved ✓");
    } catch (error) {
      showSettingsToast(error.message || "Could not save preferences");
    }
  }

  function loadNotificationsPanel() {
    const host = document.getElementById("settings-notifications-content");
    if (!host || host.dataset.ready === "true") return;

    host.innerHTML = `<p class="muted">Loading notification preferences…</p>`;

    apiFetch("/admin/notification-preferences")
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        const events = (data?.events?.length ? data.events : NOTIFICATION_EVENTS).filter(
          (ev) => ev.id !== "employee_signin_reminder",
        );
        const prefs = data?.preferences || {};
        const signin = data?.signin_reminder || {};
        const schedule = data?.business_schedule || {};
        const signinDelivery = signin.delivery || prefs.employee_signin_reminder || "email_push";
        const signinInterval = signin.interval_days ?? 30;
        const signinHour = signin.hour_local ?? signin.hour_uk ?? 9;
        const signinTiming = signin.timing || schedule.signin_reminder_timing || "fixed_hour";
        const signinBeforeOpen = signin.minutes_before_open ?? schedule.signin_reminder_minutes_before_open ?? 60;
        const timezone = schedule.timezone || "Europe/London";
        const timezoneOptions = schedule.timezone_options || [
          { value: "Europe/London", label: "UK — London (GMT/BST)" },
        ];

        host.innerHTML = `
      <article class="card settings-notify-branding">
        <h4 class="hr-section-title">Employee notification name</h4>
        <p class="muted">Staff see your business name first in notification emails (sender and subject). ShiftSwift HR appears only as small secondary text. Leave blank to use your registered business name, or “Your employer” if that is not set.</p>
        <label class="edit-field settings-notify-branding__field">
          <span class="edit-label">Sender name shown to employees</span>
          <input type="text" id="settings-employee-display-name" maxlength="120" placeholder="Your employer" value="${escapeHtml(data?.employee_display_name || "")}" />
        </label>
        <p class="muted settings-notify-branding__hint" id="settings-employee-display-preview"></p>
      </article>
      <article class="card settings-business-schedule">
        <h4 class="hr-section-title">Business hours &amp; timezone</h4>
        <p class="muted">Set when your business is open. Sign-in reminders respect closed days. Clock alerts still follow each employee’s published rota shift times.</p>
        <label class="edit-field">
          <span class="edit-label">Business timezone</span>
          <select id="settings-business-timezone">
            ${timezoneOptions.map((opt) => `<option value="${escapeHtml(opt.value)}" ${timezone === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
          </select>
        </label>
        <div class="settings-opening-hours-wrap">
          <table class="data-table settings-opening-hours-table">
            <thead><tr><th>Day</th><th>Closed</th><th>Opens</th><th>Closes</th></tr></thead>
            <tbody>${renderOpeningHoursRows(schedule)}</tbody>
          </table>
        </div>
      </article>
      <article class="card settings-rota-reminders">
        <h4 class="hr-section-title">Rota shift reminders</h4>
        <p class="muted settings-rota-reminders__lead">Bell alerts and push notifications before each published shift starts and ends. Applies to all employees on the rota (platform jobs cron every 15 minutes).</p>
        <div class="settings-rota-reminders__grid">
          <label class="edit-field">
            <span class="edit-label">Before shift starts (minutes)</span>
            <input type="number" id="settings-shift-reminder-before" min="5" max="120" value="${Number(schedule.shift_reminder_minutes_before ?? 10)}" />
          </label>
          <label class="edit-field">
            <span class="edit-label">Before shift ends (minutes)</span>
            <input type="number" id="settings-shift-end-reminder-before" min="5" max="120" value="${Number(schedule.shift_end_reminder_minutes_before ?? 10)}" />
          </label>
        </div>
      </article>
      <article class="card settings-clock-reminders">
        <h4 class="hr-section-title">Clock-in reminders</h4>
        <p class="muted">Nudges when an employee has not clocked in after their shift starts (requires time clock).</p>
        <div class="settings-signin-reminder__grid">
          <label class="edit-field">
            <span class="edit-label">Missed clock-in — first nudge (minutes after start)</span>
            <input type="number" id="settings-missed-clock-early" min="5" max="120" value="${Number(schedule.missed_clock_in_early_minutes ?? 10)}" />
          </label>
          <label class="edit-field">
            <span class="edit-label">Missed clock-in — second nudge (minutes after start)</span>
            <input type="number" id="settings-missed-clock-late" min="10" max="180" value="${Number(schedule.missed_clock_in_late_minutes ?? 30)}" />
          </label>
          <label class="edit-field">
            <span class="edit-label">Missed clock-in — HR/email alert (minutes after start)</span>
            <input type="number" id="settings-missed-punch-alert" min="5" max="180" value="${Number(schedule.missed_punch_alert_minutes ?? 15)}" />
          </label>
        </div>
      </article>
      <article class="card settings-signin-reminder">
        <h4 class="hr-section-title">Employee sign-in reminder</h4>
        <p class="muted">Nudge staff who have not opened the employee portal recently. Only sent on days your business is open.</p>
        <div class="settings-signin-reminder__grid">
          <label class="edit-field">
            <span class="edit-label">Remind after</span>
            <select id="settings-signin-reminder-interval">
              ${[7, 14, 30, 60, 90].map((days) => `<option value="${days}" ${Number(signinInterval) === days ? "selected" : ""}>${days} days</option>`).join("")}
            </select>
          </label>
          <label class="edit-field">
            <span class="edit-label">When to send</span>
            <select id="settings-signin-reminder-timing">
              <option value="fixed_hour" ${signinTiming === "fixed_hour" ? "selected" : ""}>Fixed time each open day</option>
              <option value="before_opening" ${signinTiming === "before_opening" ? "selected" : ""}>Before opening time</option>
            </select>
          </label>
          <label class="edit-field" id="settings-signin-fixed-hour-wrap" ${signinTiming === "fixed_hour" ? "" : "hidden"}>
            <span class="edit-label">Send at (business timezone)</span>
            <select id="settings-signin-reminder-hour">
              ${Array.from({ length: 24 }, (_, hour) => `<option value="${hour}" ${Number(signinHour) === hour ? "selected" : ""}>${String(hour).padStart(2, "0")}:00</option>`).join("")}
            </select>
          </label>
          <label class="edit-field" id="settings-signin-before-open-wrap" ${signinTiming === "before_opening" ? "" : "hidden"}>
            <span class="edit-label">Minutes before opening</span>
            <input type="number" id="settings-signin-minutes-before-open" min="15" max="240" value="${Number(signinBeforeOpen)}" />
          </label>
          <label class="edit-field">
            <span class="edit-label">Delivery</span>
            <select id="settings-signin-reminder-delivery">
              ${SIGNIN_REMINDER_DELIVERY.map((opt) => `<option value="${opt.value}" ${signinDelivery === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
            </select>
          </label>
        </div>
      </article>
      <p class="muted">Choose how your organisation receives HR alerts.</p>
      <div class="settings-notify-table-wrap">
        <table class="data-table settings-notify-table">
          <thead><tr><th>Event</th><th>Delivery</th></tr></thead>
          <tbody>
            ${events.map((ev) => {
              const fallback = NOTIFICATION_EVENTS.find((item) => item.id === ev.id)?.default || "email";
              const current = prefs[ev.id] || fallback;
              if (HR_PUSH_EVENT_IDS.has(ev.id)) {
                return `
              <tr>
                <td>${escapeHtml(ev.label)}</td>
                <td>
                  <select class="settings-notify-select" data-notify-id="${escapeHtml(ev.id)}">
                    ${HR_PUSH_DELIVERY.map((opt) => `<option value="${opt.value}" ${current === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
                  </select>
                </td>
              </tr>`;
              }
              return `
              <tr>
                <td>${escapeHtml(ev.label)}</td>
                <td>
                  <select class="settings-notify-select" data-notify-id="${escapeHtml(ev.id)}">
                    <option value="email" ${current === "email" ? "selected" : ""}>Email</option>
                    <option value="email_sms" ${current === "email_sms" ? "selected" : ""}>Email + SMS</option>
                    <option value="off" ${current === "off" ? "selected" : ""}>Off</option>
                  </select>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <p class="muted settings-notify-foot">Rota publish emails also require the “Notify staff by email” checkbox when publishing.</p>`;

        host.querySelectorAll(".settings-notify-select").forEach((select) => {
          select.addEventListener("change", () => {
            void saveNotificationPreferences(host);
          });
        });
        host.querySelector("#settings-signin-reminder-interval")?.addEventListener("change", () => {
          void saveNotificationPreferences(host);
        });
        host.querySelector("#settings-signin-reminder-hour")?.addEventListener("change", () => {
          void saveNotificationPreferences(host);
        });
        host.querySelector("#settings-signin-reminder-delivery")?.addEventListener("change", () => {
          void saveNotificationPreferences(host);
        });
        host.querySelector("#settings-signin-reminder-timing")?.addEventListener("change", () => {
          syncSigninTimingFields(host);
          void saveNotificationPreferences(host);
        });
        host.querySelector("#settings-business-timezone")?.addEventListener("change", () => {
          void saveNotificationPreferences(host);
        });
        [
          "#settings-shift-reminder-before",
          "#settings-missed-clock-early",
          "#settings-missed-clock-late",
          "#settings-missed-punch-alert",
          "#settings-signin-minutes-before-open",
        ].forEach((selector) => {
          host.querySelector(selector)?.addEventListener("change", () => {
            void saveNotificationPreferences(host);
          });
        });
        OPENING_DAY_KEYS.forEach((day) => {
          host.querySelector(`#settings-hours-${day}-closed`)?.addEventListener("change", (event) => {
            const closed = event.target.checked;
            host.querySelector(`#settings-hours-${day}-open`)?.toggleAttribute("disabled", closed);
            host.querySelector(`#settings-hours-${day}-close`)?.toggleAttribute("disabled", closed);
            void saveNotificationPreferences(host);
          });
          host.querySelector(`#settings-hours-${day}-open`)?.addEventListener("change", () => {
            void saveNotificationPreferences(host);
          });
          host.querySelector(`#settings-hours-${day}-close`)?.addEventListener("change", () => {
            void saveNotificationPreferences(host);
          });
        });
        syncSigninTimingFields(host);

        const displayInput = host.querySelector("#settings-employee-display-name");
        const preview = host.querySelector("#settings-employee-display-preview");
        const updatePreview = () => {
          const value = displayInput?.value.trim();
          const shown = value || data?.tenant_trading_name || data?.employee_display_name_default || "Your employer";
          if (preview) {
            preview.textContent = `Preview — From: ${shown} · Subject: ${shown} — Your rota for Mon 10 – Sun 16 Jun 2026`;
          }
        };
        updatePreview();
        displayInput?.addEventListener("input", updatePreview);
        displayInput?.addEventListener("change", () => {
          void saveNotificationPreferences(host);
        });

        host.dataset.ready = "true";
      })
      .catch(() => {
        host.innerHTML = `<p class="muted">Could not load notification preferences.</p>`;
      });
  }

  const ROTA_WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  function rotaTemplateDayOptions(weekStartDay = 0) {
    const start = Number.isFinite(Number(weekStartDay)) ? Number(weekStartDay) : 0;
    return Array.from({ length: 7 }, (_, i) => {
      const idx = (start + i) % 7;
      return { value: i + 1, label: ROTA_WEEKDAY_NAMES[idx] };
    });
  }

  const ROTA_DAY_OPTIONS = rotaTemplateDayOptions(0);

  function rotaReadinessStatusLabel(status) {
    if (status === "ok") return "Complete";
    if (status === "error") return "Action needed";
    if (status === "warn") return "Recommended";
    return "Optional";
  }

  function renderRotaReadinessHtml(readiness) {
    if (!readiness?.items?.length) {
      return `<article class="card settings-rota-readiness settings-rota-readiness--loading"><p class="muted">Rota readiness checklist unavailable.</p></article>`;
    }
    const readyClass = readiness.ready ? " settings-rota-readiness--ready" : "";
    const itemsHtml = readiness.items
      .map((item) => {
        const action = item.action_href
          ? `<a class="settings-rota-readiness__action" href="${escapeHtml(item.action_href)}">${escapeHtml(item.action_text || "Open")}</a>`
          : "";
        return `<li class="settings-rota-readiness__item settings-rota-readiness__item--${escapeHtml(item.status || "warn")}">
          <div class="settings-rota-readiness__item-head">
            <span class="settings-rota-readiness__status">${escapeHtml(rotaReadinessStatusLabel(item.status))}</span>
            <strong>${escapeHtml(item.title || "")}</strong>
          </div>
          <p class="muted settings-rota-readiness__message">${escapeHtml(item.message || "")}</p>
          ${action}
        </li>`;
      })
      .join("");
    return `<article class="card settings-rota-readiness${readyClass}" id="settings-rota-readiness" aria-labelledby="settings-rota-readiness-title">
      <div class="settings-rota-readiness__head">
        <div>
          <h4 id="settings-rota-readiness-title">Rota readiness</h4>
          <p class="muted settings-rota-readiness__summary">${escapeHtml(readiness.summary || "")}${readiness.ready ? " · ready to build" : ""}</p>
        </div>
        <a class="btn ghost" href="#rota">Open Rota</a>
      </div>
      <ul class="settings-rota-readiness__list">${itemsHtml}</ul>
    </article>`;
  }

  async function refreshRotaReadiness(container) {
    if (!container) return;
    try {
      const res = await apiFetch("/admin/rota/readiness");
      if (!res.ok) throw new Error("load failed");
      const readiness = await res.json();
      container.outerHTML = renderRotaReadinessHtml(readiness);
      window.ShiftSwiftBrand?.applyBrandDom?.(document.getElementById("settings-rota-readiness"));
    } catch {
      container.innerHTML = '<p class="muted">Could not refresh rota readiness.</p>';
    }
  }

  let settingsRotaWeekStartDay = 0;

  function rotaRequirementRowHtml(req = {}, index = 0, weekStartDay = settingsRotaWeekStartDay) {
    const dayOptions = rotaTemplateDayOptions(weekStartDay);
    return `
      <tr data-req-row="${index}">
        <td>
          <select data-req-day>
            ${dayOptions.map(
              (day) =>
                `<option value="${day.value}" ${Number(req.day_of_week) === day.value ? "selected" : ""}>${day.label}</option>`
            ).join("")}
          </select>
        </td>
        <td><input type="time" data-req-start value="${escapeHtml((req.start_time || "09:00").slice(0, 5))}" step="1800" /></td>
        <td><input type="time" data-req-end value="${escapeHtml((req.end_time || "17:00").slice(0, 5))}" step="1800" /></td>
        <td><input type="text" data-req-role value="${escapeHtml(req.role_label || "")}" placeholder="e.g. Floor" maxlength="80" /></td>
        <td><input type="number" data-req-min min="1" max="50" value="${escapeHtml(String(req.min_staff || 1))}" /></td>
        <td><button type="button" class="btn ghost" data-req-remove aria-label="Remove row">×</button></td>
      </tr>`;
  }

  function readRequirementRows(table) {
    return Array.from(table.querySelectorAll("[data-req-row]")).map((row) => ({
      day_of_week: Number(row.querySelector("[data-req-day]")?.value || 1),
      start_time: String(row.querySelector("[data-req-start]")?.value || "09:00").slice(0, 5),
      end_time: String(row.querySelector("[data-req-end]")?.value || "17:00").slice(0, 5),
      role_label: String(row.querySelector("[data-req-role]")?.value || "").trim(),
      min_staff: Number(row.querySelector("[data-req-min]")?.value || 1),
    }));
  }

  async function renderRotaTemplatesEditor(container, advancedEnabled) {
    if (!container) return;
    if (!advancedEnabled) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = `<p class="muted">Loading staffing templates…</p>`;
    try {
      const res = await apiFetch("/admin/rota/templates");
      const data = res.ok ? await res.json() : { items: [] };
      const items = data.items || [];

      container.innerHTML = `
        <div class="settings-rota-templates">
          <h4>Staffing templates</h4>
          <p class="muted">Define required staff by day, time band, and role. Coverage gaps and generate draft use the default template.</p>
          ${
            items.length
              ? `<ul class="settings-rota-template-list">${items
                  .map(
                    (item) =>
                      `<li class="settings-rota-template-list__item"><button type="button" class="btn ghost" data-edit-template="${item.id}">${escapeHtml(item.name)}</button>${item.is_default ? " <span class=\"muted\">(default)</span>" : ""} · ${item.requirement_count} slot${item.requirement_count === 1 ? "" : "s"}<button type="button" class="btn ghost settings-rota-template-delete" data-delete-template="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">Delete</button></li>`
                  )
                  .join("")}</ul>`
              : `<p class="muted">No templates yet — create your first weekly pattern below.</p>`
          }
          <div class="settings-rota-template-form" id="settings-rota-template-form">
            <h5 id="settings-rota-template-form-title">New template</h5>
            <label class="edit-field">Template name<input type="text" id="settings-rota-template-name" maxlength="120" placeholder="e.g. Weekday shop floor" /></label>
            <label class="signup-check"><input type="checkbox" id="settings-rota-template-default" /> <span>Set as default template</span></label>
            <div class="table-wrap">
              <table class="data-table settings-rota-req-table">
                <thead>
                  <tr><th>Day</th><th>Start</th><th>End</th><th>Role</th><th>Min staff</th><th></th></tr>
                </thead>
                <tbody id="settings-rota-req-body">
                  ${rotaRequirementRowHtml({ day_of_week: 1, start_time: "09:00", end_time: "17:00", role_label: "Floor", min_staff: 2 })}
                </tbody>
              </table>
            </div>
            <div class="settings-form-actions">
              <button type="button" class="btn ghost" id="settings-rota-req-add">+ Add slot</button>
              <button type="button" class="btn outline" id="settings-rota-template-save">Save template</button>
              <button type="button" class="btn ghost" id="settings-rota-template-cancel" hidden>Cancel edit</button>
            </div>
            <p class="muted" id="settings-rota-template-status" aria-live="polite"></p>
          </div>
        </div>`;

      let editingTemplateId = null;
      const reqBody = document.getElementById("settings-rota-req-body");
      const statusEl = document.getElementById("settings-rota-template-status");
      const titleEl = document.getElementById("settings-rota-template-form-title");
      const cancelBtn = document.getElementById("settings-rota-template-cancel");

      function resetTemplateForm() {
        editingTemplateId = null;
        if (titleEl) titleEl.textContent = "New template";
        document.getElementById("settings-rota-template-name").value = "";
        document.getElementById("settings-rota-template-default").checked = !items.length;
        if (reqBody) {
          reqBody.innerHTML = rotaRequirementRowHtml({
            day_of_week: 1,
            start_time: "09:00",
            end_time: "17:00",
            role_label: "Floor",
            min_staff: 2,
          });
        }
        if (cancelBtn) cancelBtn.hidden = true;
      }

      function bindRequirementRowEvents() {
        reqBody?.querySelectorAll("[data-req-remove]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const rows = reqBody.querySelectorAll("[data-req-row]");
            if (rows.length <= 1) return;
            btn.closest("[data-req-row]")?.remove();
          });
        });
      }
      bindRequirementRowEvents();

      document.getElementById("settings-rota-req-add")?.addEventListener("click", () => {
        if (!reqBody) return;
        const index = reqBody.querySelectorAll("[data-req-row]").length;
        reqBody.insertAdjacentHTML("beforeend", rotaRequirementRowHtml({ day_of_week: 1, start_time: "09:00", end_time: "17:00", role_label: "Bar", min_staff: 1 }, index));
        bindRequirementRowEvents();
      });

      container.querySelectorAll("[data-edit-template]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const templateId = Number(btn.getAttribute("data-edit-template"));
          try {
            const detailRes = await apiFetch(`/admin/rota/templates/${templateId}`);
            const template = await detailRes.json();
            if (!detailRes.ok) throw new Error(template.detail || "Could not load template");
            editingTemplateId = templateId;
            if (titleEl) titleEl.textContent = `Edit template — ${template.name}`;
            document.getElementById("settings-rota-template-name").value = template.name || "";
            document.getElementById("settings-rota-template-default").checked = Boolean(template.is_default);
            if (reqBody) {
              reqBody.innerHTML = (template.requirements || []).length
                ? template.requirements.map((req, index) => rotaRequirementRowHtml(req, index)).join("")
                : rotaRequirementRowHtml({}, 0);
              bindRequirementRowEvents();
            }
            if (cancelBtn) cancelBtn.hidden = false;
          } catch (error) {
            if (statusEl) statusEl.textContent = error.message || "Could not load template";
          }
        });
      });

      container.querySelectorAll("[data-delete-template]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const templateId = Number(btn.getAttribute("data-delete-template"));
          const templateName = btn.closest(".settings-rota-template-list__item")?.querySelector("[data-edit-template]")?.textContent?.trim();
          const label = templateName || "this template";
          if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
          if (statusEl) statusEl.textContent = "Deleting template…";
          try {
            const deleteRes = await apiFetch(`/admin/rota/templates/${templateId}`, { method: "DELETE" });
            if (!deleteRes.ok) {
              const deleteData = await deleteRes.json();
              throw new Error(deleteData.detail?.message || deleteData.detail || "Delete failed");
            }
            showSettingsToast("Staffing template deleted");
            if (editingTemplateId === templateId) {
              resetTemplateForm();
            }
            const panelHost = document.getElementById("settings-rota-content");
            if (panelHost) panelHost.dataset.ready = "false";
            await loadRotaPanel(true);
          } catch (error) {
            if (statusEl) statusEl.textContent = error.message || "Could not delete template";
          }
        });
      });

      cancelBtn?.addEventListener("click", () => {
        resetTemplateForm();
        if (statusEl) statusEl.textContent = "";
      });

      document.getElementById("settings-rota-template-save")?.addEventListener("click", async () => {
        const name = document.getElementById("settings-rota-template-name")?.value?.trim();
        const isDefault = Boolean(document.getElementById("settings-rota-template-default")?.checked);
        const requirements = readRequirementRows(reqBody);
        if (!name) {
          if (statusEl) statusEl.textContent = "Template name is required";
          return;
        }
        if (statusEl) statusEl.textContent = "Saving template…";
        try {
          const payload = { name, is_default: isDefault, requirements };
          const saveRes = editingTemplateId
            ? await apiFetch(`/admin/rota/templates/${editingTemplateId}`, { method: "PUT", body: JSON.stringify(payload) })
            : await apiFetch("/admin/rota/templates", { method: "POST", body: JSON.stringify(payload) });
          const saveData = await saveRes.json();
          if (!saveRes.ok) throw new Error(saveData.detail?.message || saveData.detail || "Save failed");
          showSettingsToast("Staffing template saved ✓");
          const panelHost = document.getElementById("settings-rota-content");
          if (panelHost) panelHost.dataset.ready = "false";
          await loadRotaPanel(true);
        } catch (error) {
          if (statusEl) statusEl.textContent = error.message || "Could not save template";
        }
      });
    } catch {
      container.innerHTML = `<p class="muted">Could not load staffing templates.</p>`;
    }
  }

  async function loadRotaPanel(force = false) {
    const host = document.getElementById("settings-rota-content");
    if (!host || (host.dataset.ready === "true" && !force)) return;

    host.innerHTML = `<p class="muted">Loading rota settings…</p>`;

    try {
      const [profileRes, overviewRes, readinessRes] = await Promise.all([
        apiFetch("/admin/tenant-profile"),
        apiFetch("/admin/overview"),
        apiFetch("/admin/rota/readiness"),
      ]);
      const profile = profileRes.ok ? await profileRes.json() : {};
      const overview = overviewRes.ok ? await overviewRes.json() : {};
      const readiness = readinessRes.ok ? await readinessRes.json() : null;
      const options = overview.rota_mode_options || profile.rota_mode_options || ["basic"];
      const modeLabels = overview.rota_mode_labels || window.Admin?.tenantFeatures?.rota_mode_labels || {};
      const allModes = overview.rota_modes_all || window.Admin?.tenantFeatures?.rota_modes_all || ["basic", "advanced", "multi_site"];
      const current = profile.rota_mode_preference ?? overview.rota_mode ?? profile.rota_mode ?? "basic";
      settingsRotaWeekStartDay = profile.rota_week_start_day ?? overview.rota_week_start_day ?? 0;
      const planName = overview.plan_display_name || "Starter";
      const supportMailto = window.ShiftSwiftBrand?.supportMailto?.("Advanced rota add-on") || "#";

      host.innerHTML = `
        ${renderRotaReadinessHtml(readiness)}
        <p class="muted">Basic manual rota (weekly grid, copy week, publish, attendance) is included on your <strong>${escapeHtml(planName)}</strong> plan.</p>
        <p class="muted">Advanced scheduling and multi-site rota are <strong>paid add-ons</strong> — pricing to be confirmed. Contact <a href="${escapeHtml(supportMailto)}">support</a> to enable them on your account.</p>
        <label class="edit-field">
          Week starts on
          <select id="settings-rota-week-start-day">
            ${ROTA_WEEKDAY_NAMES.map(
              (name, idx) =>
                `<option value="${idx}" ${Number(settingsRotaWeekStartDay) === idx ? "selected" : ""}>${escapeHtml(name)}</option>`
            ).join("")}
          </select>
        </label>
        <p class="muted">Your rota and timesheet weeks run for seven days from this day. Restaurants often use Tuesday or Wednesday.</p>
        <label class="edit-field">
          Scheduling mode
          <select id="settings-rota-mode-select">
            ${allModes.map((mode) => {
              const allowed = options.includes(mode);
              const selected = mode === current ? "selected" : "";
              const label = modeLabels[mode] || mode;
              const suffix = allowed ? "" : mode === "basic" ? "" : " (add-on required)";
              return `<option value="${escapeHtml(mode)}" ${selected} ${allowed ? "" : "disabled"}>${escapeHtml(label)}${suffix}</option>`;
            }).join("")}
          </select>
        </label>
        <p class="muted settings-rota-addon-status" id="settings-rota-addon-status"></p>
        <p class="muted settings-rota-foot" id="settings-rota-mode-help"></p>
        <p class="muted" id="settings-rota-status" aria-live="polite"></p>
        <div id="settings-rota-templates-wrap"></div>`;

      const help = document.getElementById("settings-rota-mode-help");
      const statusLine = document.getElementById("settings-rota-status");
      const addonStatus = document.getElementById("settings-rota-addon-status");
      const select = document.getElementById("settings-rota-mode-select");
      const weekStartSelect = document.getElementById("settings-rota-week-start-day");

      if (addonStatus) {
        const bits = [];
        if (overview.rota_advanced_addon) bits.push("Advanced rota add-on active");
        if (overview.rota_multi_site_addon) bits.push("Multi-site rota add-on active");
        addonStatus.textContent = bits.length ? bits.join(" · ") : "No rota add-ons enabled on this account yet.";
      }

      function updateHelp() {
        const mode = select?.value || "basic";
        if (mode === "basic") {
          help.textContent = "Build rotas manually on the weekly grid. Staff see published shifts in the Time Clock app.";
        } else if (mode === "advanced") {
          help.textContent = "Use staffing templates, coverage gaps, hours warnings, and generate draft on the Rota page.";
        } else {
          help.textContent = "Multi-site rota mode — per-location rotas will roll out here.";
        }
      }
      updateHelp();

      weekStartSelect?.addEventListener("change", async () => {
        const day = Number(weekStartSelect.value);
        if (!Number.isFinite(day) || day < 0 || day > 6) return;
        if (statusLine) statusLine.textContent = "Saving week start day…";
        try {
          const saveRes = await apiFetch("/admin/tenant-profile", {
            method: "PATCH",
            body: JSON.stringify({ rota_week_start_day: day }),
          });
          const saveData = await saveRes.json();
          if (!saveRes.ok) throw new Error(saveData.detail || "Save failed");
          settingsRotaWeekStartDay = day;
          showSettingsToast("Rota week start day saved ✓");
          if (statusLine) statusLine.textContent = "";
          await window.Admin.loadTenantFeatures();
          window.dispatchEvent(new CustomEvent("admin:features-refresh"));
          await renderRotaTemplatesEditor(
            document.getElementById("settings-rota-templates-wrap"),
            select?.value === "advanced" || select?.value === "multi_site"
          );
        } catch (error) {
          if (statusLine) statusLine.textContent = error.message || "Could not save week start day";
          showSettingsToast(error.message || "Could not save week start day");
        }
      });

      select?.addEventListener("change", async () => {
        updateHelp();
        const mode = select.value;
        if (!options.includes(mode)) return;
        if (statusLine) statusLine.textContent = "Saving…";
        try {
          const saveRes = await apiFetch("/admin/tenant-profile", {
            method: "PATCH",
            body: JSON.stringify({ rota_mode: mode }),
          });
          const saveData = await saveRes.json();
          if (!saveRes.ok) throw new Error(saveData.detail || "Save failed");
          showSettingsToast("Rota scheduling mode saved ✓");
          if (statusLine) statusLine.textContent = "";
          await window.Admin.loadTenantFeatures();
          window.dispatchEvent(new CustomEvent("admin:features-refresh"));
          await renderRotaTemplatesEditor(
            document.getElementById("settings-rota-templates-wrap"),
            select.value === "advanced" || select.value === "multi_site"
          );
          await refreshRotaReadiness(document.getElementById("settings-rota-readiness"));
        } catch (error) {
          if (statusLine) statusLine.textContent = error.message || "Could not save rota mode";
          showSettingsToast(error.message || "Could not save rota mode");
        }
      });

      await renderRotaTemplatesEditor(
        document.getElementById("settings-rota-templates-wrap"),
        Boolean(overview.rota_advanced_addon) && (current === "advanced" || current === "multi_site")
      );

      window.ShiftSwiftBrand?.applyBrandDom?.(host);
      host.dataset.ready = "true";
    } catch {
      host.innerHTML = `<p class="muted">Could not load rota settings.</p>`;
    }
  }

  function loadUsersPanel() {
    const host = document.getElementById("settings-users-content");
    if (!host || host.dataset.ready === "true") return;
    const username = localStorage.getItem("username") || "Admin";
    const role = localStorage.getItem("userRole") || "hr";
    const tenantId = window.Admin?.TENANT_ID || localStorage.getItem("tenantId") || "—";
    const roleLabel = role === "admin" ? "Platform admin" : role === "hr" ? "HR admin" : role;

    host.innerHTML = `
      <p class="muted">People who can sign in to this ShiftSwift HR workspace.</p>
      <p class="muted">Workspace ID <strong>#${escapeHtml(tenantId)}</strong> · your sign-in email is your HR username.</p>
      <div class="settings-user-card">
        <div class="settings-user-card__main">
          <strong>${escapeHtml(username)}</strong>
          <span class="settings-user-badge">Owner</span>
        </div>
        <span class="muted">${escapeHtml(roleLabel)} · you</span>
      </div>
      <div class="settings-form-actions">
        <a class="btn outline" href="#" data-brand-support-mailto="Invite manager to ShiftSwift HR">Invite manager</a>
      </div>
      <p class="muted">Multi-user roles and manager invites are set up by support. Email us to add HR managers or site leads.</p>`;
    window.ShiftSwiftBrand?.applyBrandDom?.(host);
    host.dataset.ready = "true";
  }

  async function loadSecurityPanel() {
    const host = document.getElementById("settings-security-content");
    if (!host) return;

    async function mfaAuthFetch(path, options = {}) {
      const token = localStorage.getItem("token");
      const response = await fetch(`${window.Admin.API_BASE}${path}`, {
        ...options,
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
          "X-Tenant-Id": window.Admin.TENANT_ID || "",
          ...(options.headers || {}),
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : data.message || "Request failed");
      return data;
    }

    let status;
    try {
      status = await mfaAuthFetch("/auth/mfa/status");
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load MFA status.")}</p>`;
      return;
    }

    const enabled = Boolean(status.mfa_enabled);
    const required = Boolean(status.policy_required);
    host.innerHTML = `
      <div class="settings-security-summary">
        <p><strong>Status:</strong> ${enabled ? "Two-factor authentication is ON" : "Not enabled yet"}</p>
        <p class="muted">${required ? "Your organisation requires authenticator app codes at sign-in." : "You can optionally enable an authenticator app for extra security."}</p>
      </div>
      <div id="settings-mfa-setup-block" ${enabled ? "hidden" : ""}>
        <h4>Set up authenticator</h4>
        <p class="muted">Use Google Authenticator, Authy, or Microsoft Authenticator.</p>
        <button type="button" class="btn outline" id="settings-mfa-start">Generate QR code</button>
        <div id="settings-mfa-qr-area" hidden>
          <div class="mfa-enrollment-qr-wrap"><img id="settings-mfa-qr" alt="Authenticator QR code" width="180" height="180" /></div>
          <p class="muted">Manual key: <code id="settings-mfa-secret"></code></p>
          <label class="edit-field">Verification code<input type="text" id="settings-mfa-code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="123456" /></label>
          <button type="button" class="btn" id="settings-mfa-enable">Enable two-factor authentication</button>
        </div>
      </div>
      <div id="settings-mfa-disable-block" ${enabled ? "" : "hidden"}>
        <h4>Turn off two-factor authentication</h4>
        ${required ? '<p class="muted">Required by policy — contact platform support if you need an exception.</p>' : ""}
        <label class="edit-field">Password<input type="password" id="settings-mfa-disable-password" autocomplete="current-password" /></label>
        <label class="edit-field">Authenticator code<input type="text" id="settings-mfa-disable-code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" /></label>
        <button type="button" class="btn ghost" id="settings-mfa-disable" ${required ? "disabled" : ""}>Disable two-factor authentication</button>
      </div>
      <p class="muted" id="settings-mfa-status-line" aria-live="polite"></p>`;

    const statusLine = document.getElementById("settings-mfa-status-line");
    document.getElementById("settings-mfa-start")?.addEventListener("click", async () => {
      try {
        const setup = await mfaAuthFetch("/auth/mfa/setup", { method: "POST", body: "{}" });
        const qrArea = document.getElementById("settings-mfa-qr-area");
        const qrImg = document.getElementById("settings-mfa-qr");
        const secretEl = document.getElementById("settings-mfa-secret");
        if (secretEl) secretEl.textContent = setup.manual_secret || "";
        if (qrImg && setup.otpauth_uri) {
          qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setup.otpauth_uri)}`;
        }
        if (qrArea) qrArea.hidden = false;
      } catch (error) {
        if (statusLine) statusLine.textContent = error.message;
      }
    });

    document.getElementById("settings-mfa-enable")?.addEventListener("click", async () => {
      const code = document.getElementById("settings-mfa-code")?.value?.trim();
      if (!code) return;
      try {
        await mfaAuthFetch("/auth/mfa/enable", { method: "POST", body: JSON.stringify({ code }) });
        showSettingsToast("Two-factor authentication enabled.");
        await loadSecurityPanel();
      } catch (error) {
        if (statusLine) statusLine.textContent = error.message;
      }
    });

    document.getElementById("settings-mfa-disable")?.addEventListener("click", async () => {
      const password = document.getElementById("settings-mfa-disable-password")?.value || "";
      const code = document.getElementById("settings-mfa-disable-code")?.value?.trim() || "";
      try {
        await mfaAuthFetch("/auth/mfa/disable", {
          method: "POST",
          body: JSON.stringify({ password, code }),
        });
        showSettingsToast("Two-factor authentication disabled.");
        await loadSecurityPanel();
      } catch (error) {
        if (statusLine) statusLine.textContent = error.message;
      }
    });
  }

  async function initSettingsSection() {
    mountSettingsHub();
    bindSettingsNavIcons();
    bindSettingsNav();
    bindUpgradeActions();
    try {
      await window.Admin.loadTenantFeatures();
      window.Admin.applyFeatureGates();
    } catch {
      /* optional */
    }
    applyGatedPanels();
    await loadPlanBadge();
    activateSettingsPanel(settingsPanelId());
  }

  function bootstrapSettingsSection() {
    if (sectionReady) {
      activateSettingsPanel(settingsPanelId());
      return;
    }
    sectionReady = true;
    void (async () => {
      try {
        await window.Admin.loadFormOptions();
      } catch {
        /* business profile can still load without metadata */
      }
      try {
        await initSettingsSection();
      } catch (error) {
        const host = document.getElementById("tenant-profile-form");
        if (host && !businessFormMounted()) {
          host.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load settings.")}</p>`;
        }
      }
    })();
  }

  window.addEventListener("admin:portal-native-retry", () => {
    if (parseHashPath(window.location.hash).baseSection === "settings") {
      bootstrapSettingsSection();
    }
  });

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "settings") {
      bootstrapSettingsSection();
    }
  });

  window.addEventListener("admin:features", () => {
    applyGatedPanels();
    const addonsHost = document.getElementById("settings-addons-content");
    if (addonsHost) {
      addonsHost.dataset.ready = "false";
      void loadAddonsPanel(true);
    }
  });

  if (parseHashPath(window.location.hash).baseSection === "settings") {
    bootstrapSettingsSection();
  }

  window.AdminSettings = { showSettingsToast, startUpgrade, bootstrapSettingsSection };
})();
