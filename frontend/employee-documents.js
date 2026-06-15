/** Employee portal — view and download HR documents shared on their profile. */
(function () {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const tenantId = localStorage.getItem("tenantId");

  if (!session.hasSession() || !tenantId) return;

  const tbody = document.getElementById("employee-documents-body");
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
            (item) => String(item.id) === btn.dataset.downloadDoc && (item.scope || "employee") === (btn.dataset.downloadScope || "employee")
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

  function renderDocumentCards(items) {
    if (!cardsHost) return;
    const generalDocs = items.filter((row) => row.category !== "payslip");
    if (!generalDocs.length) {
      cardsHost.innerHTML =
        '<p class="muted">No general documents shared yet. Signed employment contracts appear here after you sign, or when HR uploads a file to your profile.</p>';
      return;
    }
    cardsHost.innerHTML = generalDocs
      .map(
        (row) => `<article class="employee-doc-card">
          <div class="employee-doc-card__main">
            <strong class="employee-doc-card__title">${escapeHtml(row.title)}</strong>
            <p class="muted employee-doc-card__meta">${escapeHtml(row.category_label || row.category)} · ${escapeHtml(formatDate(row.created_at))}</p>
          </div>
          <div class="employee-doc-card__actions table-actions">${documentActions(row)}</div>
        </article>`,
      )
      .join("");
    bindDownloadButtons(cardsHost, generalDocs);
  }

  function renderDocuments(items) {
    const generalDocs = items.filter((row) => row.category !== "payslip");
    renderDocumentCards(items);
    if (!tbody) return;
    if (!generalDocs.length) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="muted">No general documents shared yet. Signed employment contracts appear here after you sign, or when HR uploads a file to your profile.</td></tr>';
      return;
    }
    tbody.innerHTML = generalDocs
      .map(
        (row) => `<tr>
          <td><strong>${escapeHtml(row.title)}</strong></td>
          <td>${escapeHtml(row.category_label || row.category)}</td>
          <td>${escapeHtml(formatDate(row.created_at))}</td>
          <td><div class="table-actions">${documentActions(row)}</div></td>
        </tr>`
      )
      .join("");
    bindDownloadButtons(tbody, generalDocs);
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
      const otherCount = allItems.length - payslipCount;
      if (allItems.length === 0) {
        setSummaryText("employee-docs-summary", "Nothing shared yet.");
        setSummaryText("employee-payslips-summary", "None shared yet.");
      } else {
        setSummaryText(
          "employee-docs-summary",
          otherCount
            ? `${otherCount} document${otherCount === 1 ? "" : "s"} available.`
            : "No general documents yet.",
        );
        setSummaryText(
          "employee-payslips-summary",
          payslipCount
            ? `${payslipCount} payslip${payslipCount === 1 ? "" : "s"} available.`
            : "No payslips shared yet.",
        );
      }
    } catch (error) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(error.message || "Could not load documents.")}</td></tr>`;
      }
      if (payslipsHost) {
        payslipsHost.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load payslips.")}</p>`;
      }
      if (summaryEl) setSummaryText("employee-docs-summary", "Could not load documents.");
      setSummaryText("employee-payslips-summary", "Could not load payslips.");
    }
  }

  loadDocuments();
})();
