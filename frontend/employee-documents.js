/** Employee portal — view, download, and share HR documents / payslips. */
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
  const payslipsMessageEl = document.getElementById("employee-payslips-message");

  let allItems = [];
  let activeObjectUrl = null;
  let viewerState = null;

  function setSummaryText(sourceId, text) {
    const source = document.getElementById(sourceId);
    if (source) source.textContent = text;
    document.querySelectorAll(`[data-mirror="${sourceId}"]`).forEach((el) => {
      el.textContent = text;
    });
  }

  function setStatus(text, host) {
    const targets = [host, messageEl, payslipsMessageEl].filter(Boolean);
    const unique = [...new Set(targets)];
    unique.forEach((el) => {
      el.textContent = text || "";
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

  function isNativePlatform() {
    try {
      return Boolean(window.Capacitor?.isNativePlatform?.());
    } catch {
      return false;
    }
  }

  function getFilesystem() {
    return window.Capacitor?.Plugins?.Filesystem || null;
  }

  function getSharePlugin() {
    return window.Capacitor?.Plugins?.Share || null;
  }

  function sanitizeFilename(name) {
    const cleaned = String(name || "document")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "document";
  }

  function guessContentType(filename, fallback) {
    const lower = String(filename || "").toLowerCase();
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    return fallback || "application/octet-stream";
  }

  function parseFilename(disposition, fallback) {
    const header = String(disposition || "");
    const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch) {
      try {
        return sanitizeFilename(decodeURIComponent(utfMatch[1]));
      } catch {
        /* fall through */
      }
    }
    const match = header.match(/filename="([^"]+)"/i) || header.match(/filename=([^;]+)/i);
    if (match) return sanitizeFilename(match[1].trim());
    return sanitizeFilename(fallback || "document");
  }

  async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function fetchDocumentFile(documentId, filename, scope = "employee") {
    const scopeQuery = scope && scope !== "employee" ? `?scope=${encodeURIComponent(scope)}` : "";
    const res = await apiFetch(`/employee/me/documents/${documentId}/file${scopeQuery}`, {
      headers: {
        ...session.authHeaders({ json: false, tenantId }),
        "X-SSHR-Response-Type": "arraybuffer",
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || "Could not open document");
    }
    const name = parseFilename(res.headers.get("Content-Disposition"), filename || "document");
    const contentType =
      res.headers.get("Content-Type") || guessContentType(name, "application/octet-stream");
    const buffer = await res.arrayBuffer();
    const blob = new Blob([buffer], { type: contentType });
    return { blob, filename: name, contentType };
  }

  async function writeNativeFile(filename, blob, directory) {
    const Filesystem = getFilesystem();
    if (!Filesystem?.writeFile) throw new Error("File storage is unavailable in this app build.");
    const base64 = await blobToBase64(blob);
    const safeName = sanitizeFilename(filename);
    const path = `ShiftSwift/${safeName}`;
    const result = await Filesystem.writeFile({
      path,
      data: base64,
      directory,
      recursive: true,
    });
    if (result?.uri) return result.uri;
    if (Filesystem.getUri) {
      const uriResult = await Filesystem.getUri({ path, directory });
      if (uriResult?.uri) return uriResult.uri;
    }
    throw new Error("Could not save the file on this device.");
  }

  async function shareNativeUri(uri, filename, title) {
    const Share = getSharePlugin();
    if (!Share?.share) throw new Error("Sharing is unavailable in this app build.");
    await Share.share({
      title: title || filename,
      text: title || filename,
      url: uri,
      files: [uri],
      dialogTitle: title || "Share document",
    });
  }

  async function shareWebBlob(blob, filename, title) {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: title || filename, text: title || filename });
      return;
    }
    if (navigator.share) {
      const objectUrl = URL.createObjectURL(blob);
      try {
        await navigator.share({ title: title || filename, text: title || filename, url: objectUrl });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      return;
    }
    throw new Error("Sharing is not available on this device. Use Download instead.");
  }

  function nativeDirectory(kind) {
    const values = getFilesystem()?.Directory || {};
    if (kind === "cache") return values.Cache || "CACHE";
    return values.Documents || "DOCUMENTS";
  }

  async function shareDocumentBlob(blob, filename, title) {
    if (isNativePlatform() && getFilesystem() && getSharePlugin()) {
      const uri = await writeNativeFile(filename, blob, nativeDirectory("cache"));
      await shareNativeUri(uri, filename, title);
      return;
    }
    await shareWebBlob(blob, filename, title);
  }

  function triggerBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function downloadDocumentBlob(blob, filename) {
    if (isNativePlatform() && getFilesystem()) {
      const uri = await writeNativeFile(filename, blob, nativeDirectory("documents"));
      if (getSharePlugin()) {
        await shareNativeUri(uri, filename, `Save ${filename}`);
        return "Saved on this device. Use the share sheet to save to Files, Downloads, WhatsApp, or Email.";
      }
      return "Saved to this app’s Documents folder.";
    }
    triggerBrowserDownload(blob, filename);
    return "Download started.";
  }

  function revokeActiveObjectUrl() {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
  }

  function ensureViewer() {
    let modal = document.getElementById("employee-doc-viewer");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "employee-doc-viewer";
    modal.className = "employee-doc-viewer";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "employee-doc-viewer-title");
    modal.innerHTML = `
      <div class="employee-doc-viewer__backdrop" data-doc-viewer-close></div>
      <div class="employee-doc-viewer__panel">
        <header class="employee-doc-viewer__head">
          <div class="employee-doc-viewer__titles">
            <h2 id="employee-doc-viewer-title">Document</h2>
            <p class="muted employee-doc-viewer__meta" id="employee-doc-viewer-meta"></p>
          </div>
          <button type="button" class="btn ghost" data-doc-viewer-close aria-label="Close">Close</button>
        </header>
        <div class="employee-doc-viewer__body" id="employee-doc-viewer-body"></div>
        <div class="employee-doc-viewer__actions">
          <button type="button" class="btn ghost" id="employee-doc-viewer-share">Share</button>
          <button type="button" class="btn primary" id="employee-doc-viewer-download">Download</button>
        </div>
        <p class="muted employee-doc-viewer__status" id="employee-doc-viewer-status" aria-live="polite"></p>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll("[data-doc-viewer-close]").forEach((el) => {
      el.addEventListener("click", closeViewer);
    });
    modal.querySelector("#employee-doc-viewer-share")?.addEventListener("click", async () => {
      if (!viewerState) return;
      const statusEl = document.getElementById("employee-doc-viewer-status");
      if (statusEl) statusEl.textContent = "Opening share options…";
      try {
        await shareDocumentBlob(viewerState.blob, viewerState.filename, viewerState.title || viewerState.filename);
        if (statusEl) statusEl.textContent = "Share sheet opened.";
      } catch (error) {
        if (statusEl) statusEl.textContent = error.message || "Could not share document.";
      }
    });
    modal.querySelector("#employee-doc-viewer-download")?.addEventListener("click", async () => {
      if (!viewerState) return;
      const statusEl = document.getElementById("employee-doc-viewer-status");
      if (statusEl) statusEl.textContent = "Saving…";
      try {
        const message = await downloadDocumentBlob(viewerState.blob, viewerState.filename);
        if (statusEl) statusEl.textContent = message;
      } catch (error) {
        if (statusEl) statusEl.textContent = error.message || "Download failed.";
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal && !modal.hidden) closeViewer();
    });
    return modal;
  }

  function closeViewer() {
    const modal = document.getElementById("employee-doc-viewer");
    if (modal) modal.hidden = true;
    document.body.classList.remove("no-scroll");
    revokeActiveObjectUrl();
    viewerState = null;
    const body = document.getElementById("employee-doc-viewer-body");
    if (body) body.innerHTML = "";
    const statusEl = document.getElementById("employee-doc-viewer-status");
    if (statusEl) statusEl.textContent = "";
  }

  function openViewer({ blob, filename, contentType, title }) {
    const modal = ensureViewer();
    revokeActiveObjectUrl();
    activeObjectUrl = URL.createObjectURL(blob);
    viewerState = { blob, filename, contentType, title };

    const titleEl = document.getElementById("employee-doc-viewer-title");
    const metaEl = document.getElementById("employee-doc-viewer-meta");
    const body = document.getElementById("employee-doc-viewer-body");
    const statusEl = document.getElementById("employee-doc-viewer-status");
    if (titleEl) titleEl.textContent = title || filename;
    if (metaEl) metaEl.textContent = filename;
    if (statusEl) statusEl.textContent = "";

    const type = String(contentType || blob.type || "").toLowerCase();
    if (body) {
      if (type.startsWith("image/")) {
        body.innerHTML = `<img class="employee-doc-viewer__image" src="${activeObjectUrl}" alt="${escapeHtml(title || filename)}" />`;
      } else if (type.includes("pdf") || filename.toLowerCase().endsWith(".pdf")) {
        body.innerHTML = `<iframe class="employee-doc-viewer__frame" title="${escapeHtml(title || filename)}" src="${activeObjectUrl}"></iframe>`;
      } else {
        body.innerHTML = `<div class="employee-doc-viewer__fallback">
          <p>Preview is not available for this file type.</p>
          <p class="muted">Use Share to send it, or Download to save it on this device.</p>
        </div>`;
      }
    }

    modal.hidden = false;
    document.body.classList.add("no-scroll");
  }

  function findRow(items, button) {
    return items.find(
      (item) =>
        String(item.id) === button.dataset.docId &&
        (item.scope || "employee") === (button.dataset.docScope || "employee")
    );
  }

  function bindDocumentActions(container, items) {
    container.querySelectorAll("[data-view-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        setStatus("Opening…");
        try {
          const row = findRow(items, btn);
          const file = await fetchDocumentFile(
            Number(btn.dataset.docId),
            row?.original_filename,
            row?.scope || btn.dataset.docScope
          );
          openViewer({
            blob: file.blob,
            filename: file.filename,
            contentType: file.contentType,
            title: row?.title || file.filename,
          });
          setStatus("");
        } catch (error) {
          setStatus(error.message || "Could not open document.");
        }
      });
    });

    container.querySelectorAll("[data-download-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        setStatus("Downloading…");
        try {
          const row = findRow(items, btn);
          const file = await fetchDocumentFile(
            Number(btn.dataset.docId),
            row?.original_filename,
            row?.scope || btn.dataset.docScope
          );
          const message = await downloadDocumentBlob(file.blob, file.filename);
          setStatus(message);
        } catch (error) {
          setStatus(error.message || "Download failed");
        }
      });
    });
  }

  function documentStripMarkup(row) {
    const metaParts = [formatDate(row.created_at)];
    if (row.category_label || row.category) {
      metaParts.unshift(row.category_label || row.category);
    }
    return `<div class="employee-doc-strip">
      <div class="employee-doc-strip__main">
        <strong class="employee-doc-strip__title">${escapeHtml(row.title || "Document")}</strong>
        <span class="employee-doc-strip__meta">${escapeHtml(metaParts.join(" · "))}</span>
      </div>
      <div class="employee-doc-strip__actions table-actions">${documentActions(row)}</div>
    </div>`;
  }

  function documentHasAttachment(row) {
    return Boolean(row?.has_file) || Boolean(String(row?.document_url || "").trim());
  }

  function documentActions(row) {
    const actions = [];
    if (row.has_file) {
      actions.push(
        `<button type="button" class="btn ghost" data-view-doc data-doc-id="${escapeHtml(row.id)}" data-doc-scope="${escapeHtml(row.scope || "employee")}">View</button>`
      );
      actions.push(
        `<button type="button" class="btn ghost" data-download-doc data-doc-id="${escapeHtml(row.id)}" data-doc-scope="${escapeHtml(row.scope || "employee")}">Download</button>`
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
    const generalDocs = items.filter((row) => row.category !== "payslip" && documentHasAttachment(row));
    if (!generalDocs.length) {
      container.innerHTML = `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
      return;
    }
    container.innerHTML = `<div class="employee-doc-strip-list">${generalDocs.map(documentStripMarkup).join("")}</div>`;
    bindDocumentActions(container, generalDocs);
  }

  function renderDocuments(items) {
    const generalDocs = items.filter((row) => row.category !== "payslip" && documentHasAttachment(row));
    const companyDocs = generalDocs.filter((row) => row.audience === "company");
    const personalDocs = generalDocs.filter((row) => row.audience !== "company");

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
    bindDocumentActions(tbody, tableDocs);
  }

  function renderPayslips(items) {
    if (!payslipsHost) return;
    const payslips = items.filter((row) => row.category === "payslip" && documentHasAttachment(row));
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
          <div class="employee-doc-strip-list">
            ${rows.map(documentStripMarkup).join("")}
          </div>
        </section>`;
      })
      .join("");

    bindDocumentActions(payslipsHost, payslips);
  }

  async function loadDocuments() {
    try {
      const res = await apiFetch("/employee/me/documents");
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not load documents");
      allItems = data.items || [];
      renderDocuments(allItems);
      renderPayslips(allItems);
      const payslipCount = allItems.filter((row) => row.category === "payslip" && documentHasAttachment(row)).length;
      const companyCount = allItems.filter((row) => row.audience === "company" && row.category !== "payslip" && documentHasAttachment(row)).length;
      const personalCount = allItems.filter((row) => row.audience !== "company" && row.category !== "payslip" && documentHasAttachment(row)).length;
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
