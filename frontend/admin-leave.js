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
    return window.matchMedia("(max-width: 860px)").matches;
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
    if (isMobileLeave()) return;

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

  async function loadRequests() {
    const tbody = $("leave-requests-body");
    const mobileGrid = $("leave-mobile-grid");
    if (isMobileLeave() && mobileGrid) {
      mobileGrid.hidden = false;
      mobileGrid.innerHTML = `<p class="muted leave-mobile-grid__loading">Loading leave requests…</p>`;
      const tableWrap = document.querySelector("#leave .leave-table-wrap");
      if (tableWrap) tableWrap.hidden = true;
    } else if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">Loading leave requests…</td></tr>`;
    }
    try {
      const res = await apiFetch("/admin/leave/requests");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      allRequests = data.items || [];
      renderTable();
      if (selectedId) {
        const item = allRequests.find((row) => row.id === selectedId);
        if (item) await renderDetail(item);
        else clearSelection();
      }
      syncDetailLayout();
    } catch {
      allRequests = [];
      if (tbody) {
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
  }

  async function reviewRequest(requestId, decision) {
    if (reviewBusy) return;
    const noteEl = $("leave-review-note");
    const statusEl = $("leave-review-status");
    const reviewNote = noteEl?.value?.trim() || "";
    const btn = document.getElementById(decision === "approved" ? "leave-approve-btn" : "leave-reject-btn");
    reviewBusy = true;

    const performReview = async () => {
      const res = await apiFetch(`/admin/leave/requests/${requestId}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, review_note: reviewNote || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Review failed");
      await loadRequests();
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
      }
    } catch (error) {
      if (statusEl) statusEl.textContent = "";
      window.alert(error.message || "Could not update leave request.");
    } finally {
      reviewBusy = false;
    }
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

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if ($("leave-employee-picker")?.hidden) return;
      closeEmployeePicker();
    });

    window.addEventListener("resize", () => {
      if (!sectionReady) return;
      renderTable();
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
