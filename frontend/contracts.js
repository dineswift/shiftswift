/** Service agreements — read-only tenant view (generate/send is Master-only). */
(function () {
  const { apiFetch, escapeHtml, parseHashBaseSection } = window.Admin;

  let contracts = [];
  let selectedContractId = null;
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

  function renderContractsTable() {
    const tbody = $("contracts-table-body");
    if (!tbody) return;
    if (!contracts.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted">No agreements on file yet. ShiftSwift prepares your MSA, DPA, and order form when you subscribe.</td></tr>';
      return;
    }
    tbody.innerHTML = contracts
      .map((row) => {
        const selected = selectedContractId === row.id ? " contracts-case-row--selected" : "";
        return `<tr class="contracts-case-row${selected}" data-contract-id="${row.id}">
          <td><strong>${escapeHtml(row.contract_number)}</strong><div class="muted">${formatDate(row.created_at)}</div></td>
          <td>${escapeHtml(row.template_name || row.template_id)}</td>
          <td>${escapeHtml(row.customer_legal_name)}</td>
          <td>${statusBadge(row.status)}</td>
          <td>${escapeHtml(row.signatory_email)}</td>
          <td>${row.signed_at ? escapeHtml(formatDate(row.signed_at)) : row.sent_at ? '<span class="muted">Awaiting signature</span>' : '<span class="muted">Not sent</span>'}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".contracts-case-row").forEach((row) => {
      row.addEventListener("click", () => selectContract(Number(row.dataset.contractId)));
    });
  }

  async function loadContracts() {
    const tbody = $("contracts-table-body");
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="muted">Loading agreements…</td></tr>';
    try {
      const res = await apiFetch("/contracts");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      contracts = data.items || [];
      renderContractsTable();
      if (selectedContractId && contracts.some((c) => c.id === selectedContractId)) {
        await selectContract(selectedContractId, { scroll: false });
      }
    } catch {
      contracts = [];
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">Could not load agreements. Check you are signed in and the API is running.</td></tr>';
      }
    }
  }

  function signingHelpHtml(data) {
    if (data.status === "signed") {
      return `<p class="contracts-readonly-note contracts-readonly-note--ok">Signed on ${escapeHtml(formatDate(data.signed_at))}.</p>`;
    }
    if (data.status === "sent") {
      return `<p class="contracts-readonly-note">Awaiting signature — a secure link was emailed to <strong>${escapeHtml(data.signatory_email)}</strong>. Check spam or contact ShiftSwift support if you need it resent.</p>`;
    }
    return `<p class="contracts-readonly-note muted">Not yet sent for signature. ShiftSwift will issue this when your subscription pack is ready.</p>`;
  }

  function renderDetailPanel(data) {
    const empty = $("contracts-detail-empty");
    const content = $("contracts-detail-content");
    if (!content) return;
    empty?.setAttribute("hidden", "");
    content.hidden = false;

    const timeline = (data.events || []).map(
      (event) => `<li class="contracts-timeline__item">
        <span class="contracts-timeline__dot">✓</span>
        <span><strong>${escapeHtml(event.event_type)}</strong><span class="muted"> · ${escapeHtml(formatDate(event.created_at))}${event.actor ? ` · ${escapeHtml(event.actor)}` : ""}</span></span>
      </li>`
    );

    content.innerHTML = `
      <div class="contracts-detail-head">
        <div>
          <h3>${escapeHtml(data.contract_number)}</h3>
          ${statusBadge(data.status)}
        </div>
      </div>
      <dl class="contracts-detail-grid">
        <div><dt>Template</dt><dd>${escapeHtml(data.template_name || data.template_id)}</dd></div>
        <div><dt>Customer</dt><dd>${escapeHtml(data.customer_legal_name)}</dd></div>
        <div><dt>Signatory</dt><dd>${escapeHtml(data.signatory_name || "Not set")}${data.signatory_title ? ` · ${escapeHtml(data.signatory_title)}` : ""}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(data.signatory_email)}</dd></div>
        <div><dt>Effective date</dt><dd>${escapeHtml(formatDate(data.effective_date))}</dd></div>
        <div><dt>Sent / signed</dt><dd>${data.signed_at ? escapeHtml(formatDate(data.signed_at)) : data.sent_at ? `Sent ${escapeHtml(formatDate(data.sent_at))}` : "Not sent"}</dd></div>
      </dl>
      ${signingHelpHtml(data)}
      ${timeline.length ? `<ol class="contracts-timeline">${timeline.join("")}</ol>` : ""}
      <div class="contracts-preview-wrap">
        <h4 class="hr-section-title">Agreement preview</h4>
        <div class="contract-preview-panel">${data.html || "<p class=\"muted\">No preview available.</p>"}</div>
      </div>`;
  }

  async function selectContract(contractId, { scroll = true } = {}) {
    selectedContractId = contractId;
    renderContractsTable();
    const content = $("contracts-detail-content");
    if (content) content.innerHTML = '<p class="muted">Loading agreement…</p>';
    try {
      const res = await apiFetch(`/contracts/${contractId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Load failed");
      renderDetailPanel(data);
      if (scroll) content?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      if (content) content.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load agreement.")}</p>`;
    }
  }

  async function initContractsSection() {
    await loadContracts();
  }

  function bindSectionEvents() {
    if (sectionBound) return;
    sectionBound = true;
    window.addEventListener("admin:section", (event) => {
      if (event.detail?.section === "contracts") initContractsSection();
    });
    if (parseHashBaseSection(window.location.hash) === "contracts") initContractsSection();
  }

  bindSectionEvents();
})();
