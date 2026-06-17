/** CRM add-on — pipeline for IT services, HR software, consulting, and B2B sales. */
(async function initAdminCrm() {
  const { apiFetch, escapeHtml, isAddonEnabled, parseHashBaseSection, downloadAuthenticated } = window.Admin;

  let pipelineData = null;
  let accounts = [];
  let contacts = [];
  let crmMeta = null;
  let selectedDealId = null;
  let selectedEntity = null;
  let loaded = false;
  let activeTab = "pipeline";
  let searchTimers = { pipeline: null, accounts: null, contacts: null };
  let emailTemplates = [];
  let dragDealId = null;

  const ACTIVITY_LABELS = {
    note: "Note",
    call: "Call",
    email: "Email",
    meeting: "Meeting",
    demo: "Demo / presentation",
  };

  const FALLBACK_DEAL_CATEGORIES = {
    general: "General",
    it_services: "IT services & support",
    hr_software: "HR software & platform",
    consulting: "Consulting & professional services",
    support_contract: "Support / SLA renewal",
    hospitality: "Hospitality & events",
    other: "Other",
  };

  const FALLBACK_ACCOUNT_TYPES = {
    prospect: "Prospect",
    customer: "Customer",
    partner: "Partner",
  };

  const els = {
    summaryDeals: document.getElementById("crm-summary-deals"),
    summaryAccounts: document.getElementById("crm-summary-accounts"),
    summaryContacts: document.getElementById("crm-summary-contacts"),
    pipelineName: document.getElementById("crm-pipeline-name"),
    pipelineBoard: document.getElementById("crm-pipeline-board"),
    pipelineSearch: document.getElementById("crm-pipeline-search"),
    pipelineCategory: document.getElementById("crm-pipeline-category"),
    accountsSearch: document.getElementById("crm-accounts-search"),
    contactsSearch: document.getElementById("crm-contacts-search"),
    accountsBody: document.getElementById("crm-accounts-body"),
    contactsBody: document.getElementById("crm-contacts-body"),
    dealDialog: document.getElementById("crm-deal-dialog"),
    dealForm: document.getElementById("crm-deal-form"),
    dealDialogTitle: document.getElementById("crm-deal-dialog-title"),
    dealIdInput: document.getElementById("crm-deal-id"),
    dealStageSelect: document.getElementById("crm-deal-stage-select"),
    dealCategorySelect: document.getElementById("crm-deal-category-select"),
    dealAccountSelect: document.getElementById("crm-deal-account-select"),
    dealContactSelect: document.getElementById("crm-deal-contact-select"),
    accountDialog: document.getElementById("crm-account-dialog"),
    accountForm: document.getElementById("crm-account-form"),
    accountDialogTitle: document.getElementById("crm-account-dialog-title"),
    accountIdInput: document.getElementById("crm-account-id"),
    accountTypeSelect: document.getElementById("crm-account-type-select"),
    accountDeleteBtn: document.getElementById("crm-account-delete-btn"),
    contactDialog: document.getElementById("crm-contact-dialog"),
    contactForm: document.getElementById("crm-contact-form"),
    contactDialogTitle: document.getElementById("crm-contact-dialog-title"),
    contactIdInput: document.getElementById("crm-contact-id"),
    contactDeleteBtn: document.getElementById("crm-contact-delete-btn"),
    contactAccountSelect: document.getElementById("crm-contact-account-select"),
    dealDrawer: document.getElementById("crm-deal-drawer"),
    dealDrawerTitle: document.getElementById("crm-deal-drawer-title"),
    dealDrawerMeta: document.getElementById("crm-deal-drawer-meta"),
    dealDrawerStage: document.getElementById("crm-deal-drawer-stage"),
    dealDrawerCategory: document.getElementById("crm-deal-drawer-category"),
    activityForm: document.getElementById("crm-activity-form"),
    activityList: document.getElementById("crm-activity-list"),
    entityDrawer: document.getElementById("crm-entity-drawer"),
    entityDrawerTitle: document.getElementById("crm-entity-drawer-title"),
    entityDrawerMeta: document.getElementById("crm-entity-drawer-meta"),
    entityDeals: document.getElementById("crm-entity-deals"),
    entityActivityForm: document.getElementById("crm-entity-activity-form"),
    entityActivityList: document.getElementById("crm-entity-activity-list"),
    entityDocuments: document.getElementById("crm-entity-documents"),
    entityDocumentInput: document.getElementById("crm-entity-document-input"),
    dealDocuments: document.getElementById("crm-deal-documents"),
    dealDocumentInput: document.getElementById("crm-deal-document-input"),
    dashboardStages: document.getElementById("crm-dashboard-stages"),
    summaryValue: document.getElementById("crm-summary-value"),
    summaryActivity: document.getElementById("crm-summary-activity"),
    importResult: document.getElementById("crm-import-result"),
    emailTemplateSelect: document.getElementById("crm-email-template"),
    emailCustomInput: document.getElementById("crm-email-custom"),
    emailToInput: document.getElementById("crm-email-to"),
    emailSubjectInput: document.getElementById("crm-email-subject"),
    emailBodyInput: document.getElementById("crm-email-body"),
    emailForm: document.getElementById("crm-email-form"),
    aiStatus: document.getElementById("crm-ai-status"),
    aiOutput: document.getElementById("crm-deal-ai-output"),
  };

  function formatMoney(value) {
    if (value == null || value === "") return "";
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    return `£${num.toFixed(2)}`;
  }

  function dealCategoryLabel(id) {
    const map = Object.fromEntries(
      (crmMeta?.deal_categories || []).map((item) => [item.id, item.label]),
    );
    return map[id] || FALLBACK_DEAL_CATEGORIES[id] || id || "General";
  }

  function accountTypeLabel(id) {
    const map = Object.fromEntries((crmMeta?.account_types || []).map((item) => [item.id, item.label]));
    return map[id] || FALLBACK_ACCOUNT_TYPES[id] || id || "Prospect";
  }

  function populateOptionSelect(select, items, { includeEmpty = false, emptyLabel = "— None —" } = {}) {
    if (!select) return;
    const options = includeEmpty ? [`<option value="">${escapeHtml(emptyLabel)}</option>`] : [];
    options.push(
      ...items.map((item) => {
        const value = typeof item === "string" ? item : item.id;
        const label = typeof item === "string" ? item : item.label;
        return `<option value="${escapeHtml(String(value))}">${escapeHtml(label)}</option>`;
      }),
    );
    select.innerHTML = options.join("");
  }

  function populateMetaSelects() {
    const categories = crmMeta?.deal_categories || Object.entries(FALLBACK_DEAL_CATEGORIES).map(([id, label]) => ({
      id,
      label,
    }));
    const accountTypes = crmMeta?.account_types || Object.entries(FALLBACK_ACCOUNT_TYPES).map(([id, label]) => ({
      id,
      label,
    }));
    populateOptionSelect(els.dealCategorySelect, categories);
    populateOptionSelect(els.dealDrawerCategory, categories);
    populateOptionSelect(els.pipelineCategory, categories, { includeEmpty: true, emptyLabel: "All deal types" });
    populateOptionSelect(els.accountTypeSelect, accountTypes);
  }

  async function loadCrmMeta() {
    const res = await apiFetch("/admin/crm/meta");
    if (!res.ok) return;
    crmMeta = await res.json();
    populateMetaSelects();
  }

  function activityLabel(type) {
    const fromMeta = Object.fromEntries((crmMeta?.activity_types || []).map((item) => [item.id, item.label]));
    return fromMeta[type] || ACTIVITY_LABELS[type] || type;
  }

  function renderActivities(items) {
    if (!items.length) return '<p class="muted">No activity yet.</p>';
    return items
      .map((item) => {
        const dealNote = item.deal_title
          ? ` · Deal: ${escapeHtml(item.deal_title)}`
          : "";
        return `<article class="crm-activity-item">
          <p class="crm-activity-item__meta">${escapeHtml(activityLabel(item.activity_type))} · ${escapeHtml(item.activity_at || "")}${item.created_by ? ` · ${escapeHtml(item.created_by)}` : ""}${dealNote}</p>
          ${item.subject ? `<strong>${escapeHtml(item.subject)}</strong>` : ""}
          <p>${escapeHtml(item.body || "")}</p>
        </article>`;
      })
      .join("");
  }

  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".crm-tab").forEach((button) => {
      const isActive = button.dataset.crmTab === tab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    document.querySelectorAll(".crm-panel").forEach((panel) => {
      panel.hidden = panel.dataset.crmPanel !== tab;
    });
    closeEntityDrawer();
    if (tab !== "pipeline") closeDealDrawer();
  }

  function renderSummary(summary) {
    if (!summary) return;
    if (els.summaryDeals) {
      els.summaryDeals.textContent = `${summary.deals || 0} deals · ${summary.deals_won || 0} won · ${summary.deals_lost || 0} lost`;
    }
    if (els.summaryAccounts) els.summaryAccounts.textContent = `${summary.accounts || 0} companies`;
    if (els.summaryContacts) els.summaryContacts.textContent = `${summary.contacts || 0} contacts`;
    if (els.summaryValue) {
      const openValue = formatMoney(summary.open_pipeline_value_gbp);
      els.summaryValue.textContent = openValue ? `${openValue} open pipeline` : "— pipeline value";
    }
    if (els.summaryActivity) {
      els.summaryActivity.textContent = `${summary.activities_last_7_days || 0} activities (7d) · ${summary.documents || 0} files`;
    }
    if (els.pipelineName && summary.pipeline_name) {
      els.pipelineName.textContent = summary.pipeline_name;
    }
    if (els.dashboardStages) {
      const stages = summary.stage_counts || [];
      if (!stages.length) {
        els.dashboardStages.hidden = true;
      } else {
        els.dashboardStages.hidden = false;
        els.dashboardStages.innerHTML = stages
          .map(
            (stage) =>
              `<span class="crm-stage-pill">${escapeHtml(stage.label)} <strong>${stage.count}</strong></span>`,
          )
          .join("");
      }
    }
  }

  function renderDocuments(container, documents, onRefresh) {
    if (!container) return;
    if (!documents?.length) {
      container.innerHTML = '<p class="muted">No documents attached.</p>';
      return;
    }
    container.innerHTML = documents
      .map(
        (doc) => `<div class="crm-document-row">
          <button type="button" class="crm-link-btn" data-download-doc="${doc.id}">${escapeHtml(doc.title || doc.original_filename || "Document")}</button>
          <span class="muted">${escapeHtml(doc.original_filename || "")}</span>
          <button type="button" class="btn btn--ghost btn--sm" data-delete-doc="${doc.id}">Delete</button>
        </div>`,
      )
      .join("");
    container.querySelectorAll("[data-download-doc]").forEach((button) => {
      button.addEventListener("click", () => {
        void downloadAuthenticated(
          `/admin/crm/documents/${button.dataset.downloadDoc}/download`,
          button.textContent.trim() || "crm-document",
        );
      });
    });
    container.querySelectorAll("[data-delete-doc]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Delete this document?")) return;
        try {
          const res = await apiFetch(`/admin/crm/documents/${button.dataset.deleteDoc}`, {
            method: "DELETE",
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "Could not delete document");
          await onRefresh?.();
          await loadSummary();
        } catch (error) {
          alert(error.message || "Could not delete document");
        }
      });
    });
  }

  async function uploadDocument({ file, accountId, contactId, dealId, onDone }) {
    const formData = new FormData();
    formData.append("file", file);
    if (accountId) formData.append("account_id", String(accountId));
    if (contactId) formData.append("contact_id", String(contactId));
    if (dealId) formData.append("deal_id", String(dealId));
    const res = await apiFetch("/admin/crm/documents", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Upload failed");
    await onDone?.();
    await loadSummary();
  }

  function showImportResult(result, label) {
    if (!els.importResult) return;
    els.importResult.hidden = false;
    const errors = (result.errors || []).slice(0, 5);
    els.importResult.classList.toggle("promo-result--error", Boolean(result.skipped && !result.imported));
    els.importResult.classList.toggle("promo-result--ok", Boolean(result.imported));
    els.importResult.innerHTML = `
      <p><strong>${escapeHtml(label)}:</strong> ${result.imported || 0} imported${result.skipped ? `, ${result.skipped} skipped` : ""}.</p>
      ${errors.length ? `<ul class="crm-import-errors">${errors.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}`;
  }

  function populateSelect(select, items, { valueKey = "id", labelKey = "name", includeEmpty = true } = {}) {
    if (!select) return;
    const options = includeEmpty ? ['<option value="">— None —</option>'] : [];
    options.push(
      ...items.map(
        (row) =>
          `<option value="${escapeHtml(String(row[valueKey]))}">${escapeHtml(row[labelKey] || String(row[valueKey]))}</option>`,
      ),
    );
    select.innerHTML = options.join("");
  }

  function renderAccountsTable() {
    if (!els.accountsBody) return;
    if (!accounts.length) {
      els.accountsBody.innerHTML = '<tr><td colspan="5" class="muted">No companies yet.</td></tr>';
      return;
    }
    els.accountsBody.innerHTML = accounts
      .map(
        (row) => `<tr class="crm-row" data-account-id="${row.id}" tabindex="0">
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(accountTypeLabel(row.account_type || "prospect"))}</td>
          <td>${escapeHtml(row.industry || "—")}</td>
          <td>${escapeHtml(row.email || "—")}</td>
          <td>${escapeHtml(row.phone || "—")}</td>
        </tr>`,
      )
      .join("");
    bindAccountRows();
  }

  function renderContactsTable() {
    if (!els.contactsBody) return;
    if (!contacts.length) {
      els.contactsBody.innerHTML = '<tr><td colspan="5" class="muted">No contacts yet.</td></tr>';
      return;
    }
    els.contactsBody.innerHTML = contacts
      .map(
        (row) => `<tr class="crm-row" data-contact-id="${row.id}" tabindex="0">
          <td>${escapeHtml(row.name)}${row.job_title ? `<br><small class="muted">${escapeHtml(row.job_title)}</small>` : ""}</td>
          <td>${escapeHtml(row.account_name || "—")}</td>
          <td>${escapeHtml(row.department || "—")}</td>
          <td>${escapeHtml(row.email || "—")}</td>
          <td>${escapeHtml(row.phone || "—")}</td>
        </tr>`,
      )
      .join("");
    bindContactRows();
  }

  function bindAccountRows() {
    els.accountsBody?.querySelectorAll("[data-account-id]").forEach((row) => {
      const open = () => openEntityDrawer("account", Number(row.dataset.accountId));
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  }

  function bindContactRows() {
    els.contactsBody?.querySelectorAll("[data-contact-id]").forEach((row) => {
      const open = () => openEntityDrawer("contact", Number(row.dataset.contactId));
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  }

  function renderPipelineBoard() {
    if (!els.pipelineBoard || !pipelineData) return;
    const stages = pipelineData.stages || [];
    if (!stages.length) {
      els.pipelineBoard.innerHTML = '<p class="muted">No pipeline stages configured.</p>';
      return;
    }
    els.pipelineBoard.innerHTML = stages
      .map((stage) => {
        const deals = stage.deals || [];
        const cards = deals.length
          ? deals
              .map((deal) => {
                const meta = [
                  deal.deal_category && deal.deal_category !== "general"
                    ? dealCategoryLabel(deal.deal_category)
                    : null,
                  deal.account_name,
                  deal.contact_name,
                  deal.value_gbp != null ? formatMoney(deal.value_gbp) : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return `<button type="button" class="crm-deal-card" draggable="true" data-deal-id="${deal.id}" data-stage-id="${stage.id}">
                  <strong>${escapeHtml(deal.title)}</strong>
                  ${meta ? `<span class="crm-deal-card__meta">${escapeHtml(meta)}</span>` : ""}
                </button>`;
              })
              .join("")
          : '<p class="crm-deal-card crm-deal-card--empty muted">No deals</p>';
        return `<article class="crm-pipeline-column">
          <header class="crm-pipeline-column__head">
            <h4>${escapeHtml(stage.label)}</h4>
            <span class="crm-pipeline-column__count">${stage.deal_count || 0}</span>
          </header>
          <div class="crm-pipeline-column__body" data-stage-id="${stage.id}">${cards}</div>
        </article>`;
      })
      .join("");

    els.pipelineBoard.querySelectorAll("[data-deal-id]").forEach((button) => {
      button.addEventListener("click", () => openDealDrawer(Number(button.dataset.dealId)));
    });
    bindPipelineDragDrop();
  }

  async function moveDealToStage(dealId, stageId) {
    const res = await apiFetch(`/admin/crm/deals/${dealId}`, {
      method: "PATCH",
      body: JSON.stringify({ stage_id: Number(stageId) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not move deal");
    await refreshAll();
  }

  function bindPipelineDragDrop() {
    if (!els.pipelineBoard) return;
    els.pipelineBoard.querySelectorAll(".crm-deal-card[draggable='true']").forEach((card) => {
      card.addEventListener("dragstart", (event) => {
        dragDealId = Number(card.dataset.dealId);
        card.classList.add("is-dragging");
        event.dataTransfer?.setData("text/plain", String(dragDealId));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        dragDealId = null;
        els.pipelineBoard.querySelectorAll(".crm-pipeline-column__body.is-drop-target").forEach((node) => {
          node.classList.remove("is-drop-target");
        });
      });
    });

    els.pipelineBoard.querySelectorAll(".crm-pipeline-column__body[data-stage-id]").forEach((column) => {
      column.addEventListener("dragover", (event) => {
        event.preventDefault();
        column.classList.add("is-drop-target");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      column.addEventListener("dragleave", () => column.classList.remove("is-drop-target"));
      column.addEventListener("drop", async (event) => {
        event.preventDefault();
        column.classList.remove("is-drop-target");
        const dealId = dragDealId || Number(event.dataTransfer?.getData("text/plain") || 0);
        const stageId = Number(column.dataset.stageId || 0);
        if (!dealId || !stageId) return;
        try {
          await moveDealToStage(dealId, stageId);
        } catch (error) {
          alert(error.message || "Could not move deal");
        }
      });
    });
  }

  function populateEmailTemplateSelect() {
    if (!els.emailTemplateSelect) return;
    const options = ['<option value="">Custom message</option>'];
    options.push(
      ...emailTemplates.map(
        (template) =>
          `<option value="${escapeHtml(template.template_key)}">${escapeHtml(template.name)}</option>`,
      ),
    );
    els.emailTemplateSelect.innerHTML = options.join("");
  }

  async function loadEmailTemplates() {
    const res = await apiFetch("/admin/crm/email-templates");
    if (!res.ok) return;
    const data = await res.json();
    emailTemplates = data.items || [];
    populateEmailTemplateSelect();
  }

  async function previewDealEmail(dealId) {
    const templateKey = els.emailTemplateSelect?.value || "";
    if (!templateKey || !selectedDealId) return;
    const customMessage = els.emailCustomInput?.value?.trim() || "";
    const res = await apiFetch(`/admin/crm/deals/${dealId}/email/preview`, {
      method: "POST",
      body: JSON.stringify({ template_key: templateKey, custom_message: customMessage || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not load template");
    if (els.emailToInput && data.to_email) els.emailToInput.value = data.to_email;
    if (els.emailSubjectInput) els.emailSubjectInput.value = data.subject || "";
    if (els.emailBodyInput) els.emailBodyInput.value = data.body_text || "";
  }

  function resetEmailForm(deal) {
    els.emailForm?.reset();
    if (els.emailToInput) {
      els.emailToInput.value = deal?.contact_email || deal?.account_email || "";
    }
    if (els.aiOutput) {
      els.aiOutput.hidden = true;
      els.aiOutput.textContent = "";
    }
  }

  function populateStageSelects() {
    const stages = pipelineData?.stages || [];
    const options = stages
      .map((stage) => `<option value="${stage.id}">${escapeHtml(stage.label)}</option>`)
      .join("");
    if (els.dealStageSelect) els.dealStageSelect.innerHTML = options;
    if (els.dealDrawerStage) els.dealDrawerStage.innerHTML = options;
  }

  function populateDealLinkSelects(selectedAccountId = "", selectedContactId = "") {
    populateSelect(els.dealAccountSelect, accounts, { labelKey: "name" });
    populateSelect(els.dealContactSelect, contacts, { labelKey: "name" });
    if (els.dealAccountSelect && selectedAccountId) els.dealAccountSelect.value = String(selectedAccountId);
    if (els.dealContactSelect && selectedContactId) els.dealContactSelect.value = String(selectedContactId);
  }

  function populateAccountSelect() {
    populateSelect(els.contactAccountSelect, accounts, { labelKey: "name" });
  }

  async function loadSummary() {
    const res = await apiFetch("/admin/crm/summary");
    if (!res.ok) throw new Error("Could not load CRM summary");
    const data = await res.json();
    renderSummary(data);
    return data;
  }

  async function loadPipeline(q = "", category = "") {
    const query = q.trim();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    const path = params.toString() ? `/admin/crm/pipeline?${params}` : "/admin/crm/pipeline";
    const res = await apiFetch(path);
    if (!res.ok) throw new Error("Could not load CRM pipeline");
    pipelineData = await res.json();
    if (els.pipelineName && pipelineData.pipeline?.name) {
      els.pipelineName.textContent = pipelineData.pipeline.name;
    }
    populateStageSelects();
    renderPipelineBoard();
  }

  async function loadAccounts(q = "") {
    const query = q.trim();
    const path = query ? `/admin/crm/accounts?q=${encodeURIComponent(query)}` : "/admin/crm/accounts";
    const res = await apiFetch(path);
    if (!res.ok) throw new Error("Could not load companies");
    const data = await res.json();
    accounts = data.items || [];
    renderAccountsTable();
    populateAccountSelect();
    populateDealLinkSelects();
  }

  async function loadContacts(q = "") {
    const query = q.trim();
    const path = query ? `/admin/crm/contacts?q=${encodeURIComponent(query)}` : "/admin/crm/contacts";
    const res = await apiFetch(path);
    if (!res.ok) throw new Error("Could not load contacts");
    const data = await res.json();
    contacts = data.items || [];
    renderContactsTable();
    populateDealLinkSelects();
  }

  async function refreshAll() {
    const pipelineQ = els.pipelineSearch?.value || "";
    const pipelineCategory = els.pipelineCategory?.value || "";
    const accountsQ = els.accountsSearch?.value || "";
    const contactsQ = els.contactsSearch?.value || "";
    await Promise.all([
      loadSummary(),
      loadPipeline(pipelineQ, pipelineCategory),
      loadAccounts(accountsQ),
      loadContacts(contactsQ),
    ]);
    loaded = true;
    if (selectedDealId) await openDealDrawer(selectedDealId);
    if (selectedEntity) await openEntityDrawer(selectedEntity.type, selectedEntity.id, true);
  }

  function openDealDialog(deal = null) {
    if (!els.dealDialog || !els.dealForm) return;
    closeEntityDrawer();
    els.dealForm.reset();
    populateStageSelects();
    populateDealLinkSelects();
    populateMetaSelects();
    if (deal) {
      if (els.dealDialogTitle) els.dealDialogTitle.textContent = "Edit deal";
      if (els.dealIdInput) els.dealIdInput.value = String(deal.id);
      els.dealForm.title.value = deal.title || "";
      if (els.dealCategorySelect) els.dealCategorySelect.value = deal.deal_category || "general";
      if (els.dealStageSelect) els.dealStageSelect.value = String(deal.stage_id || "");
      populateDealLinkSelects(deal.account_id || "", deal.contact_id || "");
      if (deal.value_gbp != null) els.dealForm.value_gbp.value = deal.value_gbp;
      if (deal.expected_close_date) els.dealForm.expected_close_date.value = deal.expected_close_date.slice(0, 10);
      if (deal.notes) els.dealForm.notes.value = deal.notes;
    } else {
      if (els.dealDialogTitle) els.dealDialogTitle.textContent = "Add deal";
      if (els.dealIdInput) els.dealIdInput.value = "";
    }
    els.dealDialog.showModal();
  }

  function openAccountDialog(account = null) {
    if (!els.accountDialog || !els.accountForm) return;
    els.accountForm.reset();
    if (account) {
      if (els.accountDialogTitle) els.accountDialogTitle.textContent = "Edit company";
      if (els.accountIdInput) els.accountIdInput.value = String(account.id);
      if (els.accountDeleteBtn) els.accountDeleteBtn.hidden = false;
      els.accountForm.name.value = account.name || "";
      if (els.accountTypeSelect) els.accountTypeSelect.value = account.account_type || "prospect";
      if (els.accountForm.industry) els.accountForm.industry.value = account.industry || "";
      els.accountForm.email.value = account.email || "";
      els.accountForm.phone.value = account.phone || "";
      els.accountForm.website.value = account.website || "";
      els.accountForm.notes.value = account.notes || "";
    } else {
      if (els.accountDialogTitle) els.accountDialogTitle.textContent = "Add company";
      if (els.accountIdInput) els.accountIdInput.value = "";
      if (els.accountDeleteBtn) els.accountDeleteBtn.hidden = true;
    }
    els.accountDialog.showModal();
  }

  function openContactDialog(contact = null) {
    if (!els.contactDialog || !els.contactForm) return;
    populateAccountSelect();
    els.contactForm.reset();
    if (contact) {
      if (els.contactDialogTitle) els.contactDialogTitle.textContent = "Edit contact";
      if (els.contactIdInput) els.contactIdInput.value = String(contact.id);
      if (els.contactDeleteBtn) els.contactDeleteBtn.hidden = false;
      els.contactForm.name.value = contact.name || "";
      if (contact.account_id) els.contactForm.account_id.value = String(contact.account_id);
      if (els.contactForm.department) els.contactForm.department.value = contact.department || "";
      els.contactForm.job_title.value = contact.job_title || "";
      els.contactForm.email.value = contact.email || "";
      els.contactForm.phone.value = contact.phone || "";
      els.contactForm.notes.value = contact.notes || "";
    } else {
      if (els.contactDialogTitle) els.contactDialogTitle.textContent = "Add contact";
      if (els.contactIdInput) els.contactIdInput.value = "";
      if (els.contactDeleteBtn) els.contactDeleteBtn.hidden = true;
    }
    els.contactDialog.showModal();
  }

  async function openDealDrawer(dealId) {
    selectedDealId = dealId;
    closeEntityDrawer();
    if (!els.dealDrawer) return;
    const res = await apiFetch(`/admin/crm/deals/${dealId}/activities`);
    if (!res.ok) {
      alert("Could not load deal details.");
      return;
    }
    const data = await res.json();
    const deal = data.deal;
    if (els.dealDrawerTitle) els.dealDrawerTitle.textContent = deal.title;
    if (els.dealDrawerMeta) {
      const bits = [
        dealCategoryLabel(deal.deal_category || "general"),
        deal.account_name,
        deal.contact_name,
        deal.value_gbp != null ? formatMoney(deal.value_gbp) : null,
        deal.expected_close_date ? `Close ${deal.expected_close_date.slice(0, 10)}` : null,
      ].filter(Boolean);
      els.dealDrawerMeta.textContent = bits.join(" · ") || "No linked company or contact";
    }
    if (els.dealDrawerStage) els.dealDrawerStage.value = String(deal.stage_id);
    if (els.dealDrawerCategory) els.dealDrawerCategory.value = deal.deal_category || "general";
    if (els.activityList) els.activityList.innerHTML = renderActivities(data.items || []);
    renderDocuments(els.dealDocuments, data.documents || [], () => openDealDrawer(dealId));
    els.dealDrawer.dataset.deal = JSON.stringify(deal);
    resetEmailForm(deal);
    if (!emailTemplates.length) await loadEmailTemplates();
    els.dealDrawer.hidden = false;
  }

  function closeDealDrawer() {
    selectedDealId = null;
    if (els.dealDrawer) {
      els.dealDrawer.hidden = true;
      delete els.dealDrawer.dataset.deal;
    }
  }

  async function openEntityDrawer(type, id, silent = false) {
    selectedEntity = { type, id };
    closeDealDrawer();
    if (!els.entityDrawer) return;
    const path = type === "account" ? `/admin/crm/accounts/${id}` : `/admin/crm/contacts/${id}`;
    const res = await apiFetch(path);
    if (!res.ok) {
      if (!silent) alert(type === "account" ? "Could not load company." : "Could not load contact.");
      return;
    }
    const data = await res.json();
    const record = type === "account" ? data.account : data.contact;
    if (els.entityDrawerTitle) els.entityDrawerTitle.textContent = record.name;
    if (els.entityDrawerMeta) {
      const bits =
        type === "account"
          ? [
              accountTypeLabel(record.account_type || "prospect"),
              record.industry,
              record.email,
              record.phone,
              record.website,
            ].filter(Boolean)
          : [record.account_name, record.department, record.job_title, record.email, record.phone].filter(
              Boolean,
            );
      els.entityDrawerMeta.textContent = bits.join(" · ") || "No extra details";
    }
    if (els.entityDeals) {
      const deals = data.deals || [];
      els.entityDeals.innerHTML = deals.length
        ? `<h4>Related deals</h4><ul class="crm-related-list">${deals
            .map(
              (deal) =>
                `<li><button type="button" class="crm-link-btn" data-open-deal-id="${deal.id}">${escapeHtml(deal.title)}</button> · ${escapeHtml(deal.stage_label || "—")}${deal.value_gbp != null ? ` · ${escapeHtml(formatMoney(deal.value_gbp))}` : ""}</li>`,
            )
            .join("")}</ul>`
        : '<p class="muted">No linked deals yet.</p>';
      els.entityDeals.querySelectorAll("[data-open-deal-id]").forEach((button) => {
        button.addEventListener("click", () => {
          setTab("pipeline");
          void openDealDrawer(Number(button.dataset.openDealId));
        });
      });
    }
    if (els.entityActivityList) els.entityActivityList.innerHTML = renderActivities(data.activities || []);
    renderDocuments(els.entityDocuments, data.documents || [], () =>
      openEntityDrawer(type, id, true),
    );
    els.entityDrawer.dataset.entity = JSON.stringify(record);
    els.entityDrawer.dataset.entityType = type;
    els.entityDrawer.hidden = false;
  }

  function closeEntityDrawer() {
    selectedEntity = null;
    if (els.entityDrawer) {
      els.entityDrawer.hidden = true;
      delete els.entityDrawer.dataset.entity;
      delete els.entityDrawer.dataset.entityType;
    }
  }

  function debouncedSearch(key, loader, input) {
    clearTimeout(searchTimers[key]);
    searchTimers[key] = setTimeout(() => {
      void loader(input?.value || "");
    }, 250);
  }

  document.querySelectorAll(".crm-tab").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.crmTab || "pipeline"));
  });

  document.getElementById("crm-add-deal-btn")?.addEventListener("click", () => openDealDialog());
  document.getElementById("crm-add-account-btn")?.addEventListener("click", () => openAccountDialog());
  document.getElementById("crm-add-contact-btn")?.addEventListener("click", () => openContactDialog());
  document.getElementById("crm-deal-cancel")?.addEventListener("click", () => els.dealDialog?.close());
  document.getElementById("crm-account-cancel")?.addEventListener("click", () => els.accountDialog?.close());
  document.getElementById("crm-contact-cancel")?.addEventListener("click", () => els.contactDialog?.close());
  document.getElementById("crm-deal-drawer-close")?.addEventListener("click", closeDealDrawer);
  document.getElementById("crm-entity-drawer-close")?.addEventListener("click", closeEntityDrawer);

  document.getElementById("crm-deal-edit-btn")?.addEventListener("click", () => {
    const raw = els.dealDrawer?.dataset.deal;
    if (!raw) return;
    openDealDialog(JSON.parse(raw));
  });

  document.getElementById("crm-deal-delete-btn")?.addEventListener("click", async () => {
    if (!selectedDealId) return;
    if (!window.confirm("Delete this deal and its activity history?")) return;
    try {
      const res = await apiFetch(`/admin/crm/deals/${selectedDealId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not delete deal");
      closeDealDrawer();
      await refreshAll();
    } catch (error) {
      alert(error.message || "Could not delete deal");
    }
  });

  document.getElementById("crm-entity-edit-btn")?.addEventListener("click", () => {
    const raw = els.entityDrawer?.dataset.entity;
    const type = els.entityDrawer?.dataset.entityType;
    if (!raw || !type) return;
    const record = JSON.parse(raw);
    if (type === "account") openAccountDialog(record);
    else openContactDialog(record);
  });

  els.pipelineSearch?.addEventListener("input", () => {
    debouncedSearch("pipeline", () => loadPipeline(els.pipelineSearch?.value || "", els.pipelineCategory?.value || ""), els.pipelineSearch);
  });
  els.pipelineCategory?.addEventListener("change", () => {
    void loadPipeline(els.pipelineSearch?.value || "", els.pipelineCategory?.value || "");
  });
  els.accountsSearch?.addEventListener("input", () => {
    debouncedSearch("accounts", loadAccounts, els.accountsSearch);
  });
  els.contactsSearch?.addEventListener("input", () => {
    debouncedSearch("contacts", loadContacts, els.contactsSearch);
  });

  document.getElementById("crm-export-deals")?.addEventListener("click", () => {
    void downloadAuthenticated("/admin/crm/export/deals.csv", "crm-deals.csv");
  });
  document.getElementById("crm-export-accounts")?.addEventListener("click", () => {
    void downloadAuthenticated("/admin/crm/export/accounts.csv", "crm-companies.csv");
  });
  document.getElementById("crm-export-contacts")?.addEventListener("click", () => {
    void downloadAuthenticated("/admin/crm/export/contacts.csv", "crm-contacts.csv");
  });

  els.importAccountsInput = document.getElementById("crm-import-accounts");
  els.importContactsInput = document.getElementById("crm-import-contacts");

  els.importAccountsInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/admin/crm/import/accounts", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Import failed");
      showImportResult(data, "Companies import");
      await refreshAll();
    } catch (error) {
      showImportResult({ imported: 0, skipped: 1, errors: [error.message] }, "Companies import");
    }
  });

  els.importContactsInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/admin/crm/import/contacts", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Import failed");
      showImportResult(data, "Contacts import");
      await refreshAll();
    } catch (error) {
      showImportResult({ imported: 0, skipped: 1, errors: [error.message] }, "Contacts import");
    }
  });

  els.dealDocumentInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedDealId) return;
    try {
      await uploadDocument({
        file,
        dealId: selectedDealId,
        onDone: () => openDealDrawer(selectedDealId),
      });
    } catch (error) {
      alert(error.message || "Upload failed");
    }
  });

  els.entityDocumentInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedEntity) return;
    try {
      await uploadDocument({
        file,
        accountId: selectedEntity.type === "account" ? selectedEntity.id : null,
        contactId: selectedEntity.type === "contact" ? selectedEntity.id : null,
        onDone: () => openEntityDrawer(selectedEntity.type, selectedEntity.id, true),
      });
    } catch (error) {
      alert(error.message || "Upload failed");
    }
  });

  els.dealForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const dealId = form.deal_id?.value ? Number(form.deal_id.value) : null;
    const accountId = form.account_id.value ? Number(form.account_id.value) : null;
    const contactId = form.contact_id.value ? Number(form.contact_id.value) : null;
    const payload = {
      title: form.title.value.trim(),
      deal_category: form.deal_category?.value || "general",
      stage_id: Number(form.stage_id.value),
      account_id: accountId,
      contact_id: contactId,
      value_gbp: form.value_gbp.value ? Number(form.value_gbp.value) : null,
      expected_close_date: form.expected_close_date.value || null,
      notes: form.notes.value.trim() || null,
    };
    try {
      const res = await apiFetch(dealId ? `/admin/crm/deals/${dealId}` : "/admin/crm/deals", {
        method: dealId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not save deal");
      els.dealDialog?.close();
      await refreshAll();
    } catch (error) {
      alert(error.message || "Could not save deal");
    }
  });

  els.accountForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const accountId = form.account_id?.value ? Number(form.account_id.value) : null;
    const payload = {
      name: form.name.value.trim(),
      account_type: form.account_type?.value || "prospect",
      industry: form.industry?.value?.trim() || null,
      email: form.email.value.trim() || null,
      phone: form.phone.value.trim() || null,
      website: form.website.value.trim() || null,
      notes: form.notes.value.trim() || null,
    };
    try {
      const res = await apiFetch(
        accountId ? `/admin/crm/accounts/${accountId}` : "/admin/crm/accounts",
        {
          method: accountId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not save company");
      els.accountDialog?.close();
      await refreshAll();
    } catch (error) {
      alert(error.message || "Could not save company");
    }
  });

  els.contactForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const contactId = form.contact_id?.value ? Number(form.contact_id.value) : null;
    const accountId = form.account_id.value ? Number(form.account_id.value) : null;
    const payload = {
      name: form.name.value.trim(),
      account_id: accountId,
      department: form.department?.value?.trim() || null,
      job_title: form.job_title.value.trim() || null,
      email: form.email.value.trim() || null,
      phone: form.phone.value.trim() || null,
      notes: form.notes.value.trim() || null,
    };
    try {
      const res = await apiFetch(
        contactId ? `/admin/crm/contacts/${contactId}` : "/admin/crm/contacts",
        {
          method: contactId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not save contact");
      els.contactDialog?.close();
      await refreshAll();
    } catch (error) {
      alert(error.message || "Could not save contact");
    }
  });

  els.accountDeleteBtn?.addEventListener("click", async () => {
    const accountId = Number(els.accountIdInput?.value || 0);
    if (!accountId) return;
    if (!window.confirm("Delete this company? Linked contacts will be kept but unlinked.")) return;
    try {
      const res = await apiFetch(`/admin/crm/accounts/${accountId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not delete company");
      els.accountDialog?.close();
      closeEntityDrawer();
      await refreshAll();
    } catch (error) {
      alert(error.message || "Could not delete company");
    }
  });

  els.contactDeleteBtn?.addEventListener("click", async () => {
    const contactId = Number(els.contactIdInput?.value || 0);
    if (!contactId) return;
    if (!window.confirm("Delete this contact?")) return;
    try {
      const res = await apiFetch(`/admin/crm/contacts/${contactId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not delete contact");
      els.contactDialog?.close();
      closeEntityDrawer();
      await refreshAll();
    } catch (error) {
      alert(error.message || "Could not delete contact");
    }
  });

  els.dealDrawerCategory?.addEventListener("change", async (event) => {
    if (!selectedDealId) return;
    const category = event.target.value;
    try {
      const res = await apiFetch(`/admin/crm/deals/${selectedDealId}`, {
        method: "PATCH",
        body: JSON.stringify({ deal_category: category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not update deal type");
      await refreshAll();
    } catch (error) {
      alert(error.message || "Could not update deal type");
    }
  });

  els.dealDrawerStage?.addEventListener("change", async (event) => {
    if (!selectedDealId) return;
    const stageId = Number(event.target.value);
    try {
      await moveDealToStage(selectedDealId, stageId);
    } catch (error) {
      alert(error.message || "Could not move deal");
    }
  });

  els.emailTemplateSelect?.addEventListener("change", () => {
    if (!selectedDealId || !els.emailTemplateSelect.value) return;
    void previewDealEmail(selectedDealId).catch((error) => alert(error.message || "Could not load template"));
  });

  els.emailCustomInput?.addEventListener("change", () => {
    if (!selectedDealId || !els.emailTemplateSelect?.value) return;
    void previewDealEmail(selectedDealId).catch((error) => alert(error.message || "Could not load template"));
  });

  els.emailForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedDealId) return;
    const subject = els.emailSubjectInput?.value?.trim() || "";
    const bodyText = els.emailBodyInput?.value?.trim() || "";
    const toEmail = els.emailToInput?.value?.trim() || "";
    if (!subject || !bodyText || !toEmail) return;
    const bodyHtml = bodyText
      .split(/\n\n+/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
      .join("");
    try {
      const res = await apiFetch(`/admin/crm/deals/${selectedDealId}/send-email`, {
        method: "POST",
        body: JSON.stringify({
          to_email: toEmail,
          subject,
          body_html: bodyHtml,
          body_text: bodyText,
          template_key: els.emailTemplateSelect?.value || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not send email");
      alert(data.sent ? "Email sent and logged." : "Email queued (check SMTP delivery).");
      await openDealDrawer(selectedDealId);
      await loadSummary();
    } catch (error) {
      alert(error.message || "Could not send email");
    }
  });

  document.getElementById("crm-deal-ai-summary")?.addEventListener("click", async () => {
    if (!selectedDealId) return;
    if (els.aiOutput) {
      els.aiOutput.hidden = false;
      els.aiOutput.textContent = "Generating summary…";
    }
    try {
      const res = await apiFetch(`/admin/crm/deals/${selectedDealId}/ai/summary`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "AI summary failed");
      if (els.aiOutput) {
        els.aiOutput.textContent = data.content || "";
        if (data.disclaimer) {
          els.aiOutput.innerHTML = `<p>${escapeHtml(data.content || "")}</p><p class="muted">${escapeHtml(data.disclaimer)}</p>`;
        }
      }
    } catch (error) {
      if (els.aiOutput) els.aiOutput.textContent = error.message || "AI summary failed";
    }
  });

  document.getElementById("crm-deal-ai-draft")?.addEventListener("click", async () => {
    if (!selectedDealId) return;
    const customMessage = els.emailCustomInput?.value?.trim() || null;
    if (els.aiOutput) {
      els.aiOutput.hidden = false;
      els.aiOutput.textContent = "Drafting email…";
    }
    try {
      const res = await apiFetch(`/admin/crm/deals/${selectedDealId}/ai/draft-email`, {
        method: "POST",
        body: JSON.stringify({ custom_message: customMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "AI draft failed");
      if (els.emailSubjectInput && data.subject) els.emailSubjectInput.value = data.subject;
      if (els.emailBodyInput && data.body_text) els.emailBodyInput.value = data.body_text;
      if (els.aiOutput) {
        els.aiOutput.innerHTML = `<p class="muted">${escapeHtml(data.disclaimer || "Review before sending.")}</p>`;
      }
    } catch (error) {
      if (els.aiOutput) els.aiOutput.textContent = error.message || "AI draft failed";
    }
  });

  els.activityForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedDealId) return;
    const form = event.currentTarget;
    const payload = {
      activity_type: form.activity_type.value,
      subject: form.subject.value.trim() || null,
      body: form.body.value.trim(),
    };
    try {
      const res = await apiFetch(`/admin/crm/deals/${selectedDealId}/activities`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not save activity");
      form.reset();
      await openDealDrawer(selectedDealId);
      await loadSummary();
    } catch (error) {
      alert(error.message || "Could not save activity");
    }
  });

  els.entityActivityForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedEntity) return;
    const form = event.currentTarget;
    const payload = {
      activity_type: form.activity_type.value,
      subject: form.subject.value.trim() || null,
      body: form.body.value.trim(),
    };
    const path =
      selectedEntity.type === "account"
        ? `/admin/crm/accounts/${selectedEntity.id}/activities`
        : `/admin/crm/contacts/${selectedEntity.id}/activities`;
    try {
      const res = await apiFetch(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not save activity");
      form.reset();
      await openEntityDrawer(selectedEntity.type, selectedEntity.id, true);
    } catch (error) {
      alert(error.message || "Could not save activity");
    }
  });

  async function maybeLoadCrm() {
    if (!isAddonEnabled("crm")) return;
    if (loaded) return;
    if (els.pipelineBoard) els.pipelineBoard.innerHTML = '<p class="muted">Loading pipeline…</p>';
    try {
      await loadCrmMeta();
      await refreshAll();
    } catch (error) {
      if (els.pipelineBoard) {
        els.pipelineBoard.innerHTML = `<p class="promo-result promo-result--error">${escapeHtml(error.message || "CRM failed to load")}</p>`;
      }
    }
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "crm") void maybeLoadCrm();
  });

  window.addEventListener("admin:features", () => {
    if (isAddonEnabled("crm")) void maybeLoadCrm();
  });

  if (parseHashBaseSection(window.location.hash) === "crm") {
    void maybeLoadCrm();
  }
})();
