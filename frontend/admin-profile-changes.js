/** Admin — employee contact detail change requests (HR approve/reject). */
(function initAdminProfileChanges() {
  const { apiFetch, escapeHtml, parseHashBaseSection, emptyStateHtml } = window.Admin;

  let sectionReady = false;
  let allRequests = [];
  let filterStatus = "pending";
  let searchFilter = "";
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
    if (filterStatus) {
      items = items.filter((item) => item.status === filterStatus);
    }
    const q = searchFilter.trim().toLowerCase();
    if (q) {
      items = items.filter((item) => String(item.employee_name || "").toLowerCase().includes(q));
    }
    return items;
  }

  function changesSummary(item) {
    const changes = item.changes || [];
    if (!changes.length) return "—";
    return changes.map((c) => escapeHtml(c.label || c.field)).join(", ");
  }

  function renderChangesList(changes) {
    if (!changes?.length) return `<p class="muted">No field changes recorded.</p>`;
    return `<dl class="hr-detail-grid profile-change-diff">
      ${changes
        .map(
          (c) => `<div>
            <dt>${escapeHtml(c.label || c.field)}</dt>
            <dd>
              <span class="profile-change-diff__old muted">${escapeHtml(c.old || "—")}</span>
              <span class="profile-change-diff__arrow" aria-hidden="true">→</span>
              <span class="profile-change-diff__new">${escapeHtml(c.new || "—")}</span>
            </dd>
          </div>`,
        )
        .join("")}
    </dl>`;
  }

  function computeStats(items) {
    const pending = allRequests.filter((item) => item.status === "pending").length;
    return { pending, visible: items.length };
  }

  function renderStats(items) {
    const stats = computeStats(items);
    const pendingEl = $("profile-change-stat-pending");
    const pendingSub = $("profile-change-stat-pending-sub");
    if (pendingEl) pendingEl.textContent = String(stats.pending);
    if (pendingSub) {
      pendingSub.textContent =
        stats.pending === 0 ? "Nothing waiting on you" : stats.pending === 1 ? "One update needs action" : "Awaiting your decision";
    }
    const sub = $("profile-change-register-sub");
    if (sub) {
      sub.textContent =
        stats.visible === 0
          ? "No requests match this filter"
          : `${stats.visible} request${stats.visible === 1 ? "" : "s"} in this view`;
    }
  }

  function syncDetailLayout() {
    const workspace = $("profile-change-workspace");
    const panel = $("profile-change-detail-panel");
    const guide = $("profile-change-guide-panel");
    const hasSelection = Boolean(selectedId);
    workspace?.classList.toggle("leave-workspace-layout--detail-open", hasSelection);
    if (panel) panel.hidden = !hasSelection;
    if (guide) guide.hidden = hasSelection;
  }

  function clearSelection() {
    selectedId = null;
    $("profile-change-detail-content")?.setAttribute("hidden", "");
    $("profile-change-detail-empty")?.removeAttribute("hidden");
    renderTable();
    syncDetailLayout();
  }

  function renderDetail(item) {
    const content = $("profile-change-detail-content");
    const empty = $("profile-change-detail-empty");
    if (!content || !item) return;
    empty?.setAttribute("hidden", "");
    content.hidden = false;
    content.innerHTML = `
      <div class="hr-detail-head">
        <div>
          <h3>${escapeHtml(item.employee_name)}</h3>
          <p class="muted">Contact detail update</p>
        </div>
        ${statusPill(item.status)}
      </div>
      ${renderChangesList(item.changes)}
      <dl class="hr-detail-grid">
        <div><dt>Submitted</dt><dd>${escapeHtml(formatDateTime(item.created_at))}</dd></div>
        ${item.employee_note ? `<div><dt>Employee note</dt><dd>${escapeHtml(item.employee_note)}</dd></div>` : ""}
        ${item.reviewed_by ? `<div><dt>Reviewed by</dt><dd>${escapeHtml(item.reviewed_by)}</dd></div>` : ""}
        ${item.reviewed_at ? `<div><dt>Reviewed at</dt><dd>${escapeHtml(formatDateTime(item.reviewed_at))}</dd></div>` : ""}
        ${item.review_note ? `<div><dt>Review note</dt><dd>${escapeHtml(item.review_note)}</dd></div>` : ""}
      </dl>
      ${
        item.status === "pending"
          ? `
        <label class="edit-field leave-review-field">
          <span class="edit-label">Note for employee <span class="muted">(optional)</span></span>
          <textarea id="profile-change-review-note" rows="3" maxlength="2000" placeholder="Reason for rejection or confirmation message…"></textarea>
        </label>
        <div class="hr-detail-foot leave-detail-foot">
          <button type="button" class="btn" id="profile-change-approve-btn">Approve</button>
          <button type="button" class="btn ghost" id="profile-change-reject-btn">Reject</button>
        </div>
        <p class="leave-review-status muted" id="profile-change-review-status" aria-live="polite"></p>`
          : `
        <div class="hr-detail-foot">
          <a class="btn ghost" href="#employees/${item.employee_id}">Open employee profile</a>
        </div>`
      }`;
    if (item.status === "pending") {
      content.querySelector("#profile-change-approve-btn")?.addEventListener("click", () => reviewRequest(item.id, "approved"));
      content.querySelector("#profile-change-reject-btn")?.addEventListener("click", () => reviewRequest(item.id, "rejected"));
    }
  }

  function selectRequest(requestId) {
    selectedId = requestId;
    const item = allRequests.find((row) => row.id === requestId);
    renderTable();
    if (item) renderDetail(item);
    syncDetailLayout();
  }

  function renderTable() {
    const tbody = $("profile-change-requests-body");
    if (!tbody) return;
    const items = filteredRequests();
    renderStats(items);

    if (!allRequests.length) {
      tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="4">${emptyStateHtml({
        icon: "user",
        title: "No contact detail updates yet",
        message: "When staff submit phone, address, or emergency contact changes in the employee portal, they appear here for approval.",
        compact: true,
      })}</td></tr>`;
      return;
    }

    if (!items.length) {
      tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="4">${emptyStateHtml({
        icon: "search",
        title: filterStatus === "pending" ? "No pending contact updates" : "No requests",
        message: searchFilter.trim()
          ? "Try a different search or clear the filter."
          : "When staff submit updates in the portal, they appear here for approval.",
        actionLabel: searchFilter.trim() ? "Clear search" : "Show all",
        actionId: "profile-change-clear-filter-btn",
        compact: true,
      })}</td></tr>`;
      document.getElementById("profile-change-clear-filter-btn")?.addEventListener("click", () => {
        if (searchFilter.trim()) {
          searchFilter = "";
          const input = $("profile-change-search-input");
          if (input) input.value = "";
        } else {
          setFilter("");
        }
        renderTable();
      });
      return;
    }

    tbody.innerHTML = items
      .map((item) => {
        const selected = selectedId === item.id ? " hr-register-row--selected" : "";
        return `<tr class="hr-register-row leave-register-row${selected}" data-profile-change-id="${item.id}">
          <td><strong>${escapeHtml(item.employee_name)}</strong>
            ${item.employee_note ? `<div class="muted leave-row-reason">${escapeHtml(item.employee_note.slice(0, 60))}${item.employee_note.length > 60 ? "…" : ""}</div>` : ""}
          </td>
          <td>${changesSummary(item)}</td>
          <td>${escapeHtml(formatDateTime(item.created_at))}</td>
          <td>${statusPill(item.status)}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll("[data-profile-change-id]").forEach((row) => {
      row.addEventListener("click", () => selectRequest(Number(row.dataset.profileChangeId)));
    });
  }

  function setFilter(status) {
    filterStatus = status;
    document.querySelectorAll("[data-profile-change-filter]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.profileChangeFilter === status);
    });
    if (selectedId && !filteredRequests().some((item) => item.id === selectedId)) {
      selectedId = null;
      $("profile-change-detail-content")?.setAttribute("hidden", "");
      $("profile-change-detail-empty")?.removeAttribute("hidden");
    }
    renderTable();
    syncDetailLayout();
  }

  async function loadRequests() {
    const tbody = $("profile-change-requests-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="muted">Loading contact detail updates…</td></tr>`;
    try {
      const res = await apiFetch("/admin/profile-changes/requests");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      allRequests = data.items || [];
      renderTable();
      if (selectedId) {
        const item = allRequests.find((row) => row.id === selectedId);
        if (item) renderDetail(item);
        else clearSelection();
      }
      syncDetailLayout();
    } catch {
      allRequests = [];
      if (tbody) {
        tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="4">${emptyStateHtml({
          icon: "alert",
          title: "Could not load updates",
          message: "Check your connection and try again.",
          actionLabel: "Retry",
          actionId: "profile-change-retry-btn",
          compact: true,
        })}</td></tr>`;
        document.getElementById("profile-change-retry-btn")?.addEventListener("click", () => loadRequests());
      }
    }
  }

  async function reviewRequest(requestId, decision) {
    if (reviewBusy) return;
    const noteEl = $("profile-change-review-note");
    const statusEl = $("profile-change-review-status");
    const reviewNote = noteEl?.value?.trim() || "";
    const btn = document.getElementById(
      decision === "approved" ? "profile-change-approve-btn" : "profile-change-reject-btn",
    );
    reviewBusy = true;

    const performReview = async () => {
      const res = await apiFetch(`/admin/profile-changes/requests/${requestId}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, review_note: reviewNote || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Review failed");
      await loadRequests();
      return decision === "approved" ? "Approved — employee record updated." : "Rejected.";
    };

    try {
      if (window.ShiftSwiftAction?.runButtonAction && btn) {
        await window.ShiftSwiftAction.runButtonAction(btn, statusEl, {
          loadingLabel: decision === "approved" ? "Approving…" : "Rejecting…",
          successMessage: decision === "approved" ? "Approved — employee record updated." : "Rejected.",
          errorMessage: "Could not update request.",
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
      window.alert(error.message || "Could not update request.");
    } finally {
      reviewBusy = false;
    }
  }

  function bindSection() {
    if (sectionReady) return;
    sectionReady = true;

    document.querySelectorAll("[data-profile-change-filter]").forEach((btn) => {
      btn.addEventListener("click", () => setFilter(btn.dataset.profileChangeFilter ?? ""));
    });

    $("profile-change-search-input")?.addEventListener("input", (event) => {
      searchFilter = event.target.value;
      renderTable();
    });

    $("profile-change-detail-close")?.addEventListener("click", () => clearSelection());
  }

  window.addEventListener("admin:section", (event) => {
    if (parseHashBaseSection() !== "profile-changes" && event.detail?.section !== "profile-changes") return;
    bindSection();
    loadRequests();
  });

  if (parseHashBaseSection(window.location.hash) === "profile-changes") {
    bindSection();
    loadRequests();
  }
})();
