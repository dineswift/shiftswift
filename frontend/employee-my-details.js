/** Employee portal — contact detail change requests (phone, address, emergency contact). */
(function initEmployeeMyDetails() {
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

  const form = document.getElementById("employee-details-form");
  const listHost = document.getElementById("employee-details-list");
  const statusEl = document.getElementById("employee-details-status");
  const pendingBanner = document.getElementById("employee-details-pending-banner");

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className =
      tone === "ok" ? "employee-leave-status employee-leave-status--ok" : "employee-leave-status muted";
  }

  function statusClass(status) {
    if (status === "approved") return "ok";
    if (status === "rejected" || status === "cancelled") return "danger";
    return "warn";
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

  function renderChangesHtml(changes) {
    if (!changes?.length) return "";
    return `<ul class="employee-details-change-list">
      ${changes
        .map(
          (c) =>
            `<li><strong>${escapeHtml(c.label)}</strong>: ${escapeHtml(c.old || "—")} → ${escapeHtml(c.new || "—")}</li>`,
        )
        .join("")}
    </ul>`;
  }

  function renderRequestCard(item) {
    const statusTone = statusClass(item.status);
    return `
      <article class="employee-leave-card">
        <div class="employee-leave-card__head">
          <div>
            <p class="employee-leave-card__type">Contact detail update</p>
            <p class="employee-leave-card__dates muted">${escapeHtml(formatDateTime(item.created_at))}</p>
          </div>
          <span class="employee-leave-pill employee-leave-pill--${statusTone}">${escapeHtml(item.status)}</span>
        </div>
        ${renderChangesHtml(item.changes)}
        ${item.review_note ? `<p class="employee-leave-card__reason muted">HR note: ${escapeHtml(item.review_note)}</p>` : ""}
        ${
          item.status === "pending"
            ? `<button type="button" class="btn ghost btn-sm employee-details-cancel-btn" data-id="${item.id}">Cancel request</button>`
            : ""
        }
      </article>`;
  }

  function fillForm(fields) {
    if (!form || !fields) return;
    Object.entries(fields).forEach(([key, value]) => {
      const input = form.elements.namedItem(key);
      if (input && "value" in input) input.value = value || "";
    });
  }

  async function loadDetails() {
    if (!localStorage.getItem("tenantId")) return;
    try {
      const res = await apiFetch("/employee/me/profile-changes/details");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(data, "Load failed"));
      fillForm(data.fields || {});
    } catch {
      setStatus("Could not load your current details.");
    }
  }

  async function loadRequests() {
    if (!listHost) return;
    if (!localStorage.getItem("tenantId")) {
      listHost.innerHTML = `<p class="employee-leave-placeholder muted">Loading your account…</p>`;
      return;
    }

    listHost.innerHTML = `<p class="employee-leave-placeholder muted">Loading your update requests…</p>`;

    try {
      const res = await apiFetch("/employee/me/profile-changes/requests");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        listHost.innerHTML = `<p class="employee-leave-placeholder muted">${escapeHtml(parseApiError(data, "Could not load requests."))}</p>`;
        return;
      }

      const items = data.items || [];
      const pending = items.find((item) => item.status === "pending");
      if (pendingBanner) {
        pendingBanner.hidden = !pending;
        if (pending) {
          pendingBanner.textContent =
            "You have a contact detail update waiting for HR approval. You cannot submit another until it is reviewed.";
        }
      }
      if (form) {
        form.querySelector('button[type="submit"]')?.toggleAttribute("disabled", Boolean(pending));
      }

      if (!items.length) {
        listHost.innerHTML = `<p class="employee-leave-placeholder muted">No update requests yet.</p>`;
        return;
      }

      listHost.innerHTML = `<div class="employee-leave-list">${items.map(renderRequestCard).join("")}</div>`;
      listHost.querySelectorAll(".employee-details-cancel-btn").forEach((btn) => {
        btn.addEventListener("click", () => cancelRequest(Number(btn.dataset.id)));
      });
    } catch {
      listHost.innerHTML = `<p class="employee-leave-placeholder muted">Could not reach the server.</p>`;
    }
  }

  async function cancelRequest(requestId) {
    setStatus("Cancelling…");
    try {
      const res = await apiFetch(`/employee/me/profile-changes/requests/${requestId}/cancel`, {
        method: "POST",
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(data, "Cancel failed"));
      setStatus("Request cancelled.", "ok");
      await loadData();
    } catch (error) {
      setStatus(error.message || "Could not cancel request.");
    }
  }

  async function submitForm(event) {
    event.preventDefault();
    if (!form) return;
    const fd = new FormData(form);
    setStatus("Submitting for HR approval…");
    try {
      const body = {
        phone: fd.get("phone") || null,
        home_address: fd.get("home_address") || null,
        emergency_contact_name: fd.get("emergency_contact_name") || null,
        emergency_contact_phone: fd.get("emergency_contact_phone") || null,
        emergency_contact_relationship: fd.get("emergency_contact_relationship") || null,
        employee_note: fd.get("employee_note") || null,
      };
      const res = await apiFetch("/employee/me/profile-changes/requests", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(data, "Submit failed"));
      setStatus("Update submitted for HR approval. You will receive an email when it is reviewed.", "ok");
      await loadData();
    } catch (error) {
      setStatus(error.message || "Could not submit update.");
    }
  }

  async function loadData() {
    await Promise.all([loadDetails(), loadRequests()]);
  }

  form?.addEventListener("submit", submitForm);
  loadData();
  window.addEventListener("employee:profile-loaded", loadData);
})();
