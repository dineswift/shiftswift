/** Admin promotions — validate discount/referral codes (platform ops). */
(async function initAdminPromotions() {
  const {
    apiFetch,
    loadFormOptions,
    mountEditForm,
    FORM_SCHEMAS,
    escapeHtml,
    parseHashBaseSection,
    downloadAuthenticated,
    isPlatformAdmin,
  } = window.Admin;

  let validateForm = null;
  let discountCodes = [];
  let referralCodes = [];
  let showInactiveDiscount = false;
  let showInactiveReferral = false;
  let exportsBound = false;

  function formatDiscount(row) {
    if (row.discount_type === "percent") return `${row.discount_value}% off`;
    return `£${row.discount_value.toFixed(2)} off`;
  }

  function formatReferralReward(row) {
    if (row.reward_type === "percent") return `${row.reward_value}% off`;
    if (row.reward_type === "trial_days") return `+${parseInt(row.reward_value, 10)} trial days`;
    return `£${row.reward_value.toFixed(2)} off`;
  }

  function formatUsage(used, max) {
    if (max == null) return `${used} used`;
    return `${used}/${max}`;
  }

  function visibleDiscountCodes() {
    if (showInactiveDiscount) return discountCodes;
    return discountCodes.filter((row) => row.is_active);
  }

  function visibleReferralCodes() {
    if (showInactiveReferral) return referralCodes;
    return referralCodes.filter((row) => row.is_active);
  }

  function renderValidationResult(data, isError = false) {
    const panel = document.getElementById("promo-validation-result");
    if (!panel) return;
    panel.hidden = false;
    panel.classList.toggle("promo-result--error", isError);
    panel.classList.toggle("promo-result--ok", !isError && data?.valid);

    if (isError || !data?.valid) {
      panel.innerHTML = `
        <h3>Validation failed</h3>
        <p class="promo-result-message">${escapeHtml(data?.message || data?.detail || "Invalid codes")}</p>`;
      return;
    }

    const trialNote = data.extra_trial_days
      ? `<li><strong>Extra trial:</strong> +${escapeHtml(data.extra_trial_days)} days</li>`
      : "";
    const partnerNote = data.partner_name
      ? `<li><strong>Partner:</strong> ${escapeHtml(data.partner_name)}</li>`
      : "";

    panel.innerHTML = `
      <h3>Valid for billing</h3>
      <p class="promo-result-message promo-result-message--ok">${escapeHtml(data.message)}</p>
      <ul class="promo-result-list">
        <li><strong>List price:</strong> £${escapeHtml(data.price_gbp_ex_vat)} + VAT / month</li>
        <li><strong>Discount applied:</strong> £${escapeHtml(data.discount_applied_gbp)}</li>
        <li><strong>Adjusted price:</strong> £${escapeHtml(data.adjusted_price_gbp_ex_vat)} + VAT (£${escapeHtml(data.adjusted_price_gbp_inc_vat)} inc VAT)</li>
        ${trialNote}
        ${partnerNote}
      </ul>`;
  }

  function prefillValidator({ planId, discountCode, referralCode } = {}) {
    if (!validateForm) return;
    if (planId) validateForm.querySelector('[name="plan_id"]').value = planId;
    if (discountCode != null) validateForm.querySelector('[name="discount_code"]').value = discountCode;
    if (referralCode != null) validateForm.querySelector('[name="referral_code"]').value = referralCode;
    document.querySelector(".promo-validator-surface")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function mountPromoValidator() {
    const host = document.getElementById("promo-validate-form");
    if (!host || host.dataset.mounted === "true") return;

    let defaultPlan = "";
    try {
      await loadFormOptions();
      const statusRes = await apiFetch("/billing/status");
      if (statusRes.ok) {
        const status = await statusRes.json();
        defaultPlan = status.subscription_plan || "";
      }
    } catch {
      /* optional prefill */
    }

    validateForm = mountEditForm(host, FORM_SCHEMAS.promoValidate, {
      values: { plan_id: defaultPlan },
      onSubmit: async (payload) => {
        const discount_code = payload.discount_code?.trim() || null;
        const referral_code = payload.referral_code?.trim() || null;
        if (!discount_code && !referral_code) {
          throw new Error("Enter a discount code, referral code, or both.");
        }
        const res = await apiFetch("/billing/validate-promo", {
          method: "POST",
          body: JSON.stringify({
            plan_id: payload.plan_id,
            discount_code,
            referral_code,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          renderValidationResult(data, true);
          throw new Error(data.detail || data.message || "Validation failed");
        }
        if (!data.valid) {
          renderValidationResult(data, true);
          throw new Error(data.message || "Invalid codes");
        }
        renderValidationResult(data);
      },
    });
    host.dataset.mounted = "true";
  }

  function renderDiscountTable() {
    const tbody = document.getElementById("discount-codes-body");
    if (!tbody) return;
    const rows = visibleDiscountCodes();
    if (!discountCodes.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No discount codes configured.</td></tr>';
      return;
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No active discount codes. Toggle “Show inactive” to see archived codes.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((row) => {
        return `<tr class="hr-register-row">
          <td><strong>${escapeHtml(row.code)}</strong>${row.label ? `<span class="muted promo-code-label">${escapeHtml(row.label)}</span>` : ""}</td>
          <td>${escapeHtml(formatDiscount(row))}</td>
          <td>${row.applicable_plan_ids?.length ? escapeHtml(row.applicable_plan_ids.join(", ")) : "<span class='muted'>All</span>"}</td>
          <td>${escapeHtml(formatUsage(row.redemption_count, row.max_redemptions))}</td>
          <td><button type="button" class="btn ghost btn-sm" data-test-discount="${escapeHtml(row.code)}">Test</button></td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("[data-test-discount]").forEach((btn) => {
      btn.addEventListener("click", () => prefillValidator({ discountCode: btn.dataset.testDiscount }));
    });
  }

  function renderReferralTable() {
    const tbody = document.getElementById("referral-codes-body");
    if (!tbody) return;
    const rows = visibleReferralCodes();
    if (!referralCodes.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No referral codes configured.</td></tr>';
      return;
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No active referral codes. Toggle “Show inactive” to see archived codes.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((row) => {
        const exportBtn = isPlatformAdmin()
          ? `<button type="button" class="btn ghost btn-sm" data-export-referral="${escapeHtml(row.code)}">CSV</button>`
          : "";
        return `<tr class="hr-register-row">
          <td><strong>${escapeHtml(row.code)}</strong></td>
          <td>${escapeHtml(row.partner_name)}</td>
          <td>${escapeHtml(formatReferralReward(row))}</td>
          <td>${escapeHtml(formatUsage(row.use_count, row.max_uses))}</td>
          <td class="promo-row-actions">
            <button type="button" class="btn ghost btn-sm" data-test-referral="${escapeHtml(row.code)}">Test</button>
            ${exportBtn}
          </td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("[data-test-referral]").forEach((btn) => {
      btn.addEventListener("click", () => prefillValidator({ referralCode: btn.dataset.testReferral }));
    });
    tbody.querySelectorAll("[data-export-referral]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await exportIntroducerCode(btn.dataset.exportReferral);
        } catch (error) {
          alert(error.message || "Export failed");
        }
      });
    });
  }

  async function loadDiscountCodes() {
    const tbody = document.getElementById("discount-codes-body");
    if (!tbody) return;
    try {
      const res = await apiFetch("/admin/billing/discount-codes");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      discountCodes = data.items || [];
      renderDiscountTable();
    } catch {
      discountCodes = [];
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Could not load discount codes.</td></tr>';
    }
  }

  function setupIntroducerExports() {
    const toolbar = document.getElementById("introducer-export-actions");
    if (!toolbar || !isPlatformAdmin()) return;
    toolbar.hidden = false;
    if (exportsBound) return;
    exportsBound = true;

    document.getElementById("export-all-introducers-btn")?.addEventListener("click", async () => {
      try {
        await downloadAuthenticated("/admin/billing/introducer-commission.csv", "shiftswift-introducers-all.csv");
      } catch (error) {
        alert(error.message || "Export failed");
      }
    });
  }

  async function exportIntroducerCode(code) {
    const safe = encodeURIComponent(code);
    await downloadAuthenticated(
      `/admin/billing/introducer-commission.csv?referral_code=${safe}`,
      `shiftswift-introducer-${code}.csv`
    );
  }

  async function loadReferralCodes() {
    const tbody = document.getElementById("referral-codes-body");
    if (!tbody) return;
    try {
      const res = await apiFetch("/admin/billing/referral-codes");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      referralCodes = data.items || [];
      renderReferralTable();
    } catch {
      referralCodes = [];
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Could not load referral codes.</td></tr>';
    }
  }

  function bindCatalogToggles() {
    const discountToggle = document.getElementById("promo-show-inactive-discount");
    const referralToggle = document.getElementById("promo-show-inactive-referral");
    if (discountToggle && !discountToggle.dataset.bound) {
      discountToggle.dataset.bound = "true";
      discountToggle.addEventListener("change", () => {
        showInactiveDiscount = discountToggle.checked;
        renderDiscountTable();
      });
    }
    if (referralToggle && !referralToggle.dataset.bound) {
      referralToggle.dataset.bound = "true";
      referralToggle.addEventListener("change", () => {
        showInactiveReferral = referralToggle.checked;
        renderReferralTable();
      });
    }
  }

  async function loadPromotionsSection() {
    if (!isPlatformAdmin()) return;
    setupIntroducerExports();
    bindCatalogToggles();
    await mountPromoValidator();
    await Promise.all([loadDiscountCodes(), loadReferralCodes()]);
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "promotions") loadPromotionsSection();
  });

  if (parseHashBaseSection(window.location.hash) === "promotions") loadPromotionsSection();
})();
