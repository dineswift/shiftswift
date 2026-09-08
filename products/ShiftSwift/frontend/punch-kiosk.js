(function () {
  const API_BASE =
    localStorage.getItem("apiBaseUrl") ||
    (window.ShiftSwiftBrand?.resolveApiBase ? window.ShiftSwiftBrand.resolveApiBase() : "http://localhost:3000");

  const params = new URLSearchParams(window.location.search);
  const clockToken = params.get("clock") || "";

  const siteNameEl = document.getElementById("kiosk-site-name");
  const pinView = document.getElementById("kiosk-pin-view");
  const punchView = document.getElementById("kiosk-punch-view");
  const pinForm = document.getElementById("kiosk-pin-form");
  const pinStatus = document.getElementById("kiosk-pin-status");
  const userLine = document.getElementById("kiosk-user-line");
  const stateLine = document.getElementById("kiosk-state-line");
  const messageEl = document.getElementById("kiosk-message");
  const inBtn = document.getElementById("kiosk-in-btn");
  const outBtn = document.getElementById("kiosk-out-btn");
  const breakStartBtn = document.getElementById("kiosk-break-start-btn");
  const breakEndBtn = document.getElementById("kiosk-break-end-btn");
  const switchBtn = document.getElementById("kiosk-switch-user");

  let sessionToken = null;
  let workState = "off";
  let employeeName = "";

  function setMessage(text, tone) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.className = tone ? `kiosk-message kiosk-message--${tone}` : "kiosk-message";
  }

  function setPinStatus(text) {
    if (!pinStatus) return;
    pinStatus.textContent = text || "";
    pinStatus.hidden = !text;
  }

  function syncButtons() {
    if (inBtn) inBtn.disabled = workState !== "off";
    if (outBtn) outBtn.disabled = workState !== "clocked_in";
    if (breakStartBtn) breakStartBtn.disabled = workState !== "clocked_in";
    if (breakEndBtn) {
      breakEndBtn.hidden = workState !== "on_break";
      breakEndBtn.disabled = workState !== "on_break";
    }
    if (breakStartBtn) breakStartBtn.hidden = workState === "on_break";
    if (stateLine) {
      stateLine.textContent =
        workState === "off"
          ? "Not clocked in"
          : workState === "on_break"
            ? "On break"
            : "Clocked in";
    }
  }

  async function postJson(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Request failed");
    return data;
  }

  async function loadSite() {
    if (!clockToken) {
      setPinStatus("Missing site code. Open this page from Admin → Time punch → Open kiosk.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/time-punch/kiosk/site?clock=${encodeURIComponent(clockToken)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Invalid kiosk link");
      if (siteNameEl) siteNameEl.textContent = data.site_name || "Work site";
    } catch (error) {
      setPinStatus(error.message || "Could not load site.");
    }
  }

  async function startSession(form) {
    setPinStatus("Checking PIN…");
    try {
      const data = await postJson("/time-punch/kiosk/session", {
        clock_token: clockToken,
        employee_id: Number(form.employee_id.value),
        pin: form.pin.value,
      });
      sessionToken = data.session_token;
      employeeName = data.employee_name || "Employee";
      workState = data.work_state || "off";
      if (userLine) userLine.textContent = employeeName;
      pinView.hidden = true;
      punchView.hidden = false;
      setPinStatus("");
      syncButtons();
      setMessage(`Welcome, ${employeeName}.`, "ok");
    } catch (error) {
      setPinStatus(error.message || "Sign-in failed.");
    }
  }

  async function submitPunch(type) {
    if (!sessionToken) return;
    setMessage("Submitting…");
    try {
      const data = await postJson("/time-punch/kiosk/punch", {
        session_token: sessionToken,
        punch_type: type,
      });
      workState = data.work_state || workState;
      syncButtons();
      const labels = {
        in: "Clocked in",
        out: "Clocked out",
        break_start: "Break started",
        break_end: "Break ended",
      };
      setMessage(`${labels[type] || "Recorded"} at ${data.site_name || "site"}.`, "ok");
      if (type === "out") {
        setTimeout(() => switchUser(), 1500);
      }
    } catch (error) {
      setMessage(error.message || "Punch failed.", "err");
    }
  }

  function switchUser() {
    sessionToken = null;
    workState = "off";
    employeeName = "";
    if (pinForm) pinForm.reset();
    punchView.hidden = true;
    pinView.hidden = false;
    setMessage("");
    syncButtons();
  }

  pinForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    startSession(event.currentTarget);
  });
  inBtn?.addEventListener("click", () => submitPunch("in"));
  outBtn?.addEventListener("click", () => submitPunch("out"));
  breakStartBtn?.addEventListener("click", () => submitPunch("break_start"));
  breakEndBtn?.addEventListener("click", () => submitPunch("break_end"));
  switchBtn?.addEventListener("click", switchUser);

  loadSite();
  syncButtons();
})();
