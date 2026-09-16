/** In-browser preview for PDF, JPEG, and PNG HR documents. */
(function () {
  const DIALOG_ID = "ss-document-preview-dialog";
  let objectUrl = "";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function previewKind(contentType, filename) {
    const type = String(contentType || "").toLowerCase();
    const name = String(filename || "").toLowerCase();
    if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) return "image";
    if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
    if (type.includes("html") || name.endsWith(".html") || name.endsWith(".htm")) return "html";
    return "other";
  }

  function canPreview(row) {
    if (!row?.has_file) return false;
    return previewKind(row.content_type, row.original_filename || row.title) !== "other";
  }

  function revokePreviewUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
  }

  function ensureDialog() {
    let dialog = document.getElementById(DIALOG_ID);
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = DIALOG_ID;
    dialog.className = "ss-doc-preview-dialog";
    dialog.innerHTML = `
      <div class="ss-doc-preview-dialog__card">
        <header class="ss-doc-preview-dialog__head">
          <h3 class="ss-doc-preview-dialog__title" id="ss-document-preview-title">Document preview</h3>
          <div class="ss-doc-preview-dialog__actions">
            <button type="button" class="btn ghost" data-preview-download>Download</button>
            <button type="button" class="btn" data-preview-close>Close</button>
          </div>
        </header>
        <div class="ss-doc-preview-dialog__body" id="ss-document-preview-body"></div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-preview-close]")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", revokePreviewUrl);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    return dialog;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "document";
    link.click();
    URL.revokeObjectURL(url);
  }

  function open({ blob, title, filename, contentType } = {}) {
    if (!blob) throw new Error("Nothing to preview.");
    const dialog = ensureDialog();
    const kind = previewKind(contentType || blob.type, filename || title);
    revokePreviewUrl();
    objectUrl = URL.createObjectURL(blob);
    const heading = dialog.querySelector("#ss-document-preview-title");
    const body = dialog.querySelector("#ss-document-preview-body");
    const downloadBtn = dialog.querySelector("[data-preview-download]");
    if (heading) heading.textContent = title || filename || "Document preview";
    if (downloadBtn) {
      downloadBtn.onclick = () => triggerDownload(blob, filename || title || "document");
    }
    if (!body) return;
    if (kind === "image") {
      body.innerHTML = `<img class="ss-doc-preview-dialog__image" src="${objectUrl}" alt="${escapeHtml(title || "Document preview")}" />`;
    } else if (kind === "pdf" || kind === "html") {
      body.innerHTML = `<iframe class="ss-doc-preview-dialog__frame" title="${escapeHtml(title || "Document preview")}" src="${objectUrl}"></iframe>`;
    } else {
      body.innerHTML = `<p class="muted">This file type cannot be shown here. Use Download to open it.</p>`;
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  window.ShiftSwiftDocumentPreview = { canPreview, previewKind, open };
})();
