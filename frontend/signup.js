function resolveSignupApiBase() {
  if (window.ShiftSwiftBrand?.resolveApiBase) {
    return window.ShiftSwiftBrand.resolveApiBase();
  }
  const stored = localStorage.getItem("apiBaseUrl");
  if (stored && !/localhost|127\.0\.0\.1/.test(stored)) {
    return stored;
  }
  return "http://localhost:3000";
}

const API_BASE = resolveSignupApiBase();

function friendlySignupError(message) {
  if (message === "Failed to fetch" || message === "Load failed") {
    return "Cannot reach the signup service. Check your connection and try again, or email support@shiftswifthr.co.uk.";
  }
  if (message === "Unexpected token" || message.startsWith("Unexpected token")) {
    return "The signup service returned an unexpected response. Please try again in a moment.";
  }
  return message || "Signup failed. Please try again.";
}

let currentPlanId = "site_medium_monthly";

function parsePromoCode(raw) {
  const code = String(raw || "").trim();
  if (!code) return { discount_code: null, referral_code: null };
  if (/^ref[-_]/i.test(code)) return { discount_code: null, referral_code: code };
  return { discount_code: code, referral_code: null };
}

function readUrlPromos() {
  const params = new URLSearchParams(window.location.search);
  const discount = params.get("discount") || params.get("promo");
  const referral = params.get("ref") || params.get("referral");
  const promoInput = document.getElementById("promo-code");
  if (!promoInput) return;
  if (discount) promoInput.value = discount;
  else if (referral) promoInput.value = referral;
}

