(function () {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const tenantId = localStorage.getItem("tenantId");

  if (!session.hasSession() || !tenantId) return;

  const statusEl = document.getElementById("punch-status");
  const sitesEl = document.getElementById("punch-sites");
  const messageEl = document.getElementById("punch-message");
  const geofenceEl = document.getElementById("punch-geofence-status");
  const clockInBtn = document.getElementById("punch-in-btn");
  const clockOutBtn = document.getElementById("punch-out-btn");
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

  let punchInFlight = false;
  let clockedInState = false;
  let geofenceWithin = false;
  let geofenceCheckInFlight = false;
  let siteScanReady = false;
  let siteScanToken = null;
  let siteScanName = "";
  let scanStream = null;
  let scanFrameHandle = null;

  function authHeaders(json = true) {
    return session.authHeaders({ json, tenantId });
  }

  async function apiFetch(path, options = {}) {
    return session.fetchWithAuth(path, options, { apiBase: API_BASE, tenantId });
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

  function clockReady() {
    return geofenceWithin || siteScanReady;
  }

  function syncClockButtons() {
    const online = navigator.onLine;
    const ready = clockReady();
    if (clockInBtn) {
      clockInBtn.disabled =
        punchInFlight || !online || clockedInState || !ready || geofenceCheckInFlight;
      clockInBtn.classList.toggle("is-ready", ready && !clockedInState && online && !punchInFlight);
    }
    if (clockOutBtn) {
      clockOutBtn.disabled =
        punchInFlight || !online || !clockedInState || !ready || geofenceCheckInFlight;
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

  function updatePunchSummary(data) {
    const text = data?.clocked_in
      ? `Clocked in at ${data.last_punch?.site_name || "work site"}`
      : data?.last_punch
        ? `Last punch: ${data.last_punch.punch_type === "in" ? "in" : "out"}`
        : "Ready to clock in";
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
      const last = data.last_punch;
      clockedInState = Boolean(data.clocked_in);
      statusEl.innerHTML = data.clocked_in
        ? `<strong>Clocked in</strong> since ${formatTime(last?.punched_at)} at ${last?.site_name || "work site"}.`
        : last
          ? `Last punch: ${last.punch_type === "in" ? "in" : "out"} at ${formatTime(last.punched_at)}.`
          : "Not clocked in yet today.";
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
      syncClockButtons();
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
    syncClockButtons();
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
    syncClockButtons();

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
      const accuracyNote =
        data.accuracy_meters != null ? ` GPS accuracy ±${Math.round(data.accuracy_meters)}m.` : "";
      setGeofenceStatus(`${data.message}${accuracyNote}`, geofenceWithin ? "ok" : "warn");
      if (geofenceWithin) maybePromptPushNotifications();
    } catch (error) {
      setGeofenceStatus(error.message || "Could not read your location.", "error");
    } finally {
      geofenceCheckInFlight = false;
      syncClockButtons();
    }
  }

  async function submitPunch(punchType) {
    if (punchInFlight || !navigator.onLine) {
      setMessage("Connect to the internet to clock in or out.", "error");
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
      if (!response.ok) {
        setMessage(parseApiError(data, "Punch failed."), "error");
        return;
      }
      const detail =
        data.punch_method === "site_qr"
          ? `${punchType === "in" ? "Clocked in" : "Clocked out"} at ${data.site_name} (premises QR).`
          : `${punchType === "in" ? "Clocked in" : "Clocked out"} at ${data.site_name} (${Math.round(data.distance_meters)}m from site).`;
      setMessage(detail, "success");
      await loadStatus();
    } catch (error) {
      setMessage(error.message || "Punch failed.", "error");
    } finally {
      punchInFlight = false;
      syncClockButtons();
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

  clockInBtn?.addEventListener("click", () => submitPunch("in"));
  clockOutBtn?.addEventListener("click", () => submitPunch("out"));
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
