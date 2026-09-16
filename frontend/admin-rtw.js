/** Right to Work workspace — stats, filters, table, detail panel. */
(function initAdminRtwWorkspace() {
  const { apiFetch, escapeHtml, downloadAuthenticated, parseHashBaseSection, parseApiDetail, readApiError } = window.Admin;

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
    return "Needs review";
  }

  function statusClass(status) {
    if (status === "verified") return "rtw-status-pill rtw-status-pill--ok";
    if (status === "expiring_soon") return "rtw-status-pill rtw-status-pill--warn";
    return "rtw-status-pill rtw-status-pill--danger";
  }

  const KIND_FILTERS = new Set(["passport", "visa", "rtw_check"]);
  const EMPTY_LIST_MESSAGE =
    "No passport, BRP, visa or right-to-work records yet. Save them on the employee file or add an RTW check above.";

  function sameRecordId(a, b) {
    return String(a ?? "") === String(b ?? "");
  }

  function rowExpiryIso(item) {
    if (!item) return null;
    if (item.document_kind === "passport") return item.document_expiry_date || item.expiry_date;
    if (item.document_kind === "visa") {
      return item.visa_expiry_date || item.document_expiry_date || item.expiry_date;
    }
    return item.rtw_check_expiry_date || item.document_expiry_date || item.expiry_date;
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

  function documentCell(item) {
    const type = item.document_type || "Document";
    const title = String(item.document_title || item.filename || "").trim();
    const extra = title && title.toLowerCase() !== type.toLowerCase()
      ? `<span class="rtw-doc-file">${escapeHtml(title)}</span>`
      : "";
    return `<div class="rtw-doc-cell">
      <span class="rtw-kind-tag rtw-kind-tag--${kindClass(item.document_kind)}">${escapeHtml(type)}</span>
      ${extra}
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
        return `<button type="button" class="rtw-record-card${selected}" data-rtw-id="${escapeHtml(String(item.id))}">
          <span class="rtw-record-card__avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(employeeInitials(item.employee_name))}</span>
          <span class="rtw-record-card__body">
            <span class="rtw-record-card__name">${escapeHtml(item.employee_short_name || item.employee_name)}</span>
            <span class="rtw-record-card__meta muted">${escapeHtml(item.document_type)} · Expires ${escapeHtml(formatDate(rowExpiryIso(item)))}</span>
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
            return `<tr class="rtw-table-row${selected}" data-rtw-id="${escapeHtml(String(item.id))}" tabindex="0">
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
          <td>${escapeHtml(formatDate(item.check_date))}</td>
          <td><span class="${expiryClass(item)}">${escapeHtml(formatDate(rowExpiryIso(item)))}</span></td>
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

  function renderDetailPanel(item) {
    const panel = document.getElementById("rtw-detail-panel");
    const content = document.getElementById("rtw-detail-content");
    if (!panel || !content || !item) return;
    panel.hidden = false;
    const workerType = item.is_sponsored ? "Sponsored worker" : "Standard worker";
    const docs = (item.documents || [{ filename: item.filename, uploaded_at: item.check_date }])
      .map(
        (doc) => `<li class="rtw-doc-item">
          <span>${escapeHtml(doc.filename || item.filename || "document")}</span>
          <span class="muted">${escapeHtml(formatDate(doc.uploaded_at || item.check_date))}</span>
          <button type="button" class="btn ghost btn-sm" data-rtw-download="${escapeHtml(String(item.id))}">Download</button>
        </li>`
      )
      .join("");
    const lockNote = item.immutable_locked
      ? `<p class="rtw-detail-lock muted"><strong>Immutable record.</strong> Saved ${escapeHtml(formatDate(item.created_at?.slice(0, 10) || item.check_date))} by ${escapeHtml(item.checker_user_id || "admin")}. Cannot be edited or deleted.</p>`
      : `<p class="rtw-detail-lock muted">Saved on the employee file ${escapeHtml(formatDate(item.created_at?.slice(0, 10) || item.check_date))}. Passport, BRP, visa and right-to-work documents appear in this list.</p>`;

    content.innerHTML = `
      ${renderDetailAlert(item)}
      <div class="rtw-detail-employee">
        <strong>${escapeHtml(item.employee_name)}</strong>
        <span class="muted">${escapeHtml(item.employee_role)} · ${escapeHtml(workerType)}</span>
      </div>
      <dl class="rtw-detail-meta">
        <div><dt>Document type</dt><dd>${escapeHtml(item.document_type)}</dd></div>
        <div><dt>File</dt><dd>${escapeHtml(item.document_title || item.filename || "—")}</dd></div>
        <div><dt>Date on file</dt><dd>${escapeHtml(formatDate(item.check_date))}</dd></div>
        <div><dt>Uploaded by</dt><dd>${escapeHtml(item.checker_user_id || "—")}</dd></div>
        <div><dt>${escapeHtml(item.expiry_label || "Expiry")}</dt><dd class="${expiryClass(item)}">${escapeHtml(formatDate(rowExpiryIso(item)))}</dd></div>
      </dl>
      <div class="rtw-detail-docs">
        <h5>Documents</h5>
        <ul class="rtw-doc-list">${docs}</ul>
      </div>
      <label class="rtw-upload-zone">
        <span class="rtw-upload-zone__label">Drop PDF evidence here or click to upload</span>
        <span class="muted rtw-upload-zone__hint">PDF only · max 10MB · creates a new immutable RTW check</span>
        <input type="file" accept="application/pdf" data-rtw-supplement="${item.employee_id}" hidden />
      </label>
      ${lockNote}`;

    content.querySelector("[data-rtw-download]")?.addEventListener("click", () => {
      downloadAuthenticated(downloadPathFor(item), item.filename || `rtw-record-${item.id}`);
    });

    const fileInput = content.querySelector("[data-rtw-supplement]");
    fileInput?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) openRecheckPanel(item.employee_id, file);
    });
  }

  async function selectCheck(checkId) {
    selectedCheckId = checkId;
    renderTable();
    try {
      const res = await apiFetch(`/compliance/sponsor-licence/rtw-checks/${encodeURIComponent(checkId)}`);
      if (!res.ok) throw new Error("Could not load record");
      const item = await res.json();
      renderDetailPanel(item);
    } catch {
      const fallback = rtwItems.find((row) => sameRecordId(row.id, checkId));
      if (fallback) renderDetailPanel(fallback);
    }
  }

  function openRecheckPanel(employeeId, file = null) {
    const panel = document.getElementById("rtw-add-panel");
    panel?.removeAttribute("hidden");
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    const employeeInput = document.querySelector("#rtw-upload input[name='employee_id']");
    if (employeeInput && employeeId) employeeInput.value = String(employeeId);
    const fileInput = document.querySelector("#rtw-upload input[name='evidence_pdf']");
    if (fileInput && file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
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
        document.getElementById("rtw-detail-panel")?.setAttribute("hidden", "");
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
      document.getElementById("rtw-add-panel")?.removeAttribute("hidden");
      document.getElementById("rtw-add-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("rtw-add-panel-close")?.addEventListener("click", () => {
      document.getElementById("rtw-add-panel")?.setAttribute("hidden", "");
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
    document.getElementById("rtw-detail-recheck-link")?.addEventListener("click", () => {
      document.getElementById("rtw-detail-recheck-btn")?.click();
    });

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
