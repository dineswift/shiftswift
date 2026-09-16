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

function parseSignError(data, fallback) {
  const detail = data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const first = detail.find((item) => item?.msg)?.msg;
    if (first) return first;
  }
  if (detail && typeof detail === "object" && typeof detail.message === "string") {
    return detail.message;
  }
  return data?.message || fallback;
}

function networkSignError(error, fallback) {
  const message = error?.message || "";
  if (message === "Failed to fetch" || message === "Load failed") {
    return "Could not reach the signing service. Check your connection and try again.";
  }
  return message || fallback;
}

function createSignaturePad(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let drawing = false;
  let dirty = false;
  let last = null;

  function cssSize() {
    const rect = canvas.getBoundingClientRect();
    return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
  }

  function resize() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const { width, height } = cssSize();
    const snapshot = dirty ? canvas.toDataURL("image/png") : null;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#12352d";
    ctx.lineWidth = 2.4;
    if (snapshot) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, width, height);
      img.src = snapshot;
    }
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const src = event.touches?.[0] || event.changedTouches?.[0] || event;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  function start(event) {
    event.preventDefault();
    drawing = true;
    last = pointFromEvent(event);
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function move(event) {
    if (!drawing) return;
    event.preventDefault();
    const next = pointFromEvent(event);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last = next;
    dirty = true;
  }

  function end(event) {
    if (!drawing) return;
    event.preventDefault();
    drawing = false;
    last = null;
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", end);
  window.addEventListener("resize", resize);
  resize();

  return {
    isEmpty() {
      return !dirty;
    },
    toDataURL() {
      return canvas.toDataURL("image/png");
    },
    clear() {
      const { width, height } = cssSize();
      ctx.clearRect(0, 0, width, height);
      dirty = false;
      drawing = false;
      last = null;
    },
  };
}

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

const signaturePad = createSignaturePad(document.getElementById("signature-pad"));
document.getElementById("signature-pad-clear")?.addEventListener("click", () => {
  signaturePad?.clear();
});

async function loadContract() {
  if (!token) {
    document.getElementById("contract-meta").textContent = "Missing signing link.";
    return;
  }
  const res = await fetch(`${API_BASE}${viewPath}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseSignError(data, "Contract unavailable"));

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

  const submitBtn = document.querySelector('#sign-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.textContent = isDocument ? "Sign document" : "Sign contract";
  }

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
    if (signaturePad?.isEmpty()) {
      throw new Error("Draw your signature in the box before signing.");
    }
    let res;
    try {
      res = await fetch(`${API_BASE}${signPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature_name: form.signature_name.value.trim(),
          signature_title: form.signature_title.value.trim() || null,
          accept_terms: form.accept_terms.checked,
          signature_image: signaturePad ? signaturePad.toDataURL() : null,
        }),
      });
    } catch (error) {
      throw new Error(networkSignError(error, "Signing failed"));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseSignError(data, "Signing failed"));
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
  document.getElementById("contract-meta").textContent = networkSignError(error, error.message);
});
