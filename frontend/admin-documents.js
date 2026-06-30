/** Settings document store — upload, filters, export, edit and delete. */
(function () {
  const { apiFetch, escapeHtml, mountEditForm, renderTableBody, downloadAuthenticated, authHeaders, API_BASE, showAdminToast } = window.Admin;

  const FILTER_IDS = {
    category: "document-filter-category",
    stage: "document-filter-stage",
    employee: "document-filter-employee",
  };

  const STRIP_LIST_ID = "documents-strip-list";

  const TAB_DESCRIPTIONS = {
    upload: "Store a file for all staff (handbooks, policies) or one employee. Choose HR only to keep it off the employee portal.",
    distribute: "Push a file to one or all employees — it appears in their portal and can trigger an email notification.",
    link: "Register an external URL (SharePoint, Google Drive, etc.) without uploading the file to ShiftSwift.",
  };

  const DEFAULT_DOCUMENT_UPLOAD = {
    accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
    extensions: [".pdf", ".jpg", ".jpeg", ".png"],
    mime_types: ["application/pdf", "image/jpeg", "image/png"],
    max_bytes: 10 * 1024 * 1024,
    max_size_label: "10 MB",
    hint: "PDF, JPEG or PNG · max 10 MB per file",
  };

  let employeeLookup = [];

  function documentUploadPolicy() {
    return window.Admin.formOptions?.document_upload || DEFAULT_DOCUMENT_UPLOAD;
  }

  function fileExtension(name) {
    const base = String(name || "").trim().toLowerCase();
    const idx = base.lastIndexOf(".");
    return idx >= 0 ? base.slice(idx) : "";
  }

  function validateDocumentUploadFile(file, policy = documentUploadPolicy()) {
    if (!file || !file.size) return "Choose a file to upload.";
    const ext = fileExtension(file.name);
    const mime = String(file.type || "").toLowerCase();
    const extensions = policy.extensions || DEFAULT_DOCUMENT_UPLOAD.extensions;
    const mimeTypes = policy.mime_types || DEFAULT_DOCUMENT_UPLOAD.mime_types;
    const extOk = extensions.includes(ext);
    const mimeOk = !mime || mimeTypes.includes(mime);
    if (!extOk && !mimeOk) {
      return `Use PDF, JPEG or PNG only. ${policy.hint || DEFAULT_DOCUMENT_UPLOAD.hint}`;
    }
    const maxBytes = Number(policy.max_bytes) || DEFAULT_DOCUMENT_UPLOAD.max_bytes;
    if (file.size > maxBytes) {
      return `File is too large. Maximum size is ${policy.max_size_label || DEFAULT_DOCUMENT_UPLOAD.max_size_label}.`;
    }
    return null;
  }

  function applyDocumentUploadPolicy() {
    const policy = documentUploadPolicy();
    document.querySelectorAll("#document-upload-file, #document-distribute-file").forEach((input) => {
      input.accept = policy.accept || DEFAULT_DOCUMENT_UPLOAD.accept;
    });
    document.querySelectorAll("[data-document-upload-hint]").forEach((el) => {
      el.textContent = policy.hint || DEFAULT_DOCUMENT_UPLOAD.hint;
    });
  }

  function friendlyError(error, fallback) {
    const message = error?.message || "";
    if (message === "Load failed" || message === "Failed to fetch") {
      const apiBase = window.Admin?.getApiBase?.() || window.ShiftSwiftBrand?.resolveApiBase?.() || "";
      console.warn("ShiftSwift document API request failed", { apiBase, error });
      if (apiBase.startsWith("http://") && window.location.protocol === "https:") {
        return "Secure connection blocked the API (mixed content). Hard refresh the page or sign in again.";
      }
      return "Could not reach the API. Run deploy/migrations on the server, wait a minute, then hard refresh (Cmd+Shift+R).";
    }
    return message || fallback;
  }

  function setFormStatus(el, message, tone = "neutral") {
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("edit-form-status--error", "edit-form-status--success", "edit-form-status--warn");
    if (tone === "error") el.classList.add("edit-form-status--error");
    if (tone === "success") el.classList.add("edit-form-status--success");
    if (tone === "warn") el.classList.add("edit-form-status--warn");
  }

  function clearDocumentFormStatuses() {
    document.querySelectorAll("#document-upload-form [data-status], #document-distribute-form [data-status]").forEach((el) => {
      setFormStatus(el, "");
    });
  }

  function readUploadFormPreferences(form) {
    if (!form) return null;
    return {
      category: form.querySelector('[name="category"]')?.value || "",
      lifecycle_stage: form.querySelector('[name="lifecycle_stage"]')?.value || "",
      doc_audience: form.querySelector('input[name="doc_audience"]:checked')?.value || "company",
      employee_id: form.querySelector("#document-upload-employee-id")?.value || "",
      employee_search: form.querySelector("#document-upload-employee-search")?.value || "",
      expires_at: form.querySelector("#document-upload-expires-at")?.value || "",
      expiry_alert_days: form.querySelector("#document-upload-alert-days")?.value || "30",
      employee_visible: form.querySelector("#document-upload-visible")?.checked ?? true,
      notify: form.querySelector("#document-upload-notify")?.checked ?? true,
      notify_email: form.querySelector("#document-upload-notify-email")?.checked ?? true,
      notify_scope: form.querySelector('input[name="notify_scope"]:checked')?.value || "all",
      notes: form.querySelector('[name="notes"]')?.value || "",
    };
  }

  function applyUploadFormPreferences(form, prefs) {
    if (!form || !prefs) return;
    const category = form.querySelector('[name="category"]');
    const stage = form.querySelector('[name="lifecycle_stage"]');
    if (category && prefs.category) category.value = prefs.category;
    if (stage && prefs.lifecycle_stage) stage.value = prefs.lifecycle_stage;
    const audienceInput = form.querySelector(`input[name="doc_audience"][value="${prefs.doc_audience}"]`);
    if (audienceInput) audienceInput.checked = true;
    const employeeId = form.querySelector("#document-upload-employee-id");
    const employeeSearch = form.querySelector("#document-upload-employee-search");
    if (employeeId) employeeId.value = prefs.employee_id || "";
    if (employeeSearch) employeeSearch.value = prefs.employee_search || "";
    const expiresAt = form.querySelector("#document-upload-expires-at");
    if (expiresAt) expiresAt.value = prefs.expires_at || "";
    const alertDays = form.querySelector("#document-upload-alert-days");
    if (alertDays && prefs.expiry_alert_days) alertDays.value = prefs.expiry_alert_days;
    const visible = form.querySelector("#document-upload-visible");
    if (visible) visible.checked = prefs.employee_visible;
    const notify = form.querySelector("#document-upload-notify");
    if (notify) notify.checked = prefs.notify;
    const notifyEmail = form.querySelector("#document-upload-notify-email");
    if (notifyEmail) notifyEmail.checked = prefs.notify_email;
    const notifyScope = form.querySelector(`input[name="notify_scope"][value="${prefs.notify_scope}"]`);
    if (notifyScope) notifyScope.checked = true;
    const notes = form.querySelector('[name="notes"]');
    if (notes) notes.value = prefs.notes || "";
    syncUploadAudience(form);
    syncExpiryFields();
    syncUploadNotify(form);
  }

  function resetUploadFormKeepingPreferences(form) {
    if (!form) return;
    const prefs = readUploadFormPreferences(form);
    form.reset();
    applyUploadFormPreferences(form, prefs);
    const title = form.querySelector('[name="title"]');
    if (title) title.value = "";
    const fileInput = form.querySelector("#document-upload-file");
    if (fileInput) fileInput.value = "";
    const cameraInput = form.querySelector("#document-upload-camera");
    if (cameraInput) cameraInput.value = "";
    const filenameEl = document.getElementById("document-upload-filename");
    if (filenameEl) {
      filenameEl.hidden = true;
      filenameEl.textContent = "";
    }
  }

  function readDistributeFormPreferences(form) {
    if (!form) return null;
    return {
      category: form.querySelector('[name="category"]')?.value || "",
      employee_id: form.querySelector('[name="employee_id"]')?.value || "",
      pay_period: form.querySelector("#document-distribute-pay-period")?.value || "",
      send_email: form.querySelector('[name="send_email"]')?.checked ?? true,
      notes: form.querySelector('[name="notes"]')?.value || "",
    };
  }

  function applyDistributeFormPreferences(form, prefs) {
    if (!form || !prefs) return;
    const category = form.querySelector('[name="category"]');
    const employee = form.querySelector('[name="employee_id"]');
    const payPeriod = form.querySelector("#document-distribute-pay-period");
    const sendEmail = form.querySelector('[name="send_email"]');
    const notes = form.querySelector('[name="notes"]');
    if (category && prefs.category) category.value = prefs.category;
    if (employee) employee.value = prefs.employee_id || "";
    if (payPeriod) payPeriod.value = prefs.pay_period || "";
    if (sendEmail) sendEmail.checked = prefs.send_email;
    if (notes) notes.value = prefs.notes || "";
    const syncPayPeriodRequired = () => {
      if (!payPeriod) return;
      const isPayslip = category?.value === "payslip";
      payPeriod.required = isPayslip;
      payPeriod.closest(".edit-field")?.classList.toggle("edit-field--required", isPayslip);
    };
    syncPayPeriodRequired();
  }

  function resetDistributeFormKeepingPreferences(form) {
    if (!form) return;
    const prefs = readDistributeFormPreferences(form);
    form.reset();
    applyDistributeFormPreferences(form, prefs);
    const title = form.querySelector('[name="title"]');
    if (title) title.value = "";
    const fileInput = form.querySelector("#document-distribute-file");
    if (fileInput) fileInput.value = "";
    const cameraInput = form.querySelector("#document-distribute-camera");
    if (cameraInput) cameraInput.value = "";
    const filenameEl = document.getElementById("document-distribute-filename");
    if (filenameEl) {
      filenameEl.hidden = true;
      filenameEl.textContent = "";
    }
  }

  function readLinkFormPreferences(form) {
    if (!form) return null;
    return {
      employee_id: form.querySelector('[name="employee_id"]')?.value || "",
      category: form.querySelector('[name="category"]')?.value || "",
      lifecycle_stage: form.querySelector('[name="lifecycle_stage"]')?.value || "",
      expires_at: form.querySelector('[name="expires_at"]')?.value || "",
      expiry_alert_days: form.querySelector('[name="expiry_alert_days"]')?.value || "30",
      employee_visible: form.querySelector('[name="employee_visible"]')?.checked ?? false,
      notes: form.querySelector('[name="notes"]')?.value || "",
    };
  }

  function applyLinkFormPreferences(form, prefs) {
    if (!form || !prefs) return;
    const employee = form.querySelector('[name="employee_id"]');
    const category = form.querySelector('[name="category"]');
    const stage = form.querySelector('[name="lifecycle_stage"]');
    const expiresAt = form.querySelector('[name="expires_at"]');
    const alertDays = form.querySelector('[name="expiry_alert_days"]');
    const visible = form.querySelector('[name="employee_visible"]');
    const notes = form.querySelector('[name="notes"]');
    if (employee) employee.value = prefs.employee_id || "";
    if (category && prefs.category) category.value = prefs.category;
    if (stage && prefs.lifecycle_stage) stage.value = prefs.lifecycle_stage;
    if (expiresAt) expiresAt.value = prefs.expires_at || "";
    if (alertDays && prefs.expiry_alert_days) alertDays.value = prefs.expiry_alert_days;
    if (visible) visible.checked = prefs.employee_visible;
    if (notes) notes.value = prefs.notes || "";
    const title = form.querySelector('[name="title"]');
    const url = form.querySelector('[name="document_url"]');
    if (title) title.value = "";
    if (url) url.value = "";
  }

  function setDocumentsPanelAlert(options) {
    const host = document.getElementById("documents-panel-alert");
    if (!host) return;
    if (!options?.message) {
      host.hidden = true;
      host.innerHTML = "";
      host.classList.remove("settings-doc-alert--warn");
      return;
    }
    const { title, message, tone = "error", retryLabel, onRetry } = options;
    host.hidden = false;
    host.classList.toggle("settings-doc-alert--warn", tone === "warn");
    const retryHtml =
      retryLabel && typeof onRetry === "function"
        ? `<div class="settings-doc-alert__actions"><button type="button" class="btn outline" data-doc-alert-retry>${escapeHtml(retryLabel)}</button></div>`
        : "";
    host.innerHTML = `
      <span class="settings-doc-alert__icon" aria-hidden="true">${tone === "warn" ? "⚠️" : "⛔"}</span>
      <div class="settings-doc-alert__body">
        ${title ? `<strong>${escapeHtml(title)}</strong>` : ""}
        <p>${escapeHtml(message)}</p>
      </div>
      ${retryHtml}`;
    host.querySelector("[data-doc-alert-retry]")?.addEventListener("click", onRetry);
  }

  function renderExpiryStats(summary, state = "ok") {
    const statsHost = document.getElementById("documents-expiring-stats");
    const section = document.getElementById("documents-expiring-section");

    if (statsHost) {
      statsHost.setAttribute("aria-busy", state === "loading" ? "true" : "false");
      if (state === "loading") {
        statsHost.innerHTML = `
          <span class="doc-expiry-stat doc-expiry-stat--skeleton" aria-hidden="true"></span>
          <span class="doc-expiry-stat doc-expiry-stat--skeleton" aria-hidden="true"></span>
          <span class="doc-expiry-stat doc-expiry-stat--skeleton" aria-hidden="true"></span>
          <span class="visually-hidden">Loading expiry summary</span>`;
      } else if (state === "error") {
        statsHost.innerHTML = `<span class="doc-expiry-stat doc-expiry-stat--unknown">Summary unavailable</span>`;
      } else {
        const expired = Number(summary?.expired) || 0;
        const expiringSoon = Number(summary?.expiring_soon) || 0;
        const valid = Number(summary?.valid) || 0;
        statsHost.innerHTML = `
          <span class="doc-expiry-stat doc-expiry-stat--danger">${expired} expired</span>
          <span class="doc-expiry-stat doc-expiry-stat--warn">${expiringSoon} expiring soon</span>
          <span class="doc-expiry-stat doc-expiry-stat--ok">${valid} valid</span>`;
      }
    }

    if (section) {
      section.classList.toggle("settings-doc-expiring--error", state === "error");
      if (state === "ok") {
        const expired = Number(summary?.expired) || 0;
        const expiringSoon = Number(summary?.expiring_soon) || 0;
        section.classList.toggle("settings-doc-expiring--urgent", expired > 0);
        section.classList.toggle("settings-doc-expiring--warn", expired === 0 && expiringSoon > 0);
      } else {
        section.classList.remove("settings-doc-expiring--urgent", "settings-doc-expiring--warn");
      }
    }
  }

  function renderExpiryTableSkeleton(tbody) {
    if (!tbody) return;
    const cell = () =>
      `<td><span class="settings-doc-skeleton-line settings-doc-skeleton-line--md" aria-hidden="true"></span></td>`;
    tbody.innerHTML = Array.from({ length: 3 }, () => `<tr class="settings-doc-skeleton-row">${cell()}${cell()}${cell()}${cell()}${cell()}</tr>`).join(
      ""
    );
  }

  function renderTableEmptyState(tbody, colSpan, { variant = "empty", title, message, actionHtml = "" }) {
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="settings-doc-table-empty">
      ${documentsEmptyStateHtml({ variant, title, message, actionHtml })}
    </td></tr>`;
  }

  function renderDocumentsListState({ variant = "empty", title, message, actionHtml = "" }) {
    const host = document.getElementById(STRIP_LIST_ID);
    if (!host) return;
    host.hidden = false;
    host.innerHTML = documentsEmptyStateHtml({ variant, title, message, actionHtml });
  }

  let lastDocumentRows = null;

  function documentsEmptyStateHtml({ variant = "empty", title, message, actionHtml = "" }) {
    const icon = variant === "error" ? "⚠️" : variant === "ok" ? "✓" : "📄";
    return `<div class="settings-doc-empty settings-doc-empty--${variant}">
        <span class="settings-doc-empty__icon" aria-hidden="true">${icon}</span>
        <h5>${escapeHtml(title)}</h5>
        <p>${escapeHtml(message)}</p>
        ${actionHtml}
      </div>`;
  }

  function clearDocumentsStripList() {
    const host = document.getElementById(STRIP_LIST_ID);
    if (!host) return;
    host.hidden = true;
    host.innerHTML = "";
  }

  function renderDocumentsStripList(rows, emptyState) {
    const host = document.getElementById(STRIP_LIST_ID);
    if (!host) return;
    if (emptyState) {
      host.hidden = false;
      host.innerHTML = documentsEmptyStateHtml(emptyState);
      return;
    }
    if (!rows?.length) {
      clearDocumentsStripList();
      return;
    }
    host.hidden = false;
    host.innerHTML = rows
      .map((row) => {
        const fileAction = row.has_file
          ? `<button type="button" class="btn ghost" data-download-doc="${row.id}" data-doc-scope="${escapeHtml(row.scope || "tenant")}" data-doc-employee-id="${escapeHtml(row.employee_id ? String(row.employee_id) : "")}">Download</button>`
          : row.document_url
            ? `<a class="btn ghost" href="${escapeHtml(row.document_url)}" target="_blank" rel="noopener">Open link</a>`
            : "";
        return `<article class="settings-doc-strip">
          <div class="settings-doc-strip__main">
            <strong class="settings-doc-strip__title">${escapeHtml(row.title)}</strong>
            <span class="settings-doc-strip__meta">${escapeHtml(audienceLabel(row))} · ${escapeHtml(categoryLabel(row.category))} · ${escapeHtml(stageLabel(row.lifecycle_stage || "general"))} · ${escapeHtml((row.created_at || "").slice(0, 10))}</span>
          </div>
          <div class="settings-doc-strip__aside">
            <div class="settings-doc-strip__badges">${portalVisibilityMarkup(row)}</div>
            <div class="settings-doc-strip__actions">${fileAction}${documentActionsMarkup(row)}</div>
          </div>
        </article>`;
      })
      .join("");
    bindDocumentRowActions(host, rows);
  }

  function openDocumentEditPanel(row) {
    const host = document.getElementById("document-edit-panel");
    if (!host || !row) return;
    const isEmployeeCopy = row.scope === "employee";
    window.Admin?.preserveScroll?.(() => {
      host.hidden = false;
      host.innerHTML = `<h4>Edit document</h4>
        <p class="muted settings-doc-edit-caption">${escapeHtml(audienceLabel(row))}${isEmployeeCopy ? " · Employee copy" : ""}</p>
        <div id="document-edit-form"></div>`;
    });
    mountEditForm(host.querySelector("#document-edit-form"), editFormSchema(row), {
      values: {
        title: row.title,
        employee_id: row.employee_id || "",
        category: row.category,
        lifecycle_stage: row.lifecycle_stage || "active",
        document_url: row.document_url || "",
        expires_at: (row.expires_at || "").slice(0, 10),
        expiry_alert_days: row.expiry_alert_days || 30,
        employee_visible: row.employee_visible,
        original_filename: row.original_filename || "",
        pay_period: row.pay_period || "",
        notes: row.notes || "",
      },
      onSubmit: async (payload) => {
        const bodyPayload = {
          ...payload,
          document_url: payload.document_url || null,
          notes: payload.notes || null,
          expires_at: payload.expires_at || null,
          original_filename: payload.original_filename || null,
          pay_period: payload.pay_period || null,
          employee_visible: Boolean(payload.employee_visible),
        };
        if (!isEmployeeCopy) {
          bodyPayload.employee_id = payload.employee_id || null;
        }
        const res = await apiFetch(`/admin/documents/${row.id}?${documentApiQuery(row)}`, {
          method: "PATCH",
          body: JSON.stringify(bodyPayload),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || "Update failed");
        host.hidden = true;
        window.AdminSettings?.showSettingsToast?.("Document updated ✓");
        await refreshDocuments();
        await refreshExpiringDocuments();
      },
    });
  }

  function bindDocumentRowActions(container, rows) {
    if (!container) return;
    container.querySelectorAll("[data-download-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = findDocumentRow(rows, {
          id: btn.dataset.downloadDoc,
          scope: btn.dataset.docScope,
          employeeId: btn.dataset.docEmployeeId,
        });
        if (!row) return;
        const name = row.original_filename || `${row.title || "document"}.bin`;
        await downloadAuthenticated(documentDownloadPath(row), name);
      });
    });

    container.querySelectorAll("[data-delete-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = findDocumentRow(rows, {
          id: btn.dataset.deleteDoc,
          scope: btn.dataset.docScope,
          employeeId: btn.dataset.docEmployeeId,
        });
        if (!row) return;
        if (!window.confirm("Remove this document record?")) return;
        const res = await apiFetch(`/admin/documents/${row.id}?${documentApiQuery(row)}`, { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json();
          showAdminToast?.(err.detail || "Delete failed", { variant: "error" });
          return;
        }
        await refreshDocuments();
        await refreshExpiringDocuments();
      });
    });

    container.querySelectorAll("[data-edit-doc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = findDocumentRow(rows, {
          id: btn.dataset.editDoc,
          scope: btn.dataset.docScope,
          employeeId: btn.dataset.docEmployeeId,
        });
        openDocumentEditPanel(row);
      });
    });
  }

  function bindDocumentsEmptyActions(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelector("[data-doc-clear-filters]")?.addEventListener("click", () => {
      const categoryEl = document.getElementById(FILTER_IDS.category);
      const stageEl = document.getElementById(FILTER_IDS.stage);
      const employeeEl = document.getElementById(FILTER_IDS.employee);
      if (categoryEl) categoryEl.value = "";
      if (stageEl) stageEl.value = "";
      if (employeeEl) employeeEl.value = "";
      void refreshDocuments();
    });
    scope.querySelector("[data-doc-focus-upload]")?.addEventListener("click", () => {
      activateDocumentTab("upload");
      document.getElementById("document-upload-dropzone")?.scrollIntoView({ behavior: "auto", block: "nearest" });
    });
    scope.querySelector("[data-doc-retry-list]")?.addEventListener("click", () => {
      void refreshDocuments();
    });
  }

  function parseApiDetail(data, fallback) {
    if (!data || typeof data !== "object") return fallback;
    const detail = data.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
    if (Array.isArray(detail)) {
      return detail.map((item) => item.msg || item.message || String(item)).join("; ");
    }
    return fallback;
  }

  function guardFormSubmit(form, handler) {
    let inFlight = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (inFlight) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      inFlight = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.busyLabel = submitBtn.dataset.busyLabel || submitBtn.textContent;
        submitBtn.textContent = "Working…";
      }
      try {
        await handler(event);
      } finally {
        inFlight = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.busyLabel || submitBtn.textContent;
        }
      }
    });
  }

  async function uploadMultipart(path, formData) {
    const tenantId = window.Admin?.TENANT_ID;
    if (!tenantId) {
      throw new Error("Business not set. Sign in again.");
    }
    const apiBase = window.Admin.getApiBase?.() || API_BASE;
    if (!apiBase) {
      throw new Error("API URL not configured. Hard refresh and sign in again.");
    }
    let res;
    try {
      res = await window.ShiftSwiftSession.fetchWithAuth(
        path,
        { method: "POST", body: formData },
        { apiBase, tenantId }
      );
    } catch (error) {
      console.warn("ShiftSwift multipart upload failed", { apiBase, path, error });
      throw error;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(parseApiDetail(data, "Upload failed"));
    }
    return data;
  }

  async function refreshDocumentViews(statusEl) {
    await refreshDocuments().catch(() => {});
    await refreshExpiringDocuments().catch(() => {});

    const alertVisible = document.getElementById("documents-panel-alert") && !document.getElementById("documents-panel-alert").hidden;
    const uploadSucceeded = statusEl?.classList.contains("edit-form-status--success");
    if (alertVisible) {
      console.warn("Document list refresh failed");
      if (statusEl && !uploadSucceeded) {
        setFormStatus(statusEl, "Uploaded — refresh the lists below if needed.", "warn");
      }
      if (uploadSucceeded) {
        window.AdminSettings?.showSettingsToast?.("Document saved — reload lists below if they look empty.", { variant: "warn" });
      }
      return;
    }

    setDocumentsPanelAlert({});
    if (statusEl && !uploadSucceeded) {
      setFormStatus(statusEl, "Uploaded ✓", "success");
    }
  }

  function categoryLabel(value) {
    const categories = window.Admin.formOptions?.document_categories || [];
    return categories.find((item) => item.value === value)?.label || value;
  }

  function stageLabel(value) {
    const stages = window.Admin.formOptions?.document_lifecycle_stages || [];
    return stages.find((item) => item.value === value)?.label || value;
  }

  function employeeLabel(employeeId) {
    if (!employeeId) return "All employees";
    const match = employeeLookup.find((item) => String(item.id) === String(employeeId));
    if (match?.label) return match.label;
    const option = (window.Admin.formOptions?.employees || []).find(
      (item) => String(item.value || item.id) === String(employeeId)
    );
    return option?.label || `Employee #${employeeId}`;
  }

  function audienceLabel(row) {
    if (row.scope === "employee" && row.employee_id) {
      return employeeLabel(row.employee_id);
    }
    if (!row.employee_id) return "All employees";
    return employeeLabel(row.employee_id);
  }

  function documentDownloadPath(row) {
    const scope = row.scope || "tenant";
    const params = new URLSearchParams({ scope });
    if (scope === "employee" && row.employee_id) {
      params.set("employee_id", String(row.employee_id));
    }
    return `/admin/documents/${row.id}/file?${params.toString()}`;
  }

  function documentApiQuery(row) {
    const params = new URLSearchParams({ scope: row.scope || "tenant" });
    if (row.scope === "employee" && row.employee_id) {
      params.set("employee_id", String(row.employee_id));
    }
    return params.toString();
  }

  function findDocumentRow(rows, { id, scope, employeeId }) {
    return rows.find((item) => {
      if (String(item.id) !== String(id)) return false;
      const itemScope = item.scope || "tenant";
      const wantedScope = scope || "tenant";
      if (itemScope !== wantedScope) return false;
      if (wantedScope === "employee") {
        return String(item.employee_id || "") === String(employeeId || "");
      }
      return true;
    });
  }

  function documentActionAttrs(row) {
    const scope = escapeHtml(row.scope || "tenant");
    const employeeId = escapeHtml(row.employee_id ? String(row.employee_id) : "");
    return `data-doc-scope="${scope}" data-doc-employee-id="${employeeId}"`;
  }

  function documentActionsMarkup(row) {
    return `<div class="table-actions">
      <button type="button" class="btn ghost" data-edit-doc="${row.id}" ${documentActionAttrs(row)}>Edit</button>
      <button type="button" class="btn ghost" data-delete-doc="${row.id}" ${documentActionAttrs(row)}>Remove</button>
    </div>`;
  }

  function documentHasAttachment(row) {
    return Boolean(row?.has_file) || Boolean(String(row?.document_url || "").trim());
  }

  function portalVisibilityMarkup(row) {
    if (!row.employee_visible) {
      return `<span class="doc-portal-visibility doc-portal-visibility--hidden">HR only</span>`;
    }
    if (!row.employee_id) {
      return `<span class="doc-portal-visibility doc-portal-visibility--company">All staff</span>`;
    }
    return `<span class="doc-portal-visibility doc-portal-visibility--personal">Employee portal</span>`;
  }

  function syncUploadAudience(form) {
    window.Admin?.preserveScroll?.(() => {
      syncUploadAudienceInner(form);
    });
  }

  function syncUploadAudienceInner(form) {
    const audience = form?.querySelector('input[name="doc_audience"]:checked')?.value || "company";
    const employeeField = document.getElementById("document-upload-employee-field");
    const visibleField = document.getElementById("document-upload-visible-field");
    const visibleCheck = document.getElementById("document-upload-visible");
    const visibleHint = document.getElementById("document-upload-visible-hint");
    const audienceCaption = document.getElementById("document-upload-audience-caption");
    const categorySelect = document.getElementById("document-upload-category");
    const employeeSearch = document.getElementById("document-upload-employee-search");
    const employeeIdField = document.getElementById("document-upload-employee-id");

    if (employeeField) employeeField.hidden = audience !== "employee";
    if (visibleField) visibleField.hidden = audience === "hr";

    if (audience !== "employee") {
      if (employeeSearch) employeeSearch.value = "";
      if (employeeIdField) employeeIdField.value = "";
    }

    if (visibleCheck) {
      if (audience === "hr") {
        visibleCheck.checked = false;
      } else if (audience === "company") {
        visibleCheck.checked = true;
        if (categorySelect && !categorySelect.dataset.userPicked && categorySelect.value === "general") {
          categorySelect.value = "policy";
        }
      } else if (audience === "employee") {
        visibleCheck.checked = true;
      }
    }

    if (audienceCaption) {
      if (audience === "company") {
        audienceCaption.textContent = "Company handbooks and policies for every staff member.";
      } else if (audience === "employee") {
        audienceCaption.textContent = "Personal file on one employee profile only.";
      } else {
        audienceCaption.textContent = "Stored for HR audits — never shown in the employee portal.";
      }
    }

    if (visibleHint) {
      if (audience === "company") {
        visibleHint.textContent = "All staff will see this under Company documents.";
      } else if (audience === "employee") {
        visibleHint.textContent = "Only the selected employee sees this in their portal.";
      } else {
        visibleHint.textContent = "";
      }
    }

    const notifyTitle = document.getElementById("document-upload-notify-title");
    if (notifyTitle) {
      notifyTitle.textContent =
        audience === "employee" ? "Notify employee when published" : "Notify employees when published";
    }

    syncUploadNotify(form);
  }

  function formatEmployeeNotifyLabel(label) {
    const text = String(label || "").trim();
    if (!text) return "Employee";
    const comma = text.indexOf(",");
    if (comma > 0) {
      return `${text.slice(0, comma).trim()} · ${text.slice(comma + 1).trim()}`;
    }
    return text;
  }

  function mountNotifyEmployeeSelect() {
    const select = document.getElementById("document-upload-notify-employees");
    if (!select || select.dataset.ready === "true") return;
    const employees = activeEmployeeSelectOptions();
    select.innerHTML = employees
      .map(
        (item) =>
          `<option value="${escapeHtml(String(item.id))}">${escapeHtml(formatEmployeeNotifyLabel(item.label))}</option>`
      )
      .join("");
    select.dataset.ready = "true";
  }

  function syncUploadNotify(form) {
    window.Admin?.preserveScroll?.(() => {
      syncUploadNotifyInner(form);
    });
  }

  function syncUploadNotifyInner(form) {
    const audience = form?.querySelector('input[name="doc_audience"]:checked')?.value || "company";
    const visibleCheck = document.getElementById("document-upload-visible");
    const visibilitySection = document.getElementById("document-upload-visibility-section");
    const notifyRow = document.getElementById("document-upload-notify-row");
    const notifyCheck = document.getElementById("document-upload-notify");
    const notifyTargets = document.getElementById("document-upload-notify-targets");
    const scopeField = document.getElementById("document-upload-notify-scope-field");
    const selectField = document.getElementById("document-upload-notify-select-field");
    const portalVisible = audience !== "hr" && (visibleCheck?.checked ?? false);

    if (visibilitySection) visibilitySection.hidden = audience === "hr";
    if (notifyRow) notifyRow.hidden = !portalVisible;
    if (!portalVisible) {
      if (notifyTargets) notifyTargets.hidden = true;
      return;
    }

    mountNotifyEmployeeSelect();

    if (notifyTargets) notifyTargets.hidden = !(notifyCheck?.checked ?? false);
    if (scopeField) scopeField.hidden = audience === "employee";
    if (selectField) {
      const selectedScope = form.querySelector('input[name="notify_scope"]:checked')?.value || "all";
      selectField.hidden = audience === "employee" || selectedScope !== "selected";
    }
  }

  function formLifecycleStages() {
    return (
      window.Admin.formOptions?.document_form_lifecycle_stages ||
      window.Admin.formOptions?.document_lifecycle_stages ||
      []
    );
  }

  function expiryHintText(days) {
    const windowDays = Number(days) || 30;
    return `ShiftSwift will alert HR ${windowDays} days before this document expires.`;
  }

  function syncExpiryFields() {
    window.Admin?.preserveScroll?.(() => {
      syncExpiryFieldsInner();
    });
  }

  function syncExpiryFieldsInner() {
    const expiryEl = document.getElementById("document-upload-expires-at");
    const alertField = document.getElementById("document-upload-alert-field");
    const alertHint = document.getElementById("document-upload-alert-hint");
    const daysEl = document.getElementById("document-upload-alert-days");
    const hasDate = Boolean(expiryEl?.value);

    if (alertField) alertField.hidden = !hasDate;
    if (alertHint && hasDate) {
      alertHint.textContent = expiryHintText(daysEl?.value || 30);
    }
  }

  function activeEmployeeSelectOptions() {
    return (window.Admin.formOptions?.employees || [])
      .map((item) => ({
        id: item.id ?? item.value,
        label: item.label || `${item.first_name || ""} ${item.last_name || ""}`.trim(),
        status: item.status,
      }))
      .filter((item) => !item.status || item.status === "active" || item.status === "onboarding");
  }

  function populateDistributeEmployeeSelect() {
    const employeeSelect = document.getElementById("document-distribute-employee");
    if (!employeeSelect) return;
    const employees = activeEmployeeSelectOptions();
    const previous = employeeSelect.value;
    employeeSelect.innerHTML =
      `<option value="">All active employees</option>` +
      employees
        .map(
          (item) =>
            `<option value="${escapeHtml(String(item.id))}">${escapeHtml(item.label)}</option>`
        )
        .join("");
    if (previous && [...employeeSelect.options].some((opt) => opt.value === previous)) {
      employeeSelect.value = previous;
    }
  }

  function mountEmployeeSearch({ searchId, datalistId, hiddenId }) {
    const searchInput = document.getElementById(searchId);
    const datalist = document.getElementById(datalistId);
    const hiddenInput = document.getElementById(hiddenId);
    if (!searchInput || !datalist || !hiddenInput || searchInput.dataset.ready === "true") return;

    employeeLookup = (window.Admin.formOptions?.employees || []).map((item) => ({
      id: item.value || item.id,
      label: item.label || `${item.first_name || ""} ${item.last_name || ""}`.trim(),
    }));

    datalist.innerHTML = employeeLookup
      .map((item) => `<option value="${escapeHtml(item.label)}" data-id="${escapeHtml(item.id)}"></option>`)
      .join("");

    const syncEmployeeId = () => {
      const value = searchInput.value.trim();
      if (!value) {
        hiddenInput.value = "";
        return;
      }
      const match = employeeLookup.find((item) => item.label.toLowerCase() === value.toLowerCase());
      hiddenInput.value = match ? String(match.id) : "";
    };

    searchInput.addEventListener("change", syncEmployeeId);
    searchInput.addEventListener("blur", syncEmployeeId);
    searchInput.addEventListener("input", () => {
      if (!searchInput.value.trim()) hiddenInput.value = "";
    });
    searchInput.dataset.ready = "true";
  }

  function expiryStatusMarkup(status) {
    if (status === "expired") return `<span class="doc-expiry doc-expiry--danger">Expired</span>`;
    if (status === "expiring_soon") return `<span class="doc-expiry doc-expiry--warn">Expiring soon</span>`;
    if (status === "valid") return `<span class="doc-expiry doc-expiry--ok">Valid</span>`;
    return "<span class='muted'>—</span>";
  }

  function expiryDateMarkup(row) {
    const dateText = escapeHtml((row.expires_at || "").slice(0, 10) || "Not set");
    if (!row.expires_at) return dateText;
    const status = row.expiry_status || computeExpiryStatus(row);
    const cls =
      status === "expired" ? "doc-expiry doc-expiry--danger" : status === "expiring_soon" ? "doc-expiry doc-expiry--warn" : "";
    return cls ? `<span class="${cls}">${dateText}</span>` : dateText;
  }

  function computeExpiryStatus(row) {
    if (!row.expires_at) return "none";
    const alertDays = Number(row.expiry_alert_days) || 30;
    const expires = new Date(String(row.expires_at).slice(0, 10));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.round((expires - today) / 86400000);
    if (daysLeft < 0) return "expired";
    if (daysLeft <= alertDays) return "expiring_soon";
    return "valid";
  }

  function buildQuery() {
    const params = new URLSearchParams();
    const category = document.getElementById(FILTER_IDS.category)?.value;
    const stage = document.getElementById(FILTER_IDS.stage)?.value;
    const employeeId = document.getElementById(FILTER_IDS.employee)?.value;
    if (category) params.set("category", category);
    if (stage) params.set("lifecycle_stage", stage);
    if (employeeId) params.set("employee_id", employeeId);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  function documentsFiltersActive() {
    return Boolean(
      document.getElementById(FILTER_IDS.category)?.value ||
        document.getElementById(FILTER_IDS.stage)?.value ||
        document.getElementById(FILTER_IDS.employee)?.value
    );
  }

  function buildExportQuery(format) {
    const params = new URLSearchParams(buildQuery().replace(/^\?/, ""));
    params.set("format", format);
    params.set("include_employee_documents", "true");
    if (document.getElementById("documents-export-include-rtw")?.checked) {
      params.set("include_rtw", "true");
    }
    return `?${params.toString()}`;
  }

  function documentLinkFormSchema() {
    return {
      id: "document-link",
      columns: 2,
      submitLabel: "Add link record",
      successMessage: "Document link saved.",
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        {
          name: "employee_id",
          label: "Employee",
          type: "select",
          optionsKey: "employees",
          placeholderOption: "Tenant-wide",
        },
        {
          name: "category",
          label: "Category",
          type: "select",
          optionsKey: "document_categories",
          defaultValue: "general",
        },
        {
          name: "lifecycle_stage",
          label: "Lifecycle stage",
          type: "select",
          optionsKey: "document_form_lifecycle_stages",
          defaultValue: "active",
        },
        { name: "document_url", label: "Document URL", type: "url", placeholder: "https://...", required: true },
        { name: "expires_at", label: "Expiry date", type: "date" },
        {
          name: "expiry_alert_days",
          label: "HR alert window",
          type: "select",
          optionsKey: "document_expiry_alert_days",
          defaultValue: 30,
        },
        {
          name: "employee_visible",
          label: "Visible to employee in their portal",
          type: "checkbox",
          span: 2,
        },
        { name: "notes", label: "Notes", type: "textarea", span: 2, rows: 2 },
      ],
    };
  }

  function editFormSchema(row) {
    const isEmployeeCopy = row.scope === "employee";
    const fields = [
      { name: "title", label: "Title", type: "text", required: true },
    ];
    if (!isEmployeeCopy) {
      fields.push({
        name: "employee_id",
        label: "Employee",
        type: "select",
        optionsKey: "employees",
        placeholderOption: "Tenant-wide",
      });
    }
    fields.push(
      {
        name: "category",
        label: "Category",
        type: "select",
        optionsKey: "document_categories",
        defaultValue: "general",
      },
      {
        name: "lifecycle_stage",
        label: "Lifecycle stage",
        type: "select",
        optionsKey: "document_form_lifecycle_stages",
        defaultValue: "active",
      },
      {
        name: "document_url",
        label: "Document URL",
        type: "url",
        placeholder: row.has_file ? "Optional external link" : "https://...",
      },
      { name: "expires_at", label: "Expiry date", type: "date" },
      {
        name: "expiry_alert_days",
        label: "HR alert window",
        type: "select",
        optionsKey: "document_expiry_alert_days",
        defaultValue: 30,
      },
      {
        name: "employee_visible",
        label: "Visible to employee in their portal",
        type: "checkbox",
        span: 2,
      },
      { name: "notes", label: "Notes", type: "textarea", span: 2, rows: 2 },
      { name: "original_filename", label: "Original filename", type: "text", placeholder: "contract.pdf" }
    );
    if (isEmployeeCopy || row.category === "payslip") {
      fields.splice(4, 0, {
        name: "pay_period",
        label: "Pay period",
        type: "text",
        placeholder: "2026-04 or April 2026",
      });
    }
    return {
      id: `document-edit-${row.scope || "tenant"}-${row.id}`,
      columns: 2,
      submitLabel: "Save changes",
      successMessage: "Document updated.",
      fields,
    };
  }

  function updateTabDescription(target) {
    const desc = document.getElementById("document-tab-desc");
    if (desc) desc.textContent = TAB_DESCRIPTIONS[target] || "";
  }

  function activateDocumentTab(target) {
    document.querySelectorAll("[data-doc-tab]").forEach((el) => {
      const active = el.dataset.docTab === target;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-doc-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.docPanel !== target;
    });
    updateTabDescription(target);
    if (target === "link") {
      mountLinkForm();
    }
    if (target === "distribute") {
      populateDistributeEmployeeSelect();
    }
  }

  function resetDocumentTabs() {
    activateDocumentTab("upload");
  }

  function bindDocumentTabs() {
    const tabs = document.querySelectorAll("[data-doc-tab]");
    if (!tabs.length || document.body.dataset.docTabsBound === "true") return;
    document.body.dataset.docTabsBound = "true";

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        activateDocumentTab(tab.dataset.docTab);
      });
    });
    updateTabDescription("upload");
  }

  function assignFileToInput(fileInput, file) {
    if (!fileInput || !file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
  }

  function bindFileDropzone({
    dropzone,
    fileInput,
    filenameEl,
    browseSelector = ".doc-upload-browse",
    cameraInput,
  }) {
    if (!dropzone || !fileInput || dropzone.dataset.ready === "true") return;

    const showFile = (file) => {
      if (!filenameEl) return;
      if (!file) {
        filenameEl.hidden = true;
        filenameEl.textContent = "";
        return;
      }
      filenameEl.hidden = false;
      filenameEl.textContent = file.name || "Photo capture";
    };

    dropzone.querySelector(browseSelector)?.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => showFile(fileInput.files?.[0]));

    if (cameraInput) {
      dropzone.querySelector(".doc-upload-camera")?.addEventListener("click", () => cameraInput.click());
      cameraInput.addEventListener("change", () => {
        const file = cameraInput.files?.[0];
        if (!file) return;
        assignFileToInput(fileInput, file);
        showFile(file);
        cameraInput.value = "";
      });
    }

    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add("doc-upload-dropzone--active");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.remove("doc-upload-dropzone--active");
      });
    });
    dropzone.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      assignFileToInput(fileInput, file);
      showFile(file);
    });

    dropzone.dataset.ready = "true";
  }

  function bindUploadDropzone() {
    bindFileDropzone({
      dropzone: document.getElementById("document-upload-dropzone"),
      fileInput: document.getElementById("document-upload-file"),
      filenameEl: document.getElementById("document-upload-filename"),
      cameraInput: document.getElementById("document-upload-camera"),
    });
  }

  function mountUploadForm() {
    const form = document.getElementById("document-upload-form");
    if (!form) return;
    const categories = window.Admin.formOptions?.document_categories || [];
    if (form.dataset.ready === "true" && categories.length) return;
    if (form.dataset.ready === "true") form.dataset.ready = "false";
    if (form.dataset.ready === "true") return;
    const stages = formLifecycleStages();
    const categorySelect = document.getElementById("document-upload-category");
    const stageSelect = document.getElementById("document-upload-stage");
    if (categorySelect) {
      categorySelect.innerHTML = categories
        .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
        .join("");
    }
    if (stageSelect) {
      stageSelect.innerHTML = stages
        .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
        .join("");
      if (stages.some((item) => item.value === "active")) stageSelect.value = "active";
    }

    mountEmployeeSearch({
      searchId: "document-upload-employee-search",
      datalistId: "document-upload-employees",
      hiddenId: "document-upload-employee-id",
    });

    document.getElementById("document-upload-category")?.addEventListener("change", (event) => {
      event.target.dataset.userPicked = "true";
    });

    form.querySelectorAll('input[name="doc_audience"]').forEach((input) => {
      input.addEventListener("change", () => syncUploadAudience(form));
    });
    document.getElementById("document-upload-visible")?.addEventListener("change", () => syncUploadNotify(form));
    document.getElementById("document-upload-notify")?.addEventListener("change", () => syncUploadNotify(form));
    form.querySelectorAll('input[name="notify_scope"]').forEach((input) => {
      input.addEventListener("change", () => syncUploadNotify(form));
    });
    syncUploadAudience(form);

    document.getElementById("document-upload-alert-days")?.addEventListener("change", () => {
      syncExpiryFields();
    });
    document.getElementById("document-upload-expires-at")?.addEventListener("change", () => {
      syncExpiryFields();
    });
    document.getElementById("document-upload-expires-at")?.addEventListener("input", () => {
      syncExpiryFields();
    });
    syncExpiryFields();

    bindUploadDropzone();

    guardFormSubmit(form, async () => {
      const status = form.querySelector("[data-status]");
      const audience = form.querySelector('input[name="doc_audience"]:checked')?.value || "company";
      const employeeSearch = document.getElementById("document-upload-employee-search");
      const employeeIdField = document.getElementById("document-upload-employee-id");
      if (audience === "employee" && employeeSearch?.value.trim() && !employeeIdField?.value) {
        if (status) {
          setFormStatus(status, "Select an employee from the suggestions.", "error");
        }
        return;
      }
      const fd = new FormData(form);
      const file = fd.get("file");
      if (!file || (file instanceof File && !file.size)) {
        if (status) setFormStatus(status, "Choose a file to upload.", "error");
        return;
      }
      const fileError = file instanceof File ? validateDocumentUploadFile(file) : null;
      if (fileError) {
        if (status) setFormStatus(status, fileError, "error");
        return;
      }
      if (status) setFormStatus(status, "Uploading…");
      const visible = audience === "hr" ? false : form.querySelector("#document-upload-visible")?.checked ?? false;
      fd.set("employee_visible", visible ? "true" : "false");
      if (audience !== "employee" || !fd.get("employee_id")) fd.delete("employee_id");
      if (!fd.get("expires_at")) {
        fd.delete("expires_at");
        fd.delete("expiry_alert_days");
      }

      const notify = visible && (form.querySelector("#document-upload-notify")?.checked ?? false);
      fd.set("notify_employees", notify ? "true" : "false");
      fd.delete("notify_employee_ids");
      fd.delete("send_email");
      if (notify) {
        const sendEmail = form.querySelector("#document-upload-notify-email")?.checked ?? true;
        fd.set("send_email", sendEmail ? "true" : "false");
        if (audience === "company") {
          const notifyScope = form.querySelector('input[name="notify_scope"]:checked')?.value || "all";
          if (notifyScope === "selected") {
            const selectedIds = [...document.querySelectorAll("#document-upload-notify-employees option:checked")].map(
              (option) => option.value
            );
            if (!selectedIds.length) {
              if (status) setFormStatus(status, "Select at least one employee to notify.", "error");
              return;
            }
            fd.set("notify_employee_ids", selectedIds.join(","));
          }
        }
      }

      try {
        const data = await uploadMultipart("/admin/documents/upload", fd);
        resetUploadFormKeepingPreferences(form);
        const notified = data?.notifications?.notified_count;
        const successText =
          notified != null
            ? `Uploaded ✓ ${notified} employee${notified === 1 ? "" : "s"} notified`
            : "Uploaded ✓";
        if (status) setFormStatus(status, successText, "success");
        window.AdminSettings?.showSettingsToast?.(successText);
        await refreshDocumentViews(status);
      } catch (error) {
        if (status) setFormStatus(status, friendlyError(error, "Upload failed"), "error");
      }
    });
    form.dataset.ready = "true";
  }

  function mountDistributeForm() {
    const form = document.getElementById("document-distribute-form");
    if (!form || form.dataset.ready === "true") return;

    const categories = window.Admin.formOptions?.employee_document_categories || [];
    const categorySelect = document.getElementById("document-distribute-category");
    const employeeSelect = document.getElementById("document-distribute-employee");
    const payPeriodInput = document.getElementById("document-distribute-pay-period");
    const dropzone = document.getElementById("document-distribute-dropzone");
    const fileInput = document.getElementById("document-distribute-file");
    const filenameEl = document.getElementById("document-distribute-filename");

    if (categorySelect) {
      categorySelect.innerHTML = categories
        .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
        .join("");
      categorySelect.value = categories.some((item) => item.value === "payslip") ? "payslip" : categories[0]?.value || "general";
    }

    if (employeeSelect) {
      populateDistributeEmployeeSelect();
    }

    const syncPayPeriodRequired = () => {
      if (!payPeriodInput) return;
      const isPayslip = categorySelect?.value === "payslip";
      payPeriodInput.required = isPayslip;
      payPeriodInput.closest(".edit-field")?.classList.toggle("edit-field--required", isPayslip);
    };
    categorySelect?.addEventListener("change", syncPayPeriodRequired);
    syncPayPeriodRequired();

    if (dropzone && fileInput && !dropzone.dataset.ready) {
      bindFileDropzone({
        dropzone,
        fileInput,
        filenameEl,
        browseSelector: "[data-distribute-browse]",
        cameraInput: document.getElementById("document-distribute-camera"),
      });
    }

    guardFormSubmit(form, async () => {
      const status = form.querySelector("[data-status]");
      const fd = new FormData(form);
      const file = fd.get("file");
      if (!file || (file instanceof File && !file.size)) {
        if (status) setFormStatus(status, "Choose a file to upload.", "error");
        return;
      }
      const fileError = file instanceof File ? validateDocumentUploadFile(file) : null;
      if (fileError) {
        if (status) setFormStatus(status, fileError, "error");
        return;
      }
      if (status) setFormStatus(status, "Uploading…");
      const sendEmail = form.querySelector('[name="send_email"]')?.checked ?? false;
      fd.set("send_email", sendEmail ? "true" : "false");
      if (!fd.get("employee_id")) fd.delete("employee_id");
      if (categorySelect?.value !== "payslip") fd.delete("pay_period");
      const targetEmployeeId = fd.get("employee_id");
      if (categorySelect?.value === "payslip" && !targetEmployeeId) {
        const ok = window.confirm(
          "Send this payslip to all active employees? Choose one employee in Send to for an individual payslip."
        );
        if (!ok) {
          if (status) setFormStatus(status, "Choose one employee in Send to, or confirm send to all.", "warn");
          return;
        }
      }
      try {
        const data = await uploadMultipart("/admin/documents/distribute", fd);
        resetDistributeFormKeepingPreferences(form);
        if (status) {
          const emailNote =
            data.emails_sent > 0
              ? ` · ${data.emails_sent} email${data.emails_sent === 1 ? "" : "s"} sent`
              : data.emails_skipped > 0
                ? ` · ${data.emails_skipped} without email`
                : "";
          setFormStatus(status, `${data.message || "Distributed."}${emailNote}`, "success");
        }
        window.AdminSettings?.showSettingsToast?.("Document distributed ✓");
        await refreshDocumentViews(status);
      } catch (error) {
        if (status) setFormStatus(status, friendlyError(error, "Distribution failed"), "error");
      }
    });

    form.dataset.ready = "true";
  }

  let refreshDocuments = async () => {};
  let refreshExpiringDocuments = async () => {};

  async function loadExpiringDocuments() {
    const tbody = document.getElementById("documents-expiring-body");
    if (!tbody) return;

    refreshExpiringDocuments = async () => {
      window.Admin?.preserveScroll?.(() => {
        renderExpiryStats(null, "loading");
        renderExpiryTableSkeleton(tbody);
      });
      try {
        const res = await apiFetch("/admin/documents/expiring");
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(parseApiDetail(err, "Could not load expiry overview."));
        }
        const data = await res.json();
        const summary = data.summary || {};
        window.Admin?.preserveScroll?.(() => {
          renderExpiryStats(summary, "ok");
        });

        const rows = data.items || [];
        if (!rows.length) {
          renderTableEmptyState(tbody, 5, {
            variant: "ok",
            title: "No expiry dates to track yet",
            message: "Add an expiry date when you upload or link a document — HR alerts appear here automatically.",
          });
          return;
        }

        renderTableBody(tbody, {
          emptyMessage: "No documents with expiry dates yet.",
          columns: [
            { key: "title", render: (row) => `<strong>${escapeHtml(row.title)}</strong>` },
            {
              key: "employee_name",
              render: (row) => escapeHtml(row.employee_name || "Tenant-wide"),
            },
            { key: "category", render: (row) => escapeHtml(categoryLabel(row.category)) },
            {
              key: "expires_at",
              render: (row) => expiryDateMarkup(row),
            },
            { key: "expiry_status", render: (row) => expiryStatusMarkup(row.expiry_status) },
          ],
          rows,
        });
      } catch (error) {
        window.Admin?.preserveScroll?.(() => {
          renderExpiryStats(null, "error");
          renderTableEmptyState(tbody, 5, {
            variant: "error",
            title: "Could not load expiry overview",
            message: friendlyError(error, "The expiry list is unavailable right now."),
            actionHtml: `<button type="button" class="btn outline" data-doc-retry-expiring>Try again</button>`,
          });
        });
        tbody.querySelector("[data-doc-retry-expiring]")?.addEventListener("click", () => {
          void refreshExpiringDocuments();
        });
      }
    };

    await refreshExpiringDocuments();
  }

  async function loadSettingsDocuments() {
    const tbody = document.getElementById("documents-table-body");
    const formHost = document.getElementById("document-form");
    const filtersHost = document.getElementById("document-filters");
    if (!tbody && !formHost) return;

    const firstLoad = document.body.dataset.documentsReady !== "true";
    if (firstLoad) {
      clearDocumentFormStatuses();
      setDocumentsPanelAlert({});
      resetDocumentTabs();
      document.body.dataset.documentsReady = "true";
    }

    if (window.Admin.loadFormOptions) {
      await window.Admin.loadFormOptions();
    }

    bindDocumentTabs();
    applyDocumentUploadPolicy();
    mountUploadForm();
    mountDistributeForm();
    await loadExpiringDocuments();

    document.getElementById("documents-export-csv")?.addEventListener("click", async () => {
      await downloadAuthenticated(
        `/admin/documents/export${buildExportQuery("csv")}`,
        `shiftswift-documents-${window.Admin.TENANT_ID}.csv`
      );
    });
    document.getElementById("documents-export-zip")?.addEventListener("click", async () => {
      await downloadAuthenticated(
        `/admin/documents/export${buildExportQuery("zip")}`,
        `shiftswift-documents-${window.Admin.TENANT_ID}.zip`
      );
    });

    if (filtersHost && !filtersHost.dataset.ready) {
      const categories = window.Admin.formOptions?.document_categories || [];
      const stages = window.Admin.formOptions?.document_lifecycle_stages || [];
      const employees = (window.Admin.formOptions?.employees || [])
        .map((item) => ({
          id: item.value || item.id,
          label: item.label || `${item.first_name || ""} ${item.last_name || ""}`.trim(),
        }))
        .filter((item) => item.id && item.label)
        .sort((a, b) => a.label.localeCompare(b.label, "en"));
      filtersHost.innerHTML = `
        <label class="settings-doc-filter">
          <span class="muted">Employee</span>
          <select id="${FILTER_IDS.employee}">
            <option value="">All employees</option>
            ${employees.map((item) => `<option value="${escapeHtml(String(item.id))}">${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>
        <label class="settings-doc-filter">
          <span class="muted">Category</span>
          <select id="${FILTER_IDS.category}">
            <option value="">All categories</option>
            ${categories.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>
        <label class="settings-doc-filter">
          <span class="muted">Lifecycle stage</span>
          <select id="${FILTER_IDS.stage}">
            <option value="">All stages</option>
            ${stages.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>`;
      filtersHost.dataset.ready = "1";
      filtersHost.querySelectorAll("select").forEach((el) => {
        el.addEventListener("change", () => refreshDocuments());
      });
    }

    const stripHost = document.getElementById(STRIP_LIST_ID);
    if (stripHost) {
      stripHost.hidden = false;
      stripHost.innerHTML = `<p class="muted settings-doc-strip-loading">Loading documents…</p>`;
    }

    refreshDocuments = async () => {
      let loadError = null;
      try {
        const res = await apiFetch(`/admin/documents${buildQuery()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(parseApiDetail(err, "Could not load documents."));
        }
        const data = await res.json();
        const rows = (data.items || []).filter(documentHasAttachment);

        if (!rows.length) {
          const hasFilters = documentsFiltersActive();
          renderDocumentsListState({
            variant: hasFilters ? "empty" : "ok",
            title: hasFilters ? "No documents match these filters" : "No documents stored yet",
            message: hasFilters
              ? "Try a different employee, category, or lifecycle stage, or clear the filters."
              : "Use Upload file above to store PDFs and images, or Link external document for SharePoint and Drive URLs.",
            actionHtml: hasFilters
              ? `<button type="button" class="btn outline" data-doc-clear-filters>Clear filters</button>`
              : `<button type="button" class="btn outline" data-doc-focus-upload>Upload a document</button>`,
          });
          bindDocumentsEmptyActions(document.getElementById(STRIP_LIST_ID));
          lastDocumentRows = null;
          setDocumentsPanelAlert({});
          return;
        }

        lastDocumentRows = rows;
        renderDocumentsStripList(rows);
        setDocumentsPanelAlert({});
      } catch (error) {
        loadError = error;
        renderDocumentsListState({
          variant: "error",
          title: "Could not load documents",
          message: friendlyError(error, "The document list is unavailable right now."),
          actionHtml: `<button type="button" class="btn outline" data-doc-retry-list>Try again</button>`,
        });
        bindDocumentsEmptyActions(document.getElementById(STRIP_LIST_ID));
        lastDocumentRows = null;
      }

      if (loadError) {
        setDocumentsPanelAlert({
          title: "Document lists unavailable",
          message: friendlyError(loadError, "Could not load stored documents."),
          retryLabel: "Reload lists",
          onRetry: () => {
            void refreshDocuments();
            void refreshExpiringDocuments();
          },
        });
      }
    };

    mountLinkForm();
    try {
      await refreshDocuments();
    } catch {
      /* banner + table empty state already shown */
    }
  }

  function mountLinkForm() {
    const formHost = document.getElementById("document-form");
    if (!formHost || formHost.dataset.ready === "1") return;
    formHost.innerHTML = `<p class="muted">Loading form…</p>`;
    mountEditForm(formHost, documentLinkFormSchema(), {
      onSubmit: async (payload) => {
        const res = await apiFetch("/admin/documents", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            document_url: payload.document_url || null,
            notes: payload.notes || null,
            expires_at: payload.expires_at || null,
            employee_id: payload.employee_id || null,
            employee_visible: Boolean(payload.employee_visible),
            expiry_alert_days: Number(payload.expiry_alert_days || 30),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Save failed");
        const linkPrefs = readLinkFormPreferences(formHost.querySelector("form"));
        formHost.querySelector("form")?.reset();
        applyLinkFormPreferences(formHost.querySelector("form"), linkPrefs);
        window.AdminSettings?.showSettingsToast?.("Document link saved ✓");
        await refreshDocuments();
        await refreshExpiringDocuments();
      },
    });
    formHost.dataset.ready = "1";
  }

  window.AdminDocuments = { loadSettingsDocuments, resetDocumentTabs, mountLinkForm };
})();
