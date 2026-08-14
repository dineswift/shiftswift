(function () {
  const API_BASE =
    localStorage.getItem("apiBaseUrl") ||
    (window.ShiftSwiftBrand?.resolveApiBase ? window.ShiftSwiftBrand.resolveApiBase() : "http://localhost:3000");

  const loginView = document.getElementById("punch-login-view");
  const mfaView = document.getElementById("punch-mfa-view");
  const clockView = document.getElementById("punch-clock-view");
  const signOutBtn = document.getElementById("punch-sign-out");
  const loginForm = document.getElementById("punch-login-form");
  const mfaForm = document.getElementById("punch-mfa-form");
  const loginStatus = document.getElementById("punch-login-status");
  const mfaStatus = document.getElementById("punch-mfa-status");
  const workStateEl = document.getElementById("punch-work-state");
  const liveTimeEl = document.getElementById("punch-live-time");
  const sitesEl = document.getElementById("punch-sites");
  const messageEl = document.getElementById("punch-message");
  const userLine = document.getElementById("punch-user-line");
  const clockInBtn = document.getElementById("punch-in-btn");
  const clockOutBtn = document.getElementById("punch-out-btn");
  const breakStartBtn = document.getElementById("punch-break-start-btn");
  const breakEndBtn = document.getElementById("punch-break-end-btn");
  const geofenceEl = document.getElementById("punch-geofence-status");
  const installBanner = document.getElementById("pwa-install-banner");
  const installBtn = document.getElementById("pwa-install-btn");
  const installDismiss = document.getElementById("pwa-install-dismiss");
  const installCopy = document.getElementById("pwa-install-copy");
  const offlineBanner = document.getElementById("punch-offline-banner");
  const updateBanner = document.getElementById("punch-update-banner");
  const updateBtn = document.getElementById("punch-update-btn");
  const expectedShiftEl = document.getElementById("punch-expected-shift");
  const weekShiftsEl = document.getElementById("punch-week-shifts");
  const scanBtn = document.getElementById("punch-scan-btn");
  const siteScanStatusEl = document.getElementById("punch-site-scan-status");
  const scanDialog = document.getElementById("punch-scan-dialog");
  const scanVideo = document.getElementById("punch-scan-video");
  const scanMessageEl = document.getElementById("punch-scan-message");
  const scanManualInput = document.getElementById("punch-scan-manual");
  const scanManualBtn = document.getElementById("punch-scan-manual-btn");
  const scanCloseBtn = document.getElementById("punch-scan-close");

  const SITE_SCAN_KEY = "punchSiteScan";
  const SITE_SCAN_TTL_MS = 10 * 60 * 1000;

  let pendingChallenge = null;
  let deferredInstallPrompt = null;
  let punchInFlight = false;
  let refreshInFlight = null;
  let clockedInState = false;
  let workState = "off";
  let geofenceWithin = false;
  let siteScanReady = false;
  let siteScanToken = null;
  let siteScanName = "";
  let geofenceCheckInFlight = false;
  let waitingServiceWorker = null;
  let scanStream = null;
  let scanFrameHandle = null;
  let pendingClockToken = null;
  let currentUsername = "";
  let liveTimeTimer = null;

  function secureHostLabel() {
    const fromBrand = window.ShiftSwiftBrand?.domain;
    if (fromBrand) return fromBrand;
    if (window.location.hostname) {
      return String(window.location.hostname).replace(/^www\./i, "");
    }
    return "shiftswifthr.co.uk";
  }

  document.querySelectorAll("[data-secure-host]").forEach((el) => {
    el.textContent = secureHostLabel();
  });

  function token() {
    return localStorage.getItem("token");
  }

  function tenantId() {
    return localStorage.getItem("tenantId");
  }

  function authHeaders(json = true) {
    const headers = {
      Authorization: `Bearer ${token()}`,
      "X-Tenant-Id": tenantId() || "",
    };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  function parseApiError(data, fallback) {
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail?.message) return detail.message;
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
    return data?.message || fallback;
  }

  function setInlineStatus(el, message) {
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  function showView(view) {
    [loginView, mfaView, clockView].forEach((node) => {
      if (!node) return;
      node.hidden = node !== view;
    });
    if (signOutBtn) signOutBtn.hidden = view !== clockView;
  }

  function clearSession() {
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("tenantId");
    localStorage.removeItem("userRole");
  }

  function storeSession(data) {
    if (data.access_token) localStorage.setItem("token", data.access_token);
    if (data.refresh_token) localStorage.setItem("refreshToken", data.refresh_token);
    if (data.role) localStorage.setItem("userRole", data.role);
    if (data.tenant_id) localStorage.setItem("tenantId", String(data.tenant_id));
  }

  function setOnlineState(online) {
    if (offlineBanner) offlineBanner.hidden = online;
    syncClockButtons();
  }

  function setGeofenceStatus(text, tone) {
    if (!geofenceEl) return;
    geofenceEl.textContent = text || "";
    geofenceEl.hidden = !text;
    geofenceEl.className = tone
      ? `punch-location-pill punch-location-pill--${tone}`
      : "punch-location-pill";
  }

  function clockReady() {
    return geofenceWithin || siteScanReady;
  }

  function syncClockButtons() {
    const online = navigator.onLine;
    const ready = clockReady();
    if (clockInBtn) {
      clockInBtn.disabled = punchInFlight || !online || workState !== "off" || !ready || geofenceCheckInFlight;
      clockInBtn.classList.toggle("is-ready", ready && workState === "off" && online && !punchInFlight);
    }
    if (clockOutBtn) {
      clockOutBtn.disabled =
        punchInFlight || !online || workState !== "clocked_in" || !ready || geofenceCheckInFlight;
    }
    if (breakStartBtn) {
      breakStartBtn.disabled =
        punchInFlight || !online || workState !== "clocked_in" || !ready || geofenceCheckInFlight;
      breakStartBtn.hidden = workState === "on_break";
    }
    if (breakEndBtn) {
      breakEndBtn.hidden = workState !== "on_break";
      breakEndBtn.disabled =
        punchInFlight || !online || workState !== "on_break" || !ready || geofenceCheckInFlight;
    }
  }

  async function refreshAccessToken() {
    if (refreshInFlight) return refreshInFlight;
    const refresh = localStorage.getItem("refreshToken");
    if (!refresh) return false;

    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return false;
        storeSession(data);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  }

  async function apiFetch(path, options = {}) {
    const request = async () =>
      fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { ...authHeaders(options.body != null), ...(options.headers || {}) },
      });

    let response;
    try {
      response = await request();
    } catch {
      throw new Error("Cannot reach the API. Check your connection and try again.");
    }

    if (response.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        try {
          response = await request();
        } catch {
          throw new Error("Cannot reach the API. Check your connection and try again.");
        }
      }
    }
    return response;
  }

  async function postJson(path, body) {
    const response = await apiFetch(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(parseApiError(data, "Request failed"));
    }
    return data;
  }

  function friendlyLoginError(message) {
    if (message === "Failed to fetch" || message === "Load failed") {
      return "Cannot reach the API. Check your connection and try again.";
    }
    if (message === "Invalid credentials for this login type") {
      return "Use your employee account here. HR admins should sign in via the business portal.";
    }
    return message || "Sign in failed";
  }

  function formatTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return String(iso);
    }
  }

  function updateLiveTime() {
    if (!liveTimeEl) return;
    liveTimeEl.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function startLiveTimeClock() {
    stopLiveTimeClock();
    updateLiveTime();
    liveTimeTimer = window.setInterval(updateLiveTime, 30000);
  }

  function stopLiveTimeClock() {
    if (liveTimeTimer) {
      window.clearInterval(liveTimeTimer);
      liveTimeTimer = null;
    }
  }

  function renderWorkState(last) {
    if (!workStateEl) return;
    if (workState === "on_break") {
      workStateEl.textContent = `On break since ${formatTime(last?.punched_at)}`;
      if (liveTimeEl) liveTimeEl.hidden = true;
      stopLiveTimeClock();
      return;
    }
    if (workState === "clocked_in") {
      const site = last?.site_name ? ` · ${last.site_name}` : "";
      workStateEl.textContent = `Clocked in since ${formatTime(last?.punched_at)}${site}`;
      if (liveTimeEl) liveTimeEl.hidden = true;
      stopLiveTimeClock();
      return;
    }
    if (last && last.punch_type) {
      workStateEl.textContent = `Last punch: ${last.punch_type === "in" ? "in" : "out"} at ${formatTime(last.punched_at)}`;
    } else {
      workStateEl.textContent = "Not clocked in";
    }
    if (liveTimeEl) {
      liveTimeEl.hidden = false;
      startLiveTimeClock();
    }
  }

  function setUserLine(username, tenantName) {
    if (!userLine) return;
    if (username) currentUsername = username;
    const email = currentUsername || username || "Employee";
    userLine.textContent = tenantName ? `${email} · ${tenantName}` : `Signed in as ${email}`;
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

  function loadSiteScanSession() {
    try {
      const raw = sessionStorage.getItem(SITE_SCAN_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.token || !data?.expires_at || Date.now() > data.expires_at) {
        sessionStorage.removeItem(SITE_SCAN_KEY);
        return null;
      }
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
      })
    );
  }

  function clearSiteScanSession() {
    sessionStorage.removeItem(SITE_SCAN_KEY);
    siteScanReady = false;
    siteScanToken = null;
    siteScanName = "";
    setSiteScanStatus("");
  }

  function applySiteScanSession(data) {
    siteScanReady = true;
    siteScanToken = data.token;
    siteScanName = data.site_name || "your site";
    saveSiteScanSession(data);
    setSiteScanStatus(`Premises verified — ${siteScanName}. You can clock in or out without GPS.`);
    syncClockButtons();
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

  function parseClockTokenFromUrl() {
    return new URLSearchParams(window.location.search).get("clock");
  }

  async function validateSiteScan(clockToken) {
    const tokenValue = extractClockTokenFromText(clockToken);
    if (!tokenValue) {
      throw new Error("Could not read a premises code from that QR.");
    }
    const data = await postJson("/time-punch/scan", { clock_token: tokenValue });
    applySiteScanSession({
      token: tokenValue,
      site_id: data.site_id,
      site_name: data.site_name,
    });
    setMessage(data.message || `Premises verified — ${data.site_name}.`, "success");
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
          "Camera QR scan is not supported here. Paste the code from the premises QR link below.";
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
    } catch (error) {
      if (scanMessageEl) {
        scanMessageEl.textContent = error.message || "Could not open the camera.";
      }
      return;
    }

    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const tick = async () => {
      if (!scanDialog?.open || !scanVideo?.videoWidth) {
        scanFrameHandle = requestAnimationFrame(tick);
        return;
      }
      try {
        const codes = await detector.detect(scanVideo);
        const raw = codes[0]?.rawValue;
        if (raw) {
          if (scanMessageEl) scanMessageEl.textContent = "Code detected — verifying…";
          await validateSiteScan(raw);
          stopQrScanner();
          scanDialog.close();
          return;
        }
      } catch {
        /* keep scanning */
      }
      scanFrameHandle = requestAnimationFrame(tick);
    };
    scanFrameHandle = requestAnimationFrame(tick);
  }

  async function openScanDialog() {
    if (!scanDialog) return;
    if (scanManualInput) scanManualInput.value = "";
    if (scanMessageEl) scanMessageEl.textContent = "";
    scanDialog.showModal();
    await startQrScanner();
  }

  async function maybeApplyPendingClockToken() {
    const clockToken = pendingClockToken || parseClockTokenFromUrl();
    if (!clockToken || !token()) return;
    try {
      await validateSiteScan(clockToken);
      pendingClockToken = null;
      const url = new URL(window.location.href);
      url.searchParams.delete("clock");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch (error) {
      setMessage(error.message || "Could not verify premises code.", "error");
    }
  }

  function setMessage(text, type) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.className = type ? `punch-message punch-message--${type}` : "punch-message";
  }

  async function verifyEmployeeSession() {
    const currentToken = token();
    if (!currentToken) {
      showView(loginView);
      return false;
    }

    if (!navigator.onLine) {
      showView(clockView);
      if (userLine) userLine.textContent = "Signed in (offline — reconnect to refresh status)";
      if (workStateEl) workStateEl.textContent = "Offline — connect to refresh status";
      if (liveTimeEl) liveTimeEl.hidden = true;
      setOnlineState(false);
      maybeShowInstallBanner();
      return true;
    }

    try {
      const response = await apiFetch("/auth/verify", { method: "GET", headers: authHeaders(false) });
      if (response.status === 401) {
        clearSession();
        setInlineStatus(loginStatus, "Session expired. Sign in again.");
        showView(loginView);
        return false;
      }
      if (!response.ok) {
        throw new Error("Could not verify session");
      }
      const user = await response.json();
      if (user.role !== "employee") {
        clearSession();
        setInlineStatus(loginStatus, "This app is for employee accounts only.");
        showView(loginView);
        return false;
      }
      setUserLine(user.username, null);
      showView(clockView);
      setOnlineState(true);
      maybeShowInstallBanner();
      restoreSiteScanSession();
      await loadStatus();
      await maybeApplyPendingClockToken();
      return true;
    } catch {
      showView(clockView);
      setOnlineState(navigator.onLine);
      if (workStateEl) {
        workStateEl.textContent = navigator.onLine
          ? "Could not verify your session. Try signing in again."
          : "Offline — connect to refresh status";
      }
      if (liveTimeEl) liveTimeEl.hidden = true;
      maybeShowInstallBanner();
      return true;
    }
  }

  function renderRotaContext(data) {
    const expected = data.expected_shift_today;
    if (expectedShiftEl) {
      if (expected) {
        expectedShiftEl.hidden = false;
        const status = expected.attendance_status;
        const statusNote =
          status === "late"
            ? "You clocked in late for today’s shift."
            : status === "no_show"
              ? "You missed today’s scheduled shift — contact your manager."
              : status === "awaiting"
                ? "You’re on the rota today — remember to clock in."
                : status === "attended"
                  ? "Today’s shift is recorded."
                  : `Today: ${expected.start_time}–${expected.end_time}${expected.role_label ? ` (${expected.role_label})` : ""}.`;
        const tag =
          status === "no_show"
            ? `<span class="punch-expected-shift__tag">Missed shift</span>`
            : status === "late"
              ? `<span class="punch-expected-shift__tag">Late</span>`
              : "";
        expectedShiftEl.innerHTML = `${tag}<strong>Today · ${expected.start_time}–${expected.end_time}${expected.role_label ? ` · ${expected.role_label}` : ""}</strong><span class="punch-expected-shift__note">${statusNote}</span>`;
        expectedShiftEl.className = `punch-expected-shift punch-expected-shift--${status || "scheduled"}`;
      } else {
        expectedShiftEl.hidden = true;
      }
    }
    if (weekShiftsEl) {
      const items = data.week_shifts || [];
      weekShiftsEl.innerHTML = items.length
        ? items
            .map((s) => {
              const day = new Date(`${s.shift_date}T12:00:00`).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
              });
              return `<li><strong>${day}</strong> ${s.start_time}–${s.end_time}${s.role_label ? ` · ${s.role_label}` : ""}</li>`;
            })
            .join("")
        : "<li class=\"muted\">No published shifts this week yet.</li>";
    }
  }

  async function loadStatus() {
    if (!workStateEl || !token()) return;
    if (!navigator.onLine) {
      setOnlineState(false);
      return;
    }

    try {
      const response = await apiFetch("/time-punch/status", { method: "GET", headers: authHeaders(false) });
      if (response.status === 401) {
        clearSession();
        setInlineStatus(loginStatus, "Session expired. Sign in again.");
        showView(loginView);
        return;
      }
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        workStateEl.textContent = parseApiError(err, "Could not load punch status.");
        if (liveTimeEl) liveTimeEl.hidden = true;
        return;
      }
      const data = await response.json();
      const last = data.last_punch;
      workState = data.work_state || (data.clocked_in ? "clocked_in" : "off");
      clockedInState = workState !== "off";
      renderWorkState(last);
      setUserLine(currentUsername, data.tenant_name || null);
      if (sitesEl) {
        const sites = data.assigned_sites || [];
        sitesEl.innerHTML = sites.length
          ? sites.map((s) => `<li>${s.name}: ${s.address} (${s.radius_meters}m radius)</li>`).join("")
          : "<li>No punch sites configured. Ask HR.</li>";
      }
      renderRotaContext(data);
      setOnlineState(true);
      syncClockButtons();
      refreshGeofencePreview();
    } catch {
      workStateEl.textContent = "Could not reach the time punch service.";
      if (liveTimeEl) liveTimeEl.hidden = true;
      setOnlineState(navigator.onLine);
    }
  }

  function friendlyGeoError(error) {
    const code = error?.code;
    if (code === 1) {
      return "Location permission denied. Allow location for this app in your browser or phone settings.";
    }
    if (code === 2) {
      return "Location unavailable. Try moving outdoors or turning off airplane mode.";
    }
    if (code === 3) {
      return "Location timed out. Check GPS signal and try again.";
    }
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
    if (!window.ShiftSwiftPush || !token()) return;
    window.ShiftSwiftPush.promptSubscribe({
      apiBase: API_BASE,
      token: token(),
      tenantId: tenantId(),
      reason: "Get shift reminders and clock-in alerts on this device.",
    }).catch(() => null);
  }

  async function refreshGeofencePreview() {
    if (!geofenceEl || !token() || !navigator.onLine || (clockView && clockView.hidden)) return;
    if (siteScanReady) {
      setGeofenceStatus(
        `Using premises QR for ${siteScanName}. GPS check skipped — scan again if this expires.`,
        "ok"
      );
      syncClockButtons();
      return;
    }
    if (geofenceCheckInFlight) return;

    geofenceCheckInFlight = true;
    geofenceWithin = false;
    setGeofenceStatus("Getting your location…", "loading");
    syncClockButtons();

    try {
      const location = await readLocation();
      const response = await apiFetch("/time-punch/preview", {
        method: "POST",
        body: JSON.stringify(location),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        clearSession();
        setInlineStatus(loginStatus, "Session expired. Sign in again.");
        showView(loginView);
        return;
      }
      if (!response.ok) {
        setGeofenceStatus(parseApiError(data, "Could not verify your location."), "error");
        return;
      }

      geofenceWithin = Boolean(data.within_geofence);
      const accuracyNote =
        data.accuracy_meters != null ? ` GPS accuracy ±${Math.round(data.accuracy_meters)}m.` : "";
      if (geofenceWithin) {
        const distance = data.distance_meters != null ? `${Math.round(data.distance_meters)}m from site` : "Within site";
        setGeofenceStatus(`${distance} · within range${accuracyNote}`, "ok");
        maybePromptPushNotifications();
      } else {
        setGeofenceStatus(`${data.message}${accuracyNote}`, "warn");
      }
    } catch (error) {
      setGeofenceStatus(error.message || "Could not read your location.", "error");
    } finally {
      geofenceCheckInFlight = false;
      syncClockButtons();
    }
  }

  function punchLabel(type) {
    return (
      {
        in: "Clocked in",
        out: "Clocked out",
        break_start: "Break started",
        break_end: "Break ended",
      }[type] || "Recorded"
    );
  }

  async function submitPunch(punchType) {
    if (punchInFlight) return;
    if (!navigator.onLine) {
      setMessage("You are offline. Connect to the internet to clock in or out.", "error");
      return;
    }
    if (!clockReady()) {
      setMessage("Move within your site geofence or scan the premises QR code first.", "error");
      return;
    }

    punchInFlight = true;
    syncClockButtons();
    setMessage("Submitting punch…", "info");

    try {
      let response;
      let data;
      if (siteScanReady && siteScanToken) {
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
      if (response.status === 401) {
        clearSession();
        setInlineStatus(loginStatus, "Session expired. Sign in again.");
        showView(loginView);
        return;
      }
      if (!response.ok) {
        setMessage(parseApiError(data, "Punch failed."), "error");
        return;
      }
      const detail =
        data.punch_method === "site_qr"
          ? `${punchLabel(punchType)} at ${data.site_name} (premises QR).`
          : `${punchLabel(punchType)} at ${data.site_name}${data.distance_meters != null ? ` (${Math.round(data.distance_meters)}m from site)` : ""}.`;
      workState = data.work_state || workState;
      clockedInState = workState !== "off";
      setMessage(detail, "success");
      await loadStatus();
    } catch (error) {
      setMessage(error.message || "Punch failed.", "error");
    } finally {
      punchInFlight = false;
      syncClockButtons();
    }
  }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function punchManualInstallSteps() {
    if (isIos()) {
      return "In Safari: tap Share → Add to Home Screen. Then open Time Clock from your home screen.";
    }
    if (isAndroid()) {
      return "In Chrome: tap ⋮ → Install app or Add to Home screen. You may also see an install icon in the address bar.";
    }
    return "In Chrome or Edge: use the install icon in the address bar, or open the browser menu and choose Install app.";
  }

  function showPunchManualHelp() {
    if (installCopy) installCopy.textContent = punchManualInstallSteps();
    if (installBtn) {
      installBtn.hidden = false;
      installBtn.textContent = "Install steps shown above";
    }
    if (installBanner) installBanner.hidden = false;
  }

  function installDismissed() {
    return localStorage.getItem("punchPwaInstallDismissed") === "1";
  }

  function maybeShowInstallBanner() {
    if (!installBanner || isStandalone() || installDismissed()) return;

    if (deferredInstallPrompt) {
      installBanner.hidden = false;
      if (installCopy) {
        installCopy.textContent = "Add to home screen for faster access.";
      }
      if (installBtn) {
        installBtn.hidden = false;
        installBtn.textContent = "Install";
      }
      return;
    }

    installBanner.hidden = false;
    if (installCopy) {
      installCopy.textContent = isIos()
        ? "Add to home screen — tap Share, then Add to Home Screen."
        : "Add to home screen for faster access.";
    }
    if (installBtn) {
      installBtn.hidden = false;
      installBtn.textContent = isIos() ? "How to" : "Install";
    }
  }

  function showUpdateBanner(worker) {
    waitingServiceWorker = worker;
    if (updateBanner) updateBanner.hidden = false;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (sessionStorage.getItem("punchSwReloaded") === "1") return;
      sessionStorage.setItem("punchSwReloaded", "1");
      window.location.reload();
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./punch-sw.js?v=5", { scope: "./" })
        .then((registration) => {
          if (registration.waiting) {
            showUpdateBanner(registration.waiting);
          }
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller) {
                showUpdateBanner(worker);
              }
            });
          });
        })
        .catch(() => null);
    });
  }

  updateBtn?.addEventListener("click", () => {
    const worker = waitingServiceWorker;
    if (!worker) return;
    worker.postMessage({ type: "SKIP_WAITING" });
    if (updateBanner) updateBanner.hidden = true;
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    maybeShowInstallBanner();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installBanner) installBanner.hidden = true;
  });

  installBtn?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      try {
        await deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        if (installBanner) installBanner.hidden = true;
        return;
      } catch {
        deferredInstallPrompt = null;
        maybeShowInstallBanner();
      }
    }
    showPunchManualHelp();
  });

  installDismiss?.addEventListener("click", () => {
    localStorage.setItem("punchPwaInstallDismissed", "1");
    if (installBanner) installBanner.hidden = true;
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInlineStatus(loginStatus, "Signing in…");
    const payload = Object.fromEntries(new FormData(loginForm).entries());
    try {
      const data = await postJson("/auth/employee-login", payload);
      if (data.mfa_required && data.challenge_token) {
        pendingChallenge = data.challenge_token;
        setInlineStatus(loginStatus, "");
        const mfaUser = mfaView?.querySelector("[data-mfa-user]");
        const hint = data.email_hint || data.username || payload.username;
        if (mfaUser) mfaUser.textContent = hint;
        const lead = mfaView?.querySelector(".punch-lead");
        if (lead) {
          lead.innerHTML = data.email_sent
            ? `We emailed a 6-digit code to <strong data-mfa-user>${String(hint).replace(/</g, "")}</strong>. Check inbox and spam.`
            : `Enter the 6-digit code we email to <strong data-mfa-user>${String(hint).replace(/</g, "")}</strong>.`;
        }
        showView(mfaView);
        if (data.message) setInlineStatus(mfaStatus, data.message);
        else if (!data.email_sent) {
          setInlineStatus(mfaStatus, "Sending email code…");
          try {
            const resent = await postJson("/auth/mfa/send-email-code", {
              challenge_token: pendingChallenge,
            });
            setInlineStatus(mfaStatus, resent.message || "We emailed a 6-digit code.");
          } catch (error) {
            setInlineStatus(mfaStatus, error.message || "Could not email code. Tap Resend.");
          }
        }
        mfaView?.querySelector('input[name="code"]')?.focus();
        return;
      }
      if (data.role && data.role !== "employee") {
        clearSession();
        setInlineStatus(loginStatus, "This app is for employee accounts only.");
        return;
      }
      storeSession(data);
      setInlineStatus(loginStatus, "");
      await verifyEmployeeSession();
    } catch (error) {
      setInlineStatus(loginStatus, friendlyLoginError(error.message));
    }
  });

  mfaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!pendingChallenge) {
      setInlineStatus(mfaStatus, "Session expired. Sign in again.");
      showView(loginView);
      return;
    }
    setInlineStatus(mfaStatus, "Verifying code…");
    const code = new FormData(mfaForm).get("code");
    try {
      const data = await postJson("/auth/mfa/verify", {
        challenge_token: pendingChallenge,
        code,
        method: "email",
      });
      if (data.role && data.role !== "employee") {
        clearSession();
        setInlineStatus(mfaStatus, "This app is for employee accounts only.");
        showView(loginView);
        return;
      }
      storeSession(data);
      pendingChallenge = null;
      setInlineStatus(mfaStatus, "");
      await verifyEmployeeSession();
    } catch (error) {
      setInlineStatus(mfaStatus, error.message);
    }
  });

  document.getElementById("punch-mfa-resend")?.addEventListener("click", async () => {
    if (!pendingChallenge) {
      setInlineStatus(mfaStatus, "Session expired. Sign in again.");
      showView(loginView);
      return;
    }
    setInlineStatus(mfaStatus, "Sending a new code…");
    try {
      const resent = await postJson("/auth/mfa/send-email-code", {
        challenge_token: pendingChallenge,
      });
      setInlineStatus(mfaStatus, resent.message || "We emailed a new code.");
    } catch (error) {
      setInlineStatus(mfaStatus, error.message || "Could not resend code");
    }
  });

  signOutBtn?.addEventListener("click", () => {
    clearSession();
    clearSiteScanSession();
    stopQrScanner();
    setMessage("", "");
    clockedInState = false;
    showView(loginView);
    if (installBanner) installBanner.hidden = true;
    syncClockButtons();
  });

  scanBtn?.addEventListener("click", () => {
    openScanDialog().catch((error) => {
      setMessage(error.message || "Could not open scanner.", "error");
    });
  });

  scanCloseBtn?.addEventListener("click", () => {
    stopQrScanner();
    scanDialog?.close();
  });

  scanDialog?.addEventListener("close", () => {
    stopQrScanner();
  });

  scanManualBtn?.addEventListener("click", async () => {
    const value = scanManualInput?.value?.trim();
    if (!value) {
      if (scanMessageEl) scanMessageEl.textContent = "Paste the QR link or code first.";
      return;
    }
    try {
      if (scanMessageEl) scanMessageEl.textContent = "Verifying…";
      await validateSiteScan(value);
      stopQrScanner();
      scanDialog?.close();
    } catch (error) {
      if (scanMessageEl) scanMessageEl.textContent = error.message || "Verification failed.";
    }
  });

  clockInBtn?.addEventListener("click", () => submitPunch("in"));
  clockOutBtn?.addEventListener("click", () => submitPunch("out"));
  breakStartBtn?.addEventListener("click", () => submitPunch("break_start"));
  breakEndBtn?.addEventListener("click", () => submitPunch("break_end"));

  window.addEventListener("online", () => {
    setOnlineState(true);
    if (token() && clockView && !clockView.hidden) {
      loadStatus();
    }
  });
  window.addEventListener("offline", () => setOnlineState(false));

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && token() && clockView && !clockView.hidden && navigator.onLine) {
      loadStatus();
    }
  });

  setInterval(() => {
    if (document.hidden || !token() || !clockView || clockView.hidden || !navigator.onLine) return;
    loadStatus();
  }, 60000);

  registerServiceWorker();
  setOnlineState(navigator.onLine);
  pendingClockToken = parseClockTokenFromUrl();
  verifyEmployeeSession();
})();
