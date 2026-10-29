/** Service agreements — read-only tenant view (issued agreements only). */
(function () {
  const { apiFetch, escapeHtml, parseHashBaseSection } = window.Admin;

  let contracts = [];
  let selectedContractId = null;
  let sectionBound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return value;
    }
  }

  /** Tenant-facing status — ShiftSwift sends; the business receives and signs. */
  function tenantStatusBadge(row) {
    const status = row.status;
    if (status === "signed") {
      return `<span class="contracts-status-pill contracts-status-pill--signed">Signed</span>`;
    }
    if (status === "sent") {
      return `<span class="contracts-status-pill contracts-status-pill--sent">Pending signature</span>`;
    }
    if (status === "declined" || status === "expired") {
      return `<span class="contracts-status-pill contracts-status-pill--danger">${escapeHtml(status === "declined" ? "Declined" : "Expired")}</span>`;
    }
    return `<span class="contracts-status-pill contracts-status-pill--draft">${escapeHtml(status || "—")}</span>`;
  }

  function mobileStatusBadge(row) {
    const status = row.status;
    if (status === "signed") {
      return `<span class="leave-mobile-badge leave-mobile-badge--approved">Signed</span>`;
    }
    if (status === "sent") {
      return `<span class="leave-mobile-badge leave-mobile-badge--pending">Pending signature</span>`;
    }
    if (status === "declined" || status === "expired") {
      return `<span class="leave-mobile-badge leave-mobile-badge--declined">${escapeHtml(status === "declined" ? "Declined" : "Expired")}</span>`;
    }
    return `<span class="leave-mobile-badge">${escapeHtml(status || "—")}</span>`;
  }

  function isMobileContractsUi() {
    if (!document.getElementById("mobile-tab-bar")) return false;
    return window.isShiftSwiftMobileViewport?.() ?? window.matchMedia("(max-width: 860px)").matches;
  }

  function renderMobileContractsList() {
    const host = $("contracts-mobile-list");
    if (!host) return;
    if (!contracts.length) {
      host.innerHTML = `<p class="leave-mobile-empty muted">No agreements received yet. When ShiftSwift sends your MSA, DPA, and order form, they will appear here.</p>`;
      return;
    }
    host.innerHTML = contracts
      .map((row) => {
        const selected = selectedContractId === row.id ? " docs-mobile-card--selected" : "";
        return `<article class="leave-mobile-request-card docs-mobile-card${selected}" data-contract-id="${row.id}">
          <div class="leave-mobile-request-card__head">
            <div class="leave-mobile-request-card__who">
              <strong>${escapeHtml(row.contract_number)}</strong>
              <span>${escapeHtml(row.template_name || row.template_id)}</span>
            </div>
            ${mobileStatusBadge(row)}
          </div>
          <div class="leave-mobile-request-card__meta">
            <span>${escapeHtml(row.customer_legal_name)}</span>
            <span>${escapeHtml(formatDate(row.sent_at || row.created_at))}</span>
          </div>
          <div class="leave-mobile-request-card__actions">
            <button type="button" class="leave-mobile-action leave-mobile-action--approve" data-contract-open="${row.id}">Open</button>
          </div>
        </article>`;
      })
      .join("");

    host.querySelectorAll("[data-contract-open]").forEach((btn) => {
      btn.addEventListener("click", () => selectContract(Number(btn.getAttribute("data-contract-open"))));
    });
  }

  function renderMobileContractsShell() {
    const shell = $("contracts-mobile-shell");
    if (!shell) return;
    if (!isMobileContractsUi()) {
      shell.hidden = true;
      return;
    }
    shell.hidden = Boolean(selectedContractId);
    if (!shell.hidden) renderMobileContractsList();
  }

  function signatureCell(row) {
    if (row.signed_at) return escapeHtml(formatDate(row.signed_at));
    if (row.status === "sent") return '<span class="muted">Pending your signature</span>';
    return '<span class="muted">—</span>';
  }

  function renderContractsTable() {
    const tbody = $("contracts-table-body");
    if (!tbody) return;
    if (!contracts.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted">No agreements received yet. When ShiftSwift sends your MSA, DPA, and order form, they will appear here for preview and signing.</td></tr>';
      return;
    }
    tbody.innerHTML = contracts
      .map((row) => {
        const selected = selectedContractId === row.id ? " contracts-case-row--selected" : "";
        return `<tr class="contracts-case-row${selected}" data-contract-id="${row.id}">
          <td><strong>${escapeHtml(row.contract_number)}</strong><div class="muted">${escapeHtml(formatDate(row.sent_at || row.created_at))}</div></td>
          <td>${escapeHtml(row.template_name || row.template_id)}</td>
          <td>${escapeHtml(row.customer_legal_name)}</td>
          <td>${tenantStatusBadge(row)}</td>
          <td>${escapeHtml(row.signatory_email)}</td>
          <td>${signatureCell(row)}</td>
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
      if (selectedContractId && !contracts.some((c) => c.id === selectedContractId)) {
        selectedContractId = null;
        $("contracts-detail-content")?.setAttribute("hidden", "");
        $("contracts-detail-empty")?.removeAttribute("hidden");
      }
      renderContractsTable();
      renderMobileContractsShell();
      if (selectedContractId && contracts.some((c) => c.id === selectedContractId)) {
        await selectContract(selectedContractId, { scroll: false });
      }
    } catch {
      contracts = [];
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">Could not load agreements. Check you are signed in and the API is running.</td></tr>';
      }
      renderMobileContractsShell();
    }
  }

  function signingHelpHtml(data) {
    if (data.status === "signed") {
      return `<p class="contracts-readonly-note contracts-readonly-note--ok">Signed on ${escapeHtml(formatDate(data.signed_at))}.</p>`;
    }
    if (data.status === "sent") {
      return `<p class="contracts-readonly-note">Received on ${escapeHtml(formatDate(data.sent_at))} — sign using the secure link emailed to <strong>${escapeHtml(data.signatory_email)}</strong>. Contact ShiftSwift support if you need the link resent.</p>`;
    }
    return "";
  }

  function renderDetailPanel(data) {
    const empty = $("contracts-detail-empty");
    const content = $("contracts-detail-content");
    if (!content) return;
    empty?.setAttribute("hidden", "");
    content.hidden = false;

    const timeline = (data.events || [])
      .filter((event) => event.event_type !== "generated")
      .map(
        (event) => `<li class="contracts-timeline__item">
        <span class="contracts-timeline__dot">✓</span>
        <span><strong>${escapeHtml(event.event_type === "sent" ? "Received from ShiftSwift" : event.event_type)}</strong><span class="muted"> · ${escapeHtml(formatDate(event.created_at))}</span></span>
      </li>`
      );

    content.innerHTML = `
      <div class="contracts-detail-head">
        <div>
          <h3>${escapeHtml(data.contract_number)}</h3>
          ${tenantStatusBadge(data)}
        </div>
      </div>
      <dl class="contracts-detail-grid">
        <div><dt>Template</dt><dd>${escapeHtml(data.template_name || data.template_id)}</dd></div>
        <div><dt>Customer</dt><dd>${escapeHtml(data.customer_legal_name)}</dd></div>
        <div><dt>Signatory</dt><dd>${escapeHtml(data.signatory_name || "Not set")}${data.signatory_title ? ` · ${escapeHtml(data.signatory_title)}` : ""}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(data.signatory_email)}</dd></div>
        <div><dt>Effective date</dt><dd>${escapeHtml(formatDate(data.effective_date))}</dd></div>
        <div><dt>Received</dt><dd>${data.sent_at ? escapeHtml(formatDate(data.sent_at)) : "—"}</dd></div>
        <div><dt>Signed</dt><dd>${data.signed_at ? escapeHtml(formatDate(data.signed_at)) : "Pending"}</dd></div>
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
    renderMobileContractsShell();
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
    renderMobileContractsShell();
  }

  function bindSectionEvents() {
    if (sectionBound) return;
    sectionBound = true;
    window.addEventListener("admin:section", (event) => {
      if (event.detail?.section === "contracts") initContractsSection();
    });
    window.addEventListener("resize", () => {
      if (!sectionBound) return;
      renderMobileContractsShell();
    });
    if (parseHashBaseSection(window.location.hash) === "contracts") initContractsSection();
  }

  bindSectionEvents();
})();
