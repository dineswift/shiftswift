/** Admin — leave and holiday requests with detail panel review. */
(function initAdminLeave() {
  const { apiFetch, escapeHtml, parseHashBaseSection, emptyStateHtml } = window.Admin;

  const WORKFLOW_STEPS = [
    { id: "submitted", label: "Submitted" },
    { id: "pending", label: "Pending review" },
    { id: "decided", label: "Approved / rejected" },
  ];

  const LEAVE_TYPE_TONE = {
    annual: "annual",
    sick: "sick",
    unpaid: "unpaid",
    other: "other",
  };

  let sectionReady = false;
  let allRequests = [];
  let filterStatus = "pending";
  let searchFilter = "";
  let employeeFilterId = null;
  let employeeFilterName = "";
  let employeesCache = [];
  let pickerSearch = "";
  let selectedId = null;
  let reviewBusy = false;
  let mobileTab = "requests";
  let mobileCalCursor = new Date();
  let balanceCache = new Map();
  let balancesLoading = false;
  const MOBILE_AVATAR_PALETTES = [
    { bg: "#E1F5EE", color: "#0F6E56" },
    { bg: "#E6F1FB", color: "#185FA5" },
    { bg: "#FAEEDA", color: "#854F0B" },
    { bg: "#FBEAF0", color: "#993556" },
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function statusPill(status) {
    const tone =
      status === "approved" ? "ok" : status === "rejected" ? "danger" : status === "cancelled" ? "muted" : "warn";
    return `<span class="status-pill status-pill--${tone}">${escapeHtml(status)}</span>`;
  }

  function leaveTypePill(type, label) {
    const tone = LEAVE_TYPE_TONE[type] || "other";
    return `<span class="leave-type-pill leave-type-pill--${tone}">${escapeHtml(label || type)}</span>`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatLeaveRange(startIso, endIso) {
    if (!startIso) return "—";
    if (!endIso || startIso === endIso) return formatDate(startIso);
    const start = new Date(`${startIso}T12:00:00`);
    const end = new Date(`${endIso}T12:00:00`);
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();
    if (sameMonth) {
      const monthYear = end.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
      return `${start.getDate()} – ${end.getDate()} ${monthYear}`;
    }
    const startFmt = start.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: sameYear ? undefined : "numeric",
    });
    return `${startFmt} – ${formatDate(endIso)}`;
  }

  function daysLabel(days) {
    const n = Number(days);
    if (!Number.isFinite(n)) return "—";
    return n === 1 ? "1 day" : `${n % 1 === 0 ? n : n.toFixed(1)} days`;
  }

  function employeeInitials(name, emp) {
    const first = (emp?.first_name || "").trim()[0] || "";
    const last = (emp?.last_name || "").trim()[0] || "";
    if (first || last) return (first + last).toUpperCase();
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] || "?").toUpperCase();
  }

  function avatarPalette(seed) {
    return MOBILE_AVATAR_PALETTES[Math.abs(Number(seed) || 0) % MOBILE_AVATAR_PALETTES.length];
  }

  function iconSvg(name) {
    return window.AdminIcons?.svg?.(name) || "";
  }

  function isMobileLeaveUi() {
    if (!document.getElementById("mobile-tab-bar")) return false;
    return window.isShiftSwiftMobileViewport?.() ?? window.matchMedia("(max-width: 860px)").matches;
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  function filteredRequests() {
    let items = allRequests;
    if (employeeFilterId) {
      items = items.filter((item) => item.employee_id === employeeFilterId);
    }
    if (filterStatus) {
      items = items.filter((item) => item.status === filterStatus);
    }
    const q = searchFilter.trim().toLowerCase();
    if (q) {
      items = items.filter((item) => String(item.employee_name || "").toLowerCase().includes(q));
    }
    return items;
  }

  function syncEmployeeFilterBanner() {
    const banner = $("leave-employee-filter-banner");
    const nameEl = $("leave-employee-filter-name");
    if (!banner) return;
    if (employeeFilterId && employeeFilterName) {
      banner.hidden = false;
      if (nameEl) nameEl.textContent = employeeFilterName;
    } else {
      banner.hidden = true;
      if (nameEl) nameEl.textContent = "";
    }
  }

  function clearEmployeeFilter() {
    employeeFilterId = null;
    employeeFilterName = "";
    syncEmployeeFilterBanner();
  }

  function employeeDisplayName(emp) {
    return `${emp.first_name || ""} ${emp.last_name || ""}`.trim() || "Employee";
  }

  async function loadEmployeesList() {
    const res = await apiFetch("/admin/employees");
    if (!res.ok) throw new Error("Could not load employees");
    const data = await res.json();
    employeesCache = (data.items || []).filter((emp) => emp.status !== "terminated");
    return employeesCache;
  }

  function renderEmployeePickerList() {
    const host = $("leave-employee-picker-list");
    if (!host) return;
    const q = pickerSearch.trim().toLowerCase();
    const rows = employeesCache.filter((emp) => {
      if (!q) return true;
      const name = employeeDisplayName(emp).toLowerCase();
      const dept = String(emp.department || "").toLowerCase();
      const title = String(emp.job_title || "").toLowerCase();
      return name.includes(q) || dept.includes(q) || title.includes(q);
    });

    if (!employeesCache.length) {
      host.innerHTML = `<p class="muted leave-employee-picker__empty">No employees found.</p>`;
      return;
    }

    if (!rows.length) {
      host.innerHTML = `<p class="muted leave-employee-picker__empty">No employees match your search.</p>`;
      return;
    }

    host.innerHTML = rows
      .map((emp) => {
        const name = employeeDisplayName(emp);
        const meta = [emp.job_title, emp.department].filter(Boolean).join(" · ") || emp.status || "";
        return `<button type="button" class="leave-employee-picker__item" data-employee-id="${emp.id}" role="option">
          <span class="leave-employee-picker__name">${escapeHtml(name)}</span>
          <span class="muted leave-employee-picker__meta">${escapeHtml(meta)}</span>
        </button>`;
      })
      .join("");

    host.querySelectorAll(".leave-employee-picker__item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const emp = employeesCache.find((row) => row.id === Number(btn.dataset.employeeId));
        if (!emp) return;
        selectEmployeeFromPicker(emp.id, employeeDisplayName(emp));
      });
    });
  }

  async function openEmployeePicker() {
    const picker = $("leave-employee-picker");
    const searchInput = $("leave-employee-picker-search");
    if (!picker) return;
    picker.hidden = false;
    pickerSearch = "";
    if (searchInput) searchInput.value = "";
    const list = $("leave-employee-picker-list");
    if (list) list.innerHTML = `<p class="muted leave-employee-picker__empty">Loading employees…</p>`;
    try {
      await loadEmployeesList();
      renderEmployeePickerList();
    } catch {
      if (list) {
        list.innerHTML = `<p class="muted leave-employee-picker__empty">Could not load employees. Try again.</p>`;
      }
    }
    searchInput?.focus();
  }

  function closeEmployeePicker() {
    const picker = $("leave-employee-picker");
    if (picker) picker.hidden = true;
    pickerSearch = "";
  }

  function selectEmployeeFromPicker(employeeId, name) {
    employeeFilterId = employeeId;
    employeeFilterName = name;
    searchFilter = "";
    const searchInput = $("leave-search-input");
    if (searchInput) searchInput.value = "";
    setFilter("");
    syncEmployeeFilterBanner();
    closeEmployeePicker();
    renderTable();
  }

  function bindEmptyStateActions() {
    $("leave-view-employees-btn")?.addEventListener("click", () => openEmployeePicker());
  }

  function computeStats(items) {
    const pending = allRequests.filter((item) => item.status === "pending").length;
    const approved = items.filter((item) => item.status === "approved").length;
    const days = items.reduce((sum, item) => sum + Number(item.days_requested || 0), 0);
    const employees = new Set(items.map((item) => item.employee_id)).size;
    return { pending, approved, days, employees, visible: items.length };
  }

  function renderStats(items) {
    const stats = computeStats(items);
    const pendingEl = $("leave-stat-pending");
    const pendingSub = $("leave-stat-pending-sub");
    if (pendingEl) pendingEl.textContent = String(stats.pending);
    if (pendingSub) {
      pendingSub.textContent =
        stats.pending === 0 ? "Nothing waiting on you" : stats.pending === 1 ? "One request needs action" : "Awaiting your decision";
    }
    const approvedEl = $("leave-stat-approved");
    if (approvedEl) approvedEl.textContent = String(stats.approved);
    const daysEl = $("leave-stat-days");
    if (daysEl) daysEl.textContent = stats.days % 1 === 0 ? String(stats.days) : stats.days.toFixed(1);
    const employeesEl = $("leave-stat-employees");
    if (employeesEl) employeesEl.textContent = String(stats.employees);
    const sub = $("leave-register-sub");
    if (sub) {
      sub.textContent =
        stats.visible === 0
          ? "No requests match this filter"
          : `${stats.visible} request${stats.visible === 1 ? "" : "s"} in this view`;
    }
  }

  function computeWorkflowStates(item) {
    if (!item) {
      return WORKFLOW_STEPS.map((step) => ({ ...step, state: step.id === "submitted" ? "active" : "pending" }));
    }
    if (item.status === "pending") {
      return WORKFLOW_STEPS.map((step) => ({
        ...step,
        state: step.id === "submitted" ? "done" : step.id === "pending" ? "active" : "pending",
      }));
    }
    return WORKFLOW_STEPS.map((step) => ({
      ...step,
      state: step.id === "decided" ? "done" : "done",
    }));
  }

  function renderStatusWorkflow(item) {
    const host = $("leave-status-workflow");
    if (!host) return;
    const states = computeWorkflowStates(item);
    host.innerHTML = states
      .map((step, index) => {
        const stepClass =
          step.state === "pending" ? "hr-workflow-step" : `hr-workflow-step hr-workflow-step--${step.state}`;
        const arrow =
          index < states.length - 1 ? '<span class="hr-workflow-arrow" aria-hidden="true">→</span>' : "";
        return `<span class="${stepClass}">${escapeHtml(step.label)}</span>${arrow}`;
      })
      .join("");
  }

  function syncDetailLayout() {
    const workspace = $("leave-workspace");
    const panel = $("leave-detail-panel");
    const guide = $("leave-guide-panel");
    const hasSelection = Boolean(selectedId);
    workspace?.classList.toggle("leave-workspace-layout--detail-open", hasSelection);
    if (panel) panel.hidden = !hasSelection;
    if (guide) guide.hidden = hasSelection;
    const item = allRequests.find((row) => row.id === selectedId);
    renderStatusWorkflow(item || null);
  }

  function clearSelection() {
    selectedId = null;
    $("leave-detail-content")?.setAttribute("hidden", "");
    $("leave-detail-empty")?.removeAttribute("hidden");
    renderTable();
    syncDetailLayout();
  }

  async function loadEmployeeBalance(employeeId, leaveType) {
    if (leaveType !== "annual") return null;
    try {
      const res = await apiFetch(`/admin/leave/employees/${employeeId}/balance`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function balanceHtml(balance, daysRequested) {
    if (!balance) return "";
    const remaining = Number(balance.remaining_days);
    const low = remaining < 3;
    const insufficient = daysRequested > remaining;
    let cls = "leave-balance-panel";
    if (insufficient) cls += " leave-balance-panel--danger";
    else if (low) cls += " leave-balance-panel--warn";
    return `
      <div class="${cls}">
        <p class="leave-balance-panel__label">Annual leave balance (${balance.year})</p>
        <p class="leave-balance-panel__value">${escapeHtml(String(balance.remaining_days))} days remaining</p>
        <p class="muted leave-balance-panel__meta">
          Allowance ${escapeHtml(String(balance.allowance_days))} ·
          used ${escapeHtml(String(balance.used_days))} ·
          pending ${escapeHtml(String(balance.pending_days))}
        </p>
        ${insufficient ? '<p class="leave-balance-panel__alert">This request exceeds remaining allowance.</p>' : ""}
      </div>`;
  }

  async function renderDetail(item) {
    const content = $("leave-detail-content");
    const empty = $("leave-detail-empty");
    if (!content || !item) return;
    empty?.setAttribute("hidden", "");
    content.hidden = false;
    content.innerHTML = `<p class="muted">Loading detail…</p>`;
    const balance = await loadEmployeeBalance(item.employee_id, item.leave_type);
    content.innerHTML = `
      <div class="hr-detail-head">
        <div>
          <h3>${escapeHtml(item.employee_name)}</h3>
          ${leaveTypePill(item.leave_type, item.leave_type_label)}
        </div>
        ${statusPill(item.status)}
      </div>
      ${balanceHtml(balance, Number(item.days_requested))}
      <dl class="hr-detail-grid">
        <div><dt>From</dt><dd>${escapeHtml(formatDate(item.start_date))}</dd></div>
        <div><dt>To</dt><dd>${escapeHtml(formatDate(item.end_date))}</dd></div>
        <div><dt>Working days</dt><dd>${escapeHtml(String(item.days_requested))}</dd></div>
        <div><dt>Submitted</dt><dd>${escapeHtml(formatDateTime(item.created_at))}</dd></div>
        ${item.reason ? `<div><dt>Reason</dt><dd>${escapeHtml(item.reason)}</dd></div>` : ""}
        ${item.reviewed_by ? `<div><dt>Reviewed by</dt><dd>${escapeHtml(item.reviewed_by)}</dd></div>` : ""}
        ${item.reviewed_at ? `<div><dt>Reviewed at</dt><dd>${escapeHtml(formatDateTime(item.reviewed_at))}</dd></div>` : ""}
        ${item.review_note ? `<div><dt>Review note</dt><dd>${escapeHtml(item.review_note)}</dd></div>` : ""}
      </dl>
      ${
        item.status === "pending"
          ? `
        <label class="edit-field leave-review-field">
          <span class="edit-label">Note for employee <span class="muted">(optional)</span></span>
          <textarea id="leave-review-note" rows="3" maxlength="2000" placeholder="Reason for rejection or confirmation message…"></textarea>
        </label>
        <div class="hr-detail-foot leave-detail-foot">
          <button type="button" class="btn" id="leave-approve-btn">Approve</button>
          <button type="button" class="btn ghost" id="leave-reject-btn">Reject</button>
        </div>
        <p class="leave-review-status muted" id="leave-review-status" aria-live="polite"></p>`
          : `
        <div class="hr-detail-foot">
          <a class="btn ghost" href="#employees/${item.employee_id}">Open employee profile</a>
        </div>`
      }`;
  if (item.status === "pending") {
      content.querySelector("#leave-approve-btn")?.addEventListener("click", () => reviewRequest(item.id, "approved"));
      content.querySelector("#leave-reject-btn")?.addEventListener("click", () => reviewRequest(item.id, "rejected"));
    }
  }

  function selectRequest(requestId) {
    selectedId = requestId;
    const item = allRequests.find((row) => row.id === requestId);
    renderTable();
    if (item) renderDetail(item);
    syncDetailLayout();
  }

  function isMobileLeave() {
    return window.isShiftSwiftMobileViewport?.() ?? window.matchMedia("(max-width: 860px)").matches;
  }

  function renderEmptyState(host, options, extraBind) {
    host.innerHTML = emptyStateHtml(options);
    bindEmptyStateActions();
    extraBind?.();
  }

  function leaveMobileCard(item) {
    const selected = selectedId === item.id ? " leave-mobile-card--selected" : "";
    return `<button type="button" class="leave-mobile-card${selected}" data-leave-id="${item.id}">
      <span class="leave-mobile-card__name">${escapeHtml(item.employee_name)}</span>
      <span class="leave-mobile-card__meta">
        ${leaveTypePill(item.leave_type, item.leave_type_label)}
        <span class="leave-mobile-card__days">${escapeHtml(String(item.days_requested))}d</span>
      </span>
      <span class="leave-mobile-card__dates muted">${escapeHtml(formatDate(item.start_date))} – ${escapeHtml(formatDate(item.end_date))}</span>
      <span class="leave-mobile-card__status">${statusPill(item.status)}</span>
    </button>`;
  }

  function renderMobileGrid(items) {
    const host = $("leave-mobile-grid");
    const tableWrap = document.querySelector("#leave .leave-table-wrap");
    if (!host) return;

    // Mobile shell owns the list UI — keep the legacy grid hidden.
    if (isMobileLeaveUi() && $("leave-mobile-shell")) {
      host.hidden = true;
      host.innerHTML = "";
      if (tableWrap) tableWrap.hidden = true;
      return;
    }

    if (!isMobileLeave()) {
      host.hidden = true;
      host.innerHTML = "";
      if (tableWrap) tableWrap.hidden = false;
      return;
    }

    host.hidden = false;
    if (tableWrap) tableWrap.hidden = true;

    if (!allRequests.length) {
      renderEmptyState(host, {
        icon: "calendar-off",
        title: "No leave requests yet",
        message: "When staff request holiday or leave in the employee portal, they appear here for approval.",
        actionLabel: "View employees",
        actionId: "leave-view-employees-btn",
        compact: true,
      });
      return;
    }

    if (!items.length) {
      const filterLabel = filterStatus || "matching";
      const employeeOnly = employeeFilterId && employeeFilterName;
      const showViewEmployees = employeeOnly || (!searchFilter.trim() && filterStatus === "pending");
      renderEmptyState(
        host,
        {
          icon: "search",
          title: employeeOnly
            ? `No leave requests for ${employeeFilterName}`
            : filterStatus === "pending"
              ? "No pending leave requests"
              : "No leave requests",
          message: employeeOnly
            ? "This employee has no leave requests in this view. Try All statuses or choose another employee."
            : searchFilter.trim()
              ? "Try a different search or clear the filter."
              : filterStatus === "pending"
                ? "When staff request holiday or leave in the portal, they appear here for approval."
                : `No ${filterLabel} leave requests in this view.`,
          actionLabel: showViewEmployees ? "View employees" : searchFilter.trim() ? "Clear search" : "Show all",
          actionId: showViewEmployees ? "leave-view-employees-btn" : "leave-clear-filter-btn",
          compact: true,
        },
        () => {
          document.getElementById("leave-clear-filter-btn")?.addEventListener("click", () => {
            if (searchFilter.trim()) {
              searchFilter = "";
              const input = $("leave-search-input");
              if (input) input.value = "";
            } else if (employeeFilterId) {
              clearEmployeeFilter();
            } else {
              setFilter("");
            }
            renderTable();
          });
        },
      );
      return;
    }

    host.innerHTML = items.map((item) => leaveMobileCard(item)).join("");
    host.querySelectorAll(".leave-mobile-card").forEach((card) => {
      card.addEventListener("click", () => selectRequest(Number(card.dataset.leaveId)));
    });
  }

  function renderTable() {
    const tbody = $("leave-requests-body");
    if (!tbody) return;
    syncEmployeeFilterBanner();
    const items = filteredRequests();
    renderStats(items);
    renderMobileGrid(items);
    if (isMobileLeave()) {
      const tableWrap = document.querySelector("#leave .leave-table-wrap");
      if (tableWrap) tableWrap.hidden = true;
      // Clear stale desktop loading row so a resize/back-navigation never sticks.
      if (tbody) tbody.innerHTML = "";
      return;
    }

    const host = $("leave-mobile-grid");
    if (host) {
      host.hidden = true;
      host.innerHTML = "";
    }
    const tableWrap = document.querySelector("#leave .leave-table-wrap");
    if (tableWrap) tableWrap.hidden = false;

    if (!allRequests.length) {
      tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="6">${emptyStateHtml({
        icon: "calendar-off",
        title: "No leave requests yet",
        message: "When staff request holiday or leave in the employee portal, they appear here for approval.",
        actionLabel: "View employees",
        actionId: "leave-view-employees-btn",
        compact: true,
      })}</td></tr>`;
      bindEmptyStateActions();
      return;
    }

    if (!items.length) {
      const filterLabel = filterStatus || "matching";
      const employeeOnly = employeeFilterId && employeeFilterName;
      const showViewEmployees = employeeOnly || (!searchFilter.trim() && filterStatus === "pending");
      tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="6">${emptyStateHtml({
        icon: "search",
        title: employeeOnly
          ? `No leave requests for ${employeeFilterName}`
          : filterStatus === "pending"
            ? "No pending leave requests"
            : "No leave requests",
        message: employeeOnly
          ? "This employee has no leave requests in this view. Try All statuses or choose another employee."
          : searchFilter.trim()
            ? "Try a different search or clear the filter."
            : filterStatus === "pending"
              ? "When staff request holiday or leave in the portal, they appear here for approval."
              : `No ${filterLabel} leave requests in this view.`,
        actionLabel: showViewEmployees ? "View employees" : searchFilter.trim() ? "Clear search" : "Show all",
        actionId: showViewEmployees ? "leave-view-employees-btn" : "leave-clear-filter-btn",
        compact: true,
      })}</td></tr>`;
      document.getElementById("leave-clear-filter-btn")?.addEventListener("click", () => {
        if (searchFilter.trim()) {
          searchFilter = "";
          const input = $("leave-search-input");
          if (input) input.value = "";
        } else if (employeeFilterId) {
          clearEmployeeFilter();
        } else {
          setFilter("");
        }
        renderTable();
      });
      bindEmptyStateActions();
      return;
    }

    tbody.innerHTML = items
      .map((item) => {
        const selected = selectedId === item.id ? " hr-register-row--selected" : "";
        return `<tr class="hr-register-row leave-register-row${selected}" data-leave-id="${item.id}">
          <td><strong>${escapeHtml(item.employee_name)}</strong>
            ${item.reason ? `<div class="muted leave-row-reason">${escapeHtml(item.reason.slice(0, 60))}${item.reason.length > 60 ? "…" : ""}</div>` : ""}
          </td>
          <td>${leaveTypePill(item.leave_type, item.leave_type_label)}</td>
          <td>${escapeHtml(formatDate(item.start_date))}</td>
          <td>${escapeHtml(formatDate(item.end_date))}</td>
          <td>${escapeHtml(String(item.days_requested))}</td>
          <td>${statusPill(item.status)}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".leave-register-row").forEach((row) => {
      row.addEventListener("click", () => selectRequest(Number(row.dataset.leaveId)));
    });
  }

  function setFilter(status) {
    filterStatus = status;
    document.querySelectorAll("[data-leave-filter]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.leaveFilter === status);
    });
    if (selectedId && !filteredRequests().some((item) => item.id === selectedId)) {
      selectedId = null;
      $("leave-detail-content")?.setAttribute("hidden", "");
      $("leave-detail-empty")?.removeAttribute("hidden");
    }
    renderTable();
    syncDetailLayout();
  }

  function showLeaveLoadError() {
    const tbody = $("leave-requests-body");
    const mobileGrid = $("leave-mobile-grid");
    const pendingHost = $("leave-mobile-pending");
    const tableWrap = document.querySelector("#leave .leave-table-wrap");
    const sub = $("leave-register-sub");
    if (sub) sub.textContent = "Could not load leave";

    if (isMobileLeaveUi() && pendingHost) {
      pendingHost.innerHTML = `
        <div class="leave-mobile-empty">
          <p class="muted">Could not load leave requests.</p>
          <button type="button" class="btn ghost btn--sm" id="leave-retry-btn">Retry</button>
        </div>`;
      document.getElementById("leave-retry-btn")?.addEventListener("click", () => loadRequests());
      return;
    }

    if (isMobileLeave() && mobileGrid) {
      if (tableWrap) tableWrap.hidden = true;
      mobileGrid.hidden = false;
      renderEmptyState(
        mobileGrid,
        {
          icon: "alert",
          title: "Could not load leave",
          message: "Check your connection and try again.",
          actionLabel: "Retry",
          actionId: "leave-retry-btn",
          compact: true,
        },
        () => {
          document.getElementById("leave-retry-btn")?.addEventListener("click", () => loadRequests());
        },
      );
      return;
    }

    if (tbody) {
      if (tableWrap) tableWrap.hidden = false;
      if (mobileGrid) {
        mobileGrid.hidden = true;
        mobileGrid.innerHTML = "";
      }
      tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="6">${emptyStateHtml({
        icon: "alert",
        title: "Could not load leave",
        message: "Check your connection and try again.",
        actionLabel: "Retry",
        actionId: "leave-retry-btn",
        compact: true,
      })}</td></tr>`;
      document.getElementById("leave-retry-btn")?.addEventListener("click", () => loadRequests());
    }
  }

  async function loadRequests() {
    const tbody = $("leave-requests-body");
    const mobileGrid = $("leave-mobile-grid");
    const pendingHost = $("leave-mobile-pending");
    const sub = $("leave-register-sub");
    if (sub) sub.textContent = "Loading…";
    if (isMobileLeaveUi() && $("leave-mobile-shell")) {
      if (mobileGrid) {
        mobileGrid.hidden = true;
        mobileGrid.innerHTML = "";
      }
      const tableWrap = document.querySelector("#leave .leave-table-wrap");
      if (tableWrap) tableWrap.hidden = true;
      // Reveal mobile shell first, then keep the loading copy (setMobileTab would wipe it).
      renderMobileLeaveShell();
      if (pendingHost) {
        pendingHost.innerHTML = `<p class="leave-mobile-empty muted">Loading leave requests…</p>`;
      }
    } else if (isMobileLeave() && mobileGrid) {
      mobileGrid.hidden = false;
      mobileGrid.innerHTML = `<p class="muted leave-mobile-grid__loading">Loading leave requests…</p>`;
      const tableWrap = document.querySelector("#leave .leave-table-wrap");
      if (tableWrap) tableWrap.hidden = true;
    } else if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">Loading leave requests…</td></tr>`;
    }
    try {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = window.setTimeout(() => controller?.abort?.(), 20000);
      let res;
      try {
        res = await apiFetch("/admin/leave/requests", controller ? { signal: controller.signal } : {});
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      allRequests = Array.isArray(data.items) ? data.items : [];
      if (isMobileLeaveUi() && !employeesCache.length) {
        void loadEmployeesList().catch(() => null);
      }
      renderTable();
      renderMobileLeaveShell();
      if (selectedId) {
        const item = allRequests.find((row) => row.id === selectedId);
        if (item) await renderDetail(item);
        else clearSelection();
      }
      syncDetailLayout();
    } catch {
      allRequests = [];
      renderStats([]);
      renderMobileLeaveShell();
      showLeaveLoadError();
    }
  }

  function parseLeaveApiError(data, fallback) {
    const detail = data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0];
      if (typeof first === "string") return first;
      if (first && typeof first.msg === "string") return first.msg;
    }
    if (detail && typeof detail.message === "string") return detail.message;
    return fallback;
  }

  async function reviewRequest(requestId, decision, { reviewNote } = {}) {
    if (reviewBusy) return;
    const noteEl = $("leave-review-note");
    const statusEl = $("leave-review-status");
    const note = reviewNote != null ? reviewNote : noteEl?.value?.trim() || "";
    const btn = document.getElementById(decision === "approved" ? "leave-approve-btn" : "leave-reject-btn");
    reviewBusy = true;

    const performReview = async () => {
      const res = await apiFetch(`/admin/leave/requests/${requestId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, review_note: note || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseLeaveApiError(data, "Could not update leave request."));
      }
      // Don't fail the approval if the list refresh has a temporary network blip.
      try {
        await loadRequests();
      } catch {
        /* list refresh is best-effort after a successful review */
      }
      const updated = allRequests.find((row) => row.id === requestId);
      if (updated) {
        selectedId = requestId;
        await renderDetail(updated);
        syncDetailLayout();
      }
      return decision === "approved" ? "Approved." : "Rejected.";
    };

    try {
      if (window.ShiftSwiftAction?.runButtonAction && btn) {
        await window.ShiftSwiftAction.runButtonAction(btn, statusEl, {
          loadingLabel: decision === "approved" ? "Approving…" : "Rejecting…",
          successMessage: decision === "approved" ? "Approved." : "Rejected.",
          errorMessage: "Could not update leave request.",
          successLabel: decision === "approved" ? "Approved" : "Rejected",
          onAction: performReview,
        });
      } else {
        if (statusEl) statusEl.textContent = decision === "approved" ? "Approving…" : "Rejecting…";
        const message = await performReview();
        if (statusEl) statusEl.textContent = message;
        window.ShiftSwiftAction?.showActionToast?.(
          decision === "approved" ? "Leave approved." : "Leave declined.",
          "ok"
        );
      }
    } catch (error) {
      const message = error?.message || "Could not update leave request.";
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = message;
        statusEl.classList.add("form-error-message");
      }
      window.ShiftSwiftAction?.showActionToast?.(message, "error");
    } finally {
      reviewBusy = false;
    }
  }

  function pendingRequests() {
    return allRequests
      .filter((item) => item.status === "pending")
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  }

  function recentDecidedRequests(limit = 8) {
    return allRequests
      .filter((item) => item.status === "approved" || item.status === "rejected")
      .sort((a, b) => {
        const aTime = new Date(a.reviewed_at || a.created_at || 0).getTime();
        const bTime = new Date(b.reviewed_at || b.created_at || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);
  }

  function historyRequests() {
    return allRequests
      .filter((item) => item.status !== "pending")
      .sort((a, b) => {
        const aTime = new Date(a.reviewed_at || a.created_at || 0).getTime();
        const bTime = new Date(b.reviewed_at || b.created_at || 0).getTime();
        return bTime - aTime;
      });
  }

  async function ensureBalance(employeeId, leaveType) {
    if (leaveType !== "annual" || employeeId == null) return null;
    const key = String(employeeId);
    if (balanceCache.has(key)) return balanceCache.get(key);
    const balance = await loadEmployeeBalance(employeeId, "annual");
    balanceCache.set(key, balance);
    return balance;
  }

  function setMobileTab(tab) {
    mobileTab = tab;
    document.querySelectorAll("[data-leave-mobile-tab]").forEach((btn) => {
      const active = btn.dataset.leaveMobileTab === tab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-leave-mobile-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.leaveMobilePanel !== tab;
    });
    if (tab === "balances") void renderMobileBalances();
    if (tab === "calendar") renderMobileCalendar();
    if (tab === "history") renderMobileHistory();
    if (tab === "requests") renderMobileRequestsPanel();
  }

  async function renderPendingCard(item) {
    const emp = employeesCache.find((row) => Number(row.id) === Number(item.employee_id));
    const palette = avatarPalette(item.employee_id || item.id);
    const initials = employeeInitials(item.employee_name, emp);
    const balance = await ensureBalance(item.employee_id, item.leave_type);
    const thirdMeta =
      item.leave_type === "annual" && balance
        ? `${Number(balance.remaining_days)} left`
        : item.leave_type_label || "Leave";
    const thirdIcon = item.leave_type === "annual" ? "beach" : "file";
    return `<article class="leave-mobile-request-card" data-leave-id="${item.id}">
      <div class="leave-mobile-request-card__head">
        <span class="leave-mobile-avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(initials)}</span>
        <div class="leave-mobile-request-card__who">
          <strong>${escapeHtml(item.employee_name)}</strong>
          <span>${escapeHtml(item.leave_type_label || item.leave_type)}</span>
        </div>
        <span class="leave-mobile-badge leave-mobile-badge--pending">Pending</span>
      </div>
      <div class="leave-mobile-request-card__meta">
        <span>${iconSvg("calendar")}<span>${escapeHtml(formatLeaveRange(item.start_date, item.end_date))}</span></span>
        <span>${iconSvg("clock")}<span>${escapeHtml(daysLabel(item.days_requested))}</span></span>
        <span>${iconSvg(thirdIcon)}<span>${escapeHtml(thirdMeta)}</span></span>
      </div>
      <div class="leave-mobile-request-card__actions">
        <button type="button" class="leave-mobile-action leave-mobile-action--decline" data-leave-decline="${item.id}">Decline</button>
        <button type="button" class="leave-mobile-action leave-mobile-action--approve" data-leave-approve="${item.id}">Approve</button>
      </div>
    </article>`;
  }

  function renderRecentRow(item) {
    const tone = item.status === "approved" ? "approved" : "declined";
    const badge = item.status === "approved" ? "Approved" : item.status === "rejected" ? "Declined" : item.status;
    const daysTone = item.status === "approved" ? "ok" : "danger";
    return `<div class="leave-mobile-recent-row leave-mobile-recent-row--${tone}">
      <div class="leave-mobile-recent-row__main">
        <strong>${escapeHtml(item.employee_name)}</strong>
        <span>${escapeHtml(formatLeaveRange(item.start_date, item.end_date))} · ${escapeHtml(item.leave_type_label || item.leave_type)}</span>
      </div>
      <div class="leave-mobile-recent-row__side">
        <span class="leave-mobile-recent-row__days leave-mobile-recent-row__days--${daysTone}">${escapeHtml(daysLabel(item.days_requested))}</span>
        <span class="leave-mobile-badge leave-mobile-badge--${tone}">${escapeHtml(badge)}</span>
      </div>
    </div>`;
  }

  async function renderMobileRequestsPanel() {
    const pendingHost = $("leave-mobile-pending");
    const recentHost = $("leave-mobile-recent");
    const pendingHeading = $("leave-mobile-pending-heading");
    if (!pendingHost || !recentHost) return;

    const pending = pendingRequests();
    if (pendingHeading) pendingHeading.textContent = `Pending approval (${pending.length})`;

    if (!pending.length) {
      pendingHost.innerHTML = `<p class="leave-mobile-empty muted">No requests waiting for approval.</p>`;
    } else {
      const cards = await Promise.all(pending.map((item) => renderPendingCard(item)));
      pendingHost.innerHTML = cards.join("");
      pendingHost.querySelectorAll("[data-leave-approve]").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          void reviewRequest(Number(btn.dataset.leaveApprove), "approved", { reviewNote: "" });
        });
      });
      pendingHost.querySelectorAll("[data-leave-decline]").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          void reviewRequest(Number(btn.dataset.leaveDecline), "rejected", { reviewNote: "" });
        });
      });
    }

    const recent = recentDecidedRequests(6);
    recentHost.innerHTML = recent.length
      ? recent.map((item) => renderRecentRow(item)).join("")
      : `<p class="leave-mobile-empty muted">No recent leave decisions yet.</p>`;
  }

  function renderMobileHistory() {
    const host = $("leave-mobile-history");
    if (!host) return;
    const items = historyRequests();
    host.innerHTML = items.length
      ? items.map((item) => renderRecentRow(item)).join("")
      : `<p class="leave-mobile-empty muted">No leave history yet.</p>`;
  }

  async function renderMobileBalances() {
    const host = $("leave-mobile-balances");
    if (!host || balancesLoading) return;
    balancesLoading = true;
    host.innerHTML = `<p class="leave-mobile-empty muted">Loading balances…</p>`;
    try {
      if (!employeesCache.length) await loadEmployeesList();
      const staff = employeesCache.filter((emp) => emp.status === "active" || !emp.status).slice(0, 40);
      const rows = [];
      for (const emp of staff) {
        const balance = await ensureBalance(emp.id, "annual");
        if (!balance) continue;
        const name = employeeDisplayName(emp);
        const palette = avatarPalette(emp.id);
        const initials = employeeInitials(name, emp);
        const remaining = Number(balance.remaining_days);
        rows.push(`<div class="leave-mobile-balance-row">
          <span class="leave-mobile-avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(initials)}</span>
          <div class="leave-mobile-balance-row__body">
            <strong>${escapeHtml(name)}</strong>
            <span>Allowance ${escapeHtml(String(balance.allowance_days))} · used ${escapeHtml(String(balance.used_days))}</span>
          </div>
          <span class="leave-mobile-balance-row__left">${escapeHtml(String(remaining))} left</span>
        </div>`);
      }
      host.innerHTML = rows.length
        ? `<div class="leave-mobile-list-card">${rows.join("")}</div>`
        : `<p class="leave-mobile-empty muted">No annual leave balances to show.</p>`;
    } catch {
      host.innerHTML = `<p class="leave-mobile-empty muted">Could not load balances.</p>`;
    } finally {
      balancesLoading = false;
    }
  }

  function eachDayInclusive(startIso, endIso) {
    const days = [];
    const cursor = new Date(`${startIso}T12:00:00`);
    const end = new Date(`${endIso}T12:00:00`);
    while (cursor <= end) {
      days.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
      );
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function renderMobileCalendar() {
    const host = $("leave-mobile-calendar");
    const label = $("leave-mobile-cal-label");
    if (!host) return;
    const year = mobileCalCursor.getFullYear();
    const month = mobileCalCursor.getMonth();
    if (label) {
      label.textContent = mobileCalCursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    }

    const leaveByDay = new Map();
    allRequests
      .filter((item) => item.status === "approved" || item.status === "pending")
      .forEach((item) => {
        eachDayInclusive(item.start_date, item.end_date).forEach((iso) => {
          const d = new Date(`${iso}T12:00:00`);
          if (d.getFullYear() !== year || d.getMonth() !== month) return;
          if (!leaveByDay.has(iso)) leaveByDay.set(iso, []);
          leaveByDay.get(iso).push(item);
        });
      });

    const first = new Date(year, month, 1);
    const startPad = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    let cells = "";
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((day) => {
      cells += `<span class="leave-mobile-cal-dow">${day}</span>`;
    });
    for (let i = 0; i < startPad; i += 1) {
      cells += `<span class="leave-mobile-cal-cell leave-mobile-cal-cell--empty"></span>`;
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const items = leaveByDay.get(iso) || [];
      const pending = items.some((item) => item.status === "pending");
      const approved = items.some((item) => item.status === "approved");
      const classes = ["leave-mobile-cal-cell"];
      if (iso === todayIso) classes.push("leave-mobile-cal-cell--today");
      if (approved) classes.push("leave-mobile-cal-cell--approved");
      if (pending) classes.push("leave-mobile-cal-cell--pending");
      const title = items.map((item) => item.employee_name).join(", ");
      cells += `<span class="${classes.join(" ")}" title="${escapeHtml(title)}" data-cal-day="${iso}"><span>${day}</span></span>`;
    }

    const monthItems = allRequests.filter((item) => {
      if (item.status !== "approved" && item.status !== "pending") return false;
      const start = new Date(`${item.start_date}T12:00:00`);
      const end = new Date(`${item.end_date}T12:00:00`);
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      return start <= monthEnd && end >= monthStart;
    });

    const list = monthItems.length
      ? `<div class="leave-mobile-cal-list">${monthItems
          .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
          .map((item) => renderRecentRow(item))
          .join("")}</div>`
      : `<p class="leave-mobile-empty muted">No leave booked this month.</p>`;

    host.innerHTML = `<div class="leave-mobile-cal-grid">${cells}</div>${list}`;
  }

  async function populateAddEmployeeSelect() {
    const select = $("leave-mobile-add-employee");
    if (!select) return;
    try {
      if (!employeesCache.length) await loadEmployeesList();
      const current = select.value;
      select.innerHTML = `<option value="">Select staff…</option>${employeesCache
        .map((emp) => `<option value="${emp.id}">${escapeHtml(employeeDisplayName(emp))}</option>`)
        .join("")}`;
      if (current) select.value = current;
    } catch {
      select.innerHTML = `<option value="">Could not load staff</option>`;
    }
  }

  function openAddLeaveSheet() {
    const sheet = $("leave-mobile-add-sheet");
    if (!sheet) return;
    sheet.hidden = false;
    const status = $("leave-mobile-add-status");
    if (status) status.textContent = "";
    const today = new Date().toISOString().slice(0, 10);
    const start = $("leave-mobile-add-start");
    const end = $("leave-mobile-add-end");
    if (start && !start.value) start.value = today;
    if (end && !end.value) end.value = today;
    void populateAddEmployeeSelect();
  }

  function closeAddLeaveSheet() {
    const sheet = $("leave-mobile-add-sheet");
    if (sheet) sheet.hidden = true;
  }

  async function submitAddLeave(event) {
    event.preventDefault();
    const status = $("leave-mobile-add-status");
    const submitBtn = $("leave-mobile-add-submit");
    const employeeId = Number($("leave-mobile-add-employee")?.value || 0);
    const leaveType = $("leave-mobile-add-type")?.value || "annual";
    const startDate = $("leave-mobile-add-start")?.value;
    const endDate = $("leave-mobile-add-end")?.value;
    const reason = $("leave-mobile-add-reason")?.value?.trim() || null;
    const autoApprove = Boolean($("leave-mobile-add-auto-approve")?.checked);
    if (!employeeId || !startDate || !endDate) {
      if (status) status.textContent = "Choose an employee and dates.";
      return;
    }
    if (submitBtn) submitBtn.disabled = true;
    if (status) status.textContent = "Saving…";
    try {
      const res = await apiFetch("/admin/leave/requests", {
        method: "POST",
        body: JSON.stringify({
          employee_id: employeeId,
          leave_type: leaveType,
          start_date: startDate,
          end_date: endDate,
          reason,
          auto_approve: autoApprove,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Could not add leave. If this is unavailable yet, staff can submit from the employee portal."
        );
      }
      balanceCache.clear();
      closeAddLeaveSheet();
      window.ShiftSwiftAction?.showActionToast?.(autoApprove ? "Leave logged as approved." : "Leave request added.", "ok");
      await loadRequests();
      setMobileTab(autoApprove ? "history" : "requests");
    } catch (error) {
      if (status) status.textContent = error.message || "Could not add leave.";
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function renderMobileLeaveShell() {
    const shell = $("leave-mobile-shell");
    if (!shell) return;
    if (!isMobileLeaveUi()) {
      shell.hidden = true;
      return;
    }
    shell.hidden = false;
    setMobileTab(mobileTab);
  }

  function bindSection() {
    if (sectionReady) return;
    sectionReady = true;

    document.querySelectorAll("[data-leave-filter]").forEach((btn) => {
      btn.addEventListener("click", () => setFilter(btn.dataset.leaveFilter ?? ""));
    });

    $("leave-search-input")?.addEventListener("input", (event) => {
      searchFilter = event.target.value;
      renderTable();
    });

    $("leave-detail-close")?.addEventListener("click", () => clearSelection());

    $("leave-browse-employees-btn")?.addEventListener("click", () => openEmployeePicker());
    $("leave-employee-filter-clear")?.addEventListener("click", () => {
      clearEmployeeFilter();
      renderTable();
    });
    $("leave-employee-picker-close")?.addEventListener("click", () => closeEmployeePicker());
    $("leave-employee-picker-backdrop")?.addEventListener("click", () => closeEmployeePicker());
    $("leave-employee-picker-search")?.addEventListener("input", (event) => {
      pickerSearch = event.target.value;
      renderEmployeePickerList();
    });

    document.querySelectorAll("[data-leave-mobile-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setMobileTab(btn.dataset.leaveMobileTab || "requests"));
    });
    $("leave-mobile-add-btn")?.addEventListener("click", () => openAddLeaveSheet());
    $("leave-mobile-add-close")?.addEventListener("click", () => closeAddLeaveSheet());
    $("leave-mobile-add-backdrop")?.addEventListener("click", () => closeAddLeaveSheet());
    $("leave-mobile-add-form")?.addEventListener("submit", (event) => void submitAddLeave(event));
    $("leave-mobile-cal-prev")?.addEventListener("click", () => {
      mobileCalCursor = new Date(mobileCalCursor.getFullYear(), mobileCalCursor.getMonth() - 1, 1);
      renderMobileCalendar();
    });
    $("leave-mobile-cal-next")?.addEventListener("click", () => {
      mobileCalCursor = new Date(mobileCalCursor.getFullYear(), mobileCalCursor.getMonth() + 1, 1);
      renderMobileCalendar();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("leave-mobile-add-sheet")?.hidden) {
        closeAddLeaveSheet();
        return;
      }
      if ($("leave-employee-picker")?.hidden) return;
      closeEmployeePicker();
    });

    window.addEventListener("resize", () => {
      if (!sectionReady) return;
      renderTable();
      renderMobileLeaveShell();
    });
  }

  window.addEventListener("admin:section", (event) => {
    if (parseHashBaseSection() !== "leave" && event.detail?.section !== "leave") return;
    bindSection();
    loadRequests();
  });

  if (parseHashBaseSection(window.location.hash) === "leave") {
    bindSection();
    loadRequests();
  }
})();