async function applyPromoCodes() {
  const planId = document.getElementById("selected-plan-id")?.value || currentPlanId;
  const promoInput = document.getElementById("promo-code");
  const { discount_code, referral_code } = parsePromoCode(promoInput?.value);
  const promoMessage = document.getElementById("promo-message");

  if (!discount_code && !referral_code) {
    if (promoMessage) promoMessage.textContent = "";
    window.ShiftSwiftPricing?.refreshSummary?.(planId);
    return;
  }

  if (promoMessage) promoMessage.textContent = "Checking code…";

  try {
    const res = await fetch(`${API_BASE}/billing/validate-promo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: planId,
        discount_code,
        referral_code,
        active_employees: window.ShiftSwiftPricing?.readSignupHeadcount?.() ?? 0,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.valid) throw new Error(data.message || data.detail || "Invalid code");

    if (promoMessage) {
      promoMessage.textContent = `${data.message} · £${data.adjusted_price_gbp_ex_vat} + VAT after discount`;
      promoMessage.classList.remove("muted");
      promoMessage.classList.add("promo-success");
    }
    const priceLine = document.getElementById("signup-summary-price");
    if (priceLine && data.adjusted_price_gbp_ex_vat != null) {
      const headcount = window.ShiftSwiftPricing?.readSignupHeadcount?.() ?? 0;
      const suffix = headcount > 0 ? ` · ${headcount} employees` : "";
      priceLine.textContent = `£${data.adjusted_price_gbp_ex_vat} + VAT after discount${suffix}`;
    }
    if (data.extra_trial_days && promoMessage) {
      promoMessage.textContent += ` · +${data.extra_trial_days} extra trial days`;
    }
  } catch (error) {
    if (promoMessage) {
      promoMessage.textContent = error.message;
      promoMessage.classList.add("muted");
      promoMessage.classList.remove("promo-success");
    }
  }
}

function initSignupUi() {
  const vatToggle = document.getElementById("vat-toggle");
  const vatWrap = document.getElementById("vat-field-wrap");
  vatToggle?.addEventListener("click", () => {
    const open = vatWrap?.hidden !== false;
    if (vatWrap) vatWrap.hidden = !open;
    vatToggle.setAttribute("aria-expanded", open ? "true" : "false");
    vatToggle.textContent = open ? "− Hide VAT number" : "+ Add VAT number";
  });

  const holdsSponsor = document.getElementById("holds-sponsor-licence");
  const sponsorAckWrap = document.getElementById("sponsor-ack-wrap");
  const sponsorAck = document.getElementById("sponsor-licence-ack");
  const sponsorDutyNote = document.getElementById("signup-sponsor-duty-note");
  holdsSponsor?.addEventListener("change", () => {
    const show = holdsSponsor.checked;
    if (sponsorAckWrap) sponsorAckWrap.hidden = !show;
    if (sponsorDutyNote) sponsorDutyNote.hidden = !show;
    if (!show && sponsorAck) sponsorAck.checked = false;
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  initSignupUi();
  readUrlPromos();
  const result = await window.ShiftSwiftPricing?.initSignup("signup-pricing-plans", "signup-payroll-plans");
  if (result?.selectedPlanId) currentPlanId = result.selectedPlanId;

  document.getElementById("apply-promo-btn")?.addEventListener("click", applyPromoCodes);
  if (document.getElementById("promo-code")?.value) applyPromoCodes();
});

document.getElementById("signup-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("signup-status");
  const form = event.currentTarget;
  const planId = document.getElementById("selected-plan-id")?.value || currentPlanId;

  if (!planId) {
    if (status) status.textContent = "Please select an HR plan.";
    return;
  }

  const password = form.admin_password.value;
  const confirm = form.admin_password_confirm.value;
  if (password.length < 8) {
    if (status) status.textContent = "Password must be at least 8 characters.";
    return;
  }
  if (password !== confirm) {
    if (status) status.textContent = "Passwords do not match.";
    return;
  }

  if (!form.accept_service_scope?.checked) {
    if (status) status.textContent = "Please confirm you have read the service scope and your responsibilities.";
    return;
  }
  if (!form.accept_eula?.checked) {
    if (status) status.textContent = "Please accept the HR Module EULA.";
    return;
  }
  if (!form.accept_payment_terms?.checked) {
    if (status) status.textContent = "Please accept the B2B payment terms.";
    return;
  }
  if (!form.accept_dpa?.checked) {
    if (status) status.textContent = "Please accept the DPA and privacy policy.";
    return;
  }
  if (form.sponsor_licence_acknowledged?.checked && !form.holds_sponsor_licence?.checked) {
    if (status) status.textContent = "Confirm your organisation holds a UK Sponsor Licence first.";
    return;
  }

  const { discount_code, referral_code } = parsePromoCode(form.promo_code?.value);

  const payload = {
    business_name: form.business_name.value.trim(),
    billing_email: form.billing_email.value.trim(),
    admin_password: password,
    plan_id: planId,
    expected_active_employees: Number(document.getElementById("signup-active-employees")?.value) || 0,
    vat_number: form.vat_number?.value.trim() || null,
    start_trial: form.start_trial.checked,
    discount_code,
    referral_code,
    holds_sponsor_licence: Boolean(form.holds_sponsor_licence?.checked),
    sponsor_licence_acknowledged: Boolean(form.sponsor_licence_acknowledged?.checked),
    accept_service_scope: Boolean(form.accept_service_scope?.checked),
    accept_eula: Boolean(form.accept_eula?.checked),
    accept_payment_terms: Boolean(form.accept_payment_terms?.checked),
    accept_dpa: Boolean(form.accept_dpa?.checked),
  };

  if (status) status.textContent = "Creating your workspace…";

  try {
    const res = await fetch(`${API_BASE}/signup/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      if (!res.ok) {
        throw new Error(`Signup service error (${res.status}). Please try again.`);
      }
    }
    if (!res.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
      throw new Error(message || "Signup failed");
    }

    if (!data.access_token) {
      if (status) {
        status.classList.add("form-success-message");
        status.textContent = data.message || "If this email is eligible, check your inbox for sign-in instructions.";
      }
      return;
    }

    localStorage.setItem("token", data.access_token);
    localStorage.setItem("refreshToken", data.refresh_token);
    localStorage.setItem("tenantId", String(data.tenant_id));
    localStorage.setItem("businessName", payload.business_name);
    localStorage.setItem("subscriptionPlan", data.plan_id);

    if (data.checkout_url) {
      window.location.href = data.checkout_url;
      return;
    }

    window.location.href = `./signup-success.html?tenant=${data.tenant_id}&plan=${encodeURIComponent(data.plan_id)}`;
  } catch (error) {
    if (status) status.textContent = friendlySignupError(error.message);
  }
});
