/** Right to Work workspace — stats, filters, table, detail panel. */
(function initAdminRtwWorkspace() {
  const { apiFetch, escapeHtml, downloadAuthenticated, parseHashBaseSection, parseApiDetail, readApiError, authHeaders, API_BASE } = window.Admin;

  let sectionReady = false;
  let rtwItems = [];
  let rtwStats = { total: 0, verified: 0, expiring_soon: 0, needs_review: 0 };
  let activeFilter = "all";
  let searchQuery = "";
  let selectedCheckId = null;

  const AVATAR_PALETTES = [
    { bg: "#E1F5EE", color: "#0F6E56" },
    { bg: "#E6F1FB", color: "#185FA5" },
    { bg: "#FAEEDA", color: "#854F0B" },
    { bg: "#FBEAF0", color: "#993556" },
  ];

  function avatarStyle(employeeId) {
    const palette = AVATAR_PALETTES[Math.abs(Number(employeeId)) % AVATAR_PALETTES.length];
    return palette;
  }

  function employeeInitials(name) {
    const parts = String(name || "").trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).toUpperCase() || "?";
  }

  function formatDate(iso) {
    if (window.Admin?.formatDisplayDate) return window.Admin.formatDisplayDate(iso);
    if (!iso) return "—";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(iso).slice(0, 10))
      ? new Date(`${String(iso).slice(0, 10)}T12:00:00`)
      : new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function statusLabel(status) {
    if (status === "verified") return "Verified";
    if (status === "expiring_soon") return "Expiring soon";
    if (status === "superseded") return "Previous";
    return "Needs review";
  }

  function statusClass(status) {
    if (status === "verified") return "rtw-status-pill rtw-status-pill--ok";
    if (status === "expiring_soon") return "rtw-status-pill rtw-status-pill--warn";
    if (status === "superseded") return "rtw-status-pill rtw-status-pill--off";
    return "rtw-status-pill rtw-status-pill--danger";
  }

  const KIND_FILTERS = new Set(["passport", "visa", "rtw_check"]);
  const EMPTY_LIST_MESSAGE =
    "No passport, BRP, visa or right-to-work records yet. Save them on the employee file or add an RTW check above.";

  function sameRecordId(a, b) {
    return String(a ?? "") === String(b ?? "");
  }

  function rowRecordedIso(item) {
    if (!item) return null;
    if (item.document_kind === "passport") return item.issued_at || item.document_issue_date || item.check_date;
    if (item.document_kind === "visa") return item.visa_start_date || item.issued_at || item.check_date;
    return item.recorded_at || item.check_date;
  }

  function rowExpiryIso(item) {
    if (!item) return null;
    if (item.document_kind === "passport") return item.document_expiry_date || item.expiry_date;
    if (item.document_kind === "visa") {
      return item.visa_expiry_date || item.document_expiry_date || item.expiry_date;
    }
    return item.rtw_check_expiry_date || item.document_expiry_date || item.expiry_date;
  }

  function rowDatesSummary(item) {
    const start = formatDate(rowRecordedIso(item));
    const end = formatDate(rowExpiryIso(item));
    if (item.document_kind === "passport") {
      return start !== "—" ? `Issued ${start} · Expires ${end}` : `Expires ${end}`;
    }
    if (item.document_kind === "visa") {
      if (start !== "—" && end !== "—") return `${start} – ${end}`;
      if (end !== "—") return `Ends ${end}`;
      return start !== "—" ? `Start ${start}` : "No visa dates";
    }
    return start !== "—" ? `Taken ${start}${end !== "—" ? ` · Expires ${end}` : ""}` : `Expires ${end}`;
  }

  function detailDateRows(item) {
    const startLabel = dateOnFileLabel(item);
    const expiryLabel = expiryOnFileLabel(item);
    return `
        <div><dt>${escapeHtml(startLabel)}</dt><dd>${escapeHtml(formatDate(rowRecordedIso(item)))}</dd></div>
        <div><dt>${escapeHtml(expiryLabel)}</dt><dd class="${expiryClass(item)}">${escapeHtml(formatDate(rowExpiryIso(item)))}</dd></div>`;
  }

  function downloadPathFor(item) {
    return item?.download_path || `/compliance/sponsor-licence/rtw-checks/${item?.id}/file`;
  }

  function expiryClass(item) {
    return dateExpiryClass(rowExpiryIso(item));
  }

  function dateExpiryClass(iso) {
    if (!iso) return "";
    const days = Math.round((new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 86400000);
    if (Number.isNaN(days)) return "";
    if (days < 0) return "rtw-expiry rtw-expiry--danger";
    if (days <= 30) return "rtw-expiry rtw-expiry--warn";
    return "";
  }

  function filteredItems() {
    const q = searchQuery.trim().toLowerCase();
    return rtwItems.filter((item) => {
      if (KIND_FILTERS.has(activeFilter) && item.document_kind !== activeFilter) return false;
      if (activeFilter === "sponsored" && !item.is_sponsored) return false;
      if (
        !KIND_FILTERS.has(activeFilter) &&
        activeFilter !== "all" &&
        activeFilter !== "sponsored" &&
        item.status !== activeFilter
      ) {
        return false;
      }
      if (!q) return true;
      const haystack = `${item.employee_name} ${item.employee_short_name} ${item.document_type} ${item.document_title || ""} ${item.title || ""} ${item.filename || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  function isMobileView() {
    return window.isShiftSwiftMobileViewport?.() ?? window.matchMedia("(max-width: 860px)").matches;
  }

  function emptyStateHtml(message) {
    return `<div class="compliance-empty-state">
      <span class="compliance-empty-state__icon" aria-hidden="true">${window.AdminIcons?.svg?.("document") || "📄"}</span>
      <p>${escapeHtml(message)}</p>
    </div>`;
  }

  function kindClass(kind) {
    if (kind === "passport") return "passport";
    if (kind === "visa") return "visa";
    return "rtw";
  }

  function dateOnFileLabel(item) {
    if (item?.date_label) return item.date_label;
    if (item?.document_kind === "passport") return "Issue date";
    if (item?.document_kind === "visa") return "Visa start date";
    return "Date taken";
  }

  function expiryOnFileLabel(item) {
    if (item?.expiry_label) return item.expiry_label;
    if (item?.document_kind === "passport") return "Expiry date";
    if (item?.document_kind === "visa") return "End date";
    return "RTW expiry date";
  }

  function documentCell(item) {
    const type = item.document_type || "Document";
    const title = String(item.document_title || item.filename || "").trim();
    const extra = title && title.toLowerCase() !== type.toLowerCase()
      ? `<span class="rtw-doc-file">${escapeHtml(title)}</span>`
      : "";
    const previous = item.superseded
      ? `<span class="rtw-doc-previous muted">Previous version</span>`
      : "";
    return `<div class="rtw-doc-cell">
      <span class="rtw-kind-tag rtw-kind-tag--${kindClass(item.document_kind)}">${escapeHtml(type)}</span>
      ${extra}
      ${previous}
    </div>`;
  }

  function renderKindSummary() {
    const el = document.getElementById("rtw-kind-summary");
    if (!el) return;
    if (!rtwItems.length) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    const passports = rtwStats.passports ?? rtwItems.filter((item) => item.document_kind === "passport").length;
    const visas = rtwStats.visa_brp ?? rtwItems.filter((item) => item.document_kind === "visa").length;
    const checks = rtwStats.rtw_checks ?? rtwItems.filter((item) => item.document_kind === "rtw_check").length;
    el.hidden = false;
    el.textContent = `${passports} passport / ID · ${visas} visa / BRP · ${checks} right to work`;
  }

  function renderStats() {
    document.getElementById("rtw-stat-total").textContent = String(rtwStats.total ?? 0);
    document.getElementById("rtw-stat-verified").textContent = String(rtwStats.verified ?? 0);
    document.getElementById("rtw-stat-expiring").textContent = String(rtwStats.expiring_soon ?? 0);
    document.getElementById("rtw-stat-review").textContent = String(rtwStats.needs_review ?? 0);
    updateReviewStatTone(rtwStats.needs_review ?? 0);
    renderKindSummary();
    window.dispatchEvent(new CustomEvent("admin:rtw-stats", { detail: { stats: rtwStats } }));
  }

  function updateReviewStatTone(count) {
    const valueEl = document.getElementById("rtw-stat-review");
    const card = valueEl?.closest(".rtw-stat-card");
    if (!card) return;
    const hint = card.querySelector(".rtw-stat-card__hint");
    const review = Number(count) || 0;
    card.classList.remove("rtw-stat-card--danger", "rtw-stat-card--clear");
    if (review > 0) {
      card.classList.add("rtw-stat-card--danger");
      if (hint) hint.textContent = "Action required";
    } else {
      card.classList.add("rtw-stat-card--clear");
      if (hint) hint.textContent = "All clear";
    }
  }

  function renderMobileCards() {
    const host = document.getElementById("rtw-mobile-cards");
    if (!host) return;
    const rows = filteredItems();
    if (!rows.length) {
      const message =
        rtwItems.length === 0
          ? EMPTY_LIST_MESSAGE
          : "No RTW records match this filter.";
      host.innerHTML = emptyStateHtml(message);
      host.hidden = false;
      return;
    }
    host.hidden = false;
    host.innerHTML = rows
      .map((item) => {
        const palette = avatarStyle(item.employee_id);
        const selected = sameRecordId(selectedCheckId, item.id) ? " is-selected" : "";
        return `<button type="button" class="rtw-record-card${selected}${item.superseded ? " is-superseded" : ""}" data-rtw-id="${escapeHtml(String(item.id))}">
          <span class="rtw-record-card__avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(employeeInitials(item.employee_name))}</span>
          <span class="rtw-record-card__body">
            <span class="rtw-record-card__name">${escapeHtml(item.employee_short_name || item.employee_name)}</span>
            <span class="rtw-record-card__meta muted">${escapeHtml(item.document_type)} · ${escapeHtml(rowDatesSummary(item))}</span>
          </span>
          <span class="${statusClass(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
        </button>`;
      })
      .join("");

    host.querySelectorAll(".rtw-record-card").forEach((card) => {
      card.addEventListener("click", () => selectCheck(card.getAttribute("data-rtw-id")));
    });
  }

  function renderTable() {
    const tbody = document.getElementById("rtw-table-body");
    if (tbody) {
      const rows = filteredItems();
      if (!rows.length) {
        const message =
          rtwItems.length === 0
            ? EMPTY_LIST_MESSAGE
            : "No RTW records match this filter.";
        tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml(message)}</td></tr>`;
      } else {
        tbody.innerHTML = rows
          .map((item) => {
            const palette = avatarStyle(item.employee_id);
            const selected = sameRecordId(selectedCheckId, item.id) ? " is-selected" : "";
            const sponsoredTag = item.is_sponsored
              ? `<span class="rtw-sponsored-tag">Sponsored</span>`
              : `<span class="rtw-standard-tag">Standard</span>`;
            return `<tr class="rtw-table-row${selected}${item.superseded ? " is-superseded" : ""}" data-rtw-id="${escapeHtml(String(item.id))}" tabindex="0">
          <td>
            <div class="rtw-employee-cell">
              <span class="rtw-employee-avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(employeeInitials(item.employee_name))}</span>
              <span>
                <span class="rtw-employee-name">${escapeHtml(item.employee_short_name || item.employee_name)}</span>
                <span class="rtw-employee-meta">${escapeHtml(item.employee_role)} · ${sponsoredTag}</span>
              </span>
            </div>
          </td>
          <td>${documentCell(item)}</td>
          <td>
            <span class="rtw-date-cell">
              <span class="muted rtw-date-cell__label">${escapeHtml(dateOnFileLabel(item))}</span>
              ${escapeHtml(formatDate(rowRecordedIso(item)))}
            </span>
          </td>
          <td>
            <span class="rtw-date-cell ${expiryClass(item)}">
              <span class="muted rtw-date-cell__label">${escapeHtml(expiryOnFileLabel(item))}</span>
              ${escapeHtml(formatDate(rowExpiryIso(item)))}
            </span>
          </td>
          <td><span class="${statusClass(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
        </tr>`;
          })
          .join("");

        tbody.querySelectorAll(".rtw-table-row").forEach((row) => {
          const open = () => selectCheck(row.getAttribute("data-rtw-id"));
          row.addEventListener("click", open);
          row.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          });
        });
      }
    }
    if (isMobileView()) renderMobileCards();
    else {
      const host = document.getElementById("rtw-mobile-cards");
      if (host) host.hidden = true;
    }
  }

  function expiryAlertHtml(iso, expiredText, soonText) {
    if (!iso) return "";
    const days = Math.round((new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 86400000);
    if (Number.isNaN(days) || days > 30) return "";
    const when = formatDate(iso);
    if (days < 0) {
      return `<div class="rtw-detail-alert rtw-detail-alert--danger">${expiredText(when)}</div>`;
    }
    return `<div class="rtw-detail-alert rtw-detail-alert--warn">${soonText(when, days)}</div>`;
  }

  function renderDetailAlert(item) {
    if (item.superseded) {
      return `<div class="rtw-detail-alert rtw-detail-alert--off">This is a previous version. A later follow-up for the same document is now the current review. The file stays on record.</div>`;
    }
    const alerts = [];
    const documentIso = item.document_expiry_date || (item.document_kind === "passport" ? item.expiry_date : null);
    if (item.document_kind === "passport" && documentIso) {
      alerts.push(
        expiryAlertHtml(
          documentIso,
          (when) => `Passport / ID expired on ${escapeHtml(when)}. Update the identity document immediately.`,
          (when, days) =>
            `Passport / ID expires ${escapeHtml(when)} — ${escapeHtml(String(days))} day${days === 1 ? "" : "s"} remaining.`
        )
      );
    }
    const visaIso = item.visa_expiry_date;
    if (visaIso && visaIso !== documentIso) {
      alerts.push(
        expiryAlertHtml(
          visaIso,
          (when) => `Visa expired on ${escapeHtml(when)}. Update the visa record immediately.`,
          (when, days) =>
            `Visa expires ${escapeHtml(when)} — ${escapeHtml(String(days))} day${days === 1 ? "" : "s"} remaining.`
        )
      );
    }
    const rtwIso = item.rtw_check_expiry_date || (item.document_kind === "rtw_check" ? item.expiry_date : null);
    if (rtwIso && item.status !== "verified") {
      const days = item.days_until_expiry;
      const when = formatDate(rtwIso);
      if (item.status === "needs_review" && days !== null && days < 0) {
        alerts.push(
          `<div class="rtw-detail-alert rtw-detail-alert--danger">${escapeHtml(item.document_type || "RTW check")} expired on ${escapeHtml(when)}. Schedule a re-check immediately.</div>`
        );
      } else {
        const daysText = days !== null ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days < 0 ? "overdue" : "remaining"}` : "";
        const tone = item.status === "needs_review" ? "danger" : "warn";
        alerts.push(
          `<div class="rtw-detail-alert rtw-detail-alert--${tone}">${escapeHtml(item.document_type || "RTW check")} expires ${escapeHtml(when)}${daysText ? ` — ${escapeHtml(daysText)}` : ""}. Review this record before the date.</div>`
        );
      }
    }
    return alerts.filter(Boolean).join("");
  }

  function evidenceDropzoneHtml({ required = false, hint, name = "file" }) {
    return `<div class="doc-upload-dropzone doc-upload-dropzone--compact rtw-evidence-dropzone">
      <input name="${name}" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"${required ? " required" : ""} hidden />
      <input type="file" data-rtw-camera accept="image/*" capture="environment" hidden />
      <p class="doc-upload-dropzone__lead">Drag &amp; drop here, or <button type="button" class="doc-upload-browse">browse</button><span class="doc-upload-dropzone__or" aria-hidden="true"> · </span><button type="button" class="doc-upload-camera">take photo</button></p>
      <p class="doc-upload-dropzone__hint muted">${hint}</p>
      <p class="doc-upload-filename" hidden></p>
    </div>`;
  }

  function bindEvidenceDropzone(root, { onFile } = {}) {
    const dropzone = root?.querySelector(".rtw-evidence-dropzone") || root;
    const fileInput = dropzone?.querySelector('input[type="file"]:not([data-rtw-camera])');
    if (!dropzone || !fileInput) return;
    window.AdminDocuments?.bindFileDropzone?.({
      dropzone,
      fileInput,
      filenameEl: dropzone.querySelector(".doc-upload-filename"),
      cameraInput: dropzone.querySelector("[data-rtw-camera]"),
    });
    const handle = async () => {
      let file = window.AdminDocuments?.readSelectedFile?.(fileInput) || fileInput.files?.[0];
      if (!file) return;
      try {
        file = await window.AdminDocuments.prepareUploadFile(file);
      } catch (error) {
        window.Admin?.showAdminToast?.(error.message || "Choose a JPEG or PNG photo.", { variant: "error" });
        return;
      }
      onFile?.(file, fileInput);
    };
    fileInput.addEventListener("change", () => {
      void handle();
    });
  }

  function categoryForRtwUpload(item) {
    if (item?.category) return item.category;
    if (item?.document_kind === "passport") return "id";
    if (item?.document_kind === "visa") return "visa_brp";
    return "rtw";
  }

  async function uploadIdentityEvidence(item, file) {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("title", item.document_title || item.document_type || file.name || "Identity document");
    fd.set("category", categoryForRtwUpload(item));
    fd.set("employee_visible", "false");
    if (item.issued_at) fd.set("issued_at", String(item.issued_at).slice(0, 10));
    if (item.recorded_at) fd.set("recorded_at", String(item.recorded_at).slice(0, 10));
    if (item.expiry_date) fd.set("expires_at", String(item.expiry_date).slice(0, 10));
    const res = await fetch(`${API_BASE}/admin/employees/${item.employee_id}/documents/upload`, {
      method: "POST",
      headers: authHeaders(false),
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseApiDetail(data, "Upload failed"));
    return data;
  }

  function closeDetailPanel() {
    selectedCheckId = null;
    const panel = document.getElementById("rtw-detail-panel");
    panel?.setAttribute("hidden", "");
    document.querySelector(".rtw-workspace-layout")?.classList.remove("is-detail-open");
    renderTable();
  }

  function renderDetailPanel(item) {
    const panel = document.getElementById("rtw-detail-panel");
    const content = document.getElementById("rtw-detail-content");
    const title = document.getElementById("rtw-detail-title");
    const statusEl = document.getElementById("rtw-detail-status");
    if (!panel || !content || !item) return;
    panel.hidden = false;
    document.querySelector(".rtw-workspace-layout")?.classList.add("is-detail-open");
    if (title) title.textContent = item.document_type || "Record";
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.className = statusClass(item.status);
      statusEl.textContent = statusLabel(item.status);
    }
    const workerType = item.is_sponsored ? "Sponsored worker" : "Standard worker";
    const fileName = item.filename || item.document_title || "document";
    const identityRecord = !item.immutable_locked && item.document_kind !== "rtw_check";
    const docs = (item.documents || [{ filename: fileName, uploaded_at: item.check_date }])
      .map(
        (doc) => `<li class="rtw-doc-item">
          <div class="rtw-doc-item__text">
            <strong>${escapeHtml(doc.filename || fileName)}</strong>
            <span class="muted">Saved ${escapeHtml(formatDate(doc.uploaded_at || item.check_date))}</span>
          </div>
          <button type="button" class="btn outline btn-sm" data-rtw-download="${escapeHtml(String(item.id))}">Download file</button>
        </li>`
      )
      .join("");
    const lockNote = item.immutable_locked
      ? `<p class="rtw-detail-lock muted"><strong>Immutable RTW check.</strong> Saved ${escapeHtml(formatDate(item.created_at?.slice(0, 10) || item.check_date))} by ${escapeHtml(item.checker_user_id || "admin")}. This file cannot be edited or deleted.</p>`
      : `<p class="rtw-detail-lock muted">You can add another scan or photo here — it is saved on the employee record.</p>`;
    const extraAction = identityRecord
      ? `${evidenceDropzoneHtml({ hint: "PDF, JPEG or PNG · max 10 MB · saves to this employee’s file" })}
         <a class="btn outline rtw-detail-employee-link" href="#employees/${escapeHtml(String(item.employee_id))}/document_store">Open employee file</a>`
      : `<div class="doc-upload-dropzone doc-upload-dropzone--compact" id="rtw-supplement-dropzone">
        <input type="file" id="rtw-supplement-file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" data-rtw-supplement="${item.employee_id}" hidden />
        <input type="file" id="rtw-supplement-camera" accept="image/*" capture="environment" hidden />
        <p class="doc-upload-dropzone__lead">Drop evidence here, or <button type="button" class="doc-upload-browse">browse</button><span class="doc-upload-dropzone__or" aria-hidden="true"> · </span><button type="button" class="doc-upload-camera">take photo</button></p>
        <p class="muted rtw-upload-zone__hint">PDF, JPEG or PNG · max 10 MB · creates a new immutable RTW check</p>
        <p class="doc-upload-filename" id="rtw-supplement-filename" hidden></p>
      </div>`;

    content.innerHTML = `
      ${renderDetailAlert(item)}
      <div class="rtw-detail-employee">
        <strong>${escapeHtml(item.employee_name)}</strong>
        <span class="muted">${escapeHtml(item.employee_role || "Staff")} · ${escapeHtml(workerType)}</span>
      </div>
      <dl class="rtw-detail-meta">
        <div><dt>Document</dt><dd>${escapeHtml(item.document_type)}</dd></div>
        ${detailDateRows(item)}
        <div><dt>Uploaded by</dt><dd>${escapeHtml(item.checker_user_id || "—")}</dd></div>
        <div class="rtw-detail-meta__wide"><dt>File name</dt><dd>${escapeHtml(item.document_title || fileName)}</dd></div>
      </dl>
      <div class="rtw-detail-docs">
        <h5>Saved file</h5>
        <ul class="rtw-doc-list">${docs}</ul>
      </div>
      ${extraAction}
      ${lockNote}`;

    content.querySelector("[data-rtw-download]")?.addEventListener("click", () => {
      downloadAuthenticated(downloadPathFor(item), item.filename || `rtw-record-${item.id}`);
    });

    if (identityRecord) {
      bindEvidenceDropzone(content, {
        onFile: async (file) => {
          try {
            await uploadIdentityEvidence(item, file);
            window.Admin?.showAdminToast?.("Document uploaded.", { variant: "ok" });
            await loadRtwRecords();
            if (selectedCheckId) await selectCheck(selectedCheckId);
          } catch (error) {
            window.Admin?.showAdminToast?.(error.message || "Upload failed.", { variant: "error" });
          }
        },
      });
    } else {
      const fileInput = content.querySelector("[data-rtw-supplement]");
      window.AdminDocuments?.bindFileDropzone?.({
        dropzone: content.querySelector("#rtw-supplement-dropzone"),
        fileInput,
        filenameEl: content.querySelector("#rtw-supplement-filename"),
        cameraInput: content.querySelector("#rtw-supplement-camera"),
        onFile: (file) => openRecheckPanel(item.employee_id, file),
      });
    }
  }

  async function selectCheck(checkId) {
    selectedCheckId = checkId;
    renderTable();
    try {
      const res = await apiFetch(`/compliance/sponsor-licence/rtw-checks/${encodeURIComponent(checkId)}`);
      if (!res.ok) throw new Error("Could not load record");
      const item = await res.json();
      const listed = rtwItems.find((row) => sameRecordId(row.id, checkId));
      if (listed?.superseded) {
        item.superseded = true;
        item.is_current = false;
        item.superseded_by_id = listed.superseded_by_id;
        item.status = "superseded";
      }
      renderDetailPanel(item);
    } catch {
      const fallback = rtwItems.find((row) => sameRecordId(row.id, checkId));
      if (fallback) renderDetailPanel(fallback);
    }
  }

  function setAddCheckEmployee(employeeId, { followUp = false } = {}) {
    const id = employeeId == null || employeeId === "" ? "" : String(employeeId);
    const selects = document.querySelectorAll(
      "#rtw-upload [name='employee_id'], #share-code-form [name='employee_id']"
    );
    if (id && !selects.length) {
      window.setTimeout(() => setAddCheckEmployee(employeeId, { followUp }), 80);
      return;
    }
    selects.forEach((el) => {
      el.value = id;
    });
    const method = document.querySelector("#rtw-upload [name='check_method']");
    if (method && followUp && [...method.options].some((opt) => opt.value === "Follow-up check")) {
      method.value = "Follow-up check";
    }
    const heading = document.querySelector("#rtw-add-panel h4");
    if (heading) heading.textContent = id ? "Add another RTW check" : "Add RTW check";
    document.querySelector("#rtw-upload [name='employee_id']")?.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clearRtwAddStatus() {
    document.querySelectorAll("#rtw-add-panel [data-status]").forEach((el) => {
      el.textContent = "";
    });
    const result = document.getElementById("share-code-result");
    if (result) {
      result.hidden = true;
      result.innerHTML = "";
    }
  }

  function openRecheckPanel(employeeId, file = null) {
    const panel = document.getElementById("rtw-add-panel");
    panel?.removeAttribute("hidden");
    document.querySelector('[data-rtw-add-method="upload"]')?.click();
    clearRtwAddStatus();
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    const alreadyHasCheck = rtwItems.some(
      (row) =>
        String(row.employee_id) === String(employeeId) &&
        (row.document_kind === "rtw_check" || row.immutable_locked)
    );
    setAddCheckEmployee(employeeId, { followUp: alreadyHasCheck });
    const fileInput = document.querySelector("#rtw-upload-file") || document.querySelector("#rtw-upload input[name='evidence_pdf']");
    if (fileInput && file) {
      fileInput._sshrPendingFile = file;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
      } catch {
        /* iOS WKWebView often rejects DataTransfer assignment. */
      }
      const filenameEl = document.getElementById("rtw-upload-filename");
      if (filenameEl) {
        filenameEl.hidden = false;
        filenameEl.textContent = file.name || "Photo capture";
      }
    }
  }

  async function loadRtwRecords() {
    const tbody = document.getElementById("rtw-table-body");
    const cardsHost = document.getElementById("rtw-mobile-cards");
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted">Loading identity and right-to-work records…</td></tr>`;
    if (cardsHost) cardsHost.innerHTML = `<p class="muted">Loading RTW records…</p>`;
    try {
      const res = await apiFetch("/compliance/sponsor-licence/rtw-checks");
      if (!res.ok) throw new Error(await readApiError(res, "Could not load RTW records"));
      const data = await res.json();
      rtwItems = data.items || [];
      rtwStats = data.stats || rtwStats;
      renderStats();
      renderTable();
      if (selectedCheckId && rtwItems.some((item) => sameRecordId(item.id, selectedCheckId))) {
        await selectCheck(selectedCheckId);
      } else {
        selectedCheckId = null;
        closeDetailPanel();
      }
    } catch (error) {
      rtwItems = [];
      rtwStats = { total: 0, verified: 0, expiring_soon: 0, needs_review: 0 };
      renderStats();
      const message = error?.message || "Could not load RTW records. Try again.";
      if (tbody) tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml(message)}</td></tr>`;
      if (cardsHost) {
        cardsHost.hidden = false;
        cardsHost.innerHTML = emptyStateHtml(message);
      }
    }
  }

  async function tryLoadRtwRecords() {
    const content = document.getElementById("compliance-tools-content");
    if (content?.hasAttribute("hidden")) return;
    await loadRtwRecords();
  }

  function exportAllRecords() {
    const blob = new Blob([JSON.stringify({ stats: rtwStats, items: rtwItems }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rtw-records-tenant-${window.Admin.TENANT_ID}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function sendReminder() {
    if (!selectedCheckId) return;
    const btn = document.getElementById("rtw-send-reminder-btn");
    const run = window.ShiftSwiftAction?.runButtonActionAuto;
    const action = async () => {
      const res = await apiFetch(`/compliance/sponsor-licence/rtw-checks/${encodeURIComponent(selectedCheckId)}/send-reminder`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(parseApiDetail(data, "Could not send reminder"));
      return data.message || "Reminder queued.";
    };
    if (run && btn) {
      await run(btn, action, {
        loadingLabel: "Sending…",
        successMessage: "Reminder queued.",
        successLabel: "Sent",
      });
      return;
    }
    try {
      await action();
    } catch (error) {
      window.ShiftSwiftAction?.showActionToast?.(error.message || "Could not send reminder.", "error");
    }
  }

  function bindRtwWorkspace() {
    if (document.body.dataset.rtwWorkspaceBound === "true") return;
    document.body.dataset.rtwWorkspaceBound = "true";

    document.getElementById("rtw-export-all-btn")?.addEventListener("click", exportAllRecords);
    document.getElementById("rtw-add-check-btn")?.addEventListener("click", () => {
      const item = rtwItems.find((row) => sameRecordId(row.id, selectedCheckId));
      openRecheckPanel(item?.employee_id);
    });
    document.getElementById("rtw-add-panel-close")?.addEventListener("click", () => {
      document.getElementById("rtw-add-panel")?.setAttribute("hidden", "");
      setAddCheckEmployee("");
    });

    document.querySelectorAll(".rtw-filter-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        activeFilter = tab.getAttribute("data-rtw-filter") || "all";
        document.querySelectorAll(".rtw-filter-tab").forEach((el) => el.classList.toggle("is-active", el === tab));
        renderTable();
      });
    });

    document.getElementById("rtw-search-input")?.addEventListener("input", (event) => {
      searchQuery = event.target.value;
      renderTable();
    });

    document.getElementById("rtw-send-reminder-btn")?.addEventListener("click", sendReminder);
    document.getElementById("rtw-detail-recheck-btn")?.addEventListener("click", () => {
      const item = rtwItems.find((row) => sameRecordId(row.id, selectedCheckId));
      openRecheckPanel(item?.employee_id);
    });
    document.getElementById("rtw-detail-close")?.addEventListener("click", closeDetailPanel);

    window.addEventListener("admin:rtw-refresh", () => loadRtwRecords());
    window.addEventListener("admin:compliance-tools-ready", () => tryLoadRtwRecords());
  }

  async function initRtwSection() {
    bindRtwWorkspace();
    await tryLoadRtwRecords();
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "compliance" && !sectionReady) {
      sectionReady = true;
      initRtwSection();
    }
  });

  if (parseHashBaseSection(window.location.hash) === "compliance") {
    sectionReady = true;
    initRtwSection();
  }
})();
