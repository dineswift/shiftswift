/**
 * Shared subscription pricing — platform HR plans only
 */
(function () {
  function resolveApiBase() {
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    return localStorage.getItem("apiBaseUrl") || "http://localhost:3000";
  }

  const API_BASE = resolveApiBase();

  const FALLBACK_PLATFORM_PLANS = [
    {
      id: "site_starter_monthly",
      name: "Essentials",
      description: "HR records, RTW checks, and geofenced time clock.",
      billing_interval: "month",
      max_employees: 40,
      billing_model: "base_plus_per_head",
      base_price_gbp_ex_vat: 9,
      price_per_active_employee_gbp_ex_vat: 2,
      monthly_cap_gbp_ex_vat: 49,
      price_gbp_ex_vat: 9,
      price_gbp_inc_vat: 10.8,
      features: [
        "Employee records & lifecycle",
        "Right-to-work checks",
        "Geofenced time clock (mobile PWA)",
        "Document storage",
        "Email support",
      ],
    },
    {
      id: "site_medium_monthly",
      name: "Compliance",
      description: "Sponsor licence duties, day-9 absence alerts, Home Office audit exports.",
      billing_interval: "month",
      max_employees: 100,
      billing_model: "base_plus_per_head",
      base_price_gbp_ex_vat: 19,
      price_per_active_employee_gbp_ex_vat: 3,
      monthly_cap_gbp_ex_vat: 79,
      price_gbp_ex_vat: 19,
      price_gbp_inc_vat: 22.8,
      features: [
        "Everything in Essentials",
        "Day-9 absence alerts (clock-in linked)",
        "Sponsor licence compliance",
        "Home Office audit export",
        "Grievance workflows",
        "SMS alerts · Priority support",
      ],
    },
    {
      id: "site_growth_monthly",
      name: "Multi-site",
      description: "Consolidated compliance across locations — API and account support.",
      billing_interval: "month",
      max_employees: 200,
      billing_model: "base_plus_per_head",
      base_price_gbp_ex_vat: 29,
      price_per_active_employee_gbp_ex_vat: 2,
      monthly_cap_gbp_ex_vat: 129,
      price_gbp_ex_vat: 29,
      price_gbp_inc_vat: 34.8,
      features: [
        "Everything in Compliance",
        "Multi-site dashboard",
        "Custom onboarding workflows",
        "API access",
        "Dedicated account manager",
      ],
    },
  ];

  function renderExportPartners(container) {
    if (container) container.hidden = true;
  }

  const renderPayrollPartners = renderExportPartners;

  let cachedCatalog = null;

  function formatMoney(value) {
    return Number(value).toFixed(2).replace(/\.00$/, "");
  }

  function planBasePrice(plan) {
    return Number(plan.base_price_gbp_ex_vat ?? plan.price_gbp_ex_vat ?? 0);
  }

  function planPerHeadPrice(plan) {
    return Number(plan.price_per_active_employee_gbp_ex_vat ?? 0);
  }

  function planMonthlyCap(plan) {
    const cap = plan.monthly_cap_gbp_ex_vat;
    return cap == null ? null : Number(cap);
  }

  function usesPerHeadPricing(plan) {
    return planPerHeadPrice(plan) > 0 || plan.billing_model === "base_plus_per_head";
  }

  function maxBillableSeatsUnderCap(plan) {
    const cap = planMonthlyCap(plan);
    const perHead = planPerHeadPrice(plan);
    const base = planBasePrice(plan);
    if (cap == null || perHead <= 0) return null;
    return Math.max(0, Math.floor((cap - base) / perHead));
  }

  function billableSeatQuantity(plan, activeEmployees) {
    const seats = Math.max(0, Number(activeEmployees) || 0);
    const maxUnderCap = maxBillableSeatsUnderCap(plan);
    if (maxUnderCap != null) return Math.min(seats, maxUnderCap);
    return seats;
  }

  function estimateMonthlyBill(plan, activeEmployees) {
    const billable = billableSeatQuantity(plan, activeEmployees);
    const base = planBasePrice(plan);
    const perHead = planPerHeadPrice(plan);
    return base + billable * perHead;
  }

  function pricingExamplesHtml(plan) {
    const samples = [5, 10, 20].filter((n) => n <= plan.max_employees);
    if (!samples.length) samples.push(Math.min(5, plan.max_employees));
    return samples
      .map(
        (n) =>
          `<li><strong>${n} staff</strong> ≈ £${formatMoney(estimateMonthlyBill(plan, n))} + VAT / month</li>`
      )
      .join("");
  }

  function signupPerHeadPricingHtml(plan, activeEmployees) {
    const headcount = clampHeadcountToPlan(plan, activeEmployees);
    const billable = billableSeatQuantity(plan, headcount);
    const total = estimateMonthlyBill(plan, headcount);
    const incVat = formatMoney(total * 1.2);
    const cap = planMonthlyCap(plan);
    const capLine =
      cap != null ? `<p class="pricing-staff-cap">Cap £${formatMoney(cap)} + VAT / month</p>` : "";
    return `
        <div class="pricing-amount">
          <span class="currency">£</span>
          <span class="value">${formatMoney(total)}</span>
          <span class="interval">+ VAT / month</span>
        </div>
        <p class="pricing-vat"><strong>£${incVat}</strong> inc. VAT · ${billable} employee${billable === 1 ? "" : "s"}</p>
        ${capLine}`;
  }

  function perHeadPricingHtml(plan) {
    const base = formatMoney(planBasePrice(plan));
    const perHead = formatMoney(planPerHeadPrice(plan));
    const cap = planMonthlyCap(plan);
    const capLine = cap != null ? `<p class="pricing-staff-cap">Capped at £${formatMoney(cap)} + VAT / month</p>` : "";
    return `
        <div class="pricing-amount">
          <span class="currency">£</span>
          <span class="value">${base}</span>
          <span class="interval">base + VAT / month</span>
        </div>
        <p class="pricing-vat">+ <strong>£${perHead}</strong> per active employee / month (ex VAT)</p>
        ${capLine}
        <ul class="pricing-examples">${pricingExamplesHtml(plan)}</ul>`;
  }

  function intervalLabel(interval) {
    return interval === "year" ? "/ year" : "/ month";
  }

  function isFeatured(plan) {
    return plan.id === "site_medium_monthly";
  }

  function plansForBillingInterval(plans, billing) {
    return plans.filter((p) => p.billing_interval === "month");
  }

  function suggestedPayrollPlan(platformPlanId, payrollPlans) {
    const platform = (cachedCatalog?.platform_plans || FALLBACK_PLATFORM_PLANS).find(
      (p) => p.id === platformPlanId
    );
    if (!platform) return null;
    const match = payrollPlans.find((p) => p.max_employees >= platform.max_employees);
    return match?.id || payrollPlans[payrollPlans.length - 1]?.id || null;
  }

  function resolvePlanParam(raw, platformPlans) {
    const monthly = platformPlans.filter((p) => p.billing_interval === "month");
    const pool = monthly.length ? monthly : platformPlans;
    if (!raw) return pool.find((p) => p.id === "site_starter_monthly")?.id || pool[0]?.id || "site_starter_monthly";

    const key = String(raw).toLowerCase().trim();
    const exact = pool.find((p) => p.id === key);
    if (exact) return exact.id;

    const slugMap = {
      essentials: "site_starter_monthly",
      starter: "site_starter_monthly",
      compliance: "site_medium_monthly",
      growth: "site_medium_monthly",
      medium: "site_medium_monthly",
      multisite: "site_growth_monthly",
      scale: "site_growth_monthly",
    };
    if (slugMap[key]) {
      const slugMatch = pool.find((p) => p.id === slugMap[key]);
      if (slugMatch) return slugMatch.id;
    }

    const byName = pool.find((p) => p.name.toLowerCase().includes(key));
    if (byName) return byName.id;

    return pool[0]?.id || "site_starter_monthly";
  }

  function planSelectLabel(plan) {
    if (usesPerHeadPricing(plan)) {
      const cap = planMonthlyCap(plan);
      const capText = cap != null ? ` · cap £${formatMoney(cap)}` : "";
      return `${plan.name} · £${formatMoney(planBasePrice(plan))} + £${formatMoney(planPerHeadPrice(plan))}/head${capText}`;
    }
    const interval = plan.billing_interval === "year" ? "/ year" : "/ month";
    return `${plan.name} · £${formatMoney(plan.price_gbp_ex_vat)} + VAT ${interval} · up to ${plan.max_employees} staff`;
  }

  function populateSignupSelects(platformPlans, payrollPlans, selectedPlanId, selectedPayrollPlanId) {
    const hrSelect = document.getElementById("signup-hr-plan-select");
    const payrollSelect = document.getElementById("signup-payroll-plan-select");
    const monthly = platformPlans.filter((p) => p.billing_interval === "month");

    if (hrSelect) {
      hrSelect.innerHTML = monthly
        .map(
          (plan) =>
            `<option value="${plan.id}"${plan.id === selectedPlanId ? " selected" : ""}>${planSelectLabel(plan)}</option>`
        )
        .join("");
    }

    if (payrollSelect) {
      payrollSelect.innerHTML =
        `<option value="">HR only</option>` +
        payrollPlans
          .map(
            (plan) =>
              `<option value="${plan.id}"${plan.id === selectedPayrollPlanId ? " selected" : ""}>${plan.name} · £${formatMoney(plan.price_gbp_ex_vat)} + VAT / month · up to ${plan.max_employees} staff</option>`
          )
          .join("");
    }
  }

  async function fetchCatalog() {
    if (cachedCatalog) return cachedCatalog;
    try {
      const res = await fetch(`${API_BASE}/billing/plans`);
      if (!res.ok) throw new Error("API unavailable");
      const data = await res.json();
      const platform = (data.platform_plans || data.plans || []).filter(
        (item) => item.id && item.name && item.price_gbp_ex_vat != null
      );
      const payroll = (data.payroll_plans || []).filter(
        (item) => item.id && item.name && item.price_gbp_ex_vat != null
      );
      cachedCatalog = {
        platform_plans: platform.length ? platform : FALLBACK_PLATFORM_PLANS,
        payroll_plans: [],
      };
    } catch {
      cachedCatalog = {
        platform_plans: FALLBACK_PLATFORM_PLANS,
        payroll_plans: [],
      };
    }
    return cachedCatalog;
  }

  async function fetchPlans() {
    const catalog = await fetchCatalog();
    return catalog.platform_plans;
  }

  function planSignupParam(plan) {
    if (plan.id === "site_starter_monthly") return "essentials";
    if (plan.id === "site_medium_monthly") return "compliance";
    if (plan.id === "site_growth_monthly") return "multisite";
    return plan.id;
  }

  function planCardHtml(plan, options) {
    const mode = options.mode || "marketing";
    const cardType = options.cardType || "platform";
    const selected =
      cardType === "payroll"
        ? options.selectedPayrollPlanId === plan.id
        : options.selectedPlanId === plan.id;
    const featured = cardType === "platform" && isFeatured(plan);
    const interval = intervalLabel(plan.billing_interval);
    const perHead = usesPerHeadPricing(plan);
    const exVat = formatMoney(planBasePrice(plan));
    const incVat = formatMoney(planBasePrice(plan) * 1.2);
    const signupHeadcount = options.signupHeadcount;
    const pricingBlock = perHead
      ? signupHeadcount != null
        ? signupPerHeadPricingHtml(plan, signupHeadcount)
        : perHeadPricingHtml(plan)
      : `
        <div class="pricing-amount">
          <span class="currency">£</span>
          <span class="value">${exVat}</span>
          <span class="interval">+ VAT ${interval}</span>
        </div>
        <p class="pricing-vat"><strong>£${incVat}</strong> inc. 20% VAT ${interval.replace("/", "per")}</p>
        <p class="pricing-staff-cap">Up to ${plan.max_employees} employees · one site</p>`;

    let actions = "";
    if (mode === "marketing") {
      const query = `plan=${encodeURIComponent(planSignupParam(plan))}`;
      actions = `
        <div class="pricing-card-actions">
          <a class="btn" href="./signup.html?${query}">Start 14-day trial</a>
          <a class="pricing-link-cta" href="./signup.html?${query}&amp;subscribe=1">Subscribe now</a>
        </div>`;
    } else if (cardType === "payroll") {
      actions = `
        <div class="pricing-card-actions">
          <button type="button" class="btn ${selected ? "" : "ghost"}" data-select-payroll="${plan.id}">
            ${selected ? "Selected" : "Add integration"}
          </button>
        </div>`;
    } else {
      actions = `
        <div class="pricing-card-actions">
          <button type="button" class="btn ${selected ? "" : "ghost"}" data-select-plan="${plan.id}">
            ${selected ? "Selected" : "Select plan"}
          </button>
        </div>`;
    }

    return `
      <article class="pricing-card ${featured ? "is-featured" : ""} ${selected ? "is-selected" : ""} pricing-card--${cardType}"
               data-plan-id="${plan.id}" data-card-type="${cardType}">
        <div class="pricing-card-head">
          ${featured ? '<span class="pricing-badge">Best for sponsors</span>' : ""}
          ${cardType === "payroll" ? '<span class="pricing-badge pricing-badge--payroll">Legacy add-on</span>' : ""}
          <div class="pricing-plan-name">${plan.name}</div>
          <p class="pricing-plan-desc">${plan.description}</p>
        </div>
        ${pricingBlock}
        <ul class="pricing-features">
          ${(plan.features || []).map((f) => `<li>${f}</li>`).join("")}
        </ul>
        ${actions}
      </article>`;
  }

  function payrollSkipCardHtml(selected, mode) {
    if (mode !== "selectable") return "";
    return `
      <article class="pricing-card pricing-card--payroll pricing-card--skip ${selected ? "is-selected" : ""}"
               data-plan-id="" data-card-type="payroll-skip">
        <div class="pricing-card-head">
          <div class="pricing-plan-name">HR only</div>
          <p class="pricing-plan-desc">Platform subscription — HR and compliance in ShiftSwift.</p>
        </div>
        <div class="pricing-amount">
          <span class="value" style="font-size:1.5rem;">£0</span>
          <span class="interval">HR platform</span>
        </div>
        <p class="pricing-staff-cap">HR records, time clock, and compliance tools</p>
        <div class="pricing-card-actions">
          <button type="button" class="btn ${selected ? "" : "ghost"}" data-select-payroll="">
            ${selected ? "Selected" : "HR only"}
          </button>
        </div>
      </article>`;
  }

  function renderPlans(container, plans, options) {
    if (!container) return;
    container.innerHTML = plans.map((plan) => planCardHtml(plan, options)).join("");

    if (options.mode === "selectable" && options.cardType !== "payroll") {
      container.querySelectorAll("[data-select-plan]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const planId = btn.getAttribute("data-select-plan");
          if (options.onSelect) options.onSelect(planId);
          renderPlans(container, plans, { ...options, selectedPlanId: planId });
        });
      });
    }
  }

  function renderPayrollPlans(container, plans, options) {
    if (!container) return;
    const skipSelected = !options.selectedPayrollPlanId;
    container.innerHTML =
      payrollSkipCardHtml(skipSelected, options.mode) +
      plans.map((plan) => planCardHtml(plan, options)).join("");

    if (options.mode === "selectable") {
      container.querySelectorAll("[data-select-payroll]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const planId = btn.getAttribute("data-select-payroll") || "";
          if (options.onPayrollSelect) options.onPayrollSelect(planId || null);
          renderPayrollPlans(container, plans, { ...options, selectedPayrollPlanId: planId || null });
          updateSummary(options.selectedPlanId, options.platformPlans, planId || null, plans);
        });
      });
    }
  }

  function readSignupHeadcount() {
    const input = document.getElementById("signup-active-employees");
    return Math.max(0, Number(input?.value) || 0);
  }

  function clampHeadcountToPlan(plan, headcount) {
    const max = Number(plan?.max_employees) || 500;
    return Math.min(Math.max(0, headcount), max);
  }

  function billingSummaryText(plan, activeEmployees) {
    const headcount = clampHeadcountToPlan(plan, activeEmployees);
    const interval = intervalLabel(plan.billing_interval).trim();
    const detailEl = document.getElementById("signup-summary-detail");
    if (!usesPerHeadPricing(plan)) {
      if (detailEl) detailEl.textContent = `Flat plan · up to ${plan.max_employees} employees on this tier.`;
      return `£${formatMoney(plan.price_gbp_ex_vat)} + VAT ${interval} · up to ${plan.max_employees} staff`;
    }
    const billable = billableSeatQuantity(plan, headcount);
    const total = estimateMonthlyBill(plan, headcount);
    const incVat = formatMoney(total * 1.2);
    const cap = planMonthlyCap(plan);
    let priceText = `≈ £${formatMoney(total)} + VAT / month (£${incVat} inc. VAT)`;
    if (cap != null) priceText += ` · cap £${formatMoney(cap)} + VAT`;
    if (detailEl) {
      let detail = `£${formatMoney(planBasePrice(plan))} base + £${formatMoney(
        planPerHeadPrice(plan)
      )} × ${billable} employee${billable === 1 ? "" : "s"} (ex VAT).`;
      if (headcount > billable && cap != null) {
        detail += ` Monthly cap reached — billed for ${billable} of ${headcount} employees entered.`;
      }
      detailEl.textContent = detail;
    }
    return priceText;
  }

  function updateSummary(planId, platformPlans, payrollPlanId, payrollPlans, activeEmployees) {
    const summary = document.getElementById("signup-plan-summary");
    if (!summary) return;
    const plan = platformPlans.find((p) => p.id === planId);
    if (!plan) return;

    const hrLine = document.getElementById("signup-summary-hr");
    const payrollLine = document.getElementById("signup-summary-payroll");
    const priceLine = document.getElementById("signup-summary-price");

    const payroll = payrollPlanId ? payrollPlans.find((p) => p.id === payrollPlanId) : null;
    const headcount = activeEmployees ?? readSignupHeadcount();

    if (hrLine) hrLine.textContent = `${plan.name} · HR platform`;
    if (payrollLine) {
      payrollLine.hidden = true;
    }
    if (priceLine) {
      priceLine.textContent = billingSummaryText(plan, headcount);
    }

    const headcountInput = document.getElementById("signup-active-employees");
    if (headcountInput) {
      headcountInput.max = String(plan.max_employees);
      const clamped = clampHeadcountToPlan(plan, headcount);
      if (Number(headcountInput.value) !== clamped) headcountInput.value = String(clamped);
    }

    summary.hidden = false;
    const hiddenPlan = document.getElementById("selected-plan-id");
    if (hiddenPlan) hiddenPlan.value = plan.id;

    const hrSelect = document.getElementById("signup-hr-plan-select");
    if (hrSelect && hrSelect.value !== plan.id) hrSelect.value = plan.id;
  }

  async function initMarketing(platformContainerId, payrollContainerId) {
    const platformContainer = document.getElementById(platformContainerId);
    const payrollContainer = payrollContainerId ? document.getElementById(payrollContainerId) : null;
    const toggle = document.getElementById("pricing-billing-toggle");
    let catalog = {
      platform_plans: FALLBACK_PLATFORM_PLANS,
      payroll_plans: [],
    };
    let billing = "month";

    function renderPlatformPlans() {
      if (!platformContainer) return;
      const plans = plansForBillingInterval(catalog.platform_plans, billing);
      renderPlans(platformContainer, plans, { mode: "marketing", cardType: "platform", billing });
      if (platformContainer.classList.contains("reveal-stagger")) {
        const inView = platformContainer.getBoundingClientRect().top < window.innerHeight * 0.92;
        platformContainer.classList.remove("is-visible");
        requestAnimationFrame(() => {
          if (inView) platformContainer.classList.add("is-visible");
        });
      }
      document.dispatchEvent(new CustomEvent("shiftswift:pricing-rendered"));
    }

    if (platformContainer) {
      platformContainer.innerHTML = '<div class="pricing-loading">Loading plans…</div>';
    }

    try {
      catalog = await fetchCatalog();
    } catch (_err) {
      catalog = {
        platform_plans: FALLBACK_PLATFORM_PLANS,
        payroll_plans: [],
      };
    }

    renderPlatformPlans();
    if (payrollContainer) {
      payrollContainer.hidden = true;
    }

    if (toggle) {
      toggle.hidden = true;
      toggle.setAttribute("aria-hidden", "true");
    }

    initBillingCalculator(catalog.platform_plans);
  }

  function initBillingCalculator(platformPlans) {
    const root = document.getElementById("pricing-calculator");
    if (!root) return;

    const planSelect = root.querySelector("#pricing-calc-plan");
    const headcountInput = root.querySelector("#pricing-calc-headcount");
    const resultEl = root.querySelector("#pricing-calc-result");
    const detailEl = root.querySelector("#pricing-calc-detail");
    if (!planSelect || !headcountInput || !resultEl) return;

    const monthlyPlans = (platformPlans || FALLBACK_PLATFORM_PLANS).filter(
      (p) => p.billing_interval === "month"
    );
    planSelect.innerHTML = monthlyPlans
      .map((p) => `<option value="${p.id}">${planSelectLabel(p)}</option>`)
      .join("");
    const defaultPlan = monthlyPlans.find((p) => p.id === "site_medium_monthly") || monthlyPlans[0];
    if (defaultPlan) {
      planSelect.value = defaultPlan.id;
    }

    function renderEstimate() {
      const plan = monthlyPlans.find((p) => p.id === planSelect.value) || monthlyPlans[0];
      if (!plan) return;
      const active = Math.max(0, Number(headcountInput.value) || 0);
      const billable = billableSeatQuantity(plan, active);
      const total = estimateMonthlyBill(plan, active);
      const incVat = formatMoney(total * 1.2);
      const cap = planMonthlyCap(plan);
      const capSuffix = cap != null ? ` · cap £${formatMoney(cap)} + VAT` : "";
      resultEl.textContent = `≈ £${formatMoney(total)} + VAT / month (£${incVat} inc. VAT)${capSuffix}`;
      if (detailEl) {
        const capNote =
          active > billable && cap != null
            ? ` Monthly cap reached — billed for ${billable} of ${active} active employees.`
            : "";
        detailEl.textContent = `£${formatMoney(planBasePrice(plan))} base + £${formatMoney(
          planPerHeadPrice(plan)
        )} × ${billable} active employee${billable === 1 ? "" : "s"} (ex VAT).${capNote}`;
      }
    }

    planSelect.addEventListener("change", renderEstimate);
    headcountInput.addEventListener("input", renderEstimate);
    renderEstimate();
  }

  let currentSelectedPlan = "site_medium_monthly";
  let currentSelectedPayroll = null;

  async function initSignup(platformContainerId, payrollContainerId) {
    const platformContainer = document.getElementById(platformContainerId);
    const payrollContainer = document.getElementById(payrollContainerId);
    const params = new URLSearchParams(window.location.search);
    const catalog = await fetchCatalog();
    let selectedPlanId = resolvePlanParam(params.get("plan"), catalog.platform_plans);
    let selectedPayrollPlanId = params.get("payroll") || null;
    if (selectedPayrollPlanId && !catalog.payroll_plans.find((p) => p.id === selectedPayrollPlanId)) {
      selectedPayrollPlanId = null;
    }

    populateSignupSelects(catalog.platform_plans, [], selectedPlanId, null);

    function syncFromSelects() {
      const hrSelect = document.getElementById("signup-hr-plan-select");
      selectedPlanId = hrSelect?.value || selectedPlanId;
      selectedPayrollPlanId = null;
      currentSelectedPlan = selectedPlanId;
      currentSelectedPayroll = null;
      const url = new URL(window.location.href);
      url.searchParams.set("plan", selectedPlanId);
      url.searchParams.delete("payroll");
      window.history.replaceState({}, "", url);
      const headcount = readSignupHeadcount();
      updateSummary(selectedPlanId, catalog.platform_plans, null, [], headcount);
      if (platformContainer) {
        renderPlans(platformContainer, catalog.platform_plans.filter((p) => p.billing_interval === "month"), {
          mode: "selectable",
          cardType: "platform",
          selectedPlanId,
          signupHeadcount: headcount,
          platformPlans: catalog.platform_plans,
          payrollPlans: [],
          onSelect: (id) => {
            selectedPlanId = id;
            if (hrSelect) hrSelect.value = id;
            syncFromSelects();
          },
        });
      }
      if (payrollContainer) {
        payrollContainer.hidden = true;
      }
    }

    document.getElementById("signup-hr-plan-select")?.addEventListener("change", syncFromSelects);
    document.getElementById("signup-active-employees")?.addEventListener("input", () => {
      syncFromSelects();
    });

    syncFromSelects();

    return {
      platformPlans: catalog.platform_plans,
      payrollPlans: catalog.payroll_plans,
      selectedPlanId,
      selectedPayrollPlanId,
    };
  }

  function refreshSummary(planId, payrollPlanId) {
    fetchCatalog().then((catalog) => {
      updateSummary(
        planId || currentSelectedPlan,
        catalog.platform_plans,
        payrollPlanId !== undefined ? payrollPlanId : currentSelectedPayroll,
        catalog.payroll_plans,
        readSignupHeadcount()
      );
    });
  }

  window.ShiftSwiftPricing = {
    fetchPlans,
    fetchCatalog,
    initMarketing,
    initBillingCalculator,
    initSignup,
    refreshSummary,
    formatMoney,
    readSignupHeadcount,
    estimateMonthlyBill,
    billableSeatQuantity,
  };
})();
