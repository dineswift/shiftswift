/** Settings workspace — left nav, plan badge, business profile, billing, notifications. */
(function initAdminSettings() {
  const { apiFetch, escapeHtml, isFeatureEnabled, parseHashPath, mountEditForm, FORM_SCHEMAS } = window.Admin;

  const PANELS = ["business", "documents", "billing", "notifications", "users", "security", "multisite", "api"];
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
    users: {
      title: "Users & access",
      subtitle: "People who can sign in to this ShiftSwift HR workspace.",
    },
    security: {
      title: "Security",
      subtitle: "Two-factor authentication for your HR admin sign-in.",
    },
    multisite: {
      title: "Multi-site",
      subtitle: "Manage staff and compliance across multiple locations.",
    },
    api: {
      title: "API access",
      subtitle: "Integrate ShiftSwift HR with external tools and systems.",
    },
  };
  const SAVED_AT_KEY = `settings_business_saved_${window.Admin?.TENANT_ID ?? "default"}`;

  let sectionReady = false;
  let settingsNavBound = false;

  function settingsPanelId() {
    const { path } = parseHashPath(window.location.hash || "#settings/business");
    const part = path.split("/")[1];
    return PANELS.includes(part) ? part : "business";
  }

  function showSettingsToast(message) {
    const toast = document.getElementById("settings-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.add("settings-toast--visible");
    window.clearTimeout(showSettingsToast._timer);
    showSettingsToast._timer = window.setTimeout(() => {
      toast.classList.remove("settings-toast--visible");
      window.setTimeout(() => {
        toast.hidden = true;
      }, 300);
    }, 3200);
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

  function activateSettingsPanel(panelId) {
    document.querySelectorAll("[data-settings-panel]").forEach((el) => {
      el.hidden = el.dataset.settingsPanel !== panelId;
    });
    document.querySelectorAll("[data-settings-nav]").forEach((btn) => {
      const active = btn.dataset.settingsNav === panelId;
      btn.classList.toggle("settings-nav__item--active", active);
      btn.setAttribute("aria-current", active ? "page" : "false");
    });
    const copy = PANEL_COPY[panelId] || PANEL_COPY.business;
    const titleEl = document.getElementById("settings-panel-title");
    const subtitleEl = document.getElementById("settings-panel-subtitle");
    if (titleEl) titleEl.textContent = copy.title;
    if (subtitleEl) subtitleEl.textContent = copy.subtitle;
    if (panelId === "business") {
      void loadBusinessPanel();
    }
    if (panelId === "security") {
      void loadSecurityPanel();
    }
  }

  function bindSettingsNav() {
    if (settingsNavBound) return;
    settingsNavBound = true;
    document.querySelectorAll("[data-settings-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = btn.dataset.settingsNav;
        window.location.hash = `settings/${panel}`;
        activateSettingsPanel(panel);
      });
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
    try {
      const [overviewRes, billingRes] = await Promise.all([
        apiFetch("/admin/overview"),
        apiFetch("/billing/status"),
      ]);
      let planName = "Starter";
      if (overviewRes.ok) {
        const overview = await overviewRes.json();
        planName = overview.plan_display_name || overview.subscription_plan || "Starter";
      } else if (billingRes.ok) {
        const billing = await billingRes.json();
        planName = (billing.subscription_plan || "starter").replace(/_/g, " ");
      }
      label.textContent = `${planName} plan · ${businessName}`;
    } catch {
      label.textContent = businessName;
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
      startUpgrade();
    });
    document.querySelectorAll("[data-settings-upgrade]").forEach((btn) => {
      btn.addEventListener("click", startUpgrade);
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
    try {
      const res = await apiFetch("/admin/tenant-profile");
      if (res.ok) values = await res.json();
    } catch {
      /* optional */
    }

    try {
      host.innerHTML = '<div id="tenant-profile-form-mount"></div><p id="tenant-profile-last-saved" class="settings-last-saved muted"></p>';
      const mountHost = document.getElementById("tenant-profile-form-mount");
      const savedAt = localStorage.getItem(SAVED_AT_KEY);
      updateLastSavedLabel(savedAt);

      mountEditForm(mountHost, FORM_SCHEMAS.tenantProfile, {
        values,
        onSubmit: async (payload) => {
          const res = await apiFetch("/admin/tenant-profile", {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "Update failed");
          const now = new Date().toISOString();
          localStorage.setItem(SAVED_AT_KEY, now);
          updateLastSavedLabel(now);
          showSettingsToast("Business details saved ✓");
          window.dispatchEvent(new CustomEvent("admin:tenant-profile-saved", { detail: data }));
        },
      });
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load business form.")}</p>`;
    }
  }

  async function loadBillingPanel() {
    const host = document.getElementById("settings-billing-content");
    if (!host || host.dataset.ready === "true") return;
    try {
      const [overviewRes, billingRes] = await Promise.all([
        apiFetch("/admin/overview"),
        apiFetch("/billing/status"),
      ]);
      const overview = overviewRes.ok ? await overviewRes.json() : {};
      const billing = billingRes.ok ? await billingRes.json() : {};
      const planName = overview.plan_display_name || "Starter";
      const status = billing.subscription_status || overview.subscription_status || "trial";
      const trialDays = billing.days_remaining;
      const trialEnds = billing.trial_ends_at
        ? new Date(billing.trial_ends_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : null;

      host.innerHTML = `
        <div class="settings-billing-summary">
          <div class="settings-billing-row"><span class="muted">Current plan</span><strong>${escapeHtml(planName)}</strong></div>
          <div class="settings-billing-row"><span class="muted">Status</span><strong>${escapeHtml(String(status).replace(/_/g, " "))}</strong></div>
          ${trialEnds ? `<div class="settings-billing-row"><span class="muted">Trial ends</span><strong>${escapeHtml(trialEnds)}${trialDays != null ? ` (${escapeHtml(trialDays)} days left)` : ""}</strong></div>` : ""}
          <div class="settings-billing-row"><span class="muted">Employee limit</span><strong>${escapeHtml(overview.max_employees ?? billing.max_employees ?? "—")}</strong></div>
        </div>
        <div class="link-row settings-billing-actions">
          <button type="button" class="btn outline" data-settings-upgrade>Upgrade plan</button>
          <a class="btn ghost" href="./payment-terms.html" target="_blank" rel="noopener">Payment terms</a>
          <a class="btn ghost" href="mailto:support@shiftswifthr.co.uk?subject=Billing%20enquiry">Contact billing</a>
        </div>
        <p class="muted settings-billing-note">Invoice history and self-service cancellation will appear here once Stripe live billing is enabled.</p>`;
      host.querySelector("[data-settings-upgrade]")?.addEventListener("click", startUpgrade);
      host.dataset.ready = "true";
    } catch {
      host.innerHTML = `<p class="muted">Could not load billing details.</p>`;
    }
  }

  const NOTIFICATION_EVENTS = [
    { id: "rtw_expiry", label: "RTW expiry approaching", default: "email" },
    { id: "absence_day5", label: "Absence day-5 warning", default: "email" },
    { id: "absence_day9", label: "Absence day-9 alert", default: "email_sms" },
    { id: "rota_published", label: "Rota published", default: "email" },
    { id: "missed_punch_hr", label: "Missed clock-in (HR alert)", default: "email" },
    { id: "missed_punch_employee", label: "Missed clock-in (employee reminder)", default: "email" },
  ];

  function loadNotificationsPanel() {
    const host = document.getElementById("settings-notifications-content");
    if (!host || host.dataset.ready === "true") return;

    host.innerHTML = `<p class="muted">Loading notification preferences…</p>`;

    apiFetch("/admin/notification-preferences")
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        const events = data?.events?.length ? data.events : NOTIFICATION_EVENTS;
        const prefs = data?.preferences || {};

        host.innerHTML = `
      <p class="muted">Choose how your organisation receives alerts. Employee emails respect each person's notification setting.</p>
      <div class="settings-notify-table-wrap">
        <table class="data-table settings-notify-table">
          <thead><tr><th>Event</th><th>Delivery</th></tr></thead>
          <tbody>
            ${events.map((ev) => {
              const fallback = NOTIFICATION_EVENTS.find((item) => item.id === ev.id)?.default || "email";
              const current = prefs[ev.id] || fallback;
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
          select.addEventListener("change", async () => {
            const preferences = {};
            host.querySelectorAll(".settings-notify-select").forEach((el) => {
              preferences[el.dataset.notifyId] = el.value;
            });
            try {
              const saveRes = await apiFetch("/admin/notification-preferences", {
                method: "PATCH",
                body: JSON.stringify({ preferences }),
              });
              const saveData = await saveRes.json();
              if (!saveRes.ok) throw new Error(saveData.detail || "Save failed");
              showSettingsToast("Notification preferences saved ✓");
            } catch (error) {
              showSettingsToast(error.message || "Could not save preferences");
            }
          });
        });

        host.dataset.ready = "true";
      })
      .catch(() => {
        host.innerHTML = `<p class="muted">Could not load notification preferences.</p>`;
      });
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
        <a class="btn outline" href="mailto:support@shiftswifthr.co.uk?subject=Invite%20manager%20to%20ShiftSwift%20HR">Invite manager</a>
      </div>
      <p class="muted">Multi-user roles and manager invites are managed by support during early access. Email us to add HR managers or site leads.</p>`;
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
    await loadBusinessPanel();
    await loadBillingPanel();
    loadNotificationsPanel();
    loadUsersPanel();
    loadSecurityPanel();
    if (window.AdminDocuments?.loadSettingsDocuments) {
      await window.AdminDocuments.loadSettingsDocuments();
    }
  }

  function bootstrapSettingsSection() {
    if (sectionReady) return;
    sectionReady = true;
    window.Admin.loadFormOptions()
      .then(initSettingsSection)
      .catch((error) => {
        const host = document.getElementById("tenant-profile-form");
        if (host && !businessFormMounted()) {
          host.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load settings.")}</p>`;
        }
      });
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "settings") {
      bootstrapSettingsSection();
      activateSettingsPanel(settingsPanelId());
    }
  });

  window.addEventListener("admin:features", () => {
    applyGatedPanels();
  });

  if (parseHashPath(window.location.hash).baseSection === "settings") {
    bootstrapSettingsSection();
  }

  window.AdminSettings = { showSettingsToast, startUpgrade };
})();
