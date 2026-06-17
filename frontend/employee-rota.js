(function () {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const loginUrl = session.EMPLOYEE_LOGIN_URL;

  if (!session.hasSession()) return;

  const listEl = document.getElementById("employee-week-shifts");
  const messageEl = document.getElementById("employee-shift-message");

  async function apiFetch(path, options = {}) {
    const tenantId = localStorage.getItem("tenantId");
    return session.fetchWithAuth(path, options, { apiBase: API_BASE, tenantId, loginUrl });
  }

  function setMessage(text) {
    if (messageEl) messageEl.textContent = text || "";
  }

  async function requestCover(shiftId) {
    const note = window.prompt("Why do you need cover? (optional note)") || "";
    const targetRaw = window.prompt("Colleague employee ID for cover (ask HR if unsure):") || "";
    const targetEmployeeId = targetRaw.trim() ? Number(targetRaw) : null;
    if (!targetEmployeeId) {
      setMessage("Cover request needs a colleague employee ID — ask your manager.");
      return;
    }
    setMessage("Submitting cover request…");
    const res = await apiFetch(`/rota/shifts/${shiftId}/requests`, {
      method: "POST",
      body: JSON.stringify({
        request_type: "cover",
        target_employee_id: targetEmployeeId,
        note,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.detail?.message || data.detail || "Request failed.");
      return;
    }
    setMessage("Cover request sent to your manager.");
  }

  async function loadShifts() {
    if (!listEl) return;
    if (!localStorage.getItem("tenantId")) return;
    try {
      const res = await apiFetch("/rota/my-shifts", { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        listEl.innerHTML = "<li class=\"muted\">Could not load shifts.</li>";
        return;
      }
      const items = data.shifts || [];
      if (!items.length) {
        listEl.innerHTML = "<li class=\"muted\">No published shifts this week yet.</li>";
        return;
      }
      listEl.innerHTML = items
        .map((s) => {
          const day = new Date(`${s.shift_date}T12:00:00`).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
          return `<li class="employee-shift-item"><span><strong>${day}</strong> ${s.start_time}–${s.end_time}${s.role_label ? ` · ${s.role_label}` : ""}</span> <button type="button" class="btn ghost btn-sm" data-cover-shift="${s.id}">Request cover</button></li>`;
        })
        .join("");
      listEl.querySelectorAll("[data-cover-shift]").forEach((btn) => {
        btn.addEventListener("click", () => requestCover(Number(btn.getAttribute("data-cover-shift"))));
      });
    } catch {
      listEl.innerHTML = "<li class=\"muted\">Could not load shifts.</li>";
    }
  }

  loadShifts();
  window.addEventListener("employee:profile-loaded", loadShifts);
})();
