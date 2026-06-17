/** Settings document store — upload, filters, export, edit and delete. */
(function () {
  const { apiFetch, escapeHtml, mountEditForm, renderTableBody, downloadAuthenticated, authHeaders, API_BASE } = window.Admin;

  const FILTER_IDS = {
    category: "document-filter-category",
    stage: "document-filter-stage",
  };

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
      return "Could not reach the server. Check your connection and try again.";
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

  function renderExpiryStats(summary = {}) {
    const statsHost = document.getElementById("documents-expiring-stats");
    const section = document.getElementById("documents-expiring-section");
    const expired = Number(summary.expired) || 0;
    const expiringSoon = Number(summary.expiring_soon) || 0;
    const valid = Number(summary.valid) || 0;

    if (statsHost) {
      statsHost.innerHTML = `
        <span class="doc-expiry-stat doc-expiry-stat--danger">${expired} expired</span>
        <span class="doc-expiry-stat doc-expiry-stat--warn">${expiringSoon} expiring soon</span>
        <span class="doc-expiry-stat doc-expiry-stat--ok">${valid} valid</span>`;
    }

    if (section) {
      section.classList.toggle("settings-doc-expiring--urgent", expired > 0);
      section.classList.toggle("settings-doc-expiring--warn", expired === 0 && expiringSoon > 0);
    }
  }

  function renderDocumentsTableState(tbody, colSpan, { variant = "empty", title, message, actionHtml = "" }) {
    if (!tbody) return;
    const icon = variant === "error" ? "⚠️" : variant === "ok" ? "✓" : "📄";
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="settings-doc-table-empty">
      <div class="settings-doc-empty settings-doc-empty--${variant}">
        <span class="settings-doc-empty__icon" aria-hidden="true">${icon}</span>
        <h5>${escapeHtml(title)}</h5>
        <p>${escapeHtml(message)}</p>
        ${actionHtml}
      </div>
    </td></tr>`;
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

  async function uploadMultipart(path, formData) {
    const res = await window.ShiftSwiftSession.fetchWithAuth(
      path,
      { method: "POST", body: formData },
      { apiBase: API_BASE, tenantId: window.Admin.TENANT_ID }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseApiDetail(data, "Upload failed"));
    return data;
  }

  async function refreshDocumentViews(statusEl) {
    await refreshDocuments().catch(() => {});
    await refreshExpiringDocuments().catch(() => {});

    const alertVisible = document.getElementById("documents-panel-alert") && !document.getElementById("documents-panel-alert").hidden;
    if (alertVisible) {
      console.warn("Document list refresh failed");
      if (statusEl) {
        setFormStatus(statusEl, "Uploaded — refresh the lists below if needed.", "warn");
      }
      window.AdminSettings?.showSettingsToast?.("Document saved — tap Try again if lists look empty.", { variant: "warn" });
      return;
    }

    setDocumentsPanelAlert({});
    if (statusEl) {
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
    if (!row.employee_id) return "All employees";
    return employeeLabel(row.employee_id);
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
    syncUploadNotify(form);
  }

  function mountNotifyEmployeeSelect() {
    const select = document.getElementById("document-upload-notify-employees");
    if (!select || select.dataset.ready === "true") return;
    const employees = (window.Admin.formOptions?.employees || []).filter(
      (item) => item.status === "active" || item.status === "onboarding"
    );
    select.innerHTML = employees
      .map(
        (item) =>
          `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label || `${item.first_name} ${item.last_name}`)}</option>`
      )
      .join("");
    select.dataset.ready = "true";
  }

  function syncUploadNotify(form) {
    const audience = form?.querySelector('input[name="doc_audience"]:checked')?.value || "company";
    const visibleCheck = document.getElementById("document-upload-visible");
    const notifySection = document.getElementById("document-upload-notify-section");
    const notifyCheck = document.getElementById("document-upload-notify");
    const notifyTargets = document.getElementById("document-upload-notify-targets");
    const scopeField = document.getElementById("document-upload-notify-scope-field");
    const selectField = document.getElementById("document-upload-notify-select-field");
    const portalVisible = audience !== "hr" && (visibleCheck?.checked ?? false);

    if (notifySection) notifySection.hidden = !portalVisible;
    if (!portalVisible) return;

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

  function syncExpiryHint(daysInputId, hintId) {
    const daysEl = document.getElementById(daysInputId);
    const hintEl = document.getElementById(hintId);
    if (!hintEl) return;
    hintEl.textContent = expiryHintText(daysEl?.value || 30);
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
    if (category) params.set("category", category);
    if (stage) params.set("lifecycle_stage", stage);
    const query = params.toString();
    return query ? `?${query}` : "";
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
    return {
      id: `document-edit-${row.id}`,
      columns: 2,
      submitLabel: "Update document",
      successMessage: "Document updated.",
      fields: documentLinkFormSchema().fields.concat([
        { name: "original_filename", label: "Original filename", type: "text", placeholder: "contract.pdf" },
      ]),
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
    clearDocumentFormStatuses();
    if (target === "link") {
      mountLinkForm();
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

  function bindUploadDropzone() {
    const dropzone = document.getElementById("document-upload-dropzone");
    const fileInput = document.getElementById("document-upload-file");
    const filenameEl = document.getElementById("document-upload-filename");
    if (!dropzone || !fileInput || dropzone.dataset.ready === "true") return;

    const showFile = (file) => {
      if (!file) {
        filenameEl.hidden = true;
        filenameEl.textContent = "";
        return;
      }
      filenameEl.hidden = false;
      filenameEl.textContent = file.name;
    };

    dropzone.querySelector(".doc-upload-browse")?.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => showFile(fileInput.files?.[0]));

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
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      showFile(file);
    });

    dropzone.dataset.ready = "true";
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
      syncExpiryHint("document-upload-alert-days", "document-upload-expiry-hint");
    });
    syncExpiryHint("document-upload-alert-days", "document-upload-expiry-hint");

    bindUploadDropzone();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
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
            const selectedIds = [...form.querySelectorAll("#document-upload-notify-employees option:checked")].map(
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
        form.reset();
        document.getElementById("document-upload-employee-id").value = "";
        document.getElementById("document-upload-filename")?.setAttribute("hidden", "");
        syncExpiryHint("document-upload-alert-days", "document-upload-expiry-hint");
        syncUploadAudience(form);
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
      const employees = (window.Admin.formOptions?.employees || []).filter(
        (item) => item.status === "active" || item.status === "onboarding"
      );
      employeeSelect.innerHTML =
        `<option value="">All active employees</option>` +
        employees
          .map(
            (item) =>
              `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label || `${item.first_name} ${item.last_name}`)}</option>`
          )
          .join("");
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
      const showFile = (file) => {
        if (!filenameEl) return;
        if (!file) {
          filenameEl.hidden = true;
          filenameEl.textContent = "";
          return;
        }
        filenameEl.hidden = false;
        filenameEl.textContent = file.name;
      };
      dropzone.querySelector("[data-distribute-browse]")?.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => showFile(fileInput.files?.[0]));
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
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        showFile(file);
      });
      dropzone.dataset.ready = "true";
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
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
      try {
        const data = await uploadMultipart("/admin/documents/distribute", fd);
        form.reset();
        if (filenameEl) {
          filenameEl.hidden = true;
          filenameEl.textContent = "";
        }
        syncPayPeriodRequired();
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
      try {
        const res = await apiFetch("/admin/documents/expiring");
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(parseApiDetail(err, "Could not load expiry overview."));
        }
        const data = await res.json();
        const summary = data.summary || {};
        renderExpiryStats(summary);

        const rows = data.items || [];
        if (!rows.length) {
          renderDocumentsTableState(tbody, 5, {
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
        renderExpiryStats({});
        renderDocumentsTableState(tbody, 5, {
          variant: "error",
          title: "Could not load expiry overview",
          message: friendlyError(error, "The expiry list is unavailable right now."),
          actionHtml: `<button type="button" class="btn outline" data-doc-retry-expiring>Try again</button>`,
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

    clearDocumentFormStatuses();
    setDocumentsPanelAlert({});

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
      filtersHost.innerHTML = `
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

    refreshDocuments = async () => {
      let loadError = null;
      try {
        const res = await apiFetch(`/admin/documents${buildQuery()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(parseApiDetail(err, "Could not load documents."));
        }
        const data = await res.json();
        const rows = data.items || [];

        if (!rows.length) {
          const hasFilters = Boolean(
            document.getElementById(FILTER_IDS.category)?.value || document.getElementById(FILTER_IDS.stage)?.value
          );
          renderDocumentsTableState(tbody, 10, {
            variant: hasFilters ? "empty" : "ok",
            title: hasFilters ? "No documents match these filters" : "No documents stored yet",
            message: hasFilters
              ? "Try a different category or lifecycle stage, or clear the filters."
              : "Use Upload file above to store PDFs and images, or Link external document for SharePoint and Drive URLs.",
            actionHtml: hasFilters
              ? `<button type="button" class="btn outline" data-doc-clear-filters>Clear filters</button>`
              : `<button type="button" class="btn outline" data-doc-focus-upload>Upload a document</button>`,
          });
          tbody.querySelector("[data-doc-clear-filters]")?.addEventListener("click", () => {
            const categoryEl = document.getElementById(FILTER_IDS.category);
            const stageEl = document.getElementById(FILTER_IDS.stage);
            if (categoryEl) categoryEl.value = "";
            if (stageEl) stageEl.value = "";
            void refreshDocuments();
          });
          tbody.querySelector("[data-doc-focus-upload]")?.addEventListener("click", () => {
            activateDocumentTab("upload");
            document.getElementById("document-upload-dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
          setDocumentsPanelAlert({});
          return;
        }

        renderTableBody(tbody, {
          emptyMessage: "No documents stored yet.",
          columns: [
            { key: "title", render: (row) => `<strong>${escapeHtml(row.title)}</strong>` },
            { key: "audience", render: (row) => escapeHtml(audienceLabel(row)) },
            { key: "category", render: (row) => escapeHtml(categoryLabel(row.category)) },
            { key: "lifecycle_stage", render: (row) => escapeHtml(stageLabel(row.lifecycle_stage || "general")) },
            {
              key: "employee_visible",
              render: (row) => portalVisibilityMarkup(row),
            },
            {
              key: "has_file",
              render: (row) =>
                row.has_file
                  ? `<button type="button" class="btn ghost" data-download-doc="${row.id}">Download</button>`
                  : "<span class='muted'>No file</span>",
            },
            {
              key: "document_url",
              render: (row) =>
                row.document_url
                  ? `<a href="${escapeHtml(row.document_url)}" target="_blank" rel="noopener">Open link</a>`
                  : "<span class='muted'>None</span>",
            },
            {
              key: "expires_at",
              render: (row) => expiryDateMarkup(row),
            },
            { key: "created_at", render: (row) => escapeHtml((row.created_at || "").slice(0, 10)) },
            {
              key: "actions",
              render: (row) =>
                `<div class="table-actions">
                  <button type="button" class="btn ghost" data-edit-doc="${row.id}">Edit</button>
                  <button type="button" class="btn ghost" data-delete-doc="${row.id}">Remove</button>
                </div>`,
            },
          ],
          rows,
        });

        tbody.querySelectorAll("[data-download-doc]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const row = (data.items || []).find((item) => String(item.id) === btn.dataset.downloadDoc);
            const name = row?.original_filename || `${row?.title || "document"}.bin`;
            await downloadAuthenticated(`/admin/documents/${btn.dataset.downloadDoc}/file`, name);
          });
        });

        tbody.querySelectorAll("[data-delete-doc]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!window.confirm("Remove this document record?")) return;
            const res = await apiFetch(`/admin/documents/${btn.dataset.deleteDoc}`, { method: "DELETE" });
            if (!res.ok) {
              const err = await res.json();
              alert(err.detail || "Delete failed");
              return;
            }
            await refreshDocuments();
            await refreshExpiringDocuments();
          });
        });

        tbody.querySelectorAll("[data-edit-doc]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const row = (data.items || []).find((item) => String(item.id) === btn.dataset.editDoc);
            if (!row) return;
            const host = document.getElementById("document-edit-panel");
            if (!host) return;
            host.hidden = false;
            host.innerHTML = `<h4>Edit document</h4><div id="document-edit-form"></div>`;
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
                notes: row.notes || "",
              },
              onSubmit: async (payload) => {
                const res = await apiFetch(`/admin/documents/${row.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    ...payload,
                    document_url: payload.document_url || null,
                    notes: payload.notes || null,
                    expires_at: payload.expires_at || null,
                    original_filename: payload.original_filename || null,
                    employee_id: payload.employee_id || null,
                    employee_visible: Boolean(payload.employee_visible),
                  }),
                });
                const body = await res.json();
                if (!res.ok) throw new Error(body.detail || "Update failed");
                host.hidden = true;
                await refreshDocuments();
                await refreshExpiringDocuments();
              },
            });
          });
        });
        setDocumentsPanelAlert({});
      } catch (error) {
        loadError = error;
        renderDocumentsTableState(tbody, 10, {
          variant: "error",
          title: "Could not load documents",
          message: friendlyError(error, "The document list is unavailable right now."),
          actionHtml: `<button type="button" class="btn outline" data-doc-retry-list>Try again</button>`,
        });
        tbody.querySelector("[data-doc-retry-list]")?.addEventListener("click", () => {
          void refreshDocuments();
        });
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
        formHost.querySelector("form")?.reset();
        window.AdminSettings?.showSettingsToast?.("Document link saved ✓");
        await refreshDocuments();
        await refreshExpiringDocuments();
      },
    });
    formHost.dataset.ready = "1";
  }

  window.AdminDocuments = { loadSettingsDocuments, resetDocumentTabs, mountLinkForm };
})();
