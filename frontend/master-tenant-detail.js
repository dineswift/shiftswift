/** Shared tenant detail panel — used by master-tenant.html popup window. */
(function (global) {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function statusClass(status) {
    return `master-status master-status--${status || "trialing"}`;
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

  let latestCtx = null;

  function activateTenantTab(tabId) {
    document.querySelectorAll("[data-tenant-tab]").forEach((tab) => {
      const active = tab.dataset.tenantTab === tabId;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-tenant-tab-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.tenantTabPanel !== tabId;
    });
    return tabId;
  }

  function closeActionsMenu() {
    /* legacy no-op — actions are inline buttons now */
  }

  function normalizeEmail(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function kvRow(label, valueHtml) {
    return `<div class="master-detail-kv__row"><dt class="master-detail-kv__label">${escapeHtml(label)}</dt><dd class="master-detail-kv__value">${valueHtml}</dd></div>`;
  }

  function detailSection(title, rowsHtml) {
    if (!rowsHtml) return "";
    return `<section class="master-detail-section"><h3 class="master-detail-section__title">${escapeHtml(title)}</h3><dl class="master-detail-kv">${rowsHtml}</dl></section>`;
  }

  function cardStatusClass(status) {
    const key = String(status || "trialing").toLowerCase();
    if (["active", "trialing", "overdue", "cancelled", "suspended", "deleted"].includes(key)) {
      return `master-tenant-page__card--status-${key}`;
    }
    return "master-tenant-page__card--status-active";
  }

  function rotaAddonsLabel(tenant) {
    const parts = [];
    if (tenant.rota_advanced_addon) parts.push("Advanced");
    if (tenant.rota_multi_site_addon) parts.push("Multi-site");
    if (!parts.length) return "Basic manual rota (included)";
    return parts.join(" · ");
  }

  function crmAddonLabel(tenant) {
    if (!tenant.crm_addon) return "Not enabled";
    let label = "Enabled";
    if (tenant.crm_addon_monthly_gbp != null && tenant.crm_addon_monthly_gbp !== "") {
      label += ` · £${Number(tenant.crm_addon_monthly_gbp).toFixed(2)}/mo ex VAT`;
    }
    if (tenant.crm_addon_billing_notes) {
      label += `<br><small class="muted">${escapeHtml(tenant.crm_addon_billing_notes)}</small>`;
    }
    return label;
  }

  function tenantMetaLine(tenant) {
    const bits = [`#${tenant.id}`];
    if (tenant.location) bits.push(escapeHtml(tenant.location));
    if (tenant.is_canonical_tenant === false) bits.push("duplicate trial");
    else if (tenant.duplicate_billing_email) bits.push("primary for this email");
    if (tenant.is_test_account) bits.push("test account");
    return bits.join(" · ");
  }

  function initTenantDetailChrome() {
    if (document.body.dataset.tenantDetailChromeReady === "1") return;
    document.body.dataset.tenantDetailChromeReady = "1";

    document.querySelectorAll("[data-tenant-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabId = activateTenantTab(tab.dataset.tenantTab);
        if (tabId === "legal" && latestCtx?.tenant?.id) {
          window.ShiftSwiftMasterTenantContracts?.mountLegalTab?.(latestCtx.tenant, latestCtx);
        }
      });
    });
  }

  function saveMasterReturnSession() {
    sessionStorage.setItem(
      "masterImpersonationReturn",
      JSON.stringify({
        token: localStorage.getItem("token"),
        refreshToken: localStorage.getItem("refreshToken"),
        userRole: localStorage.getItem("userRole"),
        tenantId: localStorage.getItem("tenantId"),
        masterTenantId: localStorage.getItem("masterTenantId"),
      }),
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
      }),
    );
  }

  async function impersonateTenant(tenant, apiPost) {
    if (!tenant?.id || tenant.can_impersonate === false) return;
    closeActionsMenu();
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
        button.disabled = tenant.can_impersonate === false;
        button.textContent = "Impersonate this account";
      }
    }
  }

  async function deleteTenantWithConfirm(tenant, ctx) {
    const guard = tenantDeleteGuard(tenant);
    if (!guard.allowed) {
      window.alert(guard.reason);
      return;
    }
    closeActionsMenu();
    const typed = window.prompt(
      `Type the business name to confirm delete:\n${tenant.name}\n\nPaying accounts must be suspended before deletion.`,
    );
    if (typed === null) return;
    try {
      await ctx.apiPost(`/master/tenants/${tenant.id}/delete`, { confirm_name: typed });
      if (typeof ctx.onDeleted === "function") await ctx.onDeleted();
      else if (typeof ctx.refresh === "function") await ctx.refresh();
    } catch (error) {
      window.alert(error.message);
    }
  }

  function renderTenantDetail(tenant, ctx) {
    if (!tenant) return;
    latestCtx = { ...ctx, tenant };
    initTenantDetailChrome();

    const { apiGet, apiPost, apiPut, provisionPlans, refresh } = ctx;
    const active = tenant.employees_active || 0;
    const staffLimit = tenant.employees_limit || 0;
    const pct = staffLimit ? Math.min(100, Math.round((active / staffLimit) * 100)) : 0;
    const isDeleted = Boolean(tenant.deleted_at);
    const isSuspended = (tenant.platform_status || "") === "suspended" || tenant.status === "suspended";

    document.getElementById("detail-name").textContent = tenant.name;
    const statusEl = document.getElementById("detail-status");
    statusEl.className = statusClass(tenant.status);
    statusEl.textContent = tenant.status;

    const metaEl = document.getElementById("detail-tenant-meta");
    if (metaEl) metaEl.innerHTML = tenantMetaLine(tenant);

    const lastActiveTop = document.getElementById("detail-last-active-top");
    if (lastActiveTop) {
      const lastLabel = tenant.last_active?.label || "—";
      lastActiveTop.textContent = lastLabel === "—" ? "Last active —" : `Last active ${lastLabel}`;
    }

    const card = document.getElementById("detail-card");
    if (card) {
      card.className = `master-tenant-page__card ${cardStatusClass(tenant.status)}`;
    }

    const billingEmail = tenant.billing_email || "";
    const hrEmail = tenant.hr_login_email || "";
    const emailsMatch = billingEmail && hrEmail && normalizeEmail(billingEmail) === normalizeEmail(hrEmail);

    const accountHtml = [
      tenant.hr_never_logged_in
        ? `<div class="master-detail-alert">HR account exists but has never signed in — check welcome email delivery and share the sign-up password.</div>`
        : "",
      detailSection(
        "Overview",
        [
          kvRow("Status", `<span class="${statusClass(tenant.status)}">${escapeHtml(tenant.status)}</span> · ${escapeHtml(tenant.platform_status || "active")}${tenant.deleted_at ? " · deleted" : ""}`),
          kvRow("Tenant ID", `#${tenant.id}`),
          kvRow("Location", escapeHtml(tenant.location || "—")),
          kvRow("Last active", escapeHtml(tenant.last_active?.label || "—")),
        ].join(""),
      ),
    ].join("");

    const billingEmailValue = billingEmail
      ? emailsMatch
        ? `${escapeHtml(billingEmail)} <span class="master-detail-kv__hint">(same as HR login)</span>`
        : escapeHtml(billingEmail)
      : "—";

    const billingHtml = detailSection(
      "Plan & billing",
      [
        kvRow(
          "Plan",
          `<span>${escapeHtml(tenant.plan_label)} · ${escapeHtml(tenant.mrr_label)}</span>${isDeleted ? "" : ` <button type="button" class="master-btn master-btn--ghost master-btn--compact" id="detail-change-plan">Change plan</button>`}`,
        ),
        kvRow(
          "Billing",
          escapeHtml(tenant.billing_mode === "offline" ? "Offline / invoice" : "Stripe") +
            ` · ${escapeHtml(tenant.subscription_status || "—")}`,
        ),
        kvRow("Billing email", billingEmailValue),
        kvRow("Billing notes", escapeHtml(tenant.billing_notes || "—")),
        kvRow("Rota add-ons", rotaAddonsLabel(tenant)),
        kvRow("CRM add-on", crmAddonLabel(tenant)),
      ].join(""),
    );

    const usageHtml = [
      !emailsMatch && hrEmail ? detailSection("Access", kvRow("HR login", escapeHtml(hrEmail))) : "",
      `<section class="master-detail-section">
        <h3 class="master-detail-section__title">Employees</h3>
        <div class="master-detail-employees">
          <p class="master-detail-employees__summary">${active} active · ${tenant.employees_pending_portal || 0} portal pending</p>
          <div class="master-staff-bar master-staff-bar--detail" aria-hidden="true"><span style="width:${pct}%"></span></div>
          <p class="master-detail-employees__meta muted">${escapeHtml(tenant.staff_label)}</p>
        </div>
      </section>`,
      `<section class="master-detail-section">
        <h3 class="master-detail-section__title">Modules active</h3>
        <div class="master-module-pills" id="detail-modules"></div>
      </section>`,
    ].join("");

    const accountHost = document.getElementById("detail-account-sections");
    const billingHost = document.getElementById("detail-billing-sections");
    const usageHost = document.getElementById("detail-usage-sections");
    if (accountHost) accountHost.innerHTML = accountHtml;
    if (billingHost) billingHost.innerHTML = billingHtml;
    if (usageHost) usageHost.innerHTML = usageHtml;

    const modulesHost = document.getElementById("detail-modules");
    if (modulesHost) {
      modulesHost.innerHTML = (tenant.modules || [])
        .map((mod) => `<span class="master-module-pill ${mod.active ? "is-active" : "is-inactive"}">${escapeHtml(mod.label)}</span>`)
        .join("");
    }

    const notes = document.getElementById("detail-notes");
    if (notes) notes.value = tenant.internal_notes || "";

    const changePlanWrap = document.getElementById("detail-change-plan-wrap");
    if (changePlanWrap) changePlanWrap.hidden = true;
    activateTenantTab("account");

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

    const changePlanSelect = document.getElementById("detail-change-plan-select");
    const changePlanNotes = document.getElementById("detail-change-plan-notes");
    const changePlanStatus = document.getElementById("detail-change-plan-status");
    const changePlanApply = document.getElementById("detail-change-plan-apply");
    const changePlanCancel = document.getElementById("detail-change-plan-cancel");
    const rotaAdvancedAddon = document.getElementById("detail-rota-advanced-addon");
    const rotaMultiSiteAddon = document.getElementById("detail-rota-multisite-addon");
    const crmAddon = document.getElementById("detail-crm-addon");
    const crmMonthlyGbp = document.getElementById("detail-crm-monthly-gbp");
    const crmBillingNotes = document.getElementById("detail-crm-billing-notes");

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

    async function openChangePlanPanel() {
      activateTenantTab("billing");
      closeActionsMenu();
      if (changePlanStatus) changePlanStatus.textContent = "Loading plans…";
      if (changePlanWrap) changePlanWrap.hidden = false;
      try {
        if (!provisionPlans.length) {
          const data = await apiGet("/master/plans");
          provisionPlans.splice(0, provisionPlans.length, ...(data.plans || []));
        }
        populateChangePlanSelect(provisionPlans);
        if (changePlanNotes) changePlanNotes.value = tenant.billing_notes || "";
        if (rotaAdvancedAddon) rotaAdvancedAddon.checked = Boolean(tenant.rota_advanced_addon);
        if (rotaMultiSiteAddon) rotaMultiSiteAddon.checked = Boolean(tenant.rota_multi_site_addon);
        if (crmAddon) crmAddon.checked = Boolean(tenant.crm_addon);
        if (crmMonthlyGbp) {
          crmMonthlyGbp.value =
            tenant.crm_addon_monthly_gbp != null && tenant.crm_addon_monthly_gbp !== ""
              ? String(tenant.crm_addon_monthly_gbp)
              : "";
        }
        if (crmBillingNotes) crmBillingNotes.value = tenant.crm_addon_billing_notes || "";
        if (changePlanStatus) changePlanStatus.textContent = "Update plan and/or add-ons, then apply.";
        changePlanWrap?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch (error) {
        hideChangePlanPanel();
        alert(error.message || "Could not load plans.");
      }
    }

    const changePlanBtn = document.getElementById("detail-change-plan");
    if (changePlanBtn) changePlanBtn.onclick = openChangePlanPanel;
    const changePlanActionBtn = document.getElementById("detail-action-change-plan");
    if (changePlanActionBtn) changePlanActionBtn.onclick = openChangePlanPanel;
    if (changePlanCancel) changePlanCancel.onclick = hideChangePlanPanel;

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
        const crmAddonEnabled = Boolean(crmAddon?.checked);
        const crmMonthlyValue =
          crmMonthlyGbp?.value && crmMonthlyGbp.value.trim() !== "" ? Number(crmMonthlyGbp.value) : null;
        const crmNotesValue = (crmBillingNotes?.value || "").trim();
        const planChanged = planId !== tenant.plan_id;
        const addonsChanged =
          advancedAddon !== Boolean(tenant.rota_advanced_addon) ||
          multiSiteAddon !== Boolean(tenant.rota_multi_site_addon) ||
          crmAddonEnabled !== Boolean(tenant.crm_addon) ||
          crmMonthlyValue !== (tenant.crm_addon_monthly_gbp ?? null) ||
          crmNotesValue !== (tenant.crm_addon_billing_notes || "");
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
            crm_addon: crmAddonEnabled,
            crm_addon_monthly_gbp: crmMonthlyValue,
            crm_addon_billing_notes: crmNotesValue,
          });
          hideChangePlanPanel();
          await refresh();
          const planLabel = provisionPlans.find((plan) => plan.id === planId)?.name || planId;
          reportOfflineBillingResult(
            result,
            planChanged ? `Plan updated to ${planLabel}.` : "Add-ons updated.",
          );
        } catch (error) {
          if (changePlanStatus) changePlanStatus.textContent = error.message || "Plan change failed.";
        }
      };
    }

    const impersonateBtn = document.getElementById("detail-impersonate");
    if (impersonateBtn) {
      impersonateBtn.disabled = tenant.can_impersonate === false;
      impersonateBtn.textContent = "Impersonate this account";
      impersonateBtn.onclick = () => impersonateTenant(tenant, apiPost);
    }

    const suspendBtn = document.getElementById("detail-suspend-toggle");
    if (suspendBtn) {
      suspendBtn.hidden = isDeleted;
      suspendBtn.textContent = isSuspended ? "Re-enable account" : "Suspend account";
      suspendBtn.onclick = async () => {
        closeActionsMenu();
        const reason = !isSuspended ? window.prompt("Reason for suspension (optional):") : null;
        if (!isSuspended && reason === null) return;
        try {
          if (isSuspended) await apiPost(`/master/tenants/${tenant.id}/unsuspend`);
          else await apiPost(`/master/tenants/${tenant.id}/suspend`, { reason: reason || null });
          await refresh();
        } catch (error) {
          alert(error.message);
        }
      };
    }

    const restoreBtn = document.getElementById("detail-restore-tenant");
    if (restoreBtn) {
      restoreBtn.hidden = !isDeleted;
      restoreBtn.onclick = async () => {
        closeActionsMenu();
        if (!window.confirm(`Restore ${tenant.name}?`)) return;
        try {
          await apiPost(`/master/tenants/${tenant.id}/restore`);
          await refresh();
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
      deleteBtn.onclick = () => deleteTenantWithConfirm(tenant, ctx);
    }

    const deleteHint = document.getElementById("detail-delete-hint");
    if (deleteHint) {
      const deleteGuard = tenantDeleteGuard(tenant);
      deleteHint.hidden = isDeleted || deleteGuard.allowed;
      deleteHint.textContent = deleteGuard.reason || "";
    }

    document.getElementById("detail-extend-trial").onclick = async () => {
      closeActionsMenu();
      const daysRaw = window.prompt("Extend trial by how many days?", "14");
      if (daysRaw === null) return;
      const days = Number(daysRaw);
      if (!Number.isFinite(days) || days < 1) return alert("Enter a valid number of days");
      try {
        await apiPost(`/master/tenants/${tenant.id}/extend-trial`, { days });
        await refresh();
      } catch (error) {
        alert(error.message);
      }
    };

    const offlineTrialBtn = document.getElementById("detail-offline-trial");
    if (offlineTrialBtn) {
      offlineTrialBtn.hidden = isDeleted || tenant.billing_mode === "offline";
      offlineTrialBtn.onclick = async () => {
        closeActionsMenu();
        const billingNotes = window.prompt(
          "Switch to offline billing but keep the current trial?\n\nOptional billing note (invoice ref, agreed price):",
          tenant.billing_notes || "",
        );
        if (billingNotes === null) return;
        try {
          const result = await apiPost(`/master/tenants/${tenant.id}/billing`, {
            billing_mode: "offline",
            subscription_status: "trialing",
            billing_notes: billingNotes.trim() || tenant.billing_notes || "",
          });
          await refresh();
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
        closeActionsMenu();
        const billingNotes = window.prompt(
          "Mark this tenant as offline billing with active access (ends trial)?\n\nOptional billing note (invoice ref, agreed price):",
          tenant.billing_notes || "",
        );
        if (billingNotes === null) return;
        try {
          const result = await apiPost(`/master/tenants/${tenant.id}/billing`, {
            billing_mode: "offline",
            subscription_status: "active",
            billing_notes: billingNotes.trim() || tenant.billing_notes || "",
          });
          await refresh();
          reportOfflineBillingResult(result, "Tenant is now on offline billing with active access.");
        } catch (error) {
          alert(error.message);
        }
      };
    }

    document.getElementById("detail-email-tenant").onclick = async () => {
      closeActionsMenu();
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

  global.ShiftSwiftMasterTenantDetail = {
    render: renderTenantDetail,
    tenantDeleteGuard,
  };
})(window);
