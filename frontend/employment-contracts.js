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
    host.innerHTML = `<div class="employment-workflow-pipeline">${states
      .map((step, index) => {
        const stepClass =
          step.state === "pending"
            ? "employment-workflow-step"
            : `employment-workflow-step employment-workflow-step--${step.state}`;
        const connector =
          index < states.length - 1 ? '<span class="employment-workflow-connector" aria-hidden="true"></span>' : "";
        return `<div class="${stepClass}">
          <span class="employment-workflow-step__num">${index + 1}</span>
          <span class="employment-workflow-step__label">${escapeHtml(step.label)}</span>
        </div>${connector}`;
      })
      .join("")}</div>`;
  }

  function contractStats() {
    const draft = contracts.filter((c) => c.status === "draft" || c.status === "generated").length;
    const sent = contracts.filter((c) => c.status === "sent").length;
    const signed = contracts.filter((c) => c.status === "signed").length;
    const staleAwaiting = contracts.filter((c) => c.status === "sent" && daysSince(c.sent_at) > 7).length;
    return { total: contracts.length, draft, sent, signed, staleAwaiting };
  }

  function renderStats() {
    const grid = $("employment-stats-grid");
    if (!grid) return;
    const stats = contractStats();
    grid.hidden = false;
    const totalEl = $("employment-stat-total");
    const draftEl = $("employment-stat-draft");
    const sentEl = $("employment-stat-sent");
    const signedEl = $("employment-stat-signed");
    if (totalEl) totalEl.textContent = String(stats.total);
    if (draftEl) draftEl.textContent = String(stats.draft);
    if (sentEl) sentEl.textContent = String(stats.sent);
    if (signedEl) signedEl.textContent = String(stats.signed);
    const draftSub = $("employment-stat-draft-sub");
    if (draftSub) {
      draftSub.textContent = stats.draft ? "Ready to send" : "No drafts";
    }
    const sentSub = $("employment-stat-sent-sub");
    if (sentSub) {
      sentSub.textContent = stats.staleAwaiting
        ? `${stats.staleAwaiting} overdue · chase signature`
        : stats.sent
          ? "Sent to employees"
          : "None out for signature";
    }
    const signedSub = $("employment-stat-signed-sub");
    if (signedSub) {
      signedSub.textContent = stats.signed ? "Stored on file" : "None signed yet";
    }
    $("employment-stat-sent-card")?.classList.toggle("hr-stat-card--warn", stats.staleAwaiting > 0);
  }

  function updateRegisterSub() {
    const sub = $("employment-register-sub");
    if (!sub) return;
    if (!contracts.length) {
      sub.textContent = "No contracts yet — generate one above.";
      return;
    }
    const stats = contractStats();
    sub.textContent = `${contracts.length} contract${contracts.length === 1 ? "" : "s"} · ${stats.signed} signed · ${stats.sent} awaiting`;
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
        return `<article class="employment-template-tile${preContract ? " employment-template-tile--precontract" : ""}">
          <header class="employment-template-tile__head">
            <span class="employment-template-tile__icon" aria-hidden="true">${preContract ? "📨" : "📄"}</span>
            <div class="employment-template-tile__titles">
              <strong class="employment-template-tile__title">${escapeHtml(tpl.title)}</strong>
              <span class="employment-template-tile__meta">Platform v${escapeHtml(tpl.platform_version)} · ${tpl.source === "acas" ? "ACAS-aligned" : "ShiftSwift"}</span>
            </div>
            <div class="employment-template-tile__badges">
              ${tpl.update_available ? '<span class="status-pill status-warning">Update</span>' : ""}
              ${preContract ? '<span class="status-pill">Pre-employment</span>' : ""}
            </div>
          </header>
          <p class="employment-template-tile__desc muted">${escapeHtml(tpl.description || "")}</p>
          <footer class="employment-template-tile__foot">
            <a class="btn ghost btn-sm" href="#templates" data-template-edit="${escapeHtml(tpl.id)}">Customise</a>
            ${tpl.source_url ? `<a class="btn ghost btn-sm" href="${escapeHtml(tpl.source_url)}" target="_blank" rel="noopener">ACAS source</a>` : ""}
            ${preContract ? '<a class="btn ghost btn-sm" href="#recruitment">Recruitment</a>' : ""}
          </footer>
        </article>`;
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
      renderStats();
      updateRegisterSub();
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
      renderStats();
      updateRegisterSub();
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
      <header class="employment-detail-hero">
        <div class="employment-detail-hero__badge" aria-hidden="true">📄</div>
        <div class="employment-detail-hero__body">
          <h3 class="employment-detail-hero__title">${escapeHtml(data.contract_number)}</h3>
          <div class="employment-detail-hero__meta">${statusBadge(data.status)}</div>
        </div>
      </header>
      <div class="employment-detail-metrics">
        <div class="employment-detail-metric">
          <span class="employment-detail-metric__label">Employee</span>
          <span class="employment-detail-metric__value">${escapeHtml(data.employee_name)}</span>
        </div>
        <div class="employment-detail-metric">
          <span class="employment-detail-metric__label">Template</span>
          <span class="employment-detail-metric__value">v${escapeHtml(data.platform_template_version)}</span>
        </div>
        <div class="employment-detail-metric">
          <span class="employment-detail-metric__label">Source</span>
          <span class="employment-detail-metric__value">${data.template_source === "acas" ? "ACAS" : "ShiftSwift"}</span>
        </div>
      </div>
      <dl class="employment-detail-grid">
        <div><dt>Email</dt><dd>${escapeHtml(data.employee_email || "Not set")}</dd></div>
        <div><dt>Contract title</dt><dd>${escapeHtml(data.title)}</dd></div>
        ${data.signed_at ? `<div><dt>Signed</dt><dd>${escapeHtml(formatDate(data.signed_at))}</dd></div>` : ""}
        ${data.sent_at && !data.signed_at ? `<div><dt>Sent</dt><dd>${escapeHtml(formatDate(data.sent_at))}</dd></div>` : ""}
        ${data.employee_document_id ? `<div><dt>Employee file</dt><dd>#${escapeHtml(data.employee_document_id)}</dd></div>` : ""}
      </dl>
      ${data.template_source_url ? `<p class="muted employment-detail-source"><a href="${escapeHtml(data.template_source_url)}" target="_blank" rel="noopener">View ACAS guidance →</a></p>` : ""}
      <div class="employment-detail-preview">
        <h5 class="employment-detail-preview__title">Preview</h5>
        ${preview}
      </div>
      <div class="hr-detail-foot employment-detail-foot">
        ${data.status !== "signed" && data.employee_email ? `<button type="button" class="btn primary" id="employment-contract-send-btn">Send for e-signature</button>` : ""}
        <a class="btn ghost" href="#employees/${escapeHtml(data.employee_id)}/document_store">Employee documents</a>
      </div>
      ${!data.employee_email ? `<p class="employment-detail-alert">Add an email on the employee profile before sending.</p>` : ""}
      <div id="employment-signing-link-box" class="signing-link-box" hidden></div>
      <p class="edit-form-status muted employment-action-status" id="employment-contract-action-status" aria-live="polite"></p>`;
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
    const btn = $("employment-contract-send-btn");
    const run = window.ShiftSwiftAction?.runButtonAction;
    const performSend = async () => {
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
      await loadContracts();
      await selectContract(id, { scroll: false });
      return "Sent for signature.";
    };
    if (run && btn) {
      await run(btn, status, {
        loadingLabel: "Sending…",
        successMessage: "Sent for signature.",
        errorMessage: "Send failed.",
        successLabel: "Sent",
        onAction: performSend,
      });
      return;
    }
    if (status) status.textContent = "Sending signing link…";
    try {
      const message = await performSend();
      if (status) status.textContent = message;
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
