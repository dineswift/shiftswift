/** Master tenant detail — B2B service agreement (MSA/DPA) management. */
(function (global) {
  "use strict";

  let activeTenantId = null;
  let contracts = [];
  let selectedContractId = null;
  let plansLoaded = false;
  let planOptions = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const STATUS_LABELS = {
    draft: "Draft",
    generated: "Draft",
    sent: "Sent",
    signed: "Signed",
  };

  function statusBadge(status) {
    const label = STATUS_LABELS[status] || status || "Draft";
    const cls =
      status === "signed" ? "master-contract-pill--signed" : status === "sent" ? "master-contract-pill--sent" : "master-contract-pill--draft";
    return `<span class="master-contract-pill ${cls}">${escapeHtml(label)}</span>`;
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return value;
    }
  }

  function shellHtml() {
    return `
      <section class="master-detail-section">
        <h3 class="master-detail-section__title">Service agreements (ShiftSwift ↔ tenant)</h3>
        <p class="muted master-legal-lead">Generate MSA, DPA, and subscription order forms here. The tenant admin sees a read-only register and signs via emailed link.</p>
      </section>
      <section class="master-detail-section master-legal-generate">
        <h4 class="master-legal-subtitle">Generate contract pack</h4>
        <form id="master-contract-generate-form" class="master-legal-form">
          <div class="master-legal-form__grid">
            <label><span>Legal company name</span><input name="customer_legal_name" required /></label>
            <label><span>Trading name</span><input name="customer_trading_name" /></label>
            <label><span>Company number</span><input name="company_number" /></label>
            <label><span>VAT number</span><input name="vat_number" /></label>
            <label class="master-legal-form__wide"><span>Registered address</span><input name="registered_address" /></label>
            <label><span>Signatory email</span><input name="signatory_email" type="email" required /></label>
            <label><span>Signatory name</span><input name="signatory_name" /></label>
            <label><span>Signatory title</span><input name="signatory_title" value="Director" /></label>
            <label><span>Plan</span><select name="plan_id" id="master-contract-plan-select"></select></label>
            <label><span>Effective date</span><input name="effective_date" type="date" required /></label>
            <label><span>Template</span>
              <select name="template_id">
                <option value="pack">Full pack (MSA + DPA + Order)</option>
                <option value="msa">MSA only</option>
                <option value="dpa">DPA only</option>
                <option value="subscription_order">Subscription order only</option>
              </select>
            </label>
          </div>
          <div class="master-legal-form__actions">
            <button type="submit" class="master-btn master-btn--primary">Generate contracts</button>
            <p class="master-inline-status muted" id="master-contract-generate-status" aria-live="polite"></p>
          </div>
        </form>
      </section>
      <section class="master-detail-section">
        <h4 class="master-legal-subtitle">Agreement register</h4>
        <div class="master-table-wrap">
          <table class="master-table master-table--compact" aria-label="Tenant service agreements">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Template</th>
                <th>Status</th>
                <th>Signatory</th>
                <th>Signed</th>
              </tr>
            </thead>
            <tbody id="master-contracts-table-body">
              <tr><td colspan="5" class="muted">Loading…</td></tr>
            </tbody>
          </table>
        </div>
        <div id="master-contract-detail" class="master-legal-detail" hidden></div>
      </section>`;
  }

  function renderTable() {
    const tbody = document.getElementById("master-contracts-table-body");
    if (!tbody) return;
    if (!contracts.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No agreements yet — generate a pack above.</td></tr>';
      return;
    }
    tbody.innerHTML = contracts
      .map((row) => {
        const selected = selectedContractId === row.id ? " is-selected" : "";
        return `<tr class="master-contract-row${selected}" data-contract-id="${row.id}">
          <td><strong>${escapeHtml(row.contract_number)}</strong><div class="muted">${formatDate(row.created_at)}</div></td>
          <td>${escapeHtml(row.template_name || row.template_id)}</td>
          <td>${statusBadge(row.status)}</td>
          <td>${escapeHtml(row.signatory_email)}</td>
          <td>${row.signed_at ? escapeHtml(formatDate(row.signed_at)) : row.sent_at ? '<span class="muted">Awaiting</span>' : '<span class="muted">Not sent</span>'}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".master-contract-row").forEach((row) => {
      row.addEventListener("click", () => selectContract(Number(row.dataset.contractId)));
    });
  }

  async function loadContracts(ctx) {
    if (!activeTenantId) return;
    const tbody = document.getElementById("master-contracts-table-body");
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
    try {
      const data = await ctx.apiGet(`/master/tenants/${activeTenantId}/contracts`);
      contracts = data.items || [];
      renderTable();
      if (selectedContractId && contracts.some((c) => c.id === selectedContractId)) {
        await selectContract(selectedContractId, ctx);
      }
    } catch (error) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(error.message || "Load failed")}</td></tr>`;
    }
  }

  async function loadPrefill(ctx) {
    const form = document.getElementById("master-contract-generate-form");
    if (!form || !activeTenantId) return;
    try {
      const prefill = await ctx.apiGet(`/master/tenants/${activeTenantId}/contracts/prefill`);
      Object.entries(prefill).forEach(([key, value]) => {
        const input = form.elements.namedItem(key);
        if (input && value != null && input.type !== "select-one") input.value = String(value);
      });
      const planSelect = form.elements.namedItem("plan_id");
      if (planSelect && prefill.plan_id) planSelect.value = prefill.plan_id;
    } catch {
      /* optional */
    }
  }

  async function populatePlans(ctx) {
    if (plansLoaded) return;
    const select = document.getElementById("master-contract-plan-select");
    if (!select) return;
    try {
      const data = await ctx.apiGet("/master/plans");
      planOptions = data.plans || data.items || [];
      select.innerHTML = planOptions
        .map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</option>`)
        .join("");
      plansLoaded = true;
    } catch {
      select.innerHTML = '<option value="">Default plan</option>';
    }
  }

  async function selectContract(contractId, ctx) {
    selectedContractId = contractId;
    renderTable();
    const host = document.getElementById("master-contract-detail");
    if (!host) return;
    host.hidden = false;
    host.innerHTML = '<p class="muted">Loading agreement…</p>';
    try {
      const data = await ctx.apiGet(`/master/tenants/${activeTenantId}/contracts/${contractId}`);
      host.innerHTML = `
        <div class="master-legal-detail__head">
          <div><strong>${escapeHtml(data.contract_number)}</strong> ${statusBadge(data.status)}</div>
          <button type="button" class="master-btn master-btn--ghost master-btn--compact" id="master-contract-send-btn" ${data.status === "signed" ? "disabled" : ""}>Send for signature</button>
        </div>
        <p class="muted">${escapeHtml(data.customer_legal_name)} · ${escapeHtml(data.signatory_email)}</p>
        <div class="master-legal-preview">${data.html || "<p class=\"muted\">No preview.</p>"}</div>
        <p class="master-inline-status muted" id="master-contract-send-status" aria-live="polite"></p>
        <div id="master-contract-signing-link" hidden></div>`;

      host.querySelector("#master-contract-send-btn")?.addEventListener("click", async () => {
        const status = host.querySelector("#master-contract-send-status");
        if (status) status.textContent = "Sending…";
        try {
          const result = await ctx.apiPost(`/master/tenants/${activeTenantId}/contracts/${contractId}/send`, {});
          if (status) status.textContent = `Sent to ${result.signatory_email || "signatory"}.`;
          const linkBox = host.querySelector("#master-contract-signing-link");
          if (linkBox && result.signing_url) {
            linkBox.hidden = false;
            linkBox.innerHTML = `<label class="master-legal-link-field"><span>Signing link</span><input readonly value="${escapeHtml(result.signing_url)}" onclick="this.select()" /></label>`;
          }
          await loadContracts(ctx);
          await selectContract(contractId, ctx);
        } catch (error) {
          if (status) status.textContent = error.message || "Send failed";
        }
      });
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load agreement.")}</p>`;
    }
  }

  function bindGenerateForm(ctx) {
    const form = document.getElementById("master-contract-generate-form");
    if (!form || form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.getElementById("master-contract-generate-status");
      if (status) status.textContent = "Generating…";
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      try {
        const result = await ctx.apiPost(`/master/tenants/${activeTenantId}/contracts/generate`, payload);
        if (status) status.textContent = `Generated ${result.generated || 1} contract(s).`;
        await loadContracts(ctx);
        const created = result.contract || (result.contracts || [])[0];
        if (created?.id) await selectContract(created.id, ctx);
      } catch (error) {
        if (status) status.textContent = error.message || "Generation failed";
      }
    });
  }

  async function mountLegalTab(tenant, ctx) {
    activeTenantId = tenant?.id || null;
    selectedContractId = null;
    contracts = [];

    const host = document.getElementById("detail-legal-sections");
    if (!host || !activeTenantId) return;

    host.innerHTML = shellHtml();
    await populatePlans(ctx);
    bindGenerateForm(ctx);
    await loadPrefill(ctx);
    await loadContracts(ctx);
  }

  global.ShiftSwiftMasterTenantContracts = {
    mountLegalTab,
  };
})(window);
