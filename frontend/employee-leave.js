/** Employee portal — leave and holiday requests. */
(function initEmployeeLeave() {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const tenantId = localStorage.getItem("tenantId");

  if (!session.hasSession() || !tenantId) return;

  async function apiFetch(path, options = {}) {
    return session.fetchWithAuth(path, options, { apiBase: API_BASE, tenantId });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const form = document.getElementById("employee-leave-form");
  const listHost = document.getElementById("employee-leave-list");
  const balanceHost = document.getElementById("employee-leave-balance");
  const statusEl = document.getElementById("employee-leave-status");

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = tone === "ok" ? "edit-form-status punch-accountant-status--ok" : "edit-form-status muted";
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

  async function loadBalance() {
    if (!balanceHost) return;
    try {
      const res = await apiFetch("/employee/me/leave/balance");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      const text = `${data.remaining_days} of ${data.allowance_days} working days remaining (${data.used_days} used, ${data.pending_days} pending).`;
      setSummaryText("employee-leave-balance", text);
    } catch {
      setSummaryText("employee-leave-balance", "Leave balance unavailable.");
    }
  }

  async function loadRequests() {
    if (!listHost) return;
    listHost.innerHTML = `<p class="muted">Loading leave requests…</p>`;
    try {
      const res = await apiFetch("/employee/me/leave/requests");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      const items = data.items || [];
      if (!items.length) {
        listHost.innerHTML = `<p class="muted">No leave requests yet. Submit one below for HR approval.</p>`;
        return;
      }
      listHost.innerHTML = `<div class="employee-leave-list">${items
        .map(
          (item) => `<article class="card employee-leave-card">
            <div class="employee-leave-card__head">
              <strong>${escapeHtml(item.leave_type_label)}</strong>
              <span class="status-pill status-pill--${item.status === "approved" ? "ok" : item.status === "rejected" ? "danger" : "warn"}">${escapeHtml(item.status)}</span>
            </div>
            <p class="muted">${escapeHtml(formatDate(item.start_date))} → ${escapeHtml(formatDate(item.end_date))} · ${escapeHtml(String(item.days_requested))} working day(s)</p>
            ${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ""}
            ${
              item.status === "pending"
                ? `<button type="button" class="btn ghost employee-leave-cancel-btn" data-id="${item.id}">Cancel request</button>`
                : ""
            }
          </article>`
        )
        .join("")}</div>`;
      listHost.querySelectorAll(".employee-leave-cancel-btn").forEach((btn) => {
        btn.addEventListener("click", () => cancelRequest(Number(btn.dataset.id)));
      });
    } catch {
      listHost.innerHTML = `<p class="muted">Could not load leave requests.</p>`;
    }
  }

  async function cancelRequest(requestId) {
    try {
      const res = await apiFetch(`/employee/me/leave/requests/${requestId}/cancel`, { method: "POST", body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Cancel failed");
      await Promise.all([loadRequests(), loadBalance()]);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Submit failed");
      form.reset();
      setStatus("Leave request submitted for HR approval.", "ok");
      await Promise.all([loadRequests(), loadBalance()]);
    } catch (error) {
      setStatus(error.message || "Could not submit leave request.");
    }
  }

  form?.addEventListener("submit", submitForm);
  loadBalance();
  loadRequests();
})();
