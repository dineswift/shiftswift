/** Settings document store — upload, filters, export, edit and delete. */
(function () {
  const { apiFetch, escapeHtml, mountEditForm, renderTableBody, downloadAuthenticated, authHeaders, API_BASE } = window.Admin;

  const FILTER_IDS = {
    category: "document-filter-category",
    stage: "document-filter-stage",
  };

  const TAB_DESCRIPTIONS = {
    upload: "Store a file in secure tenant storage and tag it by employee, category, and expiry.",
    distribute: "Push a file to one or all employees — it appears in their portal and can trigger an email notification.",
    link: "Register an external URL (SharePoint, Google Drive, etc.) without uploading the file to ShiftSwift.",
  };

  let employeeLookup = [];

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
    try {
      await refreshDocuments();
      await refreshExpiringDocuments();
    } catch (error) {
      console.warn("Document list refresh failed:", error);
      if (statusEl) {
        statusEl.textContent = "Uploaded, but the list could not refresh. Reload this page to see it.";
      }
      window.AdminSettings?.showSettingsToast?.("Document saved — reload if the list looks empty.");
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
    if (!employeeId) return "Tenant-wide";
    const match = employeeLookup.find((item) => String(item.id) === String(employeeId));
    if (match?.label) return match.label;
    const option = (window.Admin.formOptions?.employees || []).find(
      (item) => String(item.value || item.id) === String(employeeId)
    );
    return option?.label || `Employee #${employeeId}`;
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

    document.getElementById("document-upload-alert-days")?.addEventListener("change", () => {
      syncExpiryHint("document-upload-alert-days", "document-upload-expiry-hint");
    });
    syncExpiryHint("document-upload-alert-days", "document-upload-expiry-hint");

    bindUploadDropzone();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-status]");
      const employeeSearch = document.getElementById("document-upload-employee-search");
      const employeeIdField = document.getElementById("document-upload-employee-id");
      if (employeeSearch?.value.trim() && !employeeIdField?.value) {
        if (status) {
          status.textContent = "Select an employee from the suggestions, or clear the field for tenant-wide.";
        }
        return;
      }
      const fd = new FormData(form);
      const file = fd.get("file");
      if (!file || (file instanceof File && !file.size)) {
        if (status) status.textContent = "Choose a file to upload.";
        return;
      }
      if (status) status.textContent = "Uploading…";
      const visible = form.querySelector("#document-upload-visible")?.checked ?? false;
      fd.set("employee_visible", visible ? "true" : "false");
      if (!fd.get("employee_id")) fd.delete("employee_id");
      try {
        await uploadMultipart("/admin/documents/upload", fd);
        form.reset();
        document.getElementById("document-upload-employee-id").value = "";
        document.getElementById("document-upload-filename")?.setAttribute("hidden", "");
        syncExpiryHint("document-upload-alert-days", "document-upload-expiry-hint");
        if (status) status.textContent = "Uploaded.";
        window.AdminSettings?.showSettingsToast?.("Document uploaded ✓");
        await refreshDocumentViews(status);
      } catch (error) {
        if (status) status.textContent = error.message || "Upload failed";
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
      if (status) status.textContent = "Uploading…";
      const fd = new FormData(form);
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
          status.textContent = `${data.message || "Distributed."}${emailNote}`;
        }
        window.AdminSettings?.showSettingsToast?.("Document distributed ✓");
        await refreshDocumentViews(status);
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    });

    form.dataset.ready = "true";
  }

  let refreshDocuments = async () => {};
  let refreshExpiringDocuments = async () => {};

  async function loadExpiringDocuments() {
    const tbody = document.getElementById("documents-expiring-body");
    const statsHost = document.getElementById("documents-expiring-stats");
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

        if (statsHost) {
          statsHost.innerHTML = `
            <span class="doc-expiry-stat doc-expiry-stat--danger">${summary.expired || 0} expired</span>
            <span class="doc-expiry-stat doc-expiry-stat--warn">${summary.expiring_soon || 0} expiring soon</span>
            <span class="doc-expiry-stat doc-expiry-stat--ok">${summary.valid || 0} valid</span>`;
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
          rows: data.items || [],
        });
      } catch {
        renderTableBody(tbody, {
          columns: [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }, { key: "e" }],
          rows: [],
          emptyMessage: "Could not load expiry overview.",
        });
        if (statsHost) statsHost.innerHTML = "";
      }
    };

    await refreshExpiringDocuments();
  }

  async function loadSettingsDocuments() {
    const tbody = document.getElementById("documents-table-body");
    const formHost = document.getElementById("document-form");
    const filtersHost = document.getElementById("document-filters");
    if (!tbody && !formHost) return;

    if (window.Admin.loadFormOptions) {
      await window.Admin.loadFormOptions();
    }

    bindDocumentTabs();
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
      try {
        const res = await apiFetch(`/admin/documents${buildQuery()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(parseApiDetail(err, "Could not load documents."));
        }
        const data = await res.json();

        renderTableBody(tbody, {
          emptyMessage: "No documents stored yet.",
          columns: [
            { key: "title", render: (row) => `<strong>${escapeHtml(row.title)}</strong>` },
            { key: "employee_id", render: (row) => escapeHtml(employeeLabel(row.employee_id)) },
            { key: "category", render: (row) => escapeHtml(categoryLabel(row.category)) },
            { key: "lifecycle_stage", render: (row) => escapeHtml(stageLabel(row.lifecycle_stage || "general")) },
            {
              key: "employee_visible",
              render: (row) => (row.employee_visible ? "Yes" : "No"),
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
          rows: data.items || [],
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
      } catch {
        renderTableBody(tbody, {
          columns: [
            { key: "a" },
            { key: "b" },
            { key: "c" },
            { key: "d" },
            { key: "e" },
            { key: "f" },
            { key: "g" },
            { key: "h" },
            { key: "i" },
            { key: "j" },
          ],
          rows: [],
          emptyMessage: "Could not load documents.",
        });
      }
    };

    mountLinkForm();
    await refreshDocuments();
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
