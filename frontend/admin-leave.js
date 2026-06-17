/** Admin — leave and holiday requests. */
(function initAdminLeave() {
  const { apiFetch, escapeHtml, parseHashBaseSection, emptyStateHtml } = window.Admin;

  let sectionReady = false;
  let filterStatus = "pending";

  function statusPill(status) {
    const tone =
      status === "approved" ? "ok" : status === "rejected" ? "danger" : status === "cancelled" ? "muted" : "warn";
    return `<span class="status-pill status-pill--${tone}">${escapeHtml(status)}</span>`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  async function loadRequests() {
    const tbody = document.getElementById("leave-requests-body");
    const pendingEl = document.getElementById("leave-pending-count");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="muted">Loading leave requests…</td></tr>`;
    try {
      const params = filterStatus ? `?status=${encodeURIComponent(filterStatus)}` : "";
      const res = await apiFetch(`/admin/leave/requests${params}`);
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      if (pendingEl) pendingEl.textContent = String(data.pending_count ?? 0);
      const items = data.items || [];
      if (!tbody) return;
      if (!items.length) {
        const filterLabel = filterStatus === "pending" ? "pending" : filterStatus || "matching";
        tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="7">${emptyStateHtml({
          icon: "calendar-off",
          title: filterStatus === "pending" ? "No pending leave requests" : "No leave requests",
          message:
            filterStatus === "pending"
              ? "When staff request holiday or leave in the portal, they appear here for approval."
              : `No ${filterLabel} leave requests in this view.`,
          actionLabel: "View employees",
          actionHref: "#employees",
          compact: true,
        })}</td></tr>`;
        return;
      }
      tbody.innerHTML = items
        .map(
          (item) => `<tr>
            <td>${escapeHtml(item.employee_name)}</td>
            <td>${escapeHtml(item.leave_type_label)}</td>
            <td>${escapeHtml(formatDate(item.start_date))}</td>
            <td>${escapeHtml(formatDate(item.end_date))}</td>
            <td>${escapeHtml(String(item.days_requested))}</td>
            <td>${statusPill(item.status)}</td>
            <td class="leave-actions-cell">
              ${
                item.status === "pending"
                  ? `<button type="button" class="btn ghost leave-approve-btn" data-id="${item.id}">Approve</button>
                     <button type="button" class="btn ghost leave-reject-btn" data-id="${item.id}">Reject</button>`
                  : `<span class="muted">${escapeHtml(item.reviewed_by || "—")}</span>`
              }
            </td>
          </tr>`
        )
        .join("");
      tbody.querySelectorAll(".leave-approve-btn").forEach((btn) => {
        btn.addEventListener("click", () => reviewRequest(Number(btn.dataset.id), "approved"));
      });
      tbody.querySelectorAll(".leave-reject-btn").forEach((btn) => {
        btn.addEventListener("click", () => reviewRequest(Number(btn.dataset.id), "rejected"));
      });
    } catch {
      if (tbody) {
        tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="7">${emptyStateHtml({
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
    const reviewNote =
      window.prompt(
        decision === "approved"
          ? "Optional note for the employee:"
          : "Optional reason for rejection:"
      ) || "";
    try {
      const res = await apiFetch(`/admin/leave/requests/${requestId}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, review_note: reviewNote || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Review failed");
      await loadRequests();
    } catch (error) {
      window.alert(error.message || "Could not update leave request.");
    }
  }

  function bindSection() {
    if (sectionReady) return;
    sectionReady = true;
    document.querySelectorAll("[data-leave-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filterStatus = btn.dataset.leaveFilter ?? "pending";
        document.querySelectorAll("[data-leave-filter]").forEach((el) => {
          el.classList.toggle("secondary", el === btn);
          el.classList.toggle("ghost", el !== btn);
        });
        loadRequests();
      });
    });
  }

  window.addEventListener("admin:section", (event) => {
    if (parseHashBaseSection() !== "leave" && event.detail?.section !== "leave") return;
    bindSection();
    loadRequests();
  });
})();
