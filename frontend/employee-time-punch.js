(function () {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const tenantId = localStorage.getItem("tenantId");

  if (!session.hasSession() || !tenantId) return;

  const statusEl = document.getElementById("punch-work-state-label");
  const sitesEl = document.getElementById("punch-sites");
  const messageEl = document.getElementById("punch-message");
  const geofenceEl = document.getElementById("punch-geofence-status");
  const clockInBtn = document.getElementById("punch-in-btn");
  const reclockBtn = document.getElementById("punch-reclock-btn");
  const cooldownNoteEl = document.getElementById("punch-cooldown-note");
  const clockOutBtn = document.getElementById("punch-out-btn");
  const breakStartBtn = document.getElementById("punch-break-start-btn");
  const breakEndBtn = document.getElementById("punch-break-end-btn");
  const outDuringBreakBtn = document.getElementById("punch-out-during-break-btn");
  const phaseSecondaryEl = document.getElementById("punch-phase-secondary");
  const reclockDialog = document.getElementById("punch-reclock-dialog");
  const reclockDialogCopy = document.getElementById("punch-reclock-dialog-copy");
  const reclockCancelBtn = document.getElementById("punch-reclock-cancel");
  const expectedEl = document.getElementById("employee-expected-shift");
  const scanBtn = document.getElementById("punch-scan-btn");
  const siteScanStatusEl = document.getElementById("punch-site-scan-status");
  const scanDialog = document.getElementById("punch-scan-dialog");
  const scanVideo = document.getElementById("punch-scan-video");
  const scanMessageEl = document.getElementById("punch-scan-message");
  const scanManualInput = document.getElementById("punch-scan-manual");
  const scanManualBtn = document.getElementById("punch-scan-manual-btn");
  const scanCloseBtn = document.getElementById("punch-scan-close");

  const SITE_SCAN_KEY = "employeePortalSiteScan";
  const SITE_SCAN_TTL_MS = 10 * 60 * 1000;
  const DEFAULT_COOLDOWN_SECONDS = 90;

  let punchInFlight = false;
  let workState = "off";
  let geofenceWithin = false;
  let geofenceCheckInFlight = false;
  let geofencePreview = null;
  let siteScanReady = false;
  let siteScanToken = null;
  let siteScanName = "";
  let secondsSinceClockOut = null;
  let breakStartedAt = null;
  let clockInCooldownSeconds = DEFAULT_COOLDOWN_SECONDS;
  let scanStream = null;
  let scanFrameHandle = null;

  function authHeaders(json = true) {
    return session.authHeaders({ json, tenantId });
  }

  async function apiFetch(path, options = {}) {
    return session.fetchWithAuth(path, options, {
      apiBase: API_BASE,
      tenantId,
      loginUrl: session.EMPLOYEE_LOGIN_URL,
    });
  }

  function parseApiError(data, fallback) {
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail?.message) return detail.message;
    return data?.message || fallback;
  }

  function setMessage(text, type) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.className = type ? `punch-message punch-message--${type}` : "punch-message";
  }

  function setGeofenceStatus(text, tone) {
    if (!geofenceEl) return;
    geofenceEl.textContent = text || "";
    geofenceEl.hidden = !text;
    geofenceEl.className = tone
      ? `punch-geofence-status punch-geofence-status--${tone}`
      : "punch-geofence-status";
  }

  function setSiteScanStatus(text) {
    if (!siteScanStatusEl) return;
    if (text) {
      siteScanStatusEl.textContent = text;
      siteScanStatusEl.hidden = false;
    } else {
      siteScanStatusEl.textContent = "";
      siteScanStatusEl.hidden = true;
    }
  }

  function clockInReady() {
    return geofenceWithin || siteScanReady;
  }

  function inCooldownWindow() {
    return (
      workState === "off" &&
      secondsSinceClockOut != null &&
      secondsSinceClockOut >= 0 &&
      secondsSinceClockOut < clockInCooldownSeconds
    );
  }

  function formatDurationSince(iso) {
    if (!iso) return "";
    try {
      const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins} min`;
      const hours = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem ? `${hours}h ${rem}m` : `${hours}h`;
    } catch {
      return "";
    }
  }

  function formatTimeShort(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function syncClockWidget() {
    const online = navigator.onLine;
    const readyIn = clockInReady();
    const cooldown = inCooldownWindow();
    const canClockIn = workState === "off" && !cooldown;
    const working = workState === "clocked_in";
    const onBreak = workState === "on_break";
    const geofenceRow = document.querySelector(".punch-geofence-row");
    if (geofenceRow) geofenceRow.hidden = workState !== "off";

    if (clockInBtn) {
      clockInBtn.hidden = cooldown;
      clockInBtn.disabled =
        !canClockIn || punchInFlight || !online || !readyIn || geofenceCheckInFlight;
      clockInBtn.classList.toggle("is-ready", canClockIn && readyIn && online && !punchInFlight);
      clockInBtn.classList.toggle("is-idle", working || onBreak);
      clockInBtn.setAttribute("aria-pressed", working || onBreak ? "true" : "false");
    }

    if (reclockBtn) {
      reclockBtn.hidden = !(workState === "off" && cooldown);
      reclockBtn.disabled = punchInFlight || !online || !readyIn || geofenceCheckInFlight;
    }

    if (cooldownNoteEl) {
      if (workState === "off" && cooldown) {
        cooldownNoteEl.hidden = false;
        cooldownNoteEl.textContent = `You clocked out ${secondsSinceClockOut} sec ago — confirm if clocking in again.`;
      } else {
        cooldownNoteEl.hidden = true;
        cooldownNoteEl.textContent = "";
      }
    }

    if (clockOutBtn) {
      clockOutBtn.hidden = onBreak;
      clockOutBtn.disabled = punchInFlight || !online || !working;
      clockOutBtn.classList.toggle("is-active-out", working && online && !punchInFlight);
      clockOutBtn.classList.toggle("is-idle-out", !working);
    }

    if (breakEndBtn) {
      breakEndBtn.hidden = !onBreak;
      breakEndBtn.disabled = punchInFlight || !online || !onBreak;
    }

    if (breakStartBtn) {
      breakStartBtn.hidden = !working;
      breakStartBtn.disabled = punchInFlight || !online || !working;
    }

    if (outDuringBreakBtn) {
      outDuringBreakBtn.hidden = !onBreak;
      outDuringBreakBtn.disabled = punchInFlight || !online || !onBreak;
    }

    if (phaseSecondaryEl) {
      phaseSecondaryEl.hidden = !working && !onBreak;
    }
  }

  function formatTime(iso) {
    if (!iso) return "Not set";
    try {
      return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return iso;
    }
  }

  function updateWorkStateLabel(data) {
    if (!statusEl) return;
    const last = data?.last_punch;
    if (data?.work_state === "on_break") {
      const since = formatTimeShort(data.break_started_at || last?.punched_at);
      const duration = formatDurationSince(data.break_started_at || last?.punched_at);
      statusEl.innerHTML = `<strong>On break</strong> since ${since}${duration ? ` · ${duration}` : ""}.`;
      statusEl.className = "punch-work-state-label punch-work-state-label--break";
      return;
    }
    if (data?.work_state === "clocked_in") {
      statusEl.innerHTML = `<strong>Working</strong> since ${formatTimeShort(last?.punched_at)} at ${last?.site_name || "work site"}.`;
      statusEl.className = "punch-work-state-label punch-work-state-label--working";
      return;
    }
    if (secondsSinceClockOut != null && data?.last_punch?.punch_type === "out") {
      statusEl.textContent = `Clocked out ${secondsSinceClockOut < 60 ? `${secondsSinceClockOut} sec` : formatDurationSince(last?.punched_at)} ago.`;
      statusEl.className = "punch-work-state-label";
      return;
    }
    if (geofencePreview?.within_geofence) {
      statusEl.textContent = `On site · within ${geofencePreview.site_name || "your site"}.`;
    } else if (siteScanReady) {
      statusEl.textContent = `Premises verified — ${siteScanName}.`;
    } else {
      statusEl.textContent = "Not clocked in.";
    }
    statusEl.className = "punch-work-state-label muted";
  }

  function updatePunchSummary(data) {
    let text = "Ready to clock in";
    if (data?.work_state === "on_break") {
      text = `On break since ${formatTimeShort(data.break_started_at || data.last_punch?.punched_at)}`;
    } else if (data?.work_state === "clocked_in") {
      text = `Working since ${formatTimeShort(data.last_punch?.punched_at)}`;
    } else if (data?.last_punch?.punch_type === "out") {
      text = `Clocked out at ${formatTimeShort(data.last_punch?.punched_at)}`;
    }
    document.querySelectorAll("[data-mirror='employee-punch-summary']").forEach((el) => {
      el.textContent = text;
    });
    const summary = document.getElementById("employee-punch-summary");
    if (summary) summary.textContent = text;
  }

  async function loadStatus() {
    if (!statusEl || !navigator.onLine) return;
    try {
      const response = await apiFetch("/time-punch/status", { method: "GET", headers: authHeaders(false) });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        statusEl.textContent = parseApiError(err, "Could not load punch status.");
        return;
      }
      const data = await response.json();
      workState = data.work_state || (data.clocked_in ? "clocked_in" : "off");
      secondsSinceClockOut = data.seconds_since_clock_out ?? null;
      breakStartedAt = data.break_started_at || null;
      clockInCooldownSeconds = Number(data.clock_in_cooldown_seconds) || DEFAULT_COOLDOWN_SECONDS;
      updateWorkStateLabel(data);
      if (sitesEl) {
        const sites = data.assigned_sites || [];
        sitesEl.innerHTML = sites.length
          ? sites.map((s) => `<li>${s.name}: ${s.address} (${s.radius_meters}m radius)</li>`).join("")
          : "<li>No punch sites configured. Ask HR to sync a site in Admin → Time punch.</li>";
      }
      if (expectedEl && data.expected_shift_today) {
        const s = data.expected_shift_today;
        expectedEl.hidden = false;
        expectedEl.innerHTML = `<strong>Today’s shift</strong> ${s.start_time}–${s.end_time}${s.role_label ? ` · ${s.role_label}` : ""}`;
      } else if (expectedEl) {
        expectedEl.hidden = true;
      }
      updatePunchSummary(data);
      syncClockWidget();
      refreshGeofencePreview();
    } catch {
      statusEl.textContent = "Could not reach the time punch service.";
    }
  }

  function loadSiteScanSession() {
    try {
      const raw = sessionStorage.getItem(SITE_SCAN_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.expires_at || Date.now() > data.expires_at) return null;
      return data;
    } catch {
      return null;
    }
  }

  function saveSiteScanSession(data) {
    sessionStorage.setItem(
      SITE_SCAN_KEY,
      JSON.stringify({
        ...data,
        expires_at: Date.now() + SITE_SCAN_TTL_MS,
      }),
    );
  }

  function clearSiteScanSession() {
    sessionStorage.removeItem(SITE_SCAN_KEY);
    siteScanReady = false;
    siteScanToken = null;
    siteScanName = "";
    setSiteScanStatus("");
    syncClockWidget();
  }

  function applySiteScanSession(data) {
    siteScanReady = true;
    siteScanToken = data.token;
    siteScanName = data.site_name || "your site";
    saveSiteScanSession(data);
    setSiteScanStatus(`Premises verified — ${siteScanName}. You can clock in or out without GPS.`);
    syncClockWidget();
  }

  function restoreSiteScanSession() {
    const saved = loadSiteScanSession();
    if (saved) {
      applySiteScanSession(saved);
      return true;
    }
    clearSiteScanSession();
    return false;
  }

  function extractClockTokenFromText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    try {
      const url = new URL(trimmed, window.location.origin);
      const fromQuery = url.searchParams.get("clock");
      if (fromQuery) return fromQuery;
    } catch {
      /* not a URL */
    }
    if (/^[A-Za-z0-9_-]{16,}$/.test(trimmed)) return trimmed;
    return null;
  }

  async function validateSiteScan(clockToken) {
    const tokenValue = extractClockTokenFromText(clockToken);
    if (!tokenValue) {
      throw new Error("Could not read a premises code from that QR.");
    }
    const response = await apiFetch("/time-punch/scan", {
      method: "POST",
      body: JSON.stringify({ clock_token: tokenValue }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(parseApiError(data, "Could not verify premises QR."));
    }
    applySiteScanSession({
      token: tokenValue,
      site_id: data.site_id,
      site_name: data.site_name,
    });
    setMessage(data.message || `Premises verified — ${data.site_name}.`, "success");
    if (scanDialog?.open) scanDialog.close();
    stopQrScanner();
    return data;
  }

  function stopQrScanner() {
    if (scanFrameHandle) {
      cancelAnimationFrame(scanFrameHandle);
      scanFrameHandle = null;
    }
    if (scanStream) {
      scanStream.getTracks().forEach((track) => track.stop());
      scanStream = null;
    }
    if (scanVideo) scanVideo.srcObject = null;
  }

  async function startQrScanner() {
    if (!scanDialog || !scanVideo) return;
    if (scanMessageEl) scanMessageEl.textContent = "";
    stopQrScanner();

    if (!("BarcodeDetector" in window)) {
      if (scanMessageEl) {
        scanMessageEl.textContent =
          "Camera QR scan is not supported here. Paste the premises link below instead.";
      }
      return;
    }

    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      scanVideo.srcObject = scanStream;
      await scanVideo.play();
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!scanVideo.srcObject) return;
        try {
          const codes = await detector.detect(scanVideo);
          const value = codes[0]?.rawValue;
          if (value) {
            await validateSiteScan(value);
            return;
          }
        } catch {
          /* keep scanning */
        }
        scanFrameHandle = requestAnimationFrame(tick);
      };
      scanFrameHandle = requestAnimationFrame(tick);
    } catch {
      if (scanMessageEl) {
        scanMessageEl.textContent = "Camera access denied. Paste the premises link below instead.";
      }
    }
  }

  function friendlyGeoError(error) {
    if (error?.code === 1) return "Location permission denied. Enable location in your device settings.";
    if (error?.code === 2) return "Location unavailable. Try moving outdoors or scan the premises QR.";
    if (error?.code === 3) return "Location timed out. Check GPS or scan the premises QR.";
    return error?.message || "Could not read your location.";
  }

  function readLocationOnce(options) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location is not supported on this device."));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }

  async function readLocation() {
    const primary = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };
    try {
      const pos = await readLocationOnce(primary);
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_meters: pos.coords.accuracy,
      };
    } catch (firstError) {
      if (firstError?.code !== 3) {
        throw new Error(friendlyGeoError(firstError));
      }
      const pos = await readLocationOnce({ enableHighAccuracy: false, timeout: 25000, maximumAge: 15000 });
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_meters: pos.coords.accuracy,
      };
    }
  }

  function maybePromptPushNotifications() {
    if (!window.ShiftSwiftPush) return;
    window.ShiftSwiftPush.promptSubscribe({
      apiBase: API_BASE,
      token: session.getToken(),
      tenantId,
      reason: "Get shift reminders and clock-in alerts on this device.",
    }).catch(() => null);
  }

  async function refreshGeofencePreview() {
    if (!geofenceEl || !navigator.onLine || siteScanReady) return;
    if (geofenceCheckInFlight) return;

    geofenceCheckInFlight = true;
    geofenceWithin = false;
    setGeofenceStatus("Getting your location…", "loading");
    syncClockWidget();

    try {
      const location = await readLocation();
      const response = await apiFetch("/time-punch/preview", {
        method: "POST",
        body: JSON.stringify(location),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setGeofenceStatus(parseApiError(data, "Could not verify your location."), "error");
        return;
      }

      geofenceWithin = Boolean(data.within_geofence);
      geofencePreview = data;
      const accuracyNote =
        data.accuracy_meters != null ? ` GPS accuracy ±${Math.round(data.accuracy_meters)}m.` : "";
      setGeofenceStatus(`${data.message}${accuracyNote}`, geofenceWithin ? "ok" : "warn");
      if (workState === "off") {
        updateWorkStateLabel({
          work_state: workState,
          last_punch: null,
        });
      }
      if (geofenceWithin) maybePromptPushNotifications();
    } catch (error) {
      setGeofenceStatus(error.message || "Could not read your location.", "error");
    } finally {
      geofenceCheckInFlight = false;
      syncClockWidget();
    }
  }

  function punchTypeLabel(punchType) {
    return (
      {
        in: "Clocked in",
        out: "Clocked out",
        break_start: "Break started",
        break_end: "Break ended",
      }[punchType] || "Punch recorded"
    );
  }

  function requestClockIn(force = false) {
    if (inCooldownWindow() && !force) {
      if (reclockDialogCopy) {
        reclockDialogCopy.textContent = `You clocked out ${secondsSinceClockOut} seconds ago — clock in again? This will be flagged for HR review.`;
      }
      if (reclockDialog?.showModal) reclockDialog.showModal();
      else if (reclockDialog) reclockDialog.open = true;
      return;
    }
    void submitPunch("in");
  }

  async function submitPunch(punchType) {
    if (punchInFlight || !navigator.onLine) {
      setMessage("Connect to the internet to clock in or out.", "error");
      return;
    }
    const needsSiteCheck = punchType === "in";
    if (needsSiteCheck && !clockInReady()) {
      setMessage("Move within your site geofence or scan the premises QR code first.", "error");
      return;
    }

    punchInFlight = true;
    syncClockWidget();
    setMessage("Submitting punch…", "info");

    try {
      let response;
      let data;
      if (needsSiteCheck && siteScanReady && siteScanToken) {
        response = await apiFetch("/time-punch/punch-site", {
          method: "POST",
          body: JSON.stringify({ punch_type: punchType, clock_token: siteScanToken }),
        });
        data = await response.json().catch(() => ({}));
      } else if (needsSiteCheck) {
        setMessage("Reading your location…", "info");
        const location = await readLocation();
        response = await apiFetch("/time-punch/punch", {
          method: "POST",
          body: JSON.stringify({ punch_type: punchType, ...location }),
        });
        data = await response.json().catch(() => ({}));
      } else if (siteScanReady && siteScanToken) {
        response = await apiFetch("/time-punch/punch-site", {
          method: "POST",
          body: JSON.stringify({ punch_type: punchType, clock_token: siteScanToken }),
        });
        data = await response.json().catch(() => ({}));
      } else {
        setMessage("Reading your location…", "info");
        const location = await readLocation();
        response = await apiFetch("/time-punch/punch", {
          method: "POST",
          body: JSON.stringify({ punch_type: punchType, ...location }),
        });
        data = await response.json().catch(() => ({}));
      }
      if (!response.ok) {
        setMessage(parseApiError(data, "Punch failed."), "error");
        return;
      }
      let detail = `${punchTypeLabel(punchType)} at ${data.site_name}`;
      if (data.punch_method === "site_qr") detail += " (premises QR)";
      else if (data.distance_meters != null) detail += ` (${Math.round(data.distance_meters)}m from site)`;
      if (data.rapid_re_punch) detail += " — flagged for HR review.";
      setMessage(`${detail}.`, "success");
      await loadStatus();
      window.EmployeeTimesheet?.reload?.();
    } catch (error) {
      setMessage(error.message || "Punch failed.", "error");
    } finally {
      punchInFlight = false;
      syncClockWidget();
    }
  }

  scanBtn?.addEventListener("click", () => {
    if (scanDialog?.showModal) scanDialog.showModal();
    else if (scanDialog) scanDialog.open = true;
    void startQrScanner();
  });

  scanCloseBtn?.addEventListener("click", () => {
    stopQrScanner();
    if (scanDialog?.close) scanDialog.close();
  });

  scanManualBtn?.addEventListener("click", () => {
    const value = scanManualInput?.value || "";
    validateSiteScan(value).catch((error) => {
      if (scanMessageEl) scanMessageEl.textContent = error.message || "Could not verify code.";
    });
  });

  scanDialog?.addEventListener("close", stopQrScanner);

  clockInBtn?.addEventListener("click", () => requestClockIn(false));
  reclockBtn?.addEventListener("click", () => requestClockIn(false));
  reclockDialog?.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    reclockDialog?.close();
    void submitPunch("in");
  });
  reclockCancelBtn?.addEventListener("click", () => reclockDialog?.close());
  clockOutBtn?.addEventListener("click", () => submitPunch("out"));
  breakStartBtn?.addEventListener("click", () => submitPunch("break_start"));
  breakEndBtn?.addEventListener("click", () => submitPunch("break_end"));
  outDuringBreakBtn?.addEventListener("click", () => submitPunch("out"));
  window.addEventListener("online", loadStatus);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && navigator.onLine) loadStatus();
  });

  window.addEventListener("employee:section", (event) => {
    if (event.detail?.section === "time-clock") {
      restoreSiteScanSession();
      void loadStatus();
    }
  });

  restoreSiteScanSession();
  loadStatus();
})();
