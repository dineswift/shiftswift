/** Employee portal — leave and holiday requests. */
(function initEmployeeLeave() {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const loginUrl = session.EMPLOYEE_LOGIN_URL;

  if (!session.hasSession()) return;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function apiFetch(path, options = {}) {
    const tenantId = localStorage.getItem("tenantId");
    return session.fetchWithAuth(path, options, { apiBase: API_BASE, tenantId, loginUrl });
  }

  function parseApiError(data, fallback) {
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
    return fallback;
  }

  const form = document.getElementById("employee-leave-form");
  const listHost = document.getElementById("employee-leave-list");
  const balanceHost = document.getElementById("employee-leave-balance");
  const statusEl = document.getElementById("employee-leave-status");

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className =
      tone === "ok" ? "employee-leave-status employee-leave-status--ok" : "employee-leave-status muted";
  }

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function setSummaryText(sourceId, text) {
    const source = document.getElementById(sourceId);
    if (source) source.textContent = text;
    document.querySelectorAll(`[data-mirror="${sourceId}"]`).forEach((el) => {
      el.textContent = text;
    });
  }

  function statusClass(status) {
    if (status === "approved") return "ok";
    if (status === "rejected" || status === "cancelled") return "danger";
    return "warn";
  }

  function renderListPlaceholder(text, { retry = false } = {}) {
    if (!listHost) return;
    listHost.innerHTML = `
      <div class="employee-leave-empty">
        <p class="employee-leave-empty__text muted">${escapeHtml(text)}</p>
        ${retry ? '<button type="button" class="btn ghost btn-sm" id="employee-leave-retry">Try again</button>' : ""}
      </div>`;
    if (retry) {
      document.getElementById("employee-leave-retry")?.addEventListener("click", loadLeaveData);
    }
  }

  function renderRequestCard(item) {
    const status = escapeHtml(item.status);
    const statusTone = statusClass(item.status);
    return `
      <article class="employee-leave-card">
        <div class="employee-leave-card__head">
          <div>
            <p class="employee-leave-card__type">${escapeHtml(item.leave_type_label)}</p>
            <p class="employee-leave-card__dates">
              ${escapeHtml(formatDate(item.start_date))} → ${escapeHtml(formatDate(item.end_date))}
            </p>
          </div>
          <span class="employee-leave-pill employee-leave-pill--${statusTone}">${status}</span>
        </div>
        <p class="employee-leave-card__days muted">${escapeHtml(String(item.days_requested))} working day(s)</p>
        ${item.reason ? `<p class="employee-leave-card__reason">${escapeHtml(item.reason)}</p>` : ""}
        ${
          item.status === "pending"
            ? `<button type="button" class="btn ghost btn-sm employee-leave-cancel-btn" data-id="${item.id}">Cancel request</button>`
            : ""
        }
      </article>`;
  }

  async function loadBalance() {
    if (!localStorage.getItem("tenantId")) {
      setSummaryText("employee-leave-balance", "Loading balance…");
      return;
    }
    try {
      const res = await apiFetch("/employee/me/leave/balance");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(data, "Load failed"));
      const text = `${data.remaining_days} of ${data.allowance_days} working days remaining (${data.used_days} used, ${data.pending_days} pending).`;
      setSummaryText("employee-leave-balance", text);
    } catch {
      setSummaryText("employee-leave-balance", "Leave balance unavailable.");
    }
  }

  async function loadRequests() {
    if (!listHost) return;
    if (!localStorage.getItem("tenantId")) {
      renderListPlaceholder("Loading your account…");
      return;
    }

    renderListPlaceholder("Loading leave requests…");

    try {
      const res = await apiFetch("/employee/me/leave/requests");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        renderListPlaceholder(parseApiError(data, "Could not load leave requests."), { retry: true });
        return;
      }

      const items = data.items || [];
      if (!items.length) {
        renderListPlaceholder("No leave requests yet. Submit one above for HR approval.");
        return;
      }

      listHost.innerHTML = `<div class="employee-leave-list">${items.map(renderRequestCard).join("")}</div>`;
      listHost.querySelectorAll(".employee-leave-cancel-btn").forEach((btn) => {
        btn.addEventListener("click", () => cancelRequest(Number(btn.dataset.id)));
      });
    } catch {
      renderListPlaceholder("Could not reach the server. Check your connection.", { retry: true });
    }
  }

  async function cancelRequest(requestId) {
    setStatus("Cancelling…");
    try {
      const res = await apiFetch(`/employee/me/leave/requests/${requestId}/cancel`, {
        method: "POST",
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(data, "Cancel failed"));
      setStatus("Request cancelled.", "ok");
      await loadLeaveData();
    } catch (error) {
      setStatus(error.message || "Could not cancel request.");
    }
  }

  async function submitForm(event) {
    event.preventDefault();
    if (!form) return;
    const fd = new FormData(form);
    setStatus("Submitting…");
    try {
      const res = await apiFetch("/employee/me/leave/requests", {
        method: "POST",
        body: JSON.stringify({
          leave_type: fd.get("leave_type"),
          start_date: fd.get("start_date"),
          end_date: fd.get("end_date"),
          reason: fd.get("reason") || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(data, "Submit failed"));
      form.reset();
      setStatus("Leave request submitted for HR approval.", "ok");
      await loadLeaveData();
    } catch (error) {
      setStatus(error.message || "Could not submit leave request.");
    }
  }

  async function loadLeaveData() {
    await Promise.all([loadBalance(), loadRequests()]);
  }

  form?.addEventListener("submit", submitForm);
  loadLeaveData();
  window.addEventListener("employee:profile-loaded", loadLeaveData);
})();
