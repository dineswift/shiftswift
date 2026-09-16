const API_BASE = localStorage.getItem("apiBaseUrl") || "http://localhost:3000";
const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const contractType = params.get("type") || "platform";

const viewPath =
  contractType === "document"
    ? `/document-sign/view/${encodeURIComponent(token)}`
    : contractType === "employment"
      ? `/employment-contracts/sign/view/${encodeURIComponent(token)}`
      : `/contracts/sign/view/${encodeURIComponent(token)}`;
const signPath =
  contractType === "document"
    ? `/document-sign/${encodeURIComponent(token)}`
    : contractType === "employment"
      ? `/employment-contracts/sign/${encodeURIComponent(token)}`
      : `/contracts/sign/${encodeURIComponent(token)}`;

function renderDocumentPreview(data) {
  const preview = document.getElementById("contract-preview");
  if (!preview) return;
  const fileUrl = data.file_url ? `${API_BASE}${data.file_url}` : "";
  if (data.preview_mode === "pdf" && fileUrl) {
    preview.innerHTML = `<iframe src="${fileUrl}#toolbar=0" title="Document preview" style="width:100%;min-height:420px;border:0;"></iframe>`;
    return;
  }
  if (data.preview_mode === "image" && fileUrl) {
    preview.innerHTML = `<img src="${fileUrl}" alt="Document preview" style="max-width:100%;height:auto;border-radius:8px;" />`;
    return;
  }
  preview.innerHTML = `
    <p><strong>${escapeHtml(data.title || "Document")}</strong></p>
    <p class="muted">Download and read the file before signing.</p>
    ${fileUrl ? `<p><a class="btn ghost" href="${fileUrl}" target="_blank" rel="noopener">Open document</a></p>` : ""}
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadContract() {
  if (!token) {
    document.getElementById("contract-meta").textContent = "Missing signing link.";
    return;
  }
  const res = await fetch(`${API_BASE}${viewPath}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Contract unavailable");

  const isDocument = contractType === "document" || data.contract_type === "document";
  const isEmployment = contractType === "employment" || data.contract_type === "employment";
  const pageTitle = document.querySelector("h1");
  if (pageTitle) {
    pageTitle.textContent = isDocument ? "Review & sign document" : "Review & sign agreement";
  }

  if (isDocument) {
    document.getElementById("contract-meta").textContent =
      `${data.title || "Document"} · ${data.reference_code}${data.signatory_name ? ` · ${data.signatory_name}` : ""}`;
    renderDocumentPreview(data);
  } else {
    const label = isEmployment ? data.title || "Employment contract" : data.template_id?.toUpperCase();
    const party = isEmployment ? data.signatory_name : data.customer_legal_name;
    document.getElementById("contract-meta").textContent =
      `${label} · ${data.contract_number}${party ? ` · ${party}` : ""}`;
    document.getElementById("contract-preview").innerHTML = data.html || "";
  }

  const acceptLabel = document.querySelector("label.checkbox-row span");
  if (acceptLabel) {
    acceptLabel.textContent = isDocument
      ? "I have read this document and sign to confirm."
      : isEmployment
        ? "I have read this employment contract and sign as the employee named above."
        : "I have read this agreement and sign on behalf of my organisation.";
  }

  const titleField = document.querySelector('[name="signature_title"]')?.closest("label");
  if (titleField) titleField.hidden = isDocument;

  if (data.signatory_name) {
    document.querySelector('[name="signature_name"]').value = data.signatory_name;
  }
}

document.getElementById("sign-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("sign-status");
  const form = event.currentTarget;
  const submitBtn = form.querySelector('button[type="submit"]');
  const performSign = async () => {
    const res = await fetch(`${API_BASE}${signPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signature_name: form.signature_name.value.trim(),
        signature_title: form.signature_title.value.trim() || null,
        accept_terms: form.accept_terms.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Signing failed");
    const ref = data.reference_code || data.contract_number || "recorded";
    return `Signed successfully. Reference ${ref}. You may close this page.`;
  };

  const run = window.ShiftSwiftAction?.runFormSubmit;
  if (run && submitBtn) {
    const result = await run(form, status, {
      loadingLabel: "Signing…",
      successMessage: "Signed successfully.",
      errorMessage: "Signing failed.",
      successLabel: "Signed",
      clearStatusAfterMs: 0,
      onAction: performSign,
    });
    if (result?.ok) submitBtn.disabled = true;
    return;
  }

  if (status) status.textContent = "Submitting signature…";
  try {
    const message = await performSign();
    if (window.ShiftSwiftAction?.setActionStatus) {
      window.ShiftSwiftAction.setActionStatus(status, message, "ok");
    } else if (status) {
      status.textContent = message;
    }
    if (submitBtn) submitBtn.disabled = true;
  } catch (error) {
    if (window.ShiftSwiftAction?.setActionStatus) {
      window.ShiftSwiftAction.setActionStatus(status, error.message, "error");
    } else if (status) {
      status.textContent = error.message;
    }
  }
});

loadContract().catch((error) => {
  document.getElementById("contract-meta").textContent = error.message;
});
