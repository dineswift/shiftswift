/** Employment contracts — generate from ACAS-aligned templates, send to employees, store signed copies. */
(function () {
  const { apiFetch, loadFormOptions, loadEmployees, escapeHtml, parseHashBaseSection, emptyStateHtml } = window.Admin;

  const WORKFLOW_STEPS = [
    { id: "choose", label: "Choose template" },
    { id: "generate", label: "Generate" },
    { id: "sign", label: "Employee signs" },
    { id: "stored", label: "Stored on file" },
  ];

  const TEMPLATE_BY_EMPLOYMENT_TYPE = {
    full_time: "contract_full_time",
    part_time: "contract_part_time",
    zero_hours: "contract_zero_hours",
    fixed_term: "contract_fixed_term",
    casual: "contract_zero_hours",
  };

  const PRE_CONTRACT_TEMPLATE_IDS = new Set(["job_offer_letter_acas"]);

  let contracts = [];
  let templates = [];
  let employeeOptions = [];
  let selectedContractId = null;
  let generateBound = false;
  let sectionBound = false;

  function $(id) {
    return document.getElementById(id);
  }

  const STATUS_LABELS = {
    draft: "Draft",
    generated: "Draft",
    sent: "Sent",
    signed: "Signed",
    declined: "Declined",
    expired: "Expired",
  };

  function statusBadge(status) {
    const label = STATUS_LABELS[status] || status || "Draft";
    const cls =
      status === "signed"
        ? "contracts-status-pill--signed"
        : status === "sent"
          ? "contracts-status-pill--sent"
          : status === "declined" || status === "expired"
            ? "contracts-status-pill--danger"
            : "contracts-status-pill--draft";
    return `<span class="contracts-status-pill ${cls}">${escapeHtml(label)}</span>`;
  }

  function formatDate(value) {
    if (!value) return "Not set";
    try {
      return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return value;
    }
  }

  function daysSince(value) {
    if (!value) return null;
    const then = new Date(value);
    then.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today - then) / 86400000);
  }

  function parseStartEmployeeFromHash() {
    const parts = window.location.hash.replace("#", "").split("/").filter(Boolean);
    if (parts[0] !== "employment-contracts" || parts[1] !== "start" || !parts[2]) return null;
    const id = Number(parts[2]);
    return Number.isFinite(id) ? id : null;
  }

  function sourceBadge(row) {
    if (row.template_source === "acas" || row.source === "acas") {
      return `<span class="status-pill status-ok">ACAS-aligned</span>`;
    }
    return `<span class="status-pill">ShiftSwift</span>`;
  }

  function computeStepStates(row) {
    if (!row) {
      return WORKFLOW_STEPS.map((step) => ({ ...step, state: "pending" }));
    }
    const status = row.status;
    if (status === "signed") {
      return WORKFLOW_STEPS.map((step) => ({ ...step, state: "done" }));
    }
    if (status === "declined" || status === "expired") {
      return WORKFLOW_STEPS.map((step, index) => ({
        ...step,
        state: index < 2 ? "done" : "pending",
      }));
    }
    if (status === "sent") {
      return WORKFLOW_STEPS.map((step) => {
        if (step.id === "choose" || step.id === "generate") return { ...step, state: "done" };
        if (step.id === "sign") return { ...step, state: "active" };
        return { ...step, state: "pending" };
      });
    }
    return WORKFLOW_STEPS.map((step) => {
      if (step.id === "choose") return { ...step, state: "done" };
      if (step.id === "generate") return { ...step, state: "active" };
      return { ...step, state: "pending" };
    });
  }

  function renderStatusWorkflow(row) {
    const host = $("employment-contracts-status-workflow");
    if (!host) return;
    const states = computeStepStates(row);
    host.innerHTML = states
      .map((step, index) => {
        const stepClass =
          step.state === "pending" ? "contracts-workflow-step" : `contracts-workflow-step contracts-workflow-step--${step.state}`;
        const arrow =
          index < states.length - 1 ? '<span class="contracts-workflow-arrow" aria-hidden="true">→</span>' : "";
        return `<span class="${stepClass}">${escapeHtml(step.label)}</span>${arrow}`;
      })
      .join("");
  }

  function syncDetailLayout() {
    const workspace = $("employment-contracts-workspace");
    const panel = $("employment-contracts-detail-panel");
    const guide = $("employment-contracts-guide-panel");
    const hasSelection = Boolean(selectedContractId);
    workspace?.classList.toggle("employment-contracts-workspace--detail-open", hasSelection);
    if (panel) panel.hidden = !hasSelection;
    if (guide) guide.hidden = hasSelection;
    const row = contracts.find((c) => c.id === selectedContractId);
    renderStatusWorkflow(row || null);
  }

  function clearSelection() {
    selectedContractId = null;
    const content = $("employment-contracts-detail-content");
    if (content) content.hidden = true;
    renderContractsTable();
    syncDetailLayout();
  }

  function signedColumnHtml(row) {
    if (row.signed_at) return escapeHtml(formatDate(row.signed_at));
    if (row.sent_at) {
      const days = daysSince(row.sent_at);
      const cls =
        days != null && days > 7 ? "employment-awaiting-pill employment-awaiting-pill--stale" : "employment-awaiting-pill";
      const label = days != null && days > 0 ? `Awaiting ${days}d` : "Awaiting signature";
      return `<span class="${cls}">${escapeHtml(label)}</span>`;
    }
    return '<span class="muted">Not sent</span>';
  }

  async function loadTemplates() {
    try {
      const res = await apiFetch("/employment-contracts/templates");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      templates = data.items || [];
      renderTemplateLibrary();
    } catch {
      templates = [];
      const list = $("employment-template-list");
      if (list) list.innerHTML = '<p class="muted">Could not load contract templates.</p>';
    }
  }

  function renderTemplateLibrary() {
    const list = $("employment-template-list");
    if (!list) return;
    if (!templates.length) {
      list.innerHTML =
        '<p class="muted">No employment contract templates seeded. Run <code>python scripts/seed_hr_templates.py</code> after deploy.</p>';
      return;
    }
    list.innerHTML = templates
      .map((tpl) => {
        const preContract = PRE_CONTRACT_TEMPLATE_IDS.has(tpl.id);
        return `<div class="hr-template-card${preContract ? " hr-template-card--precontract" : ""}">
          <div class="hr-template-card__head">
            <strong>${escapeHtml(tpl.title)}</strong>
            ${tpl.update_available ? '<span class="status-pill status-warning">Update available</span>' : ""}
            ${preContract ? '<span class="status-pill">Pre-employment</span>' : ""}
          </div>
          <p class="muted">${escapeHtml(tpl.description || "")}</p>
          <p class="muted" style="font-size:0.85rem;">Platform v${escapeHtml(tpl.platform_version)} · ${sourceBadge({ template_source: tpl.source })}</p>
          ${tpl.source_url ? `<p class="muted" style="font-size:0.85rem;"><a href="${escapeHtml(tpl.source_url)}" target="_blank" rel="noopener">ACAS source →</a></p>` : ""}
          <p style="margin-top:8px;">
            <a class="btn ghost" href="#templates" data-template-edit="${escapeHtml(tpl.id)}">Customise in HR Templates</a>
            ${preContract ? '<a class="btn ghost" href="#recruitment">Use in Recruitment</a>' : ""}
          </p>
        </div>`;
      })
      .join("");
  }

  function renderContractsTable() {
    const tbody = $("employment-contracts-body");
    if (!tbody) return;
    if (!contracts.length) {
      tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="6">${emptyStateHtml({
        icon: "file-text",
        title: "No employment contracts yet",
        message: "Generate a contract for an employee using a template above.",
        actionLabel: "Scroll to generate",
        actionId: "employment-contracts-scroll-generate",
        compact: true,
      })}</td></tr>`;
      document.getElementById("employment-contracts-scroll-generate")?.addEventListener("click", () => {
        $("employment-contracts-generate-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    tbody.innerHTML = contracts
      .map((row) => {
        const selected = selectedContractId === row.id ? " contracts-case-row--selected" : "";
        return `<tr class="contracts-case-row hr-register-row${selected}" data-contract-id="${row.id}">
          <td><strong>${escapeHtml(row.contract_number)}</strong><div class="muted">${formatDate(row.created_at)}</div></td>
          <td>${escapeHtml(row.employee_name)}</td>
          <td>${escapeHtml(row.title)}</td>
          <td>${statusBadge(row.status)}</td>
          <td>v${escapeHtml(row.platform_template_version || "?")}</td>
          <td>${signedColumnHtml(row)}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll(".contracts-case-row").forEach((row) => {
      row.addEventListener("click", () => selectContract(Number(row.dataset.contractId)));
    });
  }

  async function loadContracts() {
    const tbody = $("employment-contracts-body");
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="muted">Loading employment contracts…</td></tr>';
    try {
      const res = await apiFetch("/employment-contracts");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      contracts = data.items || [];
      if (selectedContractId && !contracts.some((c) => c.id === selectedContractId)) {
        selectedContractId = null;
      }
      renderContractsTable();
      if (selectedContractId) {
        await selectContract(selectedContractId, { scroll: false });
      } else {
        syncDetailLayout();
      }
    } catch {
      contracts = [];
      selectedContractId = null;
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">Could not load employment contracts.</td></tr>';
      }
      syncDetailLayout();
    }
  }

  function renderDetailPanel(data) {
    const content = $("employment-contracts-detail-content");
    if (!content) return;
    content.hidden = false;
    const preview = data.html
      ? `<div class="contracts-preview-wrap"><div class="contracts-preview">${data.html}</div></div>`
      : '<p class="muted">No preview available.</p>';
    content.innerHTML = `
      <div class="hr-detail-head">
        <div>
          <h3>${escapeHtml(data.contract_number)}</h3>
          ${statusBadge(data.status)}
        </div>
      </div>
      <dl class="hr-detail-grid">
        <div><dt>Employee</dt><dd>${escapeHtml(data.employee_name)}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(data.employee_email || "Not set")}</dd></div>
        <div><dt>Template</dt><dd>${escapeHtml(data.title)} (v${escapeHtml(data.platform_template_version)})</dd></div>
        <div><dt>Source</dt><dd>${data.template_source === "acas" ? "ACAS-aligned" : "ShiftSwift"}${data.template_source_url ? ` · <a href="${escapeHtml(data.template_source_url)}" target="_blank" rel="noopener">View guidance</a>` : ""}</dd></div>
        ${data.employee_document_id ? `<div><dt>Employee file</dt><dd>Saved to document store (#${escapeHtml(data.employee_document_id)})</dd></div>` : ""}
      </dl>
      ${preview}
      <div class="hr-detail-foot">
        ${data.status !== "signed" && data.employee_email ? `<button type="button" class="btn" id="employment-contract-send-btn">Send for e-signature</button>` : ""}
        <a class="btn ghost" href="#employees/${escapeHtml(data.employee_id)}/document_store">Open employee documents</a>
      </div>
      ${!data.employee_email ? `<p class="promo-result promo-result-message promo-result--error" style="margin-top:10px;">Add an email on the employee profile before sending.</p>` : ""}
      <div id="employment-signing-link-box" class="signing-link-box" hidden></div>
      <p class="muted" id="employment-contract-action-status"></p>`;
    content.querySelector("#employment-contract-send-btn")?.addEventListener("click", () => sendContract(data.id));
    syncDetailLayout();
  }

  async function selectContract(id, { scroll = true } = {}) {
    selectedContractId = id;
    renderContractsTable();
    try {
      const res = await apiFetch(`/employment-contracts/${id}`);
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      renderDetailPanel(data);
      if (scroll) $("employment-contracts-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      const status = $("employment-contract-action-status");
      if (status) status.textContent = error.message || "Could not load contract";
      syncDetailLayout();
    }
  }

  async function sendContract(id) {
    const status = $("employment-contract-action-status");
    if (status) status.textContent = "Sending signing link…";
    try {
      const res = await apiFetch(`/employment-contracts/${id}/send`, {
        method: "POST",
        body: JSON.stringify({ frontend_base: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Send failed");
      const box = $("employment-signing-link-box");
      if (box) {
        box.hidden = false;
        box.innerHTML = `<p><strong>Signing link</strong> (also emailed to employee):</p>
          <input type="text" readonly value="${escapeHtml(data.signing_url)}" style="width:100%;" onclick="this.select()" />`;
      }
      if (status) status.textContent = "Sent for signature.";
      await loadContracts();
      await selectContract(id, { scroll: false });
    } catch (error) {
      if (status) status.textContent = error.message || "Send failed";
    }
  }

  function suggestTemplateId(employeeId) {
    const emp = employeeOptions.find((e) => String(e.id) === String(employeeId) || e.value === String(employeeId));
    if (!emp?.employment_type) return null;
    const suggested = TEMPLATE_BY_EMPLOYMENT_TYPE[emp.employment_type];
    if (!suggested || !templates.some((t) => t.id === suggested)) return null;
    return suggested;
  }

  function syncEmployeeEmailHint(employeeId) {
    const hint = $("employment-contract-email-hint");
    if (!hint) return;
    const emp = employeeOptions.find((e) => String(e.id) === String(employeeId) || e.value === String(employeeId));
    if (!emp) {
      hint.hidden = true;
      return;
    }
    if (emp.email) {
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    hint.textContent = "This employee has no email — add one on their profile before you can send for signature.";
    hint.className = "promo-result promo-result-message promo-result--error";
  }

  function applySuggestedTemplate(employeeId) {
    const templateSelect = $("employment-contract-template");
    if (!templateSelect || !employeeId) return;
    const suggested = suggestTemplateId(employeeId);
    if (suggested) templateSelect.value = suggested;
    syncEmployeeEmailHint(employeeId);
  }

  function applyStartEmployeeFromHash() {
    const employeeId = parseStartEmployeeFromHash();
    if (!employeeId) return;
    const select = $("employment-contract-employee");
    if (!select) return;
    if ([...select.options].some((opt) => opt.value === String(employeeId))) {
      select.value = String(employeeId);
      applySuggestedTemplate(employeeId);
    }
    const panel = $("employment-contracts-generate-panel");
    panel?.classList.add("employment-contracts-generate-panel--highlight");
    window.setTimeout(() => panel?.classList.remove("employment-contracts-generate-panel--highlight"), 2400);
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bindGenerateForm() {
    if (generateBound) return;
    const form = $("employment-contract-generate-form");
    if (!form) return;

    $("employment-contract-employee")?.addEventListener("change", (event) => {
      applySuggestedTemplate(event.target.value);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = $("employment-contract-generate-status");
      const employeeId = form.employee_id.value;
      const templateId = form.template_id.value;
      if (!employeeId || !templateId) {
        if (status) status.textContent = "Select an employee and template.";
        return;
      }
      const emp = employeeOptions.find((e) => e.value === String(employeeId));
      if (!emp?.email) {
        if (status) status.textContent = "Add an email on the employee profile before generating (required for e-signature).";
        return;
      }
      if (status) status.textContent = "Generating…";
      try {
        const res = await apiFetch("/employment-contracts/generate", {
          method: "POST",
          body: JSON.stringify({ employee_id: Number(employeeId), template_id: templateId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Generation failed");
        if (status) status.textContent = "Contract generated.";
        await loadContracts();
        if (data.contract?.id) await selectContract(data.contract.id);
      } catch (error) {
        if (status) status.textContent = error.message || "Generation failed";
      }
    });

    $("employment-contract-detail-close")?.addEventListener("click", () => clearSelection());
    generateBound = true;
  }

  async function populateGenerateSelects() {
    await loadFormOptions();
    employeeOptions = await loadEmployees();
    const employeeSelect = $("employment-contract-employee");
    const templateSelect = $("employment-contract-template");
    if (employeeSelect) {
      employeeSelect.innerHTML =
        `<option value="">Select employee…</option>` +
        employeeOptions
          .map((emp) => `<option value="${escapeHtml(emp.value)}">${escapeHtml(emp.label)}</option>`)
          .join("");
    }
    if (templateSelect) {
      templateSelect.innerHTML =
        `<option value="">Select template…</option>` +
        templates
          .map(
            (tpl) =>
              `<option value="${escapeHtml(tpl.id)}">${escapeHtml(tpl.title)} (v${escapeHtml(tpl.platform_version)})</option>`
          )
          .join("");
    }
    const startId = parseStartEmployeeFromHash();
    if (startId) {
      applyStartEmployeeFromHash();
    }
  }

  async function initEmploymentContractsSection() {
    bindGenerateForm();
    syncDetailLayout();
    await loadTemplates();
    await populateGenerateSelects();
    await loadContracts();
  }

  function bindSectionEvents() {
    if (sectionBound) return;
    sectionBound = true;
    window.addEventListener("admin:section", (event) => {
      if (event.detail?.section === "employment-contracts") initEmploymentContractsSection();
    });
    window.addEventListener("hashchange", () => {
      if (parseHashBaseSection(window.location.hash) !== "employment-contracts") return;
      applyStartEmployeeFromHash();
    });
    if (parseHashBaseSection(window.location.hash) === "employment-contracts") initEmploymentContractsSection();
  }

  bindSectionEvents();

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-template-edit]");
    if (!link) return;
    sessionStorage.setItem("templatesOpenId", link.dataset.templateEdit);
  });
})();
