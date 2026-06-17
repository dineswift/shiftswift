/** Employee portal — view and download HR documents shared on their profile. */
(function () {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const tenantId = localStorage.getItem("tenantId");

  if (!session.hasSession() || !tenantId) return;

  const tbody = document.getElementById("employee-documents-body");
  const companySection = document.getElementById("employee-company-docs");
  const companyCardsHost = document.getElementById("employee-company-docs-cards");
  const personalSection = document.getElementById("employee-personal-docs");
  const cardsHost = document.getElementById("employee-documents-cards");
  const messageEl = document.getElementById("employee-documents-message");
  const summaryEl = document.getElementById("employee-docs-summary");
  const payslipsHost = document.getElementById("employee-payslips-list");

  let allItems = [];

  function setSummaryText(sourceId, text) {
    const source = document.getElementById(sourceId);
    if (source) source.textContent = text;
    document.querySelectorAll(`[data-mirror="${sourceId}"]`).forEach((el) => {
      el.textContent = text;
    });
  }

  async function apiFetch(path, options = {}) {
    return session.fetchWithAuth(path, options, { apiBase: API_BASE, tenantId });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return value;
    }
  }

  async function downloadDocument(documentId, filename, scope = "employee") {
    const scopeQuery = scope && scope !== "employee" ? `?scope=${encodeURIComponent(scope)}` : "";
    const res = await apiFetch(`/employee/me/documents/${documentId}/file${scopeQuery}`, {
      headers: session.authHeaders({ json: false, tenantId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || "Download failed");
    }
    let name = filename || "document";
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    if (match) name = match[1];
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function bindDownloadButtons(container, items) {
    container.querySelectorAll("[data-download-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (messageEl) messageEl.textContent = "Downloading…";
        try {
          const row = items.find(
            (item) =>
              String(item.id) === btn.dataset.downloadDoc &&
              (item.scope || "employee") === (btn.dataset.downloadScope || "employee")
          );
          await downloadDocument(Number(btn.dataset.downloadDoc), row?.original_filename, row?.scope || btn.dataset.downloadScope);
          if (messageEl) messageEl.textContent = "";
        } catch (error) {
          if (messageEl) messageEl.textContent = error.message || "Download failed";
        }
      });
    });
  }

  function documentActions(row) {
    const actions = [];
    if (row.has_file) {
      actions.push(
        `<button type="button" class="btn ghost" data-download-doc="${escapeHtml(row.id)}" data-download-scope="${escapeHtml(row.scope || "employee")}">Download</button>`
      );
    }
    if (row.document_url) {
      actions.push(
        `<a class="btn ghost" href="${escapeHtml(row.document_url)}" target="_blank" rel="noopener">Open link</a>`
      );
    }
    return actions.join(" ");
  }

  function renderDocumentCards(container, items, emptyMessage) {
    if (!container) return;
    const generalDocs = items.filter((row) => row.category !== "payslip");
    if (!generalDocs.length) {
      container.innerHTML = `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
      return;
    }
    container.innerHTML = generalDocs
      .map(
        (row) => `<article class="employee-doc-card${row.audience === "company" ? " employee-doc-card--company" : ""}">
          <div class="employee-doc-card__main">
            <strong class="employee-doc-card__title">${escapeHtml(row.title)}</strong>
            <p class="muted employee-doc-card__meta">${escapeHtml(row.category_label || row.category)} · ${escapeHtml(formatDate(row.created_at))}${row.audience_label ? ` · ${escapeHtml(row.audience_label)}` : ""}</p>
          </div>
          <div class="employee-doc-card__actions table-actions">${documentActions(row)}</div>
        </article>`
      )
      .join("");
    bindDownloadButtons(container, generalDocs);
  }

  function renderDocuments(items) {
    const companyDocs = items.filter((row) => row.audience === "company" && row.category !== "payslip");
    const personalDocs = items.filter((row) => row.audience !== "company" && row.category !== "payslip");

    if (companySection) companySection.hidden = companyDocs.length === 0;
    if (personalSection) personalSection.hidden = personalDocs.length === 0;

    renderDocumentCards(
      companyCardsHost,
      companyDocs,
      "No company handbooks or policies shared yet."
    );
    renderDocumentCards(
      cardsHost,
      personalDocs,
      "No personal documents shared yet. Signed employment contracts appear here after you sign, or when HR uploads a file to your profile."
    );

    const tableDocs = [...companyDocs, ...personalDocs];
    if (!tbody) return;
    if (!tableDocs.length) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="muted">No documents shared yet. Company handbooks and personal files from HR will appear here.</td></tr>';
      return;
    }
    tbody.innerHTML = tableDocs
      .map(
        (row) => `<tr>
          <td><strong>${escapeHtml(row.title)}</strong>${row.audience === "company" ? ' <span class="employee-doc-badge">All staff</span>' : ""}</td>
          <td>${escapeHtml(row.category_label || row.category)}</td>
          <td>${escapeHtml(formatDate(row.created_at))}</td>
          <td><div class="table-actions">${documentActions(row)}</div></td>
        </tr>`
      )
      .join("");
    bindDownloadButtons(tbody, tableDocs);
  }

  function renderPayslips(items) {
    if (!payslipsHost) return;
    const payslips = items.filter((row) => row.category === "payslip");
    if (!payslips.length) {
      payslipsHost.innerHTML =
        '<p class="muted">No payslips shared yet. When HR uploads your payslip, it will appear here grouped by pay period.</p>';
      return;
    }

    const grouped = new Map();
    payslips.forEach((row) => {
      const key = row.pay_period || "Other";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });

    const sortedKeys = [...grouped.keys()].sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return b.localeCompare(a);
    });

    payslipsHost.innerHTML = sortedKeys
      .map((period) => {
        const rows = grouped.get(period) || [];
        return `<section class="employee-payslip-group">
          <h3 class="employee-payslip-group__title">${escapeHtml(period)}</h3>
          <div class="hr-table-wrap">
            <table class="data-table">
              <thead><tr><th>Title</th><th>Added</th><th></th></tr></thead>
              <tbody>
                ${rows
                  .map(
                    (row) => `<tr>
                      <td><strong>${escapeHtml(row.title)}</strong></td>
                      <td>${escapeHtml(formatDate(row.created_at))}</td>
                      <td><div class="table-actions">${documentActions(row)}</div></td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>`;
      })
      .join("");

    bindDownloadButtons(payslipsHost, payslips);
  }

  async function loadDocuments() {
    try {
      const res = await apiFetch("/employee/me/documents");
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not load documents");
      allItems = data.items || [];
      renderDocuments(allItems);
      renderPayslips(allItems);
      const payslipCount = allItems.filter((row) => row.category === "payslip").length;
      const companyCount = allItems.filter((row) => row.audience === "company" && row.category !== "payslip").length;
      const personalCount = allItems.filter((row) => row.audience !== "company" && row.category !== "payslip").length;
      const otherCount = companyCount + personalCount;
      if (allItems.length === 0) {
        setSummaryText("employee-docs-summary", "Nothing shared yet.");
        setSummaryText("employee-payslips-summary", "None shared yet.");
      } else {
        const parts = [];
        if (companyCount) parts.push(`${companyCount} company`);
        if (personalCount) parts.push(`${personalCount} personal`);
        setSummaryText(
          "employee-docs-summary",
          otherCount
            ? `${parts.join(" · ")} document${otherCount === 1 ? "" : "s"} available.`
            : "No general documents yet."
        );
        setSummaryText(
          "employee-payslips-summary",
          payslipCount
            ? `${payslipCount} payslip${payslipCount === 1 ? "" : "s"} available.`
            : "No payslips shared yet."
        );
      }
    } catch (error) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(error.message || "Could not load documents.")}</td></tr>`;
      }
      if (companyCardsHost) companyCardsHost.innerHTML = "";
      if (cardsHost) cardsHost.innerHTML = "";
      if (companySection) companySection.hidden = true;
      if (personalSection) personalSection.hidden = true;
      if (payslipsHost) {
        payslipsHost.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load payslips.")}</p>`;
      }
      if (summaryEl) setSummaryText("employee-docs-summary", "Could not load documents.");
      setSummaryText("employee-payslips-summary", "Could not load payslips.");
    }
  }

  loadDocuments();
})();
