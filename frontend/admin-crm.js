/** Sales CRM add-on — pipeline, companies, contacts (Master-gated). */
(async function initAdminCrm() {
  const { apiFetch, escapeHtml, isAddonEnabled, parseHashBaseSection } = window.Admin;

  let pipelineData = null;
  let accounts = [];
  let contacts = [];
  let selectedDealId = null;
  let loaded = false;
  let activeTab = "pipeline";

  const els = {
    summaryDeals: document.getElementById("crm-summary-deals"),
    summaryAccounts: document.getElementById("crm-summary-accounts"),
    summaryContacts: document.getElementById("crm-summary-contacts"),
    pipelineName: document.getElementById("crm-pipeline-name"),
    pipelineBoard: document.getElementById("crm-pipeline-board"),
    accountsBody: document.getElementById("crm-accounts-body"),
    contactsBody: document.getElementById("crm-contacts-body"),
    dealDialog: document.getElementById("crm-deal-dialog"),
    dealForm: document.getElementById("crm-deal-form"),
    dealStageSelect: document.getElementById("crm-deal-stage-select"),
    accountDialog: document.getElementById("crm-account-dialog"),
    accountForm: document.getElementById("crm-account-form"),
    contactDialog: document.getElementById("crm-contact-dialog"),
    contactForm: document.getElementById("crm-contact-form"),
    contactAccountSelect: document.getElementById("crm-contact-account-select"),
    dealDrawer: document.getElementById("crm-deal-drawer"),
    dealDrawerTitle: document.getElementById("crm-deal-drawer-title"),
    dealDrawerMeta: document.getElementById("crm-deal-drawer-meta"),
    dealDrawerStage: document.getElementById("crm-deal-drawer-stage"),
    activityForm: document.getElementById("crm-activity-form"),
    activityList: document.getElementById("crm-activity-list"),
  };

  function formatMoney(value) {
    if (value == null || value === "") return "";
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    return `£${num.toFixed(2)}`;
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
  }

  function renderSummary(summary) {
    if (!summary) return;
    if (els.summaryDeals) {
      els.summaryDeals.textContent = `${summary.deals || 0} deals · ${summary.deals_won || 0} won`;
    }
    if (els.summaryAccounts) els.summaryAccounts.textContent = `${summary.accounts || 0} companies`;
    if (els.summaryContacts) els.summaryContacts.textContent = `${summary.contacts || 0} contacts`;
    if (els.pipelineName && summary.pipeline_name) {
      els.pipelineName.textContent = summary.pipeline_name;
    }
  }

  function renderAccountsTable() {
    if (!els.accountsBody) return;
    if (!accounts.length) {
      els.accountsBody.innerHTML = '<tr><td colspan="4" class="muted">No companies yet.</td></tr>';
      return;
    }
    els.accountsBody.innerHTML = accounts
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.email || "—")}</td>
          <td>${escapeHtml(row.phone || "—")}</td>
          <td>${escapeHtml(row.owner_username || "—")}</td>
        </tr>`,
      )
      .join("");
  }

  function renderContactsTable() {
    if (!els.contactsBody) return;
    if (!contacts.length) {
      els.contactsBody.innerHTML = '<tr><td colspan="4" class="muted">No contacts yet.</td></tr>';
      return;
    }
    els.contactsBody.innerHTML = contacts
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.name)}${row.job_title ? `<br><small class="muted">${escapeHtml(row.job_title)}</small>` : ""}</td>
          <td>${escapeHtml(row.account_name || "—")}</td>
          <td>${escapeHtml(row.email || "—")}</td>
          <td>${escapeHtml(row.phone || "—")}</td>
        </tr>`,
      )
      .join("");
  }

  function populateAccountSelect() {
    if (!els.contactAccountSelect) return;
    const options = ['<option value="">— None —</option>']
      .concat(
        accounts.map(
          (row) => `<option value="${escapeHtml(String(row.id))}">${escapeHtml(row.name)}</option>`,
        ),
      )
      .join("");
    els.contactAccountSelect.innerHTML = options;
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
                  deal.account_name,
                  deal.contact_name,
                  deal.value_gbp != null ? formatMoney(deal.value_gbp) : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return `<button type="button" class="crm-deal-card" data-deal-id="${deal.id}">
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
          <div class="crm-pipeline-column__body">${cards}</div>
        </article>`;
      })
      .join("");

    els.pipelineBoard.querySelectorAll("[data-deal-id]").forEach((button) => {
      button.addEventListener("click", () => openDealDrawer(Number(button.dataset.dealId)));
    });
  }

  function populateStageSelects() {
    const stages = pipelineData?.stages || [];
    const options = stages
      .map((stage) => `<option value="${stage.id}">${escapeHtml(stage.label)}</option>`)
      .join("");
    if (els.dealStageSelect) els.dealStageSelect.innerHTML = options;
    if (els.dealDrawerStage) els.dealDrawerStage.innerHTML = options;
  }

  async function loadSummary() {
    const res = await apiFetch("/admin/crm/summary");
    if (!res.ok) throw new Error("Could not load CRM summary");
    const data = await res.json();
    renderSummary(data);
    return data;
  }

  async function loadPipeline() {
    const res = await apiFetch("/admin/crm/pipeline");
    if (!res.ok) throw new Error("Could not load CRM pipeline");
    pipelineData = await res.json();
    if (els.pipelineName && pipelineData.pipeline?.name) {
      els.pipelineName.textContent = pipelineData.pipeline.name;
    }
    populateStageSelects();
    renderPipelineBoard();
  }

  async function loadAccounts() {
    const res = await apiFetch("/admin/crm/accounts");
    if (!res.ok) throw new Error("Could not load companies");
    const data = await res.json();
    accounts = data.items || [];
    renderAccountsTable();
    populateAccountSelect();
  }

  async function loadContacts() {
    const res = await apiFetch("/admin/crm/contacts");
    if (!res.ok) throw new Error("Could not load contacts");
    const data = await res.json();
    contacts = data.items || [];
    renderContactsTable();
  }

  async function refreshAll() {
    await Promise.all([loadSummary(), loadPipeline(), loadAccounts(), loadContacts()]);
    loaded = true;
    if (selectedDealId) await openDealDrawer(selectedDealId);
  }

  function openDealDialog() {
    if (!els.dealDialog || !els.dealForm) return;
    els.dealForm.reset();
    populateStageSelects();
    els.dealDialog.showModal();
  }

  function openAccountDialog() {
    if (!els.accountDialog || !els.accountForm) return;
    els.accountForm.reset();
    els.accountDialog.showModal();
  }

  function openContactDialog() {
    if (!els.contactDialog || !els.contactForm) return;
    populateAccountSelect();
    els.contactForm.reset();
    els.contactDialog.showModal();
  }

  async function openDealDrawer(dealId) {
    selectedDealId = dealId;
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
        deal.account_name,
        deal.contact_name,
        deal.value_gbp != null ? formatMoney(deal.value_gbp) : null,
      ].filter(Boolean);
      els.dealDrawerMeta.textContent = bits.join(" · ") || "No linked company or contact";
    }
    if (els.dealDrawerStage) els.dealDrawerStage.value = String(deal.stage_id);
    if (els.activityList) {
      const items = data.items || [];
      els.activityList.innerHTML = items.length
        ? items
            .map(
              (item) => `<article class="crm-activity-item">
                <p class="crm-activity-item__meta">${escapeHtml(item.activity_type)} · ${escapeHtml(item.activity_at || "")}${item.created_by ? ` · ${escapeHtml(item.created_by)}` : ""}</p>
                ${item.subject ? `<strong>${escapeHtml(item.subject)}</strong>` : ""}
                <p>${escapeHtml(item.body || "")}</p>
              </article>`,
            )
            .join("")
        : '<p class="muted">No activity yet.</p>';
    }
    els.dealDrawer.hidden = false;
  }

  function closeDealDrawer() {
    selectedDealId = null;
    if (els.dealDrawer) els.dealDrawer.hidden = true;
  }

  document.querySelectorAll(".crm-tab").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.crmTab || "pipeline"));
  });

  document.getElementById("crm-add-deal-btn")?.addEventListener("click", openDealDialog);
  document.getElementById("crm-add-account-btn")?.addEventListener("click", openAccountDialog);
  document.getElementById("crm-add-contact-btn")?.addEventListener("click", openContactDialog);
  document.getElementById("crm-deal-cancel")?.addEventListener("click", () => els.dealDialog?.close());
  document.getElementById("crm-account-cancel")?.addEventListener("click", () => els.accountDialog?.close());
  document.getElementById("crm-contact-cancel")?.addEventListener("click", () => els.contactDialog?.close());
  document.getElementById("crm-deal-drawer-close")?.addEventListener("click", closeDealDrawer);

  els.dealForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      title: form.title.value.trim(),
      stage_id: Number(form.stage_id.value),
      value_gbp: form.value_gbp.value ? Number(form.value_gbp.value) : null,
      expected_close_date: form.expected_close_date.value || null,
      notes: form.notes.value.trim() || null,
    };
    try {
      const res = await apiFetch("/admin/crm/deals", {
        method: "POST",
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
    const payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim() || null,
      phone: form.phone.value.trim() || null,
      website: form.website.value.trim() || null,
      notes: form.notes.value.trim() || null,
    };
    try {
      const res = await apiFetch("/admin/crm/accounts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
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
    const accountId = form.account_id.value ? Number(form.account_id.value) : null;
    const payload = {
      name: form.name.value.trim(),
      account_id: accountId,
      job_title: form.job_title.value.trim() || null,
      email: form.email.value.trim() || null,
      phone: form.phone.value.trim() || null,
      notes: form.notes.value.trim() || null,
    };
    try {
      const res = await apiFetch("/admin/crm/contacts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not save contact");
      els.contactDialog?.close();
      await refreshAll();
    } catch (error) {
      alert(error.message || "Could not save contact");
    }
  });

  els.dealDrawerStage?.addEventListener("change", async (event) => {
    if (!selectedDealId) return;
    const stageId = Number(event.target.value);
    try {
      const res = await apiFetch(`/admin/crm/deals/${selectedDealId}`, {
        method: "PATCH",
        body: JSON.stringify({ stage_id: stageId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not move deal");
      await refreshAll();
    } catch (error) {
      alert(error.message || "Could not move deal");
    }
  });

  els.activityForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedDealId) return;
    const form = event.currentTarget;
    const payload = {
      activity_type: "note",
      subject: form.subject.value.trim() || null,
      body: form.body.value.trim(),
    };
    try {
      const res = await apiFetch(`/admin/crm/deals/${selectedDealId}/activities`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not save note");
      form.reset();
      await openDealDrawer(selectedDealId);
      await loadSummary();
    } catch (error) {
      alert(error.message || "Could not save note");
    }
  });

  async function maybeLoadCrm() {
    if (!isAddonEnabled("crm")) return;
    const section = document.getElementById("crm");
    if (section) section.hidden = false;
    if (loaded) return;
    if (els.pipelineBoard) els.pipelineBoard.innerHTML = '<p class="muted">Loading pipeline…</p>';
    try {
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
