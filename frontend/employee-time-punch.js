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

  let punchInFlight = false;
  let clockedInState = false;
  let geofenceWithin = false;
  let geofenceCheckInFlight = false;

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

  function syncClockButtons() {
    const online = navigator.onLine;
    if (clockInBtn) {
      clockInBtn.disabled =
        punchInFlight || !online || clockedInState || !geofenceWithin || geofenceCheckInFlight;
      clockInBtn.classList.toggle("is-ready", geofenceWithin && !clockedInState && online && !punchInFlight);
    }
    if (clockOutBtn) {
      clockOutBtn.disabled =
        punchInFlight || !online || !clockedInState || !geofenceWithin || geofenceCheckInFlight;
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
          : "<li>No punch sites configured. Ask HR.</li>";
      }
      if (expectedEl && data.expected_shift_today) {
        const s = data.expected_shift_today;
        expectedEl.hidden = false;
        expectedEl.innerHTML = `<strong>Today’s shift</strong> ${s.start_time}–${s.end_time}${s.role_label ? ` · ${s.role_label}` : ""}`;
      } else if (expectedEl) {
        expectedEl.hidden = true;
      }
      syncClockButtons();
      refreshGeofencePreview();
    } catch {
      statusEl.textContent = "Could not reach the time punch service.";
    }
  }

  function friendlyGeoError(error) {
    if (error?.code === 1) return "Location permission denied. Enable location in your device settings.";
    if (error?.code === 2) return "Location unavailable. Try moving outdoors.";
    if (error?.code === 3) return "Location timed out. Check GPS and try again.";
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
      token: token(),
      tenantId,
      reason: "Get shift reminders and clock-in alerts on this device.",
    }).catch(() => null);
  }

  async function refreshGeofencePreview() {
    if (!geofenceEl || !navigator.onLine) return;
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
    punchInFlight = true;
    syncClockButtons();
    setMessage("Reading your location…", "info");
    try {
      const location = await readLocation();
      setMessage("Submitting punch…", "info");
      const response = await apiFetch("/time-punch/punch", {
        method: "POST",
        body: JSON.stringify({ punch_type: punchType, ...location }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(parseApiError(data, "Punch failed."), "error");
        return;
      }
      setMessage(
        `${punchType === "in" ? "Clocked in" : "Clocked out"} at ${data.site_name} (${Math.round(data.distance_meters)}m from site).`,
        "success"
      );
      await loadStatus();
    } catch (error) {
      setMessage(error.message || "Punch failed.", "error");
    } finally {
      punchInFlight = false;
      syncClockButtons();
    }
  }

  clockInBtn?.addEventListener("click", () => submitPunch("in"));
  clockOutBtn?.addEventListener("click", () => submitPunch("out"));
  window.addEventListener("online", loadStatus);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && navigator.onLine) loadStatus();
  });

  loadStatus();
})();
