(function () {
  const state = {
    tenants: [],
    overview: null,
    providerName: "Datasoftware Analytics Ltd",
    filter: "all",
    search: "",
    selectedId: null,
    selectedTenant: null,
    includeDeleted: false,
    excludeTest: false,
    section: "tenants",
    loading: true,
    provisionPlans: [],
  };

  const els = {
    metrics: document.getElementById("master-metrics"),
    filters: document.getElementById("master-filters"),
    search: document.getElementById("master-search"),
    tableBody: document.getElementById("master-table-body"),
    cardList: document.getElementById("master-card-list"),
    layout: document.getElementById("master-layout"),
    empty: document.getElementById("master-empty"),
    detail: document.getElementById("master-detail"),
    detailClose: document.getElementById("master-detail-close"),
    pageSub: document.getElementById("master-page-sub"),
    providerName: document.getElementById("master-provider-name"),
    userName: document.getElementById("master-user-name"),
    userAvatar: document.getElementById("master-user-avatar"),
    exportBtn: document.getElementById("master-export-btn"),
    sidebar: document.getElementById("master-sidebar"),
    overlay: document.getElementById("master-overlay"),
    menuBtn: document.getElementById("master-menu-btn"),
    sidebarClose: document.getElementById("master-sidebar-close"),
    includeDeleted: document.getElementById("master-include-deleted"),
    excludeTest: document.getElementById("master-exclude-test"),
    deleteSelectedBtn: document.getElementById("master-delete-selected-btn"),
  };

  function apiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    return localStorage.getItem("apiBaseUrl") || "http://localhost:3000";
  }

  function authHeaders(includeJsonBody = false) {
    const headers = {
      Authorization: `Bearer ${localStorage.getItem("token")}`,
    };
    if (includeJsonBody) headers["Content-Type"] = "application/json";
    return headers;
  }

  function parseApiError(data, fallback = "Request failed") {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((item) => (typeof item === "string" ? item : item.msg || item.message || String(item)))
        .join("; ");
    }
    if (typeof data.message === "string") return data.message;
    return fallback;
  }

  async function apiRequest(path, options = {}) {
    const hasBody = options.body !== undefined && options.body !== null;
    let response;
    try {
      response = await window.ShiftSwiftSession.fetchWithAuth(path, options, {
        apiBase: apiBase(),
        loginUrl: "./ops-9x7k2.html",
        forceLogoutOn401: false,
      });
    } catch (error) {
      const message = error?.message || "Network request failed";
      if (message === "Load failed" || message === "Failed to fetch") {
        throw new Error("Could not reach the API — check your connection, refresh the page, and try again.");
      }
      throw error;
    }

    if (response.status === 401) {
      window.ShiftSwiftMasterSession?.redirectToMasterLogin?.("Your master session expired. Sign in again.");
      throw new Error("Session expired. Sign in again.");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = parseApiError(data);
      if (
        response.status === 403 &&
        window.ShiftSwiftMasterSession?.isMasterAuthError?.(message)
      ) {
        window.ShiftSwiftMasterSession.redirectToMasterLogin(message);
      }
      throw new Error(message);
    }
    return data;
  }

  const apiGet = (path) => apiRequest(path);
  const apiPost = (path, body = {}) =>
    apiRequest(path, { method: "POST", body: JSON.stringify(body) });
  const apiPut = (path, body) => apiRequest(path, { method: "PUT", body: JSON.stringify(body) });

  function saveMasterReturnSession() {
    sessionStorage.setItem(
      "masterImpersonationReturn",
      JSON.stringify({
        token: localStorage.getItem("token"),
        refreshToken: localStorage.getItem("refreshToken"),
        userRole: localStorage.getItem("userRole"),
        tenantId: localStorage.getItem("tenantId"),
        masterTenantId: localStorage.getItem("masterTenantId"),
      })
    );
  }

  function applyImpersonationSession(data) {
    localStorage.setItem("token", data.access_token);
    localStorage.removeItem("refreshToken");
    localStorage.setItem("userRole", data.role || "hr");
    localStorage.setItem("tenantId", String(data.tenant_id));
    if (data.tenant_name) localStorage.setItem("businessName", data.tenant_name);
    sessionStorage.setItem(
      "impersonationActive",
      JSON.stringify({
        tenantId: data.tenant_id,
        tenantName: data.tenant_name,
        impersonatedBy: data.impersonated_by,
        expiresIn: data.expires_in,
      })
    );
  }

  async function impersonateTenant(tenant) {
    if (!tenant?.id || tenant.can_impersonate === false) return;
    const button = document.getElementById("detail-impersonate");
    if (button) {
      button.disabled = true;
      button.textContent = "Starting session…";
    }
    try {
      const data = await apiPost(`/master/tenants/${tenant.id}/impersonate`);
      saveMasterReturnSession();
      applyImpersonationSession(data);
      window.location.href = data.redirect_url || "./admin.html";
    } catch (error) {
      alert(error.message || "Impersonation failed");
      if (button) {
        button.disabled = tenant.can_impersonate !== false;
        button.textContent = "Impersonate this account";
      }
    }
  }

  function initials(name) {
    const parts = String(name || "Platform").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "OP";
    return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  }

  function formatMoney(value) {
    if (value == null) return "—";
    return `£${Number(value).toFixed(0)}`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function planBadgeClass(tier) {
    return `plan-badge plan-badge--${tier || "starter"}`;
  }

  function statusClass(status) {
    return `master-status master-status--${status || "trialing"}`;
  }

  function dotClass(tone) {
    return `master-dot master-dot--${tone || "muted"}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderKeyValueGrid(rows) {
    return `<dl class="master-kv-grid">${rows
      .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`)
      .join("")}</dl>`;
  }

  function tenantDeleteGuard(tenant) {
    if (!tenant) return { allowed: false, reason: "Select a tenant first" };
    if (tenant.deleted_at) return { allowed: false, reason: "Tenant is already deleted" };
    if (tenant.can_delete === false) {
      return {
        allowed: false,
        reason: tenant.delete_blocked_reason || "Suspend this account before deleting it",
      };
    }
    return { allowed: true, reason: null };
  }

  function syncDeleteSelectedButton() {
    if (!els.deleteSelectedBtn) return;
    const tenant = state.selectedTenant || state.tenants.find((row) => row.id === state.selectedId);
    if (!tenant) {
      els.deleteSelectedBtn.disabled = true;
      els.deleteSelectedBtn.title = "Select a tenant to delete";
      return;
    }
    const guard = tenantDeleteGuard(tenant);
    els.deleteSelectedBtn.disabled = !guard.allowed;
    els.deleteSelectedBtn.title = guard.reason || `Delete ${tenant.name}`;
  }

  async function deleteTenantWithConfirm(tenant) {
    const guard = tenantDeleteGuard(tenant);
    if (!guard.allowed) {
      window.alert(guard.reason);
      return;
    }
    const typed = window.prompt(
      `Type the business name to confirm delete:\n${tenant.name}\n\nPaying accounts must be suspended before deletion.`,
    );
    if (typed === null) return;
    try {
      await apiPost(`/master/tenants/${tenant.id}/delete`, { confirm_name: typed });
      closeDetail();
      await loadTenants();
    } catch (error) {
      window.alert(error.message);
    }
  }

  function renderMetrics() {
    const stats = state.overview || {};
    const cards = [
      { hero: true, label: "MRR", value: formatMoney(stats.mrr_gbp), valueClass: "master-metric__value--gold", sub: "" },
      { label: "Total tenants", value: stats.total_tenants ?? "0", sub: "Registered businesses" },
      { label: "Active (paying)", value: stats.active_paying ?? "0", sub: `${stats.conversion_rate_pct ?? 0}% conversion`, valueStyle: "color: var(--master-green)" },
      { label: "Trialing", value: stats.trialing ?? "0", sub: stats.avg_trial_days_remaining != null ? `Avg ${stats.avg_trial_days_remaining} days left` : "" },
      { label: "Suspended", value: stats.suspended ?? "0", sub: "Platform disabled" },
      { label: "Overdue", value: stats.overdue ?? "0", sub: `${stats.payment_failures ?? stats.overdue ?? 0} payment failures`, valueStyle: stats.overdue ? "color: var(--master-red)" : "" },
    ];
    if (!els.metrics) return;
    els.metrics.innerHTML = cards
      .map((card) => {
        const cls = card.hero ? "master-metric master-metric--hero" : "master-metric";
        const valueCls = card.valueClass ? ` ${card.valueClass}` : "";
        const valueStyle = card.valueStyle ? ` style="${card.valueStyle}"` : "";
        return `<article class="${cls}"><div class="master-metric__label">${card.label}</div><div class="master-metric__value${valueCls}"${valueStyle}>${card.value}</div><div class="master-metric__sub">${card.sub || ""}</div></article>`;
      })
      .join("");
  }

  function renderFilters() {
    const counts = state.overview?.counts || {};
    const tabs = [
      ["all", "All"],
      ["trialing", "Trialing"],
      ["active", "Active"],
      ["overdue", "Overdue"],
      ["suspended", "Suspended"],
      ["deleted", "Deleted"],
    ];
    if (!els.filters) return;
    els.filters.innerHTML = tabs
      .map(([key, label]) => {
        const count = counts[key] ?? 0;
        const active = state.filter === key ? " is-active" : "";
        return `<button type="button" class="master-filter${active}" data-filter="${key}">${label} (${count})</button>`;
      })
      .join("");
    els.filters.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.dataset.filter;
        loadTenants();
      });
    });
  }

  function tenantSubline(tenant) {
    const bits = [`#${tenant.id}`];
    if (tenant.billing_email) bits.push(tenant.billing_email);
    if (tenant.billing_mode === "offline") bits.push("offline");
    if (tenant.hr_login_email) bits.push(`login: ${tenant.hr_login_email}`);
    return bits.join(" · ");
  }

  function syncLayoutSplit() {
    if (els.layout) {
      els.layout.classList.toggle("master-layout--split", Boolean(state.selectedId && els.detail && !els.detail.hidden));
    }
  }

  function tenantIdentityBadge(tenant) {
    const tags = [];
    if (tenant.is_test_account) {
      tags.push(`<span class="master-tag master-tag--test">Test account</span>`);
    }
    if (tenant.duplicate_billing_email && tenant.is_canonical_tenant) {
      tags.push(`<span class="master-tag master-tag--primary">Primary account</span>`);
    }
    if (tenant.duplicate_billing_email && !tenant.is_canonical_tenant) {
      tags.push(`<span class="master-tag master-tag--warn">Duplicate trial</span>`);
    }
    return tags.join(" ");
  }

  function renderTable() {
    if (!els.tableBody) return;
    const rows = state.tenants;
    if (els.empty) els.empty.hidden = rows.length > 0;
    els.tableBody.innerHTML = rows
      .map((tenant) => {
        const selected = tenant.id === state.selectedId ? " is-selected" : "";
        const pickerClass = tenant.id === state.selectedId ? "master-row-picker is-checked" : "master-row-picker";
        return `<tr data-tenant-id="${tenant.id}" class="${selected.trim()}" aria-selected="${tenant.id === state.selectedId ? "true" : "false"}">
          <td class="master-col-select"><span class="${pickerClass}" aria-hidden="true"></span></td>
          <td><div class="master-business"><strong>${escapeHtml(tenant.name)}</strong> ${tenantIdentityBadge(tenant)}<span>${escapeHtml(tenantSubline(tenant))}</span></div></td>
          <td><span class="${planBadgeClass(tenant.plan_tier)}">${escapeHtml(tenant.plan_label)}</span></td>
          <td><span class="${statusClass(tenant.status)}">${escapeHtml(tenant.status)}</span></td>
          <td>${escapeHtml(formatDate(tenant.renewal_or_trial_date || tenant.trial_ends_at))}</td>
          <td>${escapeHtml(tenant.staff_label)}</td>
          <td>${escapeHtml(tenant.mrr_label)}</td>
          <td><span class="${dotClass(tenant.last_active?.tone)}"></span>${escapeHtml(tenant.last_active?.label || "—")}</td>
          <td><button type="button" class="master-view-link" data-view="${tenant.id}">View</button></td>
        </tr>`;
      })
      .join("");
    bindRowEvents(els.tableBody);
  }

  function renderCards() {
    if (!els.cardList) return;
    els.cardList.innerHTML = state.tenants
      .map((tenant) => {
        const selected = tenant.id === state.selectedId ? " is-selected" : "";
        return `<article class="master-card${selected}" data-tenant-id="${tenant.id}">
          <div class="master-card__head"><div><strong>${escapeHtml(tenant.name)}</strong> ${tenantIdentityBadge(tenant)}<div>${escapeHtml(tenantSubline(tenant))}</div><div>${escapeHtml(tenant.location)}</div></div>
          <div><span class="${planBadgeClass(tenant.plan_tier)}">${escapeHtml(tenant.plan_label)}</span> <span class="${statusClass(tenant.status)}">${escapeHtml(tenant.status)}</span></div></div>
          <div class="master-card__footer"><button type="button" class="master-view-link" data-view="${tenant.id}">View →</button></div>
        </article>`;
      })
      .join("");
    bindRowEvents(els.cardList);
  }

  function bindRowEvents(container) {
    container.querySelectorAll("[data-tenant-id], [data-view]").forEach((el) => {
      el.addEventListener("click", (event) => {
        if (event.target.closest("[data-view]")) event.stopPropagation();
        const id = Number(el.dataset.tenantId || el.dataset.view);
        if (id) selectTenant(id);
      });
    });
  }

  async function selectTenant(id) {
    state.selectedId = id;
    renderTable();
    renderCards();
    if (els.detail) els.detail.hidden = false;
    syncLayoutSplit();
    try {
      const data = await apiGet(`/master/tenants/${id}`);
      state.selectedTenant = data.tenant;
      renderDetail(data.tenant);
    } catch (error) {
      state.selectedTenant = state.tenants.find((row) => row.id === id);
      renderDetail(state.selectedTenant);
      console.error(error);
    }
    syncDeleteSelectedButton();
  }

  async function refreshSelectedTenant() {
    if (!state.selectedId) return;
    await selectTenant(state.selectedId);
    await loadTenants();
  }

  function renderDetail(tenant) {
    if (!tenant) return;
    document.getElementById("detail-name").textContent = tenant.name;
    const statusEl = document.getElementById("detail-status");
    statusEl.className = statusClass(tenant.status);
    statusEl.textContent = tenant.status;

    const active = tenant.employees_active || 0;
    const staffLimit = tenant.employees_limit || 0;
    const pct = staffLimit ? Math.min(100, Math.round((active / staffLimit) * 100)) : 0;

    document.getElementById("detail-grid").innerHTML = `
      ${tenant.hr_never_logged_in ? `<div class="master-detail-alert">HR account exists but has never signed in — check welcome email delivery and share the sign-up password.</div>` : ""}
      <div><dt>Tenant ID</dt><dd>#${tenant.id}${tenant.is_canonical_tenant === false ? " · duplicate trial" : tenant.duplicate_billing_email ? " · primary account for this email" : ""}${tenant.is_test_account ? " · test account" : ""}</dd></div>
      <div><dt>Location</dt><dd>${escapeHtml(tenant.location)}</dd></div>
      <div><dt>Billing email</dt><dd>${escapeHtml(tenant.billing_email || "—")}</dd></div>
      <div><dt>HR login</dt><dd>${escapeHtml(tenant.hr_login_email || "—")}</dd></div>
      <div><dt>Billing</dt><dd>${escapeHtml(tenant.billing_mode === "offline" ? "Offline / invoice" : "Stripe")} · ${escapeHtml(tenant.subscription_status || "—")}</dd></div>
      <div><dt>Billing notes</dt><dd>${escapeHtml(tenant.billing_notes || "—")}</dd></div>
      <div><dt>Platform access</dt><dd>${escapeHtml(tenant.platform_status || "active")}${tenant.deleted_at ? " · deleted" : ""}</dd></div>
      <div><dt>Plan</dt><dd>${escapeHtml(tenant.plan_label)} · ${escapeHtml(tenant.mrr_label)}</dd></div>
      <div><dt>Rota add-ons</dt><dd>${tenant.rota_advanced_addon ? "Advanced" : "—"}${tenant.rota_multi_site_addon ? " · Multi-site" : ""}${!tenant.rota_advanced_addon && !tenant.rota_multi_site_addon ? "None (basic manual rota only)" : ""}</dd></div>
      <div><dt>Employees</dt><dd>${active} active · ${tenant.employees_pending_portal || 0} portal pending
        <div class="master-staff-bar"><span style="width:${pct}%"></span></div><small>${escapeHtml(tenant.staff_label)}</small></dd></div>
      <div><dt>Last active</dt><dd>${escapeHtml(tenant.last_active?.label || "—")}</dd></div>`;

    document.getElementById("detail-modules").innerHTML = (tenant.modules || [])
      .map((mod) => `<span class="master-module-pill ${mod.active ? "is-active" : "is-inactive"}">${escapeHtml(mod.label)}</span>`)
      .join("");

    const notes = document.getElementById("detail-notes");
    if (notes) notes.value = tenant.internal_notes || "";

    const changePlanWrap = document.getElementById("detail-change-plan-wrap");
    if (changePlanWrap) changePlanWrap.hidden = true;

    const canImpersonate = tenant.can_impersonate !== false;
    const isDeleted = Boolean(tenant.deleted_at);
    const isSuspended = (tenant.platform_status || "") === "suspended" || tenant.status === "suspended";

    const impersonateBtn = document.getElementById("detail-impersonate");
    if (impersonateBtn) {
      impersonateBtn.disabled = !canImpersonate;
      impersonateBtn.textContent = "Impersonate this account";
      impersonateBtn.onclick = () => impersonateTenant(tenant);
    }

    const suspendBtn = document.getElementById("detail-suspend-toggle");
    if (suspendBtn) {
      suspendBtn.hidden = isDeleted;
      suspendBtn.textContent = isSuspended ? "Re-enable account" : "Suspend account";
      suspendBtn.onclick = async () => {
        const reason = !isSuspended ? window.prompt("Reason for suspension (optional):") : null;
        if (!isSuspended && reason === null) return;
        try {
          if (isSuspended) await apiPost(`/master/tenants/${tenant.id}/unsuspend`);
          else await apiPost(`/master/tenants/${tenant.id}/suspend`, { reason: reason || null });
          await refreshSelectedTenant();
        } catch (error) {
          alert(error.message);
        }
      };
    }

    const restoreBtn = document.getElementById("detail-restore-tenant");
    if (restoreBtn) {
      restoreBtn.hidden = !isDeleted;
      restoreBtn.onclick = async () => {
        if (!window.confirm(`Restore ${tenant.name}?`)) return;
        try {
          await apiPost(`/master/tenants/${tenant.id}/restore`);
          await refreshSelectedTenant();
        } catch (error) {
          alert(error.message);
        }
      };
    }

    const deleteBtn = document.getElementById("detail-delete-tenant");
    if (deleteBtn) {
      deleteBtn.hidden = isDeleted;
      const deleteGuard = tenantDeleteGuard(tenant);
      deleteBtn.disabled = !deleteGuard.allowed;
      deleteBtn.title = deleteGuard.reason || "";
      deleteBtn.onclick = () => deleteTenantWithConfirm(tenant);
    }

    const deleteHint = document.getElementById("detail-delete-hint");
    if (deleteHint) {
      const deleteGuard = tenantDeleteGuard(tenant);
      deleteHint.hidden = isDeleted || deleteGuard.allowed;
      deleteHint.textContent = deleteGuard.reason || "";
    }

    document.getElementById("detail-extend-trial").onclick = async () => {
      const daysRaw = window.prompt("Extend trial by how many days?", "14");
      if (daysRaw === null) return;
      const days = Number(daysRaw);
      if (!Number.isFinite(days) || days < 1) return alert("Enter a valid number of days");
      try {
        await apiPost(`/master/tenants/${tenant.id}/extend-trial`, { days });
        await refreshSelectedTenant();
      } catch (error) {
        alert(error.message);
      }
    };

    const reportOfflineBillingResult = (result, label) => {
      if (result?.stripe_subscription_cancelled) {
        alert(`${label}\n\nStripe subscription cancelled.`);
        return;
      }
      if (result?.stripe_cancel?.subscription_id && !result?.stripe_subscription_cancelled) {
        alert(
          `${label}\n\nWarning: Stripe subscription was not cancelled (${result.stripe_cancel.reason || "unknown error"}). Cancel it manually in Stripe.`,
        );
        return;
      }
      alert(label);
    };

    const offlineTrialBtn = document.getElementById("detail-offline-trial");
    if (offlineTrialBtn) {
      offlineTrialBtn.hidden = isDeleted || tenant.billing_mode === "offline";
      offlineTrialBtn.onclick = async () => {
        const notes = window.prompt(
          "Switch to offline billing but keep the current trial?\n\nOptional billing note (invoice ref, agreed price):",
          tenant.billing_notes || "",
        );
        if (notes === null) return;
        try {
          const result = await apiPost(`/master/tenants/${tenant.id}/billing`, {
            billing_mode: "offline",
            subscription_status: "trialing",
            billing_notes: notes.trim() || tenant.billing_notes || "",
          });
          await refreshSelectedTenant();
          reportOfflineBillingResult(result, "Tenant is now on offline billing with the existing trial.");
        } catch (error) {
          alert(error.message);
        }
      };
    }

    const offlineBtn = document.getElementById("detail-offline-active");
    if (offlineBtn) {
      offlineBtn.hidden = isDeleted || tenant.billing_mode === "offline";
      offlineBtn.onclick = async () => {
        const notes = window.prompt(
          "Mark this tenant as offline billing with active access (ends trial)?\n\nOptional billing note (invoice ref, agreed price):",
          tenant.billing_notes || "",
        );
        if (notes === null) return;
        try {
          const result = await apiPost(`/master/tenants/${tenant.id}/billing`, {
            billing_mode: "offline",
            subscription_status: "active",
            billing_notes: notes.trim() || tenant.billing_notes || "",
          });
          await refreshSelectedTenant();
          reportOfflineBillingResult(result, "Tenant is now on offline billing with active access.");
        } catch (error) {
          alert(error.message);
        }
      };
    }

    const changePlanBtn = document.getElementById("detail-change-plan");
    const changePlanSelect = document.getElementById("detail-change-plan-select");
    const changePlanNotes = document.getElementById("detail-change-plan-notes");
    const changePlanStatus = document.getElementById("detail-change-plan-status");
    const changePlanApply = document.getElementById("detail-change-plan-apply");
    const changePlanCancel = document.getElementById("detail-change-plan-cancel");
    const rotaAdvancedAddon = document.getElementById("detail-rota-advanced-addon");
    const rotaMultiSiteAddon = document.getElementById("detail-rota-multisite-addon");

    const hideChangePlanPanel = () => {
      if (changePlanWrap) changePlanWrap.hidden = true;
      if (changePlanStatus) changePlanStatus.textContent = "";
    };

    const populateChangePlanSelect = (plans) => {
      if (!changePlanSelect) return;
      const currentPlanId = tenant.plan_id || "";
      changePlanSelect.innerHTML = plans
        .map(
          (plan) =>
            `<option value="${escapeHtml(plan.id)}"${plan.id === currentPlanId ? " selected" : ""}>${escapeHtml(plan.name)} · up to ${plan.max_employees} staff</option>`,
        )
        .join("");
    };

    if (changePlanBtn) {
      changePlanBtn.hidden = isDeleted;
      changePlanBtn.onclick = async () => {
        if (changePlanStatus) changePlanStatus.textContent = "Loading plans…";
        if (changePlanWrap) changePlanWrap.hidden = false;
        try {
          if (!state.provisionPlans.length) {
            const data = await apiGet("/master/plans");
            state.provisionPlans = data.plans || [];
          }
          populateChangePlanSelect(state.provisionPlans);
          if (changePlanNotes) changePlanNotes.value = tenant.billing_notes || "";
          if (rotaAdvancedAddon) rotaAdvancedAddon.checked = Boolean(tenant.rota_advanced_addon);
          if (rotaMultiSiteAddon) rotaMultiSiteAddon.checked = Boolean(tenant.rota_multi_site_addon);
          if (changePlanStatus) changePlanStatus.textContent = "Update plan and/or rota add-ons, then apply.";
        } catch (error) {
          hideChangePlanPanel();
          alert(error.message || "Could not load plans.");
        }
      };
    }

    if (changePlanCancel) {
      changePlanCancel.onclick = hideChangePlanPanel;
    }

    if (changePlanApply) {
      changePlanApply.disabled = isDeleted;
      changePlanApply.onclick = async () => {
        const planId = changePlanSelect?.value;
        if (!planId) {
          if (changePlanStatus) changePlanStatus.textContent = "Choose a plan first.";
          return;
        }
        const advancedAddon = Boolean(rotaAdvancedAddon?.checked);
        const multiSiteAddon = Boolean(rotaMultiSiteAddon?.checked);
        const planChanged = planId !== tenant.plan_id;
        const addonsChanged =
          advancedAddon !== Boolean(tenant.rota_advanced_addon) ||
          multiSiteAddon !== Boolean(tenant.rota_multi_site_addon);
        if (!planChanged && !addonsChanged) {
          if (changePlanStatus) changePlanStatus.textContent = "No changes to apply.";
          return;
        }
        const notes = (changePlanNotes?.value || "").trim();
        const subscriptionStatus = tenant.status === "trialing" ? "trialing" : "active";
        let billingMode = tenant.billing_mode === "offline" ? "offline" : "stripe";
        if (planChanged && billingMode !== "offline") {
          const ok = window.confirm(
            "This tenant is still on Stripe billing. Switch them to offline/manual billing with the new plan?",
          );
          if (!ok) return;
          billingMode = "offline";
        }
        if (changePlanStatus) changePlanStatus.textContent = "Saving…";
        try {
          const result = await apiPost(`/master/tenants/${tenant.id}/billing`, {
            billing_mode: billingMode,
            subscription_status: subscriptionStatus,
            plan_id: planId,
            billing_notes: notes || tenant.billing_notes || "",
            rota_advanced_addon: advancedAddon,
            rota_multi_site_addon: multiSiteAddon,
          });
          hideChangePlanPanel();
          await refreshSelectedTenant();
          const planLabel = state.provisionPlans.find((plan) => plan.id === planId)?.name || planId;
          reportOfflineBillingResult(
            result,
            planChanged
              ? `Plan updated to ${planLabel}.`
              : "Rota add-ons updated.",
          );
        } catch (error) {
          if (changePlanStatus) changePlanStatus.textContent = error.message || "Plan change failed.";
        }
      };
    }

    document.getElementById("detail-email-tenant").onclick = async () => {
      const subject = window.prompt("Email subject");
      if (!subject) return;
      const body = window.prompt("Email message");
      if (!body) return;
      try {
        await apiPost(`/master/tenants/${tenant.id}/email`, { subject, body });
        alert("Email sent.");
      } catch (error) {
        alert(error.message);
      }
    };

    document.getElementById("detail-save-notes").onclick = async () => {
      const statusEl = document.getElementById("detail-notes-status");
      try {
        await apiPut(`/master/tenants/${tenant.id}/notes`, { notes: notes?.value || "" });
        if (statusEl) statusEl.textContent = "Notes saved.";
      } catch (error) {
        if (statusEl) statusEl.textContent = error.message;
      }
    };
  }

  function closeDetail() {
    state.selectedId = null;
    state.selectedTenant = null;
    if (els.detail) els.detail.hidden = true;
    syncLayoutSplit();
    renderTable();
    renderCards();
    syncDeleteSelectedButton();
  }

  function renderPageSub() {
    const total = state.overview?.total_tenants ?? state.tenants.length;
    if (els.pageSub) els.pageSub.textContent = `All businesses registered on ShiftSwift HR · ${state.providerName} · ${total} tenants`;
    if (els.providerName) els.providerName.textContent = state.providerName;
  }

  function exportCsv() {
    const header = ["Tenant ID", "Business", "Billing email", "HR login", "Location", "Plan", "Status", "Staff", "MRR", "Duplicate trial"];
    const lines = state.tenants.map((tenant) =>
      [
        tenant.id,
        tenant.name,
        tenant.billing_email || "",
        tenant.hr_login_email || "",
        tenant.location,
        tenant.plan_label,
        tenant.status,
        tenant.staff_label,
        tenant.mrr_gbp ?? "",
        tenant.duplicate_billing_email && !tenant.is_canonical_tenant ? "yes" : "no",
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `shiftswift-tenants-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function cleanupDuplicateTrials() {
    const duplicates = state.tenants.filter((tenant) => tenant.duplicate_billing_email && !tenant.is_canonical_tenant);
    if (!duplicates.length) {
      window.alert("No duplicate trial workspaces found for the same billing email.");
      return;
    }
    let preview;
    try {
      preview = await apiGet("/master/tenants/duplicate-trials/preview");
    } catch (error) {
      window.alert(error.message || "Could not preview duplicate trials.");
      return;
    }
    const count = (preview.removed || []).length;
    if (!count) {
      window.alert("No duplicate trial workspaces to remove.");
      return;
    }
    const names = (preview.removed || [])
      .slice(0, 5)
      .map((row) => `#${row.tenant_id} ${row.name || row.billing_email}`)
      .join("\n");
    const ok = window.confirm(
      `Remove ${count} duplicate trial workspace(s)?\n\nKeeps the primary account for each billing email and soft-deletes the extras:\n${names}${count > 5 ? "\n…" : ""}`,
    );
    if (!ok) return;
    try {
      const result = await apiPost("/master/tenants/cleanup-duplicates", { confirm: true });
      const deleted = result.deleted_count ?? (result.removed || []).filter((row) => row.action === "soft_delete").length;
      if (!deleted) {
        window.alert(result.message || "No workspaces were removed — they may already be deleted.");
        return;
      }
      window.alert(result.message || `Removed ${deleted} duplicate trial workspace(s).`);
      await loadTenants();
      closeDetail();
    } catch (error) {
      window.alert(error.message || "Duplicate trial cleanup failed.");
    }
  }

  async function loadTenants() {
    state.loading = true;
    const params = new URLSearchParams();
    if (state.filter && state.filter !== "all") params.set("status", state.filter);
    if (state.search.trim()) params.set("q", state.search.trim());
    if (state.includeDeleted) params.set("include_deleted", "true");
    if (state.excludeTest) params.set("exclude_test", "true");
    try {
      const data = await apiGet(`/master/tenants?${params.toString()}`);
      state.tenants = data.tenants || [];
      state.overview = data.overview || state.overview;
      if (data.provider_name) state.providerName = data.provider_name;
      renderMetrics();
      renderFilters();
      renderTable();
      renderCards();
      renderPageSub();
      if (els.exportBtn) els.exportBtn.disabled = state.tenants.length === 0;
      syncDeleteSelectedButton();
    } catch (error) {
      if (els.pageSub) els.pageSub.textContent = error.message || "Failed to load tenants";
    } finally {
      state.loading = false;
    }
  }

  function showSection(section) {
    state.section = section;
    document.querySelectorAll("[data-master-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.masterPanel !== section;
    });
    document.querySelectorAll("[data-master-section]").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.masterSection === section);
    });
    if (section === "tenants") loadTenants();
    else if (section === "revenue") loadRevenuePanel();
    else if (section === "billing") loadBillingPanel();
    else if (section === "alerts") loadAlertsPanel();
    else if (section === "audit") loadAuditPanel();
    else if (section === "email-log") loadEmailLogPanel();
    else if (section === "infrastructure") loadInfraPanel();
    else if (section === "api-keys") loadApiKeysPanel();
    else if (section === "settings") loadSettingsPanel();
    else if (section === "account") loadAccountPanel();
    closeSidebar();
  }

  async function loadRevenuePanel() {
    const host = document.getElementById("master-revenue-content");
    if (!host) return;
    try {
      const overview = await apiGet("/master/overview");
      state.overview = overview.stats;
      const stats = state.overview || {};
      const breakdown = stats.plan_breakdown || [];
      const funnel = stats.trial_funnel || {};
      const expiring = stats.trials_expiring || {};
      const maxPlanMrr = breakdown.reduce((max, row) => Math.max(max, row.mrr_gbp || 0), 1) || 1;
      const funnelMax = Math.max(funnel.trialing || 0, funnel.active_paying || 0, 1);

      const planBars = breakdown.length
        ? breakdown
            .map((row) => {
              const pct = Math.round(((row.mrr_gbp || 0) / maxPlanMrr) * 100);
              return `<div class="master-revenue-bar-row">
                <div class="master-revenue-bar-row__label">${escapeHtml(row.plan_label)} <span class="muted">${row.tenant_count} tenant${row.tenant_count === 1 ? "" : "s"}</span></div>
                <div class="master-revenue-bar"><span style="width:${pct}%"></span></div>
                <div class="master-revenue-bar-row__value">${formatMoney(row.mrr_gbp)}</div>
              </div>`;
            })
            .join("")
        : `<p class="muted">No paying tenants yet — MRR will appear when trials convert.</p>`;

      const funnelBars = [
        ["Trialing", funnel.trialing || 0, "var(--master-gold)"],
        ["Paying (active)", funnel.active_paying || 0, "var(--master-green)"],
        ["HR never logged in", funnel.never_logged_in_hr || 0, "var(--master-red)"],
        ["Duplicate trials", funnel.duplicate_trials || 0, "#b45309"],
      ]
        .map(([label, count, color]) => {
          const pct = Math.round((Number(count) / funnelMax) * 100);
          return `<div class="master-revenue-bar-row">
            <div class="master-revenue-bar-row__label">${escapeHtml(label)}</div>
            <div class="master-revenue-bar"><span style="width:${pct}%;background:${color}"></span></div>
            <div class="master-revenue-bar-row__value">${count}</div>
          </div>`;
        })
        .join("");

      host.innerHTML = `
        <div class="master-revenue-summary">
          <article class="master-metric master-metric--hero">
            <div class="master-metric__label">Total MRR (est.)</div>
            <div class="master-metric__value master-metric__value--gold">${formatMoney(stats.mrr_gbp)}</div>
            <div class="master-metric__sub">ARR projection ${formatMoney(stats.arr_gbp)} · ${escapeHtml(stats.reporting_month || "Current month")}</div>
          </article>
          <article class="master-metric">
            <div class="master-metric__label">Conversion</div>
            <div class="master-metric__value">${stats.conversion_rate_pct ?? 0}%</div>
            <div class="master-metric__sub">${stats.active_paying ?? 0} paying · ${stats.trialing ?? 0} trialing</div>
          </article>
          <article class="master-metric">
            <div class="master-metric__label">Trials expiring</div>
            <div class="master-metric__value">${expiring["7d"] ?? 0}</div>
            <div class="master-metric__sub">7d · ${expiring["14d"] ?? 0} in 14d · ${expiring["30d"] ?? 0} in 30d</div>
          </article>
        </div>
        <p class="master-panel-note muted">${escapeHtml(stats.mrr_note || "")}</p>
        <div class="master-revenue-grid">
          <section class="master-revenue-card">
            <h3>Plan breakdown</h3>
            ${planBars}
          </section>
          <section class="master-revenue-card">
            <h3>Trial conversion funnel</h3>
            ${funnelBars}
          </section>
        </div>
        <table class="master-data-table master-revenue-table"><thead><tr><th>Plan</th><th>Tenants</th><th>MRR (est.)</th></tr></thead>
        <tbody>${breakdown.map((row) => `<tr><td>${escapeHtml(row.plan_label)}</td><td>${row.tenant_count}</td><td>${formatMoney(row.mrr_gbp)}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">No paying tenants yet</td></tr>'}</tbody></table>`;
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadBillingPanel() {
    const host = document.getElementById("master-billing-content");
    if (!host) return;
    try {
      const keys = await apiGet("/master/api-keys");
      const stripe = keys.stripe || {};
      host.innerHTML = renderKeyValueGrid([
        ["Stripe secret key", stripe.secret_key?.configured ? escapeHtml(stripe.secret_key.preview) : "Not configured"],
        ["Webhook secret", stripe.webhook_secret?.configured ? escapeHtml(stripe.webhook_secret.preview) : "Not configured"],
        ["Currency", escapeHtml(stripe.currency || "gbp")],
        ["Tax enabled", stripe.tax_enabled ? "Yes" : "No"],
      ]) + `${
        stripe.tax_enabled
          ? ""
          : `<p class="master-panel-note master-panel-note--warn">Stripe Tax is off — enable <code>STRIPE_TAX_ENABLED=1</code> in server <code>.env</code> before charging UK VAT on SaaS subscriptions.</p>`
      }<p class="muted master-panel-note">Update Stripe keys in server <code>.env</code> and restart the API. This panel is for platform operators only.</p>`;
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadAlertsPanel() {
    const host = document.getElementById("master-alerts-content");
    if (!host) return;
    try {
      const [overdue, active] = await Promise.all([
        apiGet("/master/tenants?status=overdue"),
        apiGet("/master/tenants?status=suspended"),
      ]);
      const alertRows = [...(overdue.tenants || []), ...(active.tenants || [])];
      host.innerHTML = alertRows.length
        ? `<table class="master-data-table"><thead><tr><th>Business</th><th>Status</th><th>Contact</th></tr></thead><tbody>${alertRows
            .map((t) => `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.billing_email || "—")}</td></tr>`)
            .join("")}</tbody></table>`
        : `<p class="muted">No overdue or suspended tenants.</p>`;
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadAuditPanel() {
    const host = document.getElementById("master-audit-content");
    if (!host) return;
    try {
      const data = await apiGet("/master/audit-log?limit=200");
      host.innerHTML = `<table class="master-data-table"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Tenant</th></tr></thead><tbody>${(data.items || [])
        .map(
          (row) =>
            `<tr><td>${escapeHtml(formatDate(row.created_at))}</td><td>${escapeHtml(row.master_username)}</td><td>${escapeHtml(row.action)}</td><td>${row.target_tenant_id || "—"}</td></tr>`
        )
        .join("") || '<tr><td colspan="4" class="muted">No audit entries yet</td></tr>'}</tbody></table>`;
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadEmailLogPanel() {
    const host = document.getElementById("master-email-log-content");
    if (!host) return;
    try {
      const data = await apiGet("/master/email-log?limit=200");
      host.innerHTML = `<table class="master-data-table"><thead><tr><th>When</th><th>Tenant</th><th>Subject</th><th>Status</th></tr></thead><tbody>${(data.items || [])
        .map(
          (row) =>
            `<tr><td>${escapeHtml(formatDate(row.created_at))}</td><td>${escapeHtml(row.tenant_name || row.tenant_id)}</td><td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.status)}</td></tr>`
        )
        .join("") || '<tr><td colspan="4" class="muted">No emails logged yet</td></tr>'}</tbody></table>`;
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadInfraPanel() {
    const host = document.getElementById("master-infra-content");
    if (!host) return;
    try {
      const [settings, health] = await Promise.all([
        apiGet("/master/settings"),
        fetch(`${apiBase()}/health`).then((r) => r.json()).catch(() => ({})),
      ]);
      host.innerHTML = renderKeyValueGrid([
        ["Environment", escapeHtml(settings.environment)],
        ["Database", settings.database_configured ? "Connected" : "Not configured"],
        ["API health", escapeHtml(health.status || "unknown")],
        ["SMTP", settings.smtp?.configured ? "Configured" : "Not configured"],
        ["Master MFA required", settings.master_require_mfa ? "Yes" : "No"],
        ["HR MFA required", settings.business_require_mfa ? "Yes" : "No"],
        ["Employee MFA required", settings.employee_require_mfa ? "Yes" : "No"],
      ]);
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadApiKeysPanel() {
    const host = document.getElementById("master-api-keys-content");
    if (!host) return;
    try {
      const data = await apiGet("/master/api-keys");
      const rows = [];
      Object.entries(data.stripe || {}).forEach(([key, val]) => {
        if (typeof val === "object" && val) rows.push([`Stripe ${key}`, val.configured ? val.preview : "Not set"]);
      });
      Object.entries(data.ai || {}).forEach(([key, val]) => {
        if (typeof val === "object" && val) rows.push([`AI ${key}`, val.configured ? val.preview : "Not set"]);
        else if (key.endsWith("_model")) rows.push([key, escapeHtml(String(val))]);
      });
      Object.entries(data.integrations || {}).forEach(([key, val]) => {
        if (typeof val === "object" && val) rows.push([key, val.configured ? val.preview : "Not set"]);
      });
      host.innerHTML = renderKeyValueGrid(rows) + `<p class="muted master-panel-note">${escapeHtml(data.note || "")}</p>`;
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadSettingsPanel() {
    const host = document.getElementById("master-settings-content");
    if (!host) return;
    try {
      const s = await apiGet("/master/settings");
      host.innerHTML = renderKeyValueGrid([
        ["Provider", escapeHtml(s.provider_name)],
        ["Master tenant ID", escapeHtml(String(s.master_customer_id))],
        ["Trial days", escapeHtml(String(s.billing_trial_days))],
        ["DD grace days", escapeHtml(String(s.billing_dd_grace_days))],
        ["Impersonation session (min)", escapeHtml(String(s.master_impersonation_minutes))],
        ["IP allowlist", s.master_ip_allowlist_enabled ? escapeHtml(s.master_ip_allowlist.join(", ")) : "Disabled"],
        ["AI enabled", s.ai_enabled ? "Yes" : "No"],
        ["AI provider", escapeHtml(s.ai_provider)],
      ]);
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadAccountPanel() {
    const host = document.getElementById("master-account-content");
    if (!host) return;
    try {
      const profile = await apiGet("/master/account");
      const mfaEnabled = Boolean(profile.mfa_enabled);
      host.innerHTML = `
        ${renderKeyValueGrid([
          ["Username", escapeHtml(profile.username)],
          ["MFA", mfaEnabled ? "Enabled" : "Not enabled"],
          ["MFA enabled at", escapeHtml(formatDate(profile.mfa_enabled_at))],
        ])}
        <form id="master-change-password-form" class="master-form">
          <h3>Change password</h3>
          <label>Current password<input type="password" name="current_password" required autocomplete="current-password" /></label>
          <label>New password (12+ chars)<input type="password" name="new_password" required autocomplete="new-password" /></label>
          <button type="submit" class="master-btn master-btn--gold">Update password</button>
          <p class="master-inline-status muted" id="master-password-status" aria-live="polite"></p>
        </form>
        <section id="master-enable-mfa-section" class="master-form"${mfaEnabled ? " hidden" : ""}>
          <h3>Enable two-factor authentication</h3>
          <p class="muted">Required before launch — scan a QR code with Google Authenticator, Authy, or Microsoft Authenticator.</p>
          <button type="button" class="master-btn master-btn--gold" id="master-mfa-start">Generate QR code</button>
          <div id="master-mfa-qr-area" hidden>
            <div class="master-mfa-qr-wrap"><img id="master-mfa-qr" alt="Authenticator QR code" width="180" height="180" /></div>
            <p class="muted">Manual key: <code id="master-mfa-secret"></code></p>
            <label>Verification code<input type="text" id="master-mfa-code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="123456" /></label>
            <button type="button" class="master-btn master-btn--gold" id="master-mfa-enable">Enable MFA</button>
          </div>
          <p class="master-inline-status muted" id="master-mfa-setup-status" aria-live="polite"></p>
        </section>
        <form id="master-disable-mfa-form" class="master-form"${mfaEnabled ? "" : " hidden"}>
          <h3>Disable MFA</h3>
          <p class="muted">Turns off authenticator codes on this master account.</p>
          <label>Current password<input type="password" name="current_password" required autocomplete="current-password" /></label>
          <button type="submit" class="master-btn master-btn--ghost">Disable MFA</button>
          <p class="master-inline-status muted" id="master-mfa-status" aria-live="polite"></p>
        </form>`;

      document.getElementById("master-change-password-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fd = new FormData(event.target);
        const statusEl = document.getElementById("master-password-status");
        try {
          const result = await apiPost("/master/account/change-password", {
            current_password: fd.get("current_password"),
            new_password: fd.get("new_password"),
          });
          if (statusEl) statusEl.textContent = result.message || "Password updated.";
          event.target.reset();
        } catch (error) {
          if (statusEl) statusEl.textContent = error.message;
        }
      });

      document.getElementById("master-mfa-start")?.addEventListener("click", async () => {
        const statusEl = document.getElementById("master-mfa-setup-status");
        try {
          const setup = await apiPost("/auth/mfa/setup");
          const qrArea = document.getElementById("master-mfa-qr-area");
          const qrImg = document.getElementById("master-mfa-qr");
          const secretEl = document.getElementById("master-mfa-secret");
          if (secretEl) secretEl.textContent = setup.manual_secret || "";
          if (qrImg && setup.otpauth_uri) {
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setup.otpauth_uri)}`;
          }
          if (qrArea) qrArea.hidden = false;
          if (statusEl) statusEl.textContent = "";
        } catch (error) {
          if (statusEl) statusEl.textContent = error.message;
        }
      });

      document.getElementById("master-mfa-enable")?.addEventListener("click", async () => {
        const code = document.getElementById("master-mfa-code")?.value?.trim();
        const statusEl = document.getElementById("master-mfa-setup-status");
        if (!code) return;
        try {
          await apiPost("/auth/mfa/enable", { code });
          if (statusEl) statusEl.textContent = "Two-factor authentication enabled.";
          loadAccountPanel();
        } catch (error) {
          if (statusEl) statusEl.textContent = error.message;
        }
      });

      document.getElementById("master-disable-mfa-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!window.confirm("Disable MFA on this master account?")) return;
        const fd = new FormData(event.target);
        const statusEl = document.getElementById("master-mfa-status");
        try {
          const result = await apiPost("/master/account/disable-mfa", {
            current_password: fd.get("current_password"),
          });
          if (statusEl) statusEl.textContent = result.message || "MFA disabled.";
          loadAccountPanel();
        } catch (error) {
          if (statusEl) statusEl.textContent = error.message;
        }
      });
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  function routeFromHash() {
    const section = (window.location.hash || "#tenants").replace("#", "") || "tenants";
    showSection(section);
  }

  async function loadProvisionPlans() {
    const select = document.getElementById("master-create-plan");
    if (!select) return;
    try {
      const data = await apiGet("/master/plans");
      const plans = data.plans || [];
      select.innerHTML = plans
        .map(
          (plan) =>
            `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)} (up to ${plan.max_employees} staff)</option>`,
        )
        .join("");
      const preferred = plans.find((plan) => plan.id === "site_medium_monthly");
      if (preferred) select.value = preferred.id;
    } catch {
      select.innerHTML = `<option value="site_medium_monthly">Compliance</option>`;
    }
  }

  function initCreateTenantPanel() {
    const panel = document.getElementById("master-create-panel");
    const form = document.getElementById("master-create-form");
    const status = document.getElementById("master-create-status");
    const accessSelect = document.getElementById("master-create-access");
    const trialWrap = document.getElementById("master-create-trial-wrap");
    if (!panel || !form) return;

    document.getElementById("master-create-tenant-btn")?.addEventListener("click", () => {
      panel.hidden = false;
      status.textContent = "";
      void loadProvisionPlans();
    });
    document.getElementById("master-create-cancel")?.addEventListener("click", () => {
      panel.hidden = true;
      form.reset();
      if (trialWrap) trialWrap.hidden = true;
    });
    accessSelect?.addEventListener("change", () => {
      if (trialWrap) trialWrap.hidden = accessSelect.value !== "trialing";
    });
    document.getElementById("master-generate-password")?.addEventListener("click", async () => {
      try {
        const data = await apiGet("/master/tenants/generate-password");
        const input = form.querySelector('input[name="admin_password"]');
        if (input && data.password) input.value = data.password;
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const maxRaw = String(fd.get("max_employees") || "").trim();
      const payload = {
        business_name: String(fd.get("business_name") || "").trim(),
        billing_email: String(fd.get("billing_email") || "").trim(),
        admin_password: String(fd.get("admin_password") || ""),
        plan_id: String(fd.get("plan_id") || "site_medium_monthly"),
        billing_mode: String(fd.get("billing_mode") || "offline"),
        access: String(fd.get("access") || "active"),
        trial_days: Number(fd.get("trial_days") || 14),
        send_welcome_email: fd.get("send_welcome_email") === "on",
        billing_notes: String(fd.get("billing_notes") || "").trim() || null,
      };
      if (maxRaw) payload.max_employees = Number(maxRaw);
      if (status) status.textContent = "Creating workspace…";
      try {
        const result = await apiPost("/master/tenants/create", payload);
        panel.hidden = true;
        form.reset();
        if (trialWrap) trialWrap.hidden = true;
        await loadTenants();
        await selectTenant(result.tenant_id);
        window.alert(
          `Workspace #${result.tenant_id} created for ${result.billing_email}.\n\nShare the HR password securely — it is not shown again.`,
        );
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    });
  }

  async function bootstrap() {
    try {
      const verify = await apiGet("/auth/verify");
      const session = window.ShiftSwiftMasterSession;
      if (session && !session.isMasterVerify(verify)) {
        session.syncLocalRoleFromVerify(verify);
        session.redirectToMasterLogin(
          verify.impersonating
            ? "You are viewing a customer account. Exit impersonation, then open the master console again."
            : "Your master session was replaced. Sign in again at the OPS login page.",
        );
        return;
      }
      session?.syncLocalRoleFromVerify?.(verify);
      const name = verify.username || "Platform owner";
      if (els.userName) els.userName.textContent = name.split("@")[0].replace(/\./g, " ");
      if (els.userAvatar) els.userAvatar.textContent = initials(name.split("@")[0]);
    } catch {
      window.location.replace("./ops-9x7k2.html");
      return;
    }
    try {
      const overview = await apiGet("/master/overview");
      state.overview = overview.stats;
      if (overview.provider_name) state.providerName = overview.provider_name;
    } catch (error) {
      console.warn(error);
    }
    routeFromHash();
    initCreateTenantPanel();
  }

  document.querySelectorAll("[data-master-section]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.hash = link.dataset.masterSection;
    });
  });
  window.addEventListener("hashchange", routeFromHash);

  let searchTimer;
  els.search?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = els.search.value;
      loadTenants();
    }, 250);
  });
  els.includeDeleted?.addEventListener("change", () => {
    state.includeDeleted = els.includeDeleted.checked;
    loadTenants();
  });
  els.excludeTest?.addEventListener("change", () => {
    state.excludeTest = els.excludeTest.checked;
    loadTenants();
  });

  els.detailClose?.addEventListener("click", closeDetail);
  els.exportBtn?.addEventListener("click", exportCsv);
  document.getElementById("master-cleanup-duplicates-btn")?.addEventListener("click", () => {
    void cleanupDuplicateTrials();
  });
  els.deleteSelectedBtn?.addEventListener("click", () => {
    const tenant = state.selectedTenant || state.tenants.find((row) => row.id === state.selectedId);
    if (tenant) void deleteTenantWithConfirm(tenant);
  });

  function closeSidebar() {
    els.sidebar?.classList.remove("is-open");
    if (els.overlay) {
      els.overlay.hidden = true;
      els.overlay.setAttribute("aria-hidden", "true");
    }
  }
  function openSidebar() {
    els.sidebar?.classList.add("is-open");
    if (els.overlay) {
      els.overlay.hidden = false;
      els.overlay.setAttribute("aria-hidden", "false");
    }
  }
  els.menuBtn?.addEventListener("click", openSidebar);
  els.sidebarClose?.addEventListener("click", closeSidebar);
  els.overlay?.addEventListener("click", closeSidebar);

  window.addEventListener("storage", (event) => {
    if (event.key !== "token" || event.newValue === event.oldValue) return;
    window.location.reload();
  });

  bootstrap();
})();
