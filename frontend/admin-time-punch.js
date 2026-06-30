/** Admin — geofenced time punch sites and punch log. */
(function () {
  const { apiFetch, escapeHtml, parseHashBaseSection, downloadAuthenticated } = window.Admin;

  const ROLE_LABELS = {
    all: "All staff",
    kitchen: "Kitchen",
    front_of_house: "Front of house",
    bar: "Bar",
    management: "Management",
  };

  let sites = [];
  let punches = [];
  let todayPunches = [];
  let weekPunches = [];
  let employees = [];
  let tenantProfile = null;
  let selectedSiteId = null;
  let activeTab = "sites";
  let rotaWeekStartDay = 0;
  let timesheetWeekStart = rotaWeekStartIso();
  let timesheetData = null;
  let filters = { date_from: "", date_to: "", employee_id: "", site_id: "", punch_type: "" };
  let dailyFilters = { employee_id: "", site_id: "", punch_type: "", review_status: "" };
  let recordsViewMode = "each";
  let bound = false;
  let sectionReady = false;
  let punchDataLoadedAt = null;
  let punchHistoryDate = todayIso();
  let punchRefreshTimer = null;
  let exportPreset = "week";
  const siteQrCache = new Map();

  function formatDayLabel(iso) {
    if (!iso) return "";
    if (iso === todayIso()) return "Today";
    try {
      return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  }

  function shiftIsoDate(iso, days) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + days);
    return toLocalIsoDate(d);
  }

  function syncPunchHistoryControls() {
    const picker = $("punch-day-picker");
    if (picker && picker.value !== punchHistoryDate) picker.value = punchHistoryDate;
    const todayBtn = $("punch-day-today");
    if (todayBtn) todayBtn.hidden = punchHistoryDate === todayIso();
  }

  function updateDailyPunchSummary() {
    const el = $("punch-day-summary");
    if (!el) return;
    const label = formatDayLabel(punchHistoryDate);
    const groups = groupDailyPunches(todayPunches);
    const shiftCount = groups.reduce((sum, group) => sum + group.shifts.length, 0);
    const punchCount = todayPunches.length;
    const pendingCount = todayPunches.filter((row) => row.hr_review_pending).length;
    const rapidCount = todayPunches.filter((row) => row.rapid_re_punch).length;
    if (punchCount === 0) {
      el.textContent = `No punches recorded · ${label}`;
      return;
    }
    const staffLabel = `${groups.length} staff · ${shiftCount} shift${shiftCount === 1 ? "" : "s"}`;
    const pendingLabel =
      pendingCount > 0 ? ` · ${pendingCount} need${pendingCount === 1 ? "s" : ""} HR review` : "";
    const rapidLabel =
      rapidCount > 0 ? ` · ${rapidCount} rapid re-punch${rapidCount === 1 ? "" : "es"}` : "";
    el.textContent = `${staffLabel} · ${punchCount} punch${punchCount === 1 ? "" : "es"}${pendingLabel}${rapidLabel} · ${label}`;
  }

  function setRecordsViewMode(mode) {
    recordsViewMode = mode === "shifts" ? "shifts" : "each";
    document.querySelectorAll("[data-records-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.recordsView === recordsViewMode);
    });
    const eachWrap = $("punch-records-each-wrap");
    const shiftsWrap = $("punch-records-shifts-wrap");
    if (eachWrap) eachWrap.hidden = recordsViewMode !== "each";
    if (shiftsWrap) shiftsWrap.hidden = recordsViewMode !== "shifts";
    renderTodayPreview();
  }

  function renderPunchFlags(row) {
    const flags = [];
    if (row.rapid_re_punch) {
      flags.push('<span class="punch-flag punch-flag--rapid" title="Clock-in within 10 minutes of clock-out">Rapid re-punch</span>');
    }
    return flags.join("");
  }

  function renderReviewBadge(row) {
    const flags = renderPunchFlags(row);
    if (row.hr_review_pending) {
      return `${flags}<span class="punch-review-badge punch-review-badge--pending">Needs review</span>`;
    }
    const reviewer = escapeHtml(row.hr_reviewed_by || "HR");
    const when = row.hr_reviewed_at ? escapeHtml(formatWhen(row.hr_reviewed_at)) : "";
    return `${flags}<span class="punch-review-badge punch-review-badge--done">Reviewed</span>${
      when ? `<span class="punch-review-meta">${reviewer} · ${when}</span>` : ""
    }`;
  }

  function renderEachPunchRecords() {
    const tbody = $("punch-records-each-body");
    if (!tbody) return;
    if (!todayPunches.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">No punches on ${escapeHtml(formatDayLabel(punchHistoryDate).toLowerCase())}.</td></tr>`;
      return;
    }
    tbody.innerHTML = todayPunches
      .map((row) => {
        const acceptBtn = row.hr_review_pending
          ? `<button type="button" class="btn ghost btn-sm punch-records-accept" data-punch-id="${row.id}">Accept</button>`
          : '<span class="muted">—</span>';
        return `<tr class="${row.hr_review_pending || row.rapid_re_punch ? "punch-records-row--pending" : ""}">
          <td>${escapeHtml(formatWhen(row.punched_at))}</td>
          <td>${escapeHtml(row.employee_name)}</td>
          <td>${renderTypeBadge(row.punch_type)}</td>
          <td>${renderLocationCell(row)}</td>
          <td>${renderReviewBadge(row)}</td>
          <td class="punch-records-actions">${acceptBtn}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll(".punch-records-accept").forEach((btn) => {
      btn.addEventListener("click", () => {
        void acceptPunchRecord(Number(btn.dataset.punchId));
      });
    });
  }

  function isClockInType(type) {
    return type === "in" || type === "break_end";
  }

  function isClockOutType(type) {
    return type === "out" || type === "break_start";
  }

  function pairEmployeeShifts(punches) {
    const sorted = [...punches].sort(
      (a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime()
    );
    const segments = [];
    let openIn = null;
    for (const punch of sorted) {
      if (isClockInType(punch.punch_type)) {
        if (openIn) {
          segments.push({ clockIn: openIn, clockOut: null, orphan: true });
        }
        openIn = punch;
      } else if (isClockOutType(punch.punch_type)) {
        if (openIn) {
          segments.push({ clockIn: openIn, clockOut: punch, orphan: false });
          openIn = null;
        } else {
          segments.push({ clockIn: null, clockOut: punch, orphan: true });
        }
      }
    }
    if (openIn) {
      segments.push({ clockIn: openIn, clockOut: null, orphan: true });
    }
    return segments.reverse();
  }

  function groupDailyPunches(punches) {
    const byEmployee = new Map();
    punches.forEach((punch) => {
      const key = String(punch.employee_id || punch.employee_name || "unknown");
      if (!byEmployee.has(key)) {
        byEmployee.set(key, {
          employee_name: punch.employee_name || "Employee",
          punches: [],
        });
      }
      byEmployee.get(key).punches.push(punch);
    });
    return [...byEmployee.values()]
      .sort((a, b) => a.employee_name.localeCompare(b.employee_name))
      .map((group) => ({ ...group, shifts: pairEmployeeShifts(group.punches) }));
  }

  function formatShiftDuration(clockIn, clockOut) {
    if (!clockIn?.punched_at || !clockOut?.punched_at) return null;
    const ms = new Date(clockOut.punched_at).getTime() - new Date(clockIn.punched_at).getTime();
    if (ms < 0) return null;
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  function renderShiftTimeCell(punch) {
    if (!punch) {
      return '<td class="punch-shift-time punch-shift-time--missing"><span class="muted">—</span></td>';
    }
    const time = escapeHtml(formatTimeShort(punch.punched_at));
    const admin = punch.admin_override
      ? ` <span class="punch-shift-admin muted" title="${escapeHtml(punch.admin_note || "Admin punch")}">(admin)</span>`
      : "";
    return `<td class="punch-shift-time">${time}${admin}</td>`;
  }

  function renderShiftDurationCell(shift) {
    if (shift.clockIn && !shift.clockOut) {
      return '<td class="punch-shift-duration punch-shift-duration--open">Open shift</td>';
    }
    const duration = formatShiftDuration(shift.clockIn, shift.clockOut);
    if (!duration) {
      return '<td class="punch-shift-duration punch-shift-duration--orphan">—</td>';
    }
    return `<td class="punch-shift-duration">${escapeHtml(duration)}</td>`;
  }

  function renderShiftLocationCell(shift) {
    const punch = shift.clockIn || shift.clockOut;
    if (!punch) {
      return '<td class="punch-shift-location"><span class="muted">—</span></td>';
    }
    return `<td class="punch-shift-location">${renderLocationCell(punch)}</td>`;
  }

  function stopPunchAutoRefresh() {
    if (punchRefreshTimer) {
      window.clearInterval(punchRefreshTimer);
      punchRefreshTimer = null;
    }
  }

  function startPunchAutoRefresh() {
    stopPunchAutoRefresh();
    punchRefreshTimer = window.setInterval(() => {
      if (parseHashBaseSection(window.location.hash) !== "time-punch") return;
      void refreshPunchFeed({ quiet: true });
    }, 45000);
  }

  async function refreshPunchFeed({ quiet = false } = {}) {
    await Promise.all([
      loadDailyPunches(punchHistoryDate, { quiet }),
      punchHistoryDate === todayIso() ? loadWeekPunches() : Promise.resolve(),
    ]);
    if (punchHistoryDate === todayIso()) updatePunchStats();
    if (!quiet) showPunchNote("Punch list refreshed.", "ok");
  }

  function mergeTenantProfile(data) {
    if (!data || typeof data !== "object") return;
    tenantProfile = { ...(tenantProfile || {}), ...data };
    window.Admin?.rememberTenantRegisteredAddress?.(tenantProfile.registered_address);
    window.Admin?.rememberTenantRegisteredCoords?.(
      tenantProfile.registered_latitude,
      tenantProfile.registered_longitude,
    );
  }

  function registeredAddressFromDom() {
    const field = document.querySelector('[data-form-id="tenant-profile"] [name="registered_address"]');
    return String(field?.value || "").trim();
  }

  function $(id) {
    return document.getElementById(id);
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const radius = 6371000;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dphi = ((lat2 - lat1) * Math.PI) / 180;
    const dlambda = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(a));
  }

  function todayIso() {
    return toLocalIsoDate(new Date());
  }

  function firstOfMonthIso(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }

  function toLocalIsoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function previousCalendarMonthRange(reference = new Date()) {
    const start = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
    const end = new Date(reference.getFullYear(), reference.getMonth(), 0);
    return {
      date_from: toLocalIsoDate(start),
      date_to: toLocalIsoDate(end),
    };
  }

  function exportPeriodDates() {
    return {
      date_from: filters.date_from || firstOfMonthIso(),
      date_to: filters.date_to || todayIso(),
    };
  }

  function syncRotaWeekStartDay(day) {
    if (day == null || Number.isNaN(Number(day))) return;
    const parsed = Number(day);
    if (parsed >= 0 && parsed <= 6) rotaWeekStartDay = parsed;
  }

  function jsDayFromPythonWeekday(pyDay) {
    return pyDay === 6 ? 0 : pyDay + 1;
  }

  function rotaWeekStartIso(d = new Date(), weekStartDay) {
    const startDay = weekStartDay != null ? weekStartDay : rotaWeekStartDay;
    const day = new Date(d);
    const jsStart = jsDayFromPythonWeekday(startDay);
    const diff = (day.getDay() - jsStart + 7) % 7;
    day.setDate(day.getDate() - diff);
    return toLocalIsoDate(day);
  }

  function mondayIso(d = new Date()) {
    return rotaWeekStartIso(d);
  }

  function formatWhen(iso) {
    try {
      return new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso || "";
    }
  }

  function formatTimeShort(iso) {
    try {
      return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function formatSyncShort(iso) {
    if (!iso) return "never";
    try {
      const d = new Date(iso);
      const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      return `${date} ${time}`;
    } catch {
      return iso;
    }
  }

  function lastSyncIso() {
    const primary = primarySite();
    return primary?.updated_at || localStorage.getItem("punch-last-sync-at") || null;
  }

  function lastSyncLabel() {
    return `Last: ${formatSyncShort(lastSyncIso())}`;
  }

  function hasBusinessAddress() {
    const address = resolveRegisteredAddress();
    if (!address) return false;
    if (hasPinnedBusinessCoords()) return true;
    return validateRegisteredAddress(address).ok;
  }

  function hasPinnedBusinessCoords() {
    return (
      window.Admin?.hasPinnedBusinessCoords?.(tenantProfile) ||
      window.Admin?.hasPinnedBusinessCoords?.(window.Admin?.tenantProfileSnapshot) ||
      false
    );
  }

  function resolveRegisteredCoords() {
    const pending = window.AdminAddressPicker?.getPendingSelection?.();
    if (pending?.latitude != null && pending?.longitude != null) {
      return { latitude: Number(pending.latitude), longitude: Number(pending.longitude) };
    }
    const sources = [tenantProfile, window.Admin?.tenantProfileSnapshot];
    for (const source of sources) {
      const lat = source?.registered_latitude;
      const lng = source?.registered_longitude;
      if (lat != null && lng != null) {
        return { latitude: Number(lat), longitude: Number(lng) };
      }
    }
    return window.Admin?.getCachedTenantRegisteredCoords?.() || null;
  }

  function validateRegisteredAddress(address) {
    return (
      window.Admin?.validateBusinessAddress?.(address, resolveRegisteredCoords()) || {
        ok: Boolean(String(address || "").trim()),
      }
    );
  }

  function normalizeRegisteredAddress(address) {
    return window.Admin?.normalizeBusinessAddress?.(address) || String(address || "").trim();
  }

  function resolveRegisteredAddress() {
    const pending = window.AdminAddressPicker?.getPendingSelection?.();
    if (pending?.address) return normalizeRegisteredAddress(pending.address);
    const normalize = normalizeRegisteredAddress;
    const candidates = [
      tenantProfile?.registered_address,
      window.Admin?.tenantProfileSnapshot?.registered_address,
      window.Admin?.getCachedTenantRegisteredAddress?.(),
      registeredAddressFromDom(),
      primarySite()?.address,
    ];
    const seen = new Set();
    const normalized = [];
    for (const value of candidates) {
      const trimmed = normalize(value);
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
      seen.add(trimmed.toLowerCase());
      normalized.push(trimmed);
    }
    for (const addr of normalized) {
      if (validateRegisteredAddress(addr).ok) return addr;
    }
    if (hasPinnedBusinessCoords() && normalized.length) return normalized[0];
    return normalized[0] || "";
  }

  async function ensureRegisteredAddressSaved(address, coords = null) {
    const trimmed = normalizeRegisteredAddress(address);
    if (!trimmed) return "";
    const syncCoords = coords || resolveRegisteredCoords();
    const body = { registered_address: trimmed };
    if (syncCoords) {
      body.registered_latitude = syncCoords.latitude;
      body.registered_longitude = syncCoords.longitude;
    }
    const current = normalizeRegisteredAddress(tenantProfile?.registered_address || "");
    const profileLat = tenantProfile?.registered_latitude;
    const profileLng = tenantProfile?.registered_longitude;
    const sameAddress = current === trimmed;
    const sameCoords =
      !syncCoords ||
      (profileLat != null &&
        profileLng != null &&
        Number(profileLat) === Number(syncCoords.latitude) &&
        Number(profileLng) === Number(syncCoords.longitude));
    if (sameAddress && sameCoords) return trimmed;
    const res = await apiFetch("/admin/tenant-profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseApiDetail(data, "Could not save business address."));
    mergeTenantProfile(data);
    return trimmed;
  }

  function primarySite() {
    return sites.find((s) => s.is_primary) || sites[0] || null;
  }

  function roleLabel(value) {
    if (!value || value === "all") return "All staff";
    if (ROLE_LABELS[value]) return ROLE_LABELS[value];
    return value.replace(/_/g, " ").replace(/,/g, ", ");
  }

  function punchWithinGeofence(punch) {
    if (punch.admin_override) return true;
    if (punch.within_geofence === false) return false;
    if (punch.distance_meters != null && punch.radius_meters != null) {
      return punch.distance_meters <= punch.radius_meters;
    }
    return punch.within_geofence !== false;
  }

  function renderDistanceCell(punch) {
    if (punch.admin_override || punch.punch_method === "admin") {
      return '<span class="punch-distance punch-distance--admin" title="Admin override">Admin</span>';
    }
    if (punch.punch_method === "site_qr") {
      return '<span class="punch-distance punch-distance--ok" title="Premises QR">QR</span>';
    }
    if (punch.distance_meters == null) return '<span class="muted">—</span>';
    const within = punchWithinGeofence(punch);
    const accuracy =
      punch.accuracy_meters != null ? ` · Accuracy ±${Math.round(punch.accuracy_meters)}m` : "";
    if (within) {
      return `<span class="punch-distance punch-distance--ok" title="Within geofence">✓ ${Math.round(punch.distance_meters)}m${accuracy}</span>`;
    }
    return `<span class="punch-distance punch-distance--warn" title="Outside geofence">⚠ ${Math.round(punch.distance_meters)}m${accuracy}</span>`;
  }

  function renderLocationCell(punch) {
    const siteName = punch.site_name ? escapeHtml(punch.site_name) : "Unknown site";
    const meta = renderDistanceCell(punch);
    return `<div class="punch-location-cell"><strong class="punch-location-cell__site">${siteName}</strong><span class="punch-location-cell__meta">${meta}</span></div>`;
  }

  function renderTypeBadge(type) {
    const labels = {
      in: ["Clock in", "in"],
      out: ["Clock out", "out"],
      break_start: ["Break start", "out"],
      break_end: ["Break end", "in"],
    };
    const [label, tone] = labels[type] || ["Punch", "out"];
    return `<span class="punch-type-badge punch-type-badge--${tone}">${label}</span>`;
  }

  function showPunchNote(text, tone = "info") {
    const toast = $("punch-toast");
    const inline = $("punch-admin-message");

    if (!text) {
      if (toast) {
        toast.hidden = true;
        toast.textContent = "";
        toast.className = "punch-toast";
        window.clearTimeout(showPunchNote._timer);
        window.clearTimeout(showPunchNote._hideTimer);
      }
      if (inline) {
        inline.hidden = true;
        inline.textContent = "";
        inline.className = "muted punch-admin-message punch-admin-message--info";
      }
      return;
    }

    if (tone === "info") {
      if (toast) {
        toast.hidden = true;
        toast.classList.remove("punch-toast--visible");
      }
      if (inline) {
        inline.hidden = false;
        inline.textContent = text;
        inline.className = "muted punch-admin-message punch-admin-message--info";
      }
      return;
    }

    const toastTone = tone === "ok" || tone === "warn" || tone === "error" ? tone : "ok";
    if (toast) {
      toast.textContent = text;
      toast.hidden = false;
      toast.className = `punch-toast punch-toast--visible punch-toast--${toastTone}`;
      window.clearTimeout(showPunchNote._timer);
      window.clearTimeout(showPunchNote._hideTimer);
      const dismissMs = toastTone === "error" ? 5200 : 3800;
      showPunchNote._timer = window.setTimeout(() => {
        toast.classList.remove("punch-toast--visible");
        showPunchNote._hideTimer = window.setTimeout(() => {
          toast.hidden = true;
        }, 220);
      }, dismissMs);
    }
    if (inline) {
      inline.hidden = true;
      inline.textContent = "";
    }
  }

  function markPunchDataLoaded() {
    punchDataLoadedAt = new Date();
    updatePunchDataLoadedLabel();
  }

  function updatePunchDataLoadedLabel() {
    const el = $("punch-data-loaded-at");
    if (!el) return;
    if (!punchDataLoadedAt) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    const when = punchDataLoadedAt.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    el.hidden = false;
    el.textContent = `Last loaded · ${when}`;
  }

  function parseApiDetail(data, fallback = "Request failed") {
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
    if (typeof data?.message === "string") return data.message;
    return fallback;
  }

  function updateSetupUi() {
    const warning = $("punch-address-warning");
    const setupGuide = $("punch-setup-guide");
    const setupQrActions = $("punch-setup-qr-actions");
    const selectHint = $("punch-detail-select-hint");
    const noSites = !sites.length;
    const address = resolveRegisteredAddress();
    const hasAddress = hasBusinessAddress();
    const activeSites = (sites || []).filter((site) => site.is_active);
    const addressExample =
      window.Admin?.BUSINESS_ADDRESS_EXAMPLE || "156 Front street, Nottingham, NG5 7EG";

    if (warning) {
      warning.hidden = hasAddress;
      const copy = warning.querySelector(".alert-copy");
      if (copy) {
        const addressCheck = validateRegisteredAddress(address);
        copy.textContent = address
          ? `${addressCheck.message} Example: ${addressExample}.`
          : `Search your premises below on OpenStreetMap, pick a result, then click Sync from address. Example: ${addressExample}.`;
      }
    }
    const syncMeta = $("punch-sync-meta");
    if (syncMeta) syncMeta.textContent = lastSyncLabel();

    ["sync-punch-site-btn", "punch-setup-sync-btn"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      btn.disabled = false;
      btn.title = hasAddress
        ? "Create or refresh your primary punch site from the pinned address"
        : "Search your premises on the map below, pick a result, then sync";
    });

    ["punch-setup-poster-btn", "punch-setup-view-qr-btn"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      btn.disabled = false;
      btn.title = activeSites.length
        ? id === "punch-setup-poster-btn"
          ? "Print an A4 poster with QR codes for all active sites"
          : "Jump to the premises QR gallery"
        : "Sync from address first to create your punch site and QR codes";
    });

    if (setupGuide && selectHint) {
      if (noSites) {
        setupGuide.hidden = false;
        selectHint.hidden = true;
      } else if (!selectedSiteId) {
        setupGuide.hidden = true;
        selectHint.hidden = false;
      } else {
        setupGuide.hidden = true;
        selectHint.hidden = true;
      }
    }

    if (setupQrActions) {
      setupQrActions.hidden = setupGuide ? setupGuide.hidden : !activeSites.length;
    }

    const posterBtn = $("punch-print-all-poster-btn");
    if (posterBtn) {
      posterBtn.disabled = !activeSites.length;
      posterBtn.title = !activeSites.length
        ? "Sync or add a punch site first — then print the premises QR poster."
        : "Print an A4 poster with QR codes for all active sites";
    }

    const galleryPosterBtn = $("punch-gallery-poster-btn");
    if (galleryPosterBtn) {
      galleryPosterBtn.disabled = !activeSites.length;
    }
  }

  function updatePunchStats() {
    const siteItems = sites || [];
    const todayItems = todayPunches || [];
    $("punch-stat-sites").textContent = String(siteItems.length);
    $("punch-stat-today").textContent = String(todayItems.length);

    const lastToday = todayItems[0];
    $("punch-stat-today-sub").textContent = lastToday
      ? `Last punch ${formatTimeShort(lastToday.punched_at)}`
      : "No punches yet";

    const primary = primarySite();
    if (primary) {
      $("punch-stat-primary").textContent = primary.name;
      const addressLine = String(primary.address || "").split(",")[0]?.trim();
      $("punch-stat-primary-sub").textContent = addressLine || "Main clock location";
      $("punch-stat-radius").textContent = `${primary.radius_meters}m`;
      $("punch-stat-radius-sub").textContent = "Staff must be on site to punch";
    } else {
      $("punch-stat-primary").textContent = "None";
      $("punch-stat-primary-sub").textContent = "Not configured";
      $("punch-stat-radius").textContent = "—";
      $("punch-stat-radius-sub").textContent = "Set up a punch site first";
    }
    updateSetupUi();
  }

  function setActiveTab(tab) {
    activeTab = tab;
    if (tab !== "accountant") {
      delete document.body.dataset.punchFocus;
    }
    document.querySelectorAll(".punch-view-tab").forEach((btn) => {
      const isActive = btn.dataset.punchTab === tab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    document.querySelectorAll(".punch-tab-panel").forEach((panel) => {
      panel.hidden = panel.dataset.punchPanel !== tab;
    });
    if (tab === "sites") {
      void loadSites().then(updatePunchStats);
      void loadDailyPunches(punchHistoryDate, { quiet: true });
    }
    if (tab === "records") {
      void Promise.all([loadEmployeeList(), loadSites(), loadDailyPunches(punchHistoryDate)]).then(updatePunchStats);
    }
    if (tab === "log") void loadPunches();
    if (tab === "accountant") {
      void loadTenantProfile().then(renderAccountantSettings);
    }
    if (tab === "summary") void loadWeekPunches().then(renderActivityChart);
    if (tab === "timesheet") loadTimesheet();
  }

  function resetPunchFilters() {
    filters = { date_from: "", date_to: "", employee_id: "", site_id: "", punch_type: "" };
    ["punch-filter-from", "punch-filter-to", "punch-filter-employee", "punch-filter-site", "punch-filter-type"].forEach(
      (id) => {
        const el = $(id);
        if (el) el.value = "";
      }
    );
  }

  function populateSelect(select, items, placeholder) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
    items.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = String(item.value);
      opt.textContent = item.label;
      select.appendChild(opt);
    });
    if (current && [...select.options].some((o) => o.value === current)) {
      select.value = current;
    }
  }

  function refreshFilterSelects() {
    const employeeOptions = employees.map((e) => ({
      value: e.id,
      label: `${e.first_name} ${e.last_name}`.trim(),
    }));
    const siteOptions = sites.map((s) => ({ value: s.id, label: s.name }));
    populateSelect($("punch-filter-employee"), employeeOptions, "All employees");
    populateSelect($("punch-day-filter-employee"), employeeOptions, "All employees");
    populateSelect($("punch-export-employee"), employeeOptions, "All employees");
    populateSelect($("punch-admin-employee"), employeeOptions, "Select employee…");
    populateSelect($("punch-filter-site"), siteOptions, "All sites");
    populateSelect($("punch-day-filter-site"), siteOptions, "All sites");
    populateSelect($("punch-export-site"), siteOptions, "All sites");
    populateSelect(
      $("punch-admin-site"),
      sites.filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name })),
      "Select site…"
    );
  }

  function geofenceVizSvg(radiusMeters) {
    const r = Math.min(78, Math.max(40, Number(radiusMeters) / 4));
    return `
      <div class="punch-geofence-viz" aria-hidden="true">
        <svg viewBox="0 0 220 220" class="punch-geofence-viz__svg">
          <defs>
            <radialGradient id="punch-geofence-fill" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#d8f3dc"/>
              <stop offset="70%" stop-color="#b7e4c7"/>
              <stop offset="100%" stop-color="#95d5b2"/>
            </radialGradient>
          </defs>
          <rect width="220" height="220" rx="16" fill="#f8fafc"/>
          <circle cx="110" cy="100" r="${r}" fill="url(#punch-geofence-fill)" opacity="0.85"/>
          <circle cx="110" cy="100" r="${r}" fill="none" stroke="#2d6a4f" stroke-width="2" stroke-dasharray="7 5" opacity="0.55"/>
          <circle cx="110" cy="100" r="9" fill="#1b4332"/>
          <circle cx="110" cy="100" r="22" fill="none" stroke="#40916c" stroke-width="1.5" opacity="0.35"/>
          <text id="punch-geofence-viz-label" x="110" y="196" text-anchor="middle" font-size="11" font-weight="600" fill="#2d6a4f">${escapeHtml(String(radiusMeters))}m radius</text>
        </svg>
      </div>`;
  }

  function siteMapsUrl(site) {
    const lat = Number(site.latitude);
    const lng = Number(site.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `https://www.google.com/maps?q=${lat},${lng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address || "")}`;
  }

  function siteRoleChipsHtml(permittedRoles) {
    if (!permittedRoles || permittedRoles === "all") {
      return `<span class="punch-site-chip">All staff</span>`;
    }
    return String(permittedRoles)
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean)
      .map((role) => `<span class="punch-site-chip">${escapeHtml(roleLabel(role))}</span>`)
      .join("");
  }

  function siteDetailMetricsHtml(site, stats) {
    const punchTone = stats.outside > 0 ? "warn" : stats.total > 0 ? "ok" : "";
    const punchSub = stats.outside
      ? `${stats.outside} outside geofence`
      : stats.total
        ? "Logged today"
        : "No punches yet";
    return `
      <div class="punch-site-metrics" aria-label="Site activity">
        <div class="punch-site-metric punch-site-metric--${punchTone || "default"}">
          <span class="punch-site-metric__icon" aria-hidden="true">🕐</span>
          <span class="punch-site-metric__label">Today&apos;s punches</span>
          <span class="punch-site-metric__value">${stats.total}</span>
          <span class="punch-site-metric__sub">${escapeHtml(punchSub)}</span>
        </div>
        <div class="punch-site-metric">
          <span class="punch-site-metric__icon" aria-hidden="true">⭕</span>
          <span class="punch-site-metric__label">Geofence</span>
          <span class="punch-site-metric__value">${escapeHtml(String(site.radius_meters))}m</span>
          <span class="punch-site-metric__sub">GPS clock-in range</span>
        </div>
        <div class="punch-site-metric">
          <span class="punch-site-metric__icon" aria-hidden="true">↻</span>
          <span class="punch-site-metric__label">Last synced</span>
          <span class="punch-site-metric__value punch-site-metric__value--text">${escapeHtml(formatSyncShort(site.updated_at || lastSyncIso()))}</span>
          <span class="punch-site-metric__sub">Address &amp; coordinates</span>
        </div>
      </div>`;
  }

  function geofenceSettingsMarkup(site) {
    return `
      <div class="punch-geofence-settings" id="punch-geofence-settings">
        <h4 class="punch-site-section-title">Adjust geofence</h4>
        <p class="muted punch-tab-intro punch-site-section-lead">How close staff must be to clock in with GPS (25–2000 metres). Widen if phones struggle indoors, or use the premises QR below.</p>
        <form id="punch-geofence-form" class="punch-geofence-form">
          <label class="edit-field punch-geofence-form__field">
            <span class="edit-label">Radius (metres)</span>
            <input type="number" name="radius_meters" min="25" max="2000" value="${site.radius_meters}" required />
          </label>
          <button type="submit" class="btn primary punch-geofence-form__save">Save radius</button>
        </form>
      </div>`;
  }

  function wireGeofenceSettings(site) {
    const form = $("punch-geofence-form");
    const radiusInput = form?.querySelector('input[name="radius_meters"]');
    const vizLabel = $("punch-geofence-viz-label");
    radiusInput?.addEventListener("input", () => {
      if (vizLabel) vizLabel.textContent = `${radiusInput.value || site.radius_meters}m radius`;
    });
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const radius = Number(radiusInput?.value);
      if (!Number.isFinite(radius) || radius < 25 || radius > 2000) {
        showPunchNote("Radius must be between 25 and 2000 metres.", "error");
        return;
      }
      await saveSiteFields(site.id, { radius_meters: radius }, "Geofence radius updated.");
    });
  }

  function siteTodayStats(siteId) {
    const items = todayPunches.filter((p) => p.punch_site_id === siteId);
    const outside = items.filter((p) => !punchWithinGeofence(p)).length;
    return { total: items.length, outside };
  }

  function outsideAlertsForSite(site) {
    return todayPunches.filter(
      (p) => p.punch_site_id === site.id && !punchWithinGeofence(p) && !p.admin_override
    );
  }

  function renderSiteDetail(site) {
    const empty = $("punch-detail-empty");
    const content = $("punch-detail-content");
    if (!content || !site) return;
    empty?.setAttribute("hidden", "");
    content.hidden = false;

    const stats = siteTodayStats(site.id);
    const outside = outsideAlertsForSite(site);
    const alertsHtml = outside
      .map(
        (p) =>
          `<div class="alert-card alert-card-warning punch-site-alert"><p class="alert-copy">Outside geofence: <strong>${escapeHtml(p.employee_name)}</strong> clocked ${p.punch_type === "in" ? "in" : "out"} at ${Math.round(p.distance_meters || 0)}m — limit ${site.radius_meters}m.</p></div>`
      )
      .join("");

    content.innerHTML = `
      <div class="punch-site-detail">
        <header class="punch-site-hero">
          <div class="punch-site-hero__badge" aria-hidden="true">📍</div>
          <div class="punch-site-hero__body">
            <h3 class="punch-site-hero__title">${escapeHtml(site.name)}</h3>
            <div class="punch-site-hero__meta">
              <span class="contracts-status-pill contracts-status-pill--${site.is_active ? "signed" : "draft"}">${site.is_active ? "Active" : "Inactive"}</span>
              ${site.is_primary ? `<span class="punch-site-chip punch-site-chip--primary">Primary site</span>` : ""}
            </div>
          </div>
        </header>

        ${siteDetailMetricsHtml(site, stats)}

        <article class="punch-site-info-card">
          <div class="punch-site-info-row">
            <span class="punch-site-info-row__icon" aria-hidden="true">🏠</span>
            <div class="punch-site-info-row__body">
              <span class="punch-site-info-row__label">Premises address</span>
              <p class="punch-site-info-row__value">${escapeHtml(site.address)}</p>
              <a class="punch-site-link" href="${escapeHtml(siteMapsUrl(site))}" target="_blank" rel="noopener noreferrer">Open in Maps</a>
            </div>
          </div>
        </article>

        <article class="punch-site-info-card">
          <span class="punch-site-info-row__label">Permitted roles</span>
          <div class="punch-site-chips">${siteRoleChipsHtml(site.permitted_roles)}</div>
        </article>

        <article class="punch-site-geofence-card">
          <div class="punch-site-geofence-card__viz">
            ${geofenceVizSvg(site.radius_meters)}
          </div>
          <div class="punch-site-geofence-card__settings">
            ${geofenceSettingsMarkup(site)}
          </div>
        </article>

        <article class="card punch-clock-qr-card" id="punch-clock-qr-card">
          <h4 class="punch-site-section-title">Premises QR clock-in</h4>
          <p class="muted punch-tab-intro punch-site-section-lead">Print this QR indoors where GPS is weak. Staff scan it in the Time Clock app, then clock in or out without GPS for 10 minutes.</p>
          <div id="punch-clock-qr-body" class="punch-clock-qr-body muted">Loading QR…</div>
        </article>

        <article class="card punch-epos-card" id="punch-epos-card">
          <h4 class="punch-site-section-title">EPOS / till integration</h4>
          <p class="muted punch-tab-intro punch-site-section-lead">Generate a device token for DineSwift EPOS or another till. Staff enter employee number + kiosk PIN — the till calls the punch API (no portal login).</p>
          <div id="punch-epos-tokens-body" class="punch-epos-tokens-body muted">Loading integration tokens…</div>
        </article>

        ${alertsHtml}

        <div id="punch-edit-form-wrap" hidden></div>

        <div class="hr-detail-foot punch-site-detail-foot">
          <button type="button" class="btn outline" id="punch-test-geofence-btn"><span aria-hidden="true">◎</span> Test geofence</button>
          <button type="button" class="btn outline" id="punch-edit-site-btn"><span aria-hidden="true">✎</span> Edit name &amp; roles</button>
        </div>
        <p id="punch-geofence-test-result" class="muted punch-geofence-result" aria-live="polite"></p>
      </div>`;

    content.querySelector("#punch-test-geofence-btn")?.addEventListener("click", () => testGeofence(site));
    content.querySelector("#punch-edit-site-btn")?.addEventListener("click", () => showEditSiteForm(site));
    wireGeofenceSettings(site);
    loadSiteClockQr(site.id);
    loadSiteEposTokens(site.id);
    updateSetupUi();
  }

  function qrImageSrc(data) {
    return data.qr_image_data_uri || data.qr_image_url || "";
  }

  async function fetchSiteClockQr(siteId) {
    const res = await apiFetch(`/admin/time-punch/sites/${siteId}/clock-qr`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseApiDetail(data, "Could not load QR"));
    if (!qrImageSrc(data)) throw new Error("QR image was empty — try syncing the site again.");
    siteQrCache.set(siteId, data);
    return data;
  }

  function downloadDataUriAsFile(dataUri, filename) {
    const [header, encoded] = String(dataUri || "").split(",");
    if (!encoded) throw new Error("QR image data is missing.");
    const mime = header.match(/data:(.*?);/)?.[1] || "image/png";
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function loadSiteClockQr(siteId) {
    const host = $("punch-clock-qr-body");
    if (!host) return;
    host.textContent = "Loading QR…";
    try {
      const data = await fetchSiteClockQr(siteId);
      const qrSrc = qrImageSrc(data);
      host.innerHTML = `
        <div class="punch-clock-qr-layout">
          <img src="${escapeHtml(qrSrc)}" width="200" height="200" alt="Premises clock-in QR for ${escapeHtml(data.site_name)}" class="punch-clock-qr-image" />
          <div class="punch-clock-qr-meta">
            <p class="punch-clock-qr-site-name"><strong>${escapeHtml(data.site_name || "Work site")}</strong></p>
            ${portalLinksMarkup({ includeMaster: false })}
            <p class="muted punch-clock-qr-note">Staff scan this QR in the Time Clock app — no need to type the link.</p>
            <div class="punch-clock-qr-actions">
              <button type="button" class="btn outline" id="punch-copy-clock-url">Copy premises link</button>
              <button type="button" class="btn outline" id="punch-download-clock-qr">Download QR PNG</button>
              <button type="button" class="btn outline" id="punch-print-clock-card">Print QR card</button>
              <button type="button" class="btn outline" id="punch-print-tent-card">Print tent card</button>
              <button type="button" class="btn outline" id="punch-open-kiosk-btn">Open kiosk</button>
              <button type="button" class="btn ghost" id="punch-rotate-clock-token">Rotate QR</button>
            </div>
          </div>
        </div>`;
      host.querySelector("#punch-copy-clock-url")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(data.clock_url);
          showPunchNote("Premises clock link copied.", "ok");
        } catch {
          showPunchNote("Could not copy link.", "error");
        }
      });
      host.querySelector("#punch-download-clock-qr")?.addEventListener("click", (event) => {
        const button = event.currentTarget;
        void runQrDownload(button, () =>
          downloadSiteClockQr(siteId, data.site_name).catch((error) => {
            showPunchNote(friendlyQrDownloadError(error), "error");
          }),
        );
      });
      host.querySelector("#punch-print-clock-card")?.addEventListener("click", () => {
        openPunchCardPage("pocket", data);
      });
      host.querySelector("#punch-print-tent-card")?.addEventListener("click", () => {
        openPunchCardPage("tent", data);
      });
      host.querySelector("#punch-open-kiosk-btn")?.addEventListener("click", () => {
        const url =
          data.kiosk_url ||
          `./punch-kiosk.html?clock=${encodeURIComponent(data.clock_token || "")}`;
        window.open(new URL(url, window.location.href).toString(), "_blank", "noopener");
      });
      host.querySelector("#punch-rotate-clock-token")?.addEventListener("click", async () => {
        if (!window.confirm("Rotate this QR code? Old printed codes will stop working.")) return;
        showPunchNote("Rotating premises QR…");
        try {
          const rotateRes = await apiFetch(`/admin/time-punch/sites/${siteId}/rotate-clock-token`, {
            method: "POST",
          });
          const rotateData = await rotateRes.json().catch(() => ({}));
          if (!rotateRes.ok) throw new Error(rotateData.detail || "Rotate failed");
          showPunchNote("Premises QR rotated. Reprint the code at this site.", "ok");
          await loadSiteClockQr(siteId);
        } catch (error) {
          showPunchNote(error.message || "Could not rotate QR.", "error");
        }
      });
    } catch (error) {
      host.textContent = error.message || "Could not load premises QR.";
    }
  }

  async function loadSiteEposTokens(siteId) {
    const host = document.getElementById("punch-epos-tokens-body");
    if (!host) return;
    host.textContent = "Loading integration tokens…";
    try {
      const res = await apiFetch(`/admin/time-punch/sites/${siteId}/epos-tokens`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiDetail(data, "Could not load EPOS tokens"));
      const items = data.items || [];
      const rows = items.length
        ? items
            .map(
              (item) => `
          <tr>
            <td>${escapeHtml(item.label)}</td>
            <td><code>${escapeHtml(item.token_prefix)}…</code></td>
            <td>${item.is_active ? "Active" : "Revoked"}</td>
            <td class="muted">${escapeHtml(item.last_used_at ? formatWhen(item.last_used_at) : "Never")}</td>
            <td>
              ${item.is_active ? `<button type="button" class="btn ghost btn-sm" data-revoke-epos-token="${item.id}">Revoke</button>` : ""}
            </td>
          </tr>`,
            )
            .join("")
        : `<tr><td colspan="5" class="muted">No till tokens yet — create one for EPOS or a shared clock terminal.</td></tr>`;
      host.innerHTML = `
        <div class="punch-epos-create">
          <label class="edit-field">
            <span class="edit-label">Till / integration name</span>
            <input type="text" id="punch-epos-token-label" maxlength="120" placeholder="e.g. Bar till 1" />
          </label>
          <button type="button" class="btn outline" id="punch-create-epos-token-btn">Create device token</button>
        </div>
        <div class="hr-table-wrap punch-epos-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Token</th>
                <th>Status</th>
                <th>Last used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="muted punch-epos-hint">API: <code>POST /integrations/v1/epos/punch</code> with <code>Authorization: Bearer …</code>. Copy the token when created — it is shown only once.</p>
        <div id="punch-epos-token-reveal" class="punch-epos-token-reveal" hidden></div>`;
      host.querySelector("#punch-create-epos-token-btn")?.addEventListener("click", async () => {
        const label = host.querySelector("#punch-epos-token-label")?.value?.trim();
        if (!label) {
          showPunchNote("Enter a name for this till or integration.", "error");
          return;
        }
        showPunchNote("Creating device token…");
        try {
          const createRes = await apiFetch(`/admin/time-punch/sites/${siteId}/epos-tokens`, {
            method: "POST",
            body: JSON.stringify({ label }),
          });
          const created = await createRes.json().catch(() => ({}));
          if (!createRes.ok) throw new Error(parseApiDetail(created, "Could not create token"));
          const reveal = host.querySelector("#punch-epos-token-reveal");
          if (reveal) {
            reveal.hidden = false;
            reveal.innerHTML = `
              <p class="punch-epos-token-reveal__warn"><strong>Copy this token now</strong> — it will not be shown again.</p>
              <code class="punch-epos-token-reveal__code">${escapeHtml(created.token || "")}</code>
              <button type="button" class="btn outline btn-sm" id="punch-copy-epos-token">Copy token</button>`;
            reveal.querySelector("#punch-copy-epos-token")?.addEventListener("click", async () => {
              try {
                await navigator.clipboard.writeText(created.token || "");
                showPunchNote("EPOS token copied.", "ok");
              } catch {
                showPunchNote("Could not copy token.", "error");
              }
            });
          }
          showPunchNote("Device token created.", "ok");
          const labelInput = host.querySelector("#punch-epos-token-label");
          if (labelInput) labelInput.value = "";
          const tbody = host.querySelector(".punch-epos-table-wrap tbody");
          if (tbody) {
            const emptyRow = tbody.querySelector("td[colspan='5']");
            emptyRow?.closest("tr")?.remove();
            const tr = document.createElement("tr");
            tr.innerHTML = `
            <td>${escapeHtml(created.label || label)}</td>
            <td><code>${escapeHtml(created.token_prefix || "")}…</code></td>
            <td>Active</td>
            <td class="muted">Never</td>
            <td><button type="button" class="btn ghost btn-sm" data-revoke-epos-token="${created.id}">Revoke</button></td>`;
            tbody.prepend(tr);
            tr.querySelector("[data-revoke-epos-token]")?.addEventListener("click", async () => {
              if (!window.confirm("Revoke this till token? EPOS devices using it will stop working.")) return;
              try {
                const revokeRes = await apiFetch(`/admin/time-punch/epos-tokens/${created.id}`, { method: "DELETE" });
                if (!revokeRes.ok) throw new Error("Could not revoke token");
                showPunchNote("Till token revoked.", "ok");
                await loadSiteEposTokens(siteId);
              } catch (error) {
                showPunchNote(error.message || "Could not revoke token.", "error");
              }
            });
          }
        } catch (error) {
          showPunchNote(error.message || "Could not create token.", "error");
        }
      });
      host.querySelectorAll("[data-revoke-epos-token]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tokenId = btn.getAttribute("data-revoke-epos-token");
          if (!tokenId || !window.confirm("Revoke this till token? EPOS devices using it will stop working.")) return;
          try {
            const revokeRes = await apiFetch(`/admin/time-punch/epos-tokens/${tokenId}`, { method: "DELETE" });
            if (!revokeRes.ok) {
              const err = await revokeRes.json().catch(() => ({}));
              throw new Error(parseApiDetail(err, "Could not revoke token"));
            }
            showPunchNote("Till token revoked.", "ok");
            await loadSiteEposTokens(siteId);
          } catch (error) {
            showPunchNote(error.message || "Could not revoke token.", "error");
          }
        });
      });
    } catch (error) {
      host.textContent = error.message || "Could not load EPOS integration tokens.";
    }
  }

  async function runQrDownload(button, action) {
    const label = button?.textContent || "";
    if (button) {
      button.disabled = true;
      button.textContent = "Downloading…";
    }
    try {
      await action();
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }

  function friendlyQrDownloadError(error) {
    const message = String(error?.message || error || "").trim();
    if (message === "Load failed" || message === "Failed to fetch") {
      return "Could not download the QR image. Check your connection and try again.";
    }
    return message || "Could not download QR.";
  }

  function storePunchCardPayload(payload) {
    sessionStorage.setItem("punchCardPayload", JSON.stringify(payload));
  }

  function openPunchCardPage(layout = "pocket", qrData) {
    if (qrData) {
      storePunchCardPayload({
        clock_url: qrData.clock_url,
        site_name: qrData.site_name || "Work site",
        qr_image_data_uri: qrImageSrc(qrData),
        layout,
      });
    }
    const cardUrl = new URL("./punch-site-card.html", window.location.href);
    cardUrl.searchParams.set("layout", layout);
    const win = window.open(cardUrl.toString(), "_blank", "noopener");
    if (!win) {
      showPunchNote("Allow pop-ups to open the QR print page.", "warn");
    }
    return win;
  }

  function scrollToQrGallery(options = {}) {
    const { quiet = false } = options;
    const target = $("punch-qr-gallery");
    if (!target || target.hidden) {
      if (!quiet) {
        showPunchNote("Sync from address first to generate premises QR codes.", "warn");
      }
      return false;
    }
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return true;
  }

  async function viewQrCodesFromSetup() {
    const activeSites = (sites || []).filter((site) => site.is_active);
    if (!activeSites.length) {
      showPunchNote("Sync from address first to create your punch site and QR codes.", "warn");
      return;
    }
    setActiveTab("sites");
    await renderQrGallery();
    if (scrollToQrGallery({ quiet: true })) {
      showPunchNote("Premises QR codes are ready below.", "ok");
      return;
    }
    showPunchNote("Could not load QR codes yet. Try again in a moment.", "warn");
  }

  function bindQrGalleryTile(siteId, data) {
    document.querySelector(`[data-gallery-download="${siteId}"]`)?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      void runQrDownload(button, () =>
        downloadSiteClockQr(siteId, data.site_name).catch((error) => {
          showPunchNote(friendlyQrDownloadError(error), "error");
        }),
      );
    });
    document.querySelector(`[data-gallery-print-card="${siteId}"]`)?.addEventListener("click", () => {
      openPunchCardPage("pocket", data);
    });
    document.querySelector(`[data-gallery-print-tent="${siteId}"]`)?.addEventListener("click", () => {
      openPunchCardPage("tent", data);
    });
    document.querySelector(`[data-gallery-copy-url="${siteId}"]`)?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(data.clock_url);
        showPunchNote("Premises clock link copied.", "ok");
      } catch {
        showPunchNote("Could not copy link.", "error");
      }
    });
    document.querySelector(`[data-gallery-select="${siteId}"]`)?.addEventListener("click", () => {
      selectedSiteId = siteId;
      renderSitesTable();
      renderSiteDetail(sites.find((site) => site.id === siteId));
    });
  }

  async function renderQrGallery() {
    const section = $("punch-qr-gallery");
    const grid = $("punch-qr-gallery-grid");
    if (!section || !grid) return;

    const activeSites = (sites || []).filter((site) => site.is_active);
    if (!activeSites.length) {
      section.hidden = true;
      grid.textContent = "Sync a punch site to generate QR codes.";
      return;
    }

    section.hidden = false;
    grid.innerHTML = `<p class="muted">Generating QR codes…</p>`;

    try {
      const results = await Promise.allSettled(
        activeSites.map(async (site) => {
          const data = await fetchSiteClockQr(site.id);
          return { site, data };
        }),
      );
      const items = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      const failures = results.filter((result) => result.status === "rejected");

      if (!items.length) {
        const message =
          failures[0]?.reason?.message || "Could not generate QR codes. Try syncing your punch site again.";
        grid.innerHTML = `<p class="muted">${escapeHtml(message)}</p>`;
        showPunchNote(message, "error");
        return;
      }

      if (failures.length) {
        showPunchNote(`${failures.length} site QR code(s) could not be loaded. Others are shown below.`, "warn");
      }

      grid.innerHTML = items
        .map(({ site, data }) => {
          const qrSrc = qrImageSrc(data);
          return `<article class="punch-qr-tile">
            <img src="${escapeHtml(qrSrc)}" width="160" height="160" alt="Premises QR for ${escapeHtml(data.site_name || site.name)}" class="punch-qr-tile__image" />
            <div class="punch-qr-tile__body">
              <h5 class="punch-qr-tile__title">${escapeHtml(data.site_name || site.name)}</h5>
              <p class="muted punch-qr-tile__hint">Scan in Time Clock → Clock in/out indoors</p>
              <div class="punch-qr-tile__actions">
                <button type="button" class="btn outline btn-sm" data-gallery-download="${site.id}">Download PNG</button>
                <button type="button" class="btn outline btn-sm" data-gallery-print-card="${site.id}">Print card</button>
                <button type="button" class="btn ghost btn-sm" data-gallery-print-tent="${site.id}">Tent card</button>
                <button type="button" class="btn ghost btn-sm" data-gallery-copy-url="${site.id}">Copy link</button>
                <button type="button" class="btn ghost btn-sm" data-gallery-select="${site.id}">Site details</button>
              </div>
            </div>
          </article>`;
        })
        .join("");

      items.forEach(({ site, data }) => bindQrGalleryTile(site.id, data));
    } catch (error) {
      grid.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not generate QR codes.")}</p>`;
    }
  }

  async function downloadSiteClockQr(siteId, siteName) {
    const safeName = String(siteName || "work-site")
      .trim()
      .replace(/[^\w\s-]+/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();
    const filename = `premises-clock-qr-${safeName || "site"}.png`;
    let data = siteQrCache.get(siteId);
    if (!data) {
      data = await fetchSiteClockQr(siteId);
    }
    const dataUri = qrImageSrc(data);
    if (dataUri.startsWith("data:image/")) {
      downloadDataUriAsFile(dataUri, filename);
      showPunchNote("Premises QR downloaded.", "ok");
      return;
    }
    await downloadAuthenticated(`/admin/time-punch/sites/${siteId}/clock-qr.png`, filename);
    showPunchNote("Premises QR downloaded.", "ok");
  }

  function portalLinksMarkup({ includeMaster = true, includeClock = true } = {}) {
    const portals = (window.ShiftSwiftBrand?.portals?.() || []).filter((p) => {
      if (p.id === "master" && !includeMaster) return false;
      if (p.id === "clock" && !includeClock) return false;
      return true;
    });
    if (!portals.length) return "";
    return `<ul class="punch-portal-links">${portals
      .map(
        (p) =>
          `<li><strong>${escapeHtml(p.label)}</strong> <span class="punch-portal-links__url">${escapeHtml(p.display)}</span></li>`,
      )
      .join("")}</ul>`;
  }

  function showEditSiteForm(site) {
    const wrap = $("punch-edit-form-wrap");
    if (!wrap) return;
    wrap.hidden = false;
    wrap.innerHTML = `
      <form id="punch-edit-form" class="punch-inline-form punch-edit-form">
        <h4 class="hr-section-title">Site details</h4>
        <label class="edit-field"><span class="edit-label">Site name</span><input type="text" name="name" value="${escapeHtml(site.name)}" required /></label>
        <label class="edit-field"><span class="edit-label">Permitted roles</span>
          <select name="permitted_roles">
            <option value="all" ${site.permitted_roles === "all" ? "selected" : ""}>All staff</option>
            <option value="kitchen" ${site.permitted_roles === "kitchen" ? "selected" : ""}>Kitchen</option>
            <option value="front_of_house" ${site.permitted_roles === "front_of_house" ? "selected" : ""}>Front of house</option>
            <option value="bar" ${site.permitted_roles === "bar" ? "selected" : ""}>Bar</option>
            <option value="management" ${site.permitted_roles === "management" ? "selected" : ""}>Management</option>
          </select>
        </label>
        <div class="punch-inline-form__actions">
          <button type="submit" class="btn primary">Save changes</button>
          <button type="button" class="btn ghost" id="punch-edit-cancel">Cancel</button>
        </div>
      </form>`;
    wrap.querySelector("#punch-edit-cancel")?.addEventListener("click", () => {
      wrap.hidden = true;
      wrap.innerHTML = "";
    });
    wrap.querySelector("#punch-edit-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await saveSiteFields(
        site.id,
        {
          name: form.name.value.trim(),
          permitted_roles: form.permitted_roles.value,
        },
        "Site details updated.",
      );
    });
    wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function saveSiteFields(siteId, payload, successMessage = "Site updated.") {
    try {
      const res = await apiFetch(`/admin/time-punch/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPunchNote(data.detail || "Could not save site.", "error");
        return;
      }
      showPunchNote(successMessage, "ok");
      await loadSites();
      selectedSiteId = siteId;
      renderSiteDetail(sites.find((s) => s.id === siteId));
      updatePunchStats();
    } catch (error) {
      showPunchNote(error.message || "Could not save site.", "error");
    }
  }

  function testGeofence(site) {
    const result = $("punch-geofence-test-result");
    if (!navigator.geolocation) {
      if (result) result.textContent = "Geolocation is not available in this browser.";
      return;
    }
    if (result) result.textContent = "Checking your location…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const distance = haversineMeters(
          pos.coords.latitude,
          pos.coords.longitude,
          site.latitude,
          site.longitude
        );
        const within = distance <= site.radius_meters;
        if (result) {
          result.textContent = within
            ? `Inside geofence — ~${Math.round(distance)}m from site (limit ${site.radius_meters}m).`
            : `Outside geofence — ~${Math.round(distance)}m from site (limit ${site.radius_meters}m). Adjust radius if needed.`;
          result.className = within
            ? "punch-geofence-result punch-geofence-result--ok"
            : "punch-geofence-result punch-geofence-result--warn";
        }
      },
      (error) => {
        if (result) result.textContent = error.message || "Could not read your location.";
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function renderSitesTable() {
    const tbody = $("punch-sites-body");
    if (!tbody) return;
    if (!sites.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted">No punch sites yet. Sync from address or add one manually.</td></tr>';
      return;
    }
    tbody.innerHTML = sites
      .map((row) => {
        const selected = selectedSiteId === row.id ? " hr-register-row--selected" : "";
        return `<tr class="hr-register-row${selected}" data-site-id="${row.id}">
          <td><strong>${escapeHtml(row.name)}</strong></td>
          <td>${escapeHtml(row.address)}</td>
          <td>${row.radius_meters}m</td>
          <td>${escapeHtml(roleLabel(row.permitted_roles))}</td>
          <td>${row.is_active ? "Active" : "Inactive"}</td>
          <td class="punch-site-actions">
            <button type="button" class="btn ghost btn-sm" data-site-qr-download="${row.id}">Download QR</button>
            <button type="button" class="btn ghost btn-sm" data-site-qr-print="${row.id}">Print card</button>
          </td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("[data-site-id]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.closest(".punch-site-actions")) return;
        selectedSiteId = Number(row.dataset.siteId);
        renderSitesTable();
        renderSiteDetail(sites.find((s) => s.id === selectedSiteId));
      });
    });
    tbody.querySelectorAll("[data-site-qr-download]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const site = sites.find((item) => item.id === Number(btn.dataset.siteQrDownload));
        if (!site) return;
        void runQrDownload(btn, () =>
          downloadSiteClockQr(site.id, site.name).catch((error) => {
            showPunchNote(friendlyQrDownloadError(error), "error");
          }),
        );
      });
    });
    tbody.querySelectorAll("[data-site-qr-print]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const siteId = Number(btn.dataset.siteQrPrint);
        void fetchSiteClockQr(siteId)
          .then((data) => openPunchCardPage("pocket", data))
          .catch((error) => showPunchNote(error.message || "Could not load QR.", "error"));
      });
    });
  }

  function renderTodayPreview() {
    updateDailyPunchSummary();
    syncPunchHistoryControls();
    if (recordsViewMode === "shifts") {
      renderShiftGroupedPreview();
    } else {
      renderEachPunchRecords();
    }
  }

  function renderShiftGroupedPreview() {
    const tbody = $("punch-today-preview-body");
    if (!tbody) return;
    if (!todayPunches.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted">No punches on ${escapeHtml(formatDayLabel(punchHistoryDate).toLowerCase())}.</td></tr>`;
      return;
    }
    const groups = groupDailyPunches(todayPunches);
    tbody.innerHTML = groups
      .map((group) => {
        const shiftRows = group.shifts
          .map((shift, index) => {
            const rowClass = shift.orphan ? "punch-shift-row punch-shift-row--orphan" : "punch-shift-row";
            const employeeCell =
              index === 0
                ? `<td class="punch-shift-employee" rowspan="${group.shifts.length}">${escapeHtml(group.employee_name)}</td>`
                : "";
            return `<tr class="${rowClass}">
              ${employeeCell}
              ${renderShiftTimeCell(shift.clockIn)}
              ${renderShiftTimeCell(shift.clockOut)}
              ${renderShiftDurationCell(shift)}
              ${renderShiftLocationCell(shift)}
            </tr>`;
          })
          .join("");
        return shiftRows;
      })
      .join("");
  }

  async function loadDailyPunches(dateIso = punchHistoryDate, { quiet = false } = {}) {
    const iso = dateIso || todayIso();
    punchHistoryDate = iso;
    syncPunchHistoryControls();
    try {
      const params = new URLSearchParams({ limit: "200", date_from: iso, date_to: iso });
      if (dailyFilters.employee_id) params.set("employee_id", dailyFilters.employee_id);
      if (dailyFilters.site_id) params.set("site_id", dailyFilters.site_id);
      if (dailyFilters.punch_type) params.set("punch_type", dailyFilters.punch_type);
      if (dailyFilters.review_status) params.set("review_status", dailyFilters.review_status);
      const res = await apiFetch(`/admin/time-punch/punches?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiDetail(data, "Could not load punches for this day."));
      todayPunches = data.items || [];
      markPunchDataLoaded();
    } catch (error) {
      todayPunches = [];
      if (!quiet) showPunchNote(error.message || "Could not load daily punches.", "error");
    }
    renderTodayPreview();
    if (iso === todayIso()) {
      const lastToday = todayPunches[0];
      $("punch-stat-today").textContent = String(todayPunches.length);
      $("punch-stat-today-sub").textContent = lastToday
        ? `Last punch ${formatTimeShort(lastToday.punched_at)}`
        : "No punches yet";
    }
  }

  async function loadTodayPunches() {
    return loadDailyPunches(todayIso(), { quiet: true });
  }

  function scrollToTodayPreview() {
    setActiveTab("records");
    const target = $("punch-records-each-body")?.closest(".punch-records-panel");
    if (!target) return;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function scrollToAccountantSettings() {
    document.body.dataset.punchFocus = "accountant";
    setActiveTab("accountant");
    window.requestAnimationFrame(() => {
      const card = $("punch-accountant-settings");
      card?.scrollIntoView({ behavior: "smooth", block: "start" });
      const emailInput = $("punch-accountant-form")?.querySelector('[name="payroll_accountant_email"]');
      if (emailInput instanceof HTMLInputElement) {
        window.setTimeout(() => emailInput.focus({ preventScroll: true }), 120);
      }
    });
  }

  function applyTimePunchRoute() {
    const path = window.location.hash.replace("#", "");
    if (path === "time-punch/accountant") {
      scrollToAccountantSettings();
      return true;
    }
    if (path === "time-punch/today" || path === "time-punch/records") {
      setActiveTab("records");
      if (applyRotaPunchPrefill()) return true;
      scrollToTodayPreview();
      return true;
    }
    return false;
  }

  function openPunchDayView(employeeId, shiftDate) {
    if (!shiftDate) return;
    setActiveTab("records");
    if (employeeId) {
      dailyFilters.employee_id = String(employeeId);
      const empEl = $("punch-day-filter-employee");
      if (empEl) empEl.value = String(employeeId);
    } else {
      dailyFilters.employee_id = "";
      const empEl = $("punch-day-filter-employee");
      if (empEl) empEl.value = "";
    }
    const picker = $("punch-day-picker");
    if (picker) picker.value = shiftDate;
    void loadDailyPunches(shiftDate);
    scrollToTodayPreview();
  }

  function applyRotaPunchPrefill() {
    try {
      const raw = sessionStorage.getItem("sshr_punch_day_prefill");
      if (!raw) return false;
      sessionStorage.removeItem("sshr_punch_day_prefill");
      const data = JSON.parse(raw);
      openPunchDayView(data.employee_id, data.shift_date);
      return true;
    } catch {
      return false;
    }
  }

  async function acceptPunchRecord(punchId) {
    if (!punchId) return;
    try {
      const res = await apiFetch(`/admin/time-punch/punches/${punchId}/review`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiDetail(data, "Could not accept punch record."));
      showPunchNote("Punch record accepted.", "ok");
      await loadDailyPunches(punchHistoryDate, { quiet: true });
    } catch (error) {
      showPunchNote(error.message || "Could not accept punch record.", "error");
    }
  }

  async function acceptVisiblePunchRecords() {
    const pendingIds = todayPunches.filter((row) => row.hr_review_pending).map((row) => row.id);
    if (!pendingIds.length) {
      showPunchNote("No punch records in this view need review.", "warn");
      return;
    }
    try {
      const res = await apiFetch("/admin/time-punch/punches/review-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ punch_ids: pendingIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiDetail(data, "Could not accept punch records."));
      const count = Number(data.reviewed_count || 0);
      showPunchNote(`${count} punch record${count === 1 ? "" : "s"} accepted.`, "ok");
      await loadDailyPunches(punchHistoryDate, { quiet: true });
    } catch (error) {
      showPunchNote(error.message || "Could not accept punch records.", "error");
    }
  }

  function renderPunchesTable() {
    const tbody = $("recent-punches-body");
    if (!tbody) return;
    if (!punches.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No punches match your filters.</td></tr>';
      return;
    }
    tbody.innerHTML = punches
      .map(
        (row) => `<tr class="hr-register-row">
          <td>${escapeHtml(formatWhen(row.punched_at))}</td>
          <td>${escapeHtml(row.employee_name)}</td>
          <td>${renderTypeBadge(row.punch_type)}</td>
          <td>${escapeHtml(row.site_name)}</td>
          <td>${renderDistanceCell(row)}</td>
        </tr>`
      )
      .join("");
  }

  function renderActivityChart() {
    const host = $("punch-activity-chart");
    if (!host) return;
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const weekStart = new Date(`${mondayIso()}T00:00:00`);
    weekPunches.forEach((p) => {
      const d = new Date(p.punched_at);
      const idx = (d.getDay() + 6) % 7;
      if (d >= weekStart) counts[idx] += 1;
    });
    const max = Math.max(...counts, 1);
    const todayIdx = (new Date().getDay() + 6) % 7;
    const avg = counts.reduce((a, b) => a + b, 0) / 7;

    host.innerHTML = `
      <div class="punch-chart-bars">
        ${days
          .map((label, idx) => {
            const height = Math.round((counts[idx] / max) * 100);
            const classes = [
              "punch-chart-bar",
              idx === todayIdx ? "punch-chart-bar--today" : "",
              counts[idx] > 0 && counts[idx] < avg * 0.6 ? "punch-chart-bar--low" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `<div class="punch-chart-col">
              <div class="${classes}" style="height:${Math.max(height, 6)}%" title="${counts[idx]} punches"><span>${counts[idx]}</span></div>
              <span class="punch-chart-label">${label}</span>
            </div>`;
          })
          .join("")}
      </div>`;
  }

  function buildPunchQuery(extra) {
    const params = new URLSearchParams({ limit: "100", ...extra });
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    if (filters.employee_id) params.set("employee_id", filters.employee_id);
    if (filters.site_id) params.set("site_id", filters.site_id);
    if (filters.punch_type) params.set("punch_type", filters.punch_type);
    return `/admin/time-punch/punches?${params.toString()}`;
  }

  function renderAccountantSettings() {
    const form = $("punch-accountant-form");
    if (!form || !tenantProfile) return;
    const emailInput = form.querySelector('[name="payroll_accountant_email"]');
    const enabledInput = form.querySelector('[name="payroll_hours_report_enabled"]');
    if (emailInput) emailInput.value = tenantProfile.payroll_accountant_email || "";
    if (enabledInput) enabledInput.checked = Boolean(tenantProfile.payroll_hours_report_enabled);
  }

  function setAccountantStatus(text, tone) {
    const el = $("punch-accountant-status");
    if (!el) return;
    el.textContent = text || "";
    el.className =
      tone === "ok" ? "edit-form-status punch-accountant-status--ok" : "edit-form-status muted";
  }

  async function saveAccountantSettings() {
    const form = $("punch-accountant-form");
    if (!form) return;
    const btn = $("punch-accountant-save-btn");
    const statusEl = $("punch-accountant-status");
    const email = form.querySelector('[name="payroll_accountant_email"]')?.value?.trim() || "";
    const enabled = Boolean(form.querySelector('[name="payroll_hours_report_enabled"]')?.checked);
    const run = window.ShiftSwiftAction?.runButtonAction;
    const action = async () => {
      const res = await apiFetch("/admin/tenant-profile", {
        method: "PATCH",
        body: JSON.stringify({
          payroll_accountant_email: email || null,
          payroll_hours_report_enabled: enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Save failed");
      mergeTenantProfile(data);
      renderAccountantSettings();
      return "Settings saved.";
    };
    if (run && btn) {
      await run(btn, statusEl, {
        loadingLabel: "Saving…",
        successMessage: "Settings saved.",
        successLabel: "Saved",
        onAction: action,
      });
      return;
    }
    setAccountantStatus("Saving…");
    try {
      const message = await action();
      setAccountantStatus(message, "ok");
    } catch (error) {
      setAccountantStatus(error.message || "Could not save settings.");
    }
  }

  async function sendAccountantReportNow() {
    const form = $("punch-accountant-form");
    const email = form?.querySelector('[name="payroll_accountant_email"]')?.value?.trim() || "";
    const btn = $("punch-accountant-send-btn");
    const statusEl = $("punch-accountant-status");
    if (!email) {
      const msg = "Add an accountant email first.";
      setAccountantStatus(msg);
      window.ShiftSwiftAction?.showActionToast?.(msg, "warn");
      return;
    }
    const run = window.ShiftSwiftAction?.runButtonAction;
    const action = async () => {
      const res = await apiFetch("/admin/payroll-export/hours/email-now", {
        method: "POST",
        body: JSON.stringify({ accountant_email: email, use_previous_month: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Send failed");
      return `Sent ${data.period_start} to ${data.period_end} (${data.employee_count} staff, ${Number(data.total_hours).toFixed(1)}h) to ${data.recipient_email}.`;
    };
    if (run && btn) {
      await run(btn, statusEl, {
        loadingLabel: "Sending…",
        successMessage: "Report sent.",
        successLabel: "Sent",
        onAction: action,
      });
      return;
    }
    setAccountantStatus("Sending report…");
    try {
      const message = await action();
      setAccountantStatus(message, "ok");
    } catch (error) {
      setAccountantStatus(error.message || "Could not send report.");
    }
  }

  async function loadTenantProfile() {
    try {
      if (window.Admin?.prefetchTenantProfile) {
        mergeTenantProfile(await window.Admin.prefetchTenantProfile());
      } else {
        const res = await apiFetch("/admin/tenant-profile");
        if (!res.ok) throw new Error("Load failed");
        mergeTenantProfile(await res.json());
      }
      if (tenantProfile) {
        syncRotaWeekStartDay(tenantProfile.rota_week_start_day);
        timesheetWeekStart = rotaWeekStartIso();
        renderAccountantSettings();
      }
    } catch {
      mergeTenantProfile(window.Admin?.tenantProfileSnapshot);
    }
  }

  async function loadEmployeeList() {
    try {
      const res = await apiFetch("/admin/employees");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      employees = data.items || [];
    } catch {
      employees = [];
    }
    refreshFilterSelects();
  }

  async function loadSites() {
    try {
      const res = await apiFetch("/admin/time-punch/sites");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      sites = data.items || [];
    } catch {
      sites = [];
    }
    if (!sites.length) {
      selectedSiteId = null;
      $("punch-detail-empty")?.removeAttribute("hidden");
      const detailContent = $("punch-detail-content");
      if (detailContent) {
        detailContent.hidden = true;
        detailContent.textContent = "";
      }
    }
    renderSitesTable();
    refreshFilterSelects();
    if (sites.length && selectedSiteId) {
      const site = sites.find((s) => s.id === selectedSiteId);
      if (site) {
        renderSiteDetail(site);
        renderSitesTable();
      } else {
        selectedSiteId = primarySite()?.id || sites[0]?.id || null;
        if (selectedSiteId) {
          renderSiteDetail(sites.find((s) => s.id === selectedSiteId));
          renderSitesTable();
        }
      }
    } else if (sites.length && !selectedSiteId) {
      selectedSiteId = primarySite()?.id || sites[0].id;
      renderSiteDetail(sites.find((s) => s.id === selectedSiteId));
      renderSitesTable();
    }
    await renderQrGallery();
    updateSetupUi();
  }

  async function loadPunches() {
    try {
      const res = await apiFetch(buildPunchQuery());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiDetail(data, "Could not load punch log."));
      punches = data.items || [];
      markPunchDataLoaded();
    } catch (error) {
      punches = [];
      if (parseHashBaseSection(window.location.hash) === "time-punch" && activeTab === "log") {
        showPunchNote(error.message || "Could not load punch log.", "error");
      }
    }
    renderPunchesTable();
  }

  async function loadWeekPunches() {
    try {
      const res = await apiFetch(
        `/admin/time-punch/punches?limit=500&date_from=${mondayIso()}&date_to=${todayIso()}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiDetail(data, "Could not load weekly punches."));
      weekPunches = data.items || [];
    } catch {
      weekPunches = [];
    }
    renderActivityChart();
  }

  async function syncFromAddress(sourceBtn) {
    const btn = sourceBtn || $("sync-punch-site-btn");
    await loadTenantProfile();
    const syncCoords = resolveRegisteredCoords();
    let address = normalizeRegisteredAddress(resolveRegisteredAddress());
    const addressCheck = validateRegisteredAddress(address);
    if (!addressCheck.ok) {
      const hint = address
        ? `${addressCheck.message} Search below, pick your premises, then sync again.`
        : "Search your premises on the map below, pick a result, then click Sync from address.";
      showPunchNote(hint, address ? "warn" : "error");
      updateSetupUi();
      return;
    }
    if (btn) {
      const run = window.ShiftSwiftAction?.runButtonActionAuto;
      const action = async () => {
        address = await ensureRegisteredAddressSaved(address, syncCoords);
        const syncBody = { registered_address: address };
        const coords = resolveRegisteredCoords();
        if (coords) {
          syncBody.registered_latitude = coords.latitude;
          syncBody.registered_longitude = coords.longitude;
        }
        const res = await apiFetch("/admin/time-punch/sites/sync-from-address", {
          method: "POST",
          body: JSON.stringify(syncBody),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(parseApiDetail(data, "Sync failed."));
        localStorage.setItem("punch-last-sync-at", new Date().toISOString());
        selectedSiteId = data.id;
        await Promise.all([loadSites(), loadDailyPunches(todayIso(), { quiet: true }), loadWeekPunches()]);
        const syncedSite = sites.find((site) => site.id === data.id) || data;
        renderSiteDetail(syncedSite);
        updatePunchStats();
        window.setTimeout(scrollToQrGallery, 450);
        return `Synced primary site: ${data.name}. QR codes are ready below.`;
      };
      if (run) {
        showPunchNote("Syncing from pinned business address…");
        const result = await run(btn, action, {
          loadingLabel: "Syncing…",
          successMessage: "Site synced.",
          successLabel: "Synced",
        });
        if (result.ok) showPunchNote(result.message || "Site synced.", "ok");
        else if (result.error) showPunchNote(result.error, "error");
        updateSetupUi();
        return;
      }
    }
    if (btn) btn.disabled = true;
    showPunchNote("Syncing from pinned business address…");
    try {
      address = await ensureRegisteredAddressSaved(address, syncCoords);
      const syncBody = { registered_address: address };
      const coords = resolveRegisteredCoords();
      if (coords) {
        syncBody.registered_latitude = coords.latitude;
        syncBody.registered_longitude = coords.longitude;
      }
      const res = await apiFetch("/admin/time-punch/sites/sync-from-address", {
        method: "POST",
        body: JSON.stringify(syncBody),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPunchNote(parseApiDetail(data, "Sync failed."), "error");
        updateSetupUi();
        return;
      }
      localStorage.setItem("punch-last-sync-at", new Date().toISOString());
      showPunchNote(`Synced primary site: ${data.name}. QR codes are ready below.`, "ok");
      selectedSiteId = data.id;
      await Promise.all([loadSites(), loadDailyPunches(todayIso(), { quiet: true }), loadWeekPunches()]);
      const syncedSite = sites.find((site) => site.id === data.id) || data;
      renderSiteDetail(syncedSite);
      updatePunchStats();
      window.setTimeout(scrollToQrGallery, 450);
    } catch (error) {
      showPunchNote(error.message || "Sync failed.", "error");
    } finally {
      if (btn) btn.disabled = false;
      updateSetupUi();
    }
  }

  function resolveRadius(form) {
    const preset = form.radius_preset.value;
    if (preset === "custom") return Number(form.radius_custom.value);
    return Number(preset);
  }

  function resolvePermittedRoles(form) {
    const preset = form.permitted_roles.value;
    if (preset === "custom") return form.permitted_roles_custom.value.trim() || "all";
    return preset;
  }

  async function openAllSitesPoster(posterWindow) {
    const activeSites = (sites || []).filter((site) => site.is_active);
    if (!activeSites.length) {
      posterWindow?.close();
      showPunchNote("Sync from address or add a site manually first — then print the QR poster.", "warn");
      return;
    }
    showPunchNote("Preparing A4 poster…");
    try {
      const qrItems = await Promise.all(
        activeSites.map(async (site) => {
          const res = await apiFetch(`/admin/time-punch/sites/${site.id}/clock-qr`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || `Could not load QR for ${site.name}`);
          return {
            site_name: data.site_name || site.name,
            clock_url: data.clock_url,
            qr_image_data_uri: qrImageSrc(data),
          };
        })
      );
      const businessName =
        tenantProfile?.trading_name || tenantProfile?.name || tenantProfile?.business_name || "Your business";
      sessionStorage.setItem(
        "punchPosterPayload",
        JSON.stringify({
          businessName,
          sites: qrItems,
        })
      );
      const posterUrl = new URL("./punch-site-poster.html", window.location.href).toString();
      if (posterWindow) {
        posterWindow.location.replace(posterUrl);
      } else {
        window.open(posterUrl, "_blank", "noopener");
      }
      showPunchNote("Poster opened in a new tab — click Print poster.", "ok");
    } catch (error) {
      posterWindow?.close();
      showPunchNote(error.message || "Could not prepare poster.", "error");
    }
  }

  function shiftTimesheetWeek(delta) {
    const base = new Date(`${timesheetWeekStart}T12:00:00`);
    base.setDate(base.getDate() + delta * 7);
    timesheetWeekStart = toLocalIsoDate(base);
    loadTimesheet();
  }

  function approvalBadge(status) {
    if (status === "approved") return '<span class="contracts-status-pill contracts-status-pill--signed">Approved</span>';
    if (status === "rejected") return '<span class="contracts-status-pill contracts-status-pill--draft">Rejected</span>';
    return '<span class="contracts-status-pill">Pending</span>';
  }

  function renderTimesheetTable() {
    const host = $("punch-timesheet-body");
    const label = $("punch-timesheet-week-label");
    if (label && timesheetData) {
      label.textContent = `${timesheetData.week_start} → ${timesheetData.week_end}`;
    }
    if (!host) return;
    const rows = timesheetData?.employees || [];
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="11" class="muted">No active employees.</td></tr>';
      return;
    }
    host.innerHTML = rows
      .map((row) => {
        const dayCells = (row.days || [])
          .map((day) => {
            const hours = day.total_hours ? `${day.total_hours}h` : "—";
            const warn = day.complete ? "" : " punch-timesheet-cell--warn";
            const title = day.issues?.length ? day.issues.join("; ") : "";
            return `<td class="punch-timesheet-cell${warn}" title="${escapeHtml(title)}">${hours}</td>`;
          })
          .join("");
        const actions =
          row.approval_status === "approved"
            ? `<button type="button" class="btn ghost punch-ts-reject" data-employee-id="${row.employee_id}">Reject</button>`
            : `<button type="button" class="btn outline punch-ts-approve" data-employee-id="${row.employee_id}">Approve</button>`;
        return `<tr>
          <td><strong>${escapeHtml(row.employee_name)}</strong></td>
          ${dayCells}
          <td><strong>${row.week_total_hours.toFixed(1)}h</strong></td>
          <td>${row.week_break_minutes || 0}m</td>
          <td>${approvalBadge(row.approval_status)}</td>
          <td class="punch-timesheet-actions">${actions}</td>
        </tr>`;
      })
      .join("");
    host.querySelectorAll(".punch-ts-approve").forEach((btn) => {
      btn.addEventListener("click", () => approveTimesheetRow(Number(btn.dataset.employeeId), "approved"));
    });
    host.querySelectorAll(".punch-ts-reject").forEach((btn) => {
      btn.addEventListener("click", () => approveTimesheetRow(Number(btn.dataset.employeeId), "rejected"));
    });
    const summary = $("punch-timesheet-summary");
    if (summary && timesheetData?.summary) {
      const s = timesheetData.summary;
      summary.textContent = `${s.approved} approved · ${s.pending} pending · ${s.rejected} rejected`;
    }
  }

  async function loadTimesheet() {
    try {
      const res = await apiFetch(`/admin/time-punch/timesheet?week_start=${timesheetWeekStart}`);
      if (!res.ok) throw new Error("Load failed");
      timesheetData = await res.json();
      renderTimesheetTable();
    } catch {
      timesheetData = null;
      const host = $("punch-timesheet-body");
      if (host) host.innerHTML = '<tr><td colspan="11" class="muted">Could not load timesheet.</td></tr>';
    }
  }

  async function approveTimesheetRow(employeeId, status) {
    try {
      const res = await apiFetch("/admin/time-punch/timesheet/approve", {
        method: "POST",
        body: JSON.stringify({
          week_start: timesheetWeekStart,
          employee_id: employeeId,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Approve failed");
      showPunchNote(status === "approved" ? "Timesheet approved." : "Timesheet rejected.", "ok");
      await loadTimesheet();
    } catch (error) {
      showPunchNote(error.message || "Could not update approval.", "error");
    }
  }

  async function approveAllTimesheets(status) {
    try {
      const res = await apiFetch("/admin/time-punch/timesheet/approve-all", {
        method: "POST",
        body: JSON.stringify({ week_start: timesheetWeekStart, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Bulk approve failed");
      showPunchNote(`${data.updated} timesheet${data.updated === 1 ? "" : "s"} marked ${status}.`, "ok");
      await loadTimesheet();
    } catch (error) {
      showPunchNote(error.message || "Could not approve all.", "error");
    }
  }

  async function submitManualSite(form) {
    const payload = {
      name: form.name.value.trim(),
      address: form.address.value.trim(),
      radius_meters: resolveRadius(form),
      permitted_roles: resolvePermittedRoles(form),
    };
    const addressCheck = validateRegisteredAddress(payload.address);
    if (!addressCheck.ok) {
      showPunchNote(addressCheck.message, "warn");
      return;
    }
    showPunchNote("Adding punch site…");
    try {
      const res = await apiFetch("/admin/time-punch/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPunchNote(data.detail || "Could not add site.", "error");
        return;
      }
      form.reset();
      $("punch-manual-form").hidden = true;
      showPunchNote(`Added punch site: ${data.name}`, "ok");
      selectedSiteId = data.id;
      await loadSites();
      renderSiteDetail(data);
      updatePunchStats();
    } catch (error) {
      showPunchNote(error.message || "Could not add site.", "error");
    }
  }

  async function submitAdminPunch(form) {
    const payload = {
      employee_id: Number(form.employee_id.value),
      punch_site_id: Number(form.punch_site_id.value),
      punch_type: form.punch_type.value,
      admin_note: form.admin_note.value.trim() || null,
    };
    if (form.punched_at.value) {
      payload.punched_at = new Date(form.punched_at.value).toISOString();
    }
    showPunchNote("Recording admin punch…");
    try {
      const res = await apiFetch("/admin/time-punch/punches/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPunchNote(data.detail || "Could not record punch.", "error");
        return;
      }
      form.admin_note.value = "";
      showPunchNote(
        `Recorded ${data.punch_type === "in" ? "clock in" : "clock out"} for ${data.employee_name}`,
        "ok"
      );
      await Promise.all([loadPunches(), loadTodayPunches(), loadWeekPunches()]);
      if (selectedSiteId) renderSiteDetail(sites.find((s) => s.id === selectedSiteId));
      updatePunchStats();
    } catch (error) {
      showPunchNote(error.message || "Could not record punch.", "error");
    }
  }

  async function exportHoursPdf(period = null) {
    try {
      const resolved = period || exportPeriodDates();
      const params = new URLSearchParams({
        date_from: resolved.date_from,
        date_to: resolved.date_to,
      });
      await downloadAuthenticated(
        `/admin/time-punch/hours-report.pdf?${params.toString()}`,
        `working-hours-${resolved.date_from}-to-${resolved.date_to}.pdf`,
      );
      showPunchNote(
        `Hours PDF downloaded for ${resolved.date_from} to ${resolved.date_to}. Send this to your accountant.`,
        "ok",
      );
    } catch (error) {
      showPunchNote(error.message || "Hours PDF export failed.", "error");
    }
  }

  async function applyLastMonthFilters() {
    const period = previousCalendarMonthRange();
    const fromEl = $("punch-filter-from");
    const toEl = $("punch-filter-to");
    if (fromEl) fromEl.value = period.date_from;
    if (toEl) toEl.value = period.date_to;
    filters = {
      ...filters,
      date_from: period.date_from,
      date_to: period.date_to,
    };
    await loadPunches();
    showPunchNote(`Showing punch log for ${period.date_from} to ${period.date_to}.`, "ok");
  }

  async function exportLastMonthHoursPdf() {
    await exportHoursPdf(previousCalendarMonthRange());
  }

  function exportRangeForPreset(preset) {
    if (preset === "today") {
      const iso = todayIso();
      return { date_from: iso, date_to: iso };
    }
    if (preset === "week") {
      return { date_from: mondayIso(), date_to: todayIso() };
    }
    if (preset === "last-month") {
      return previousCalendarMonthRange();
    }
    const fromEl = $("punch-export-from");
    const toEl = $("punch-export-to");
    return {
      date_from: fromEl?.value || firstOfMonthIso(),
      date_to: toEl?.value || todayIso(),
    };
  }

  function highlightExportPreset(preset) {
    exportPreset = preset;
    document.querySelectorAll("[data-punch-export-preset]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.punchExportPreset === preset);
    });
  }

  function readExportFilterValues() {
    return {
      employee_id: $("punch-export-employee")?.value || "",
      site_id: $("punch-export-site")?.value || "",
      punch_type: $("punch-export-type")?.value || "",
      review_status: $("punch-export-review")?.value || "",
    };
  }

  function applyExportFilterValues(values = {}) {
    const employeeEl = $("punch-export-employee");
    const siteEl = $("punch-export-site");
    const typeEl = $("punch-export-type");
    const reviewEl = $("punch-export-review");
    if (employeeEl) employeeEl.value = values.employee_id || "";
    if (siteEl) siteEl.value = values.site_id || "";
    if (typeEl) typeEl.value = values.punch_type || "";
    if (reviewEl) reviewEl.value = values.review_status || "";
  }

  function fillExportDialogFields(preset = exportPreset, filterSource = null) {
    const range = exportRangeForPreset(preset === "custom" ? "custom" : preset);
    const fromEl = $("punch-export-from");
    const toEl = $("punch-export-to");
    if (fromEl) fromEl.value = range.date_from;
    if (toEl) toEl.value = range.date_to;
    highlightExportPreset(preset);
    if (filterSource === "daily") {
      applyExportFilterValues(dailyFilters);
      return;
    }
    if (filterSource === "log") {
      applyExportFilterValues(filters);
      return;
    }
    applyExportFilterValues({});
  }

  function openExportDialog(defaultPreset = "week", filterSource = null) {
    const dialog = $("punch-export-dialog");
    if (!dialog) {
      void exportPunchesCsv(false);
      return;
    }
    fillExportDialogFields(defaultPreset, filterSource);
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  async function submitExportDialog(event) {
    event?.preventDefault();
    const format = $("punch-export-format")?.value || "csv";
    const range = exportRangeForPreset(exportPreset === "custom" ? "custom" : exportPreset);
    if (!range.date_from || !range.date_to) {
      showPunchNote("Choose a from and to date for the export.", "warn");
      return;
    }
    if (range.date_from > range.date_to) {
      showPunchNote("From date must be on or before to date.", "warn");
      return;
    }
    $("punch-export-dialog")?.close();
    if (format === "hours-pdf") {
      await exportHoursPdf(range);
      return;
    }
    const exportFilters = readExportFilterValues();
    try {
      const params = new URLSearchParams({
        date_from: range.date_from,
        date_to: range.date_to,
      });
      if (exportFilters.employee_id) params.set("employee_id", exportFilters.employee_id);
      if (exportFilters.site_id) params.set("site_id", exportFilters.site_id);
      if (exportFilters.punch_type) params.set("punch_type", exportFilters.punch_type);
      if (exportFilters.review_status) params.set("review_status", exportFilters.review_status);
      await downloadAuthenticated(
        `/admin/time-punch/punches/export.csv?${params.toString()}`,
        `time-punches-${range.date_from}-to-${range.date_to}.csv`,
      );
      showPunchNote(`Punch CSV downloaded (${range.date_from} to ${range.date_to}).`, "ok");
    } catch (error) {
      showPunchNote(error.message || "Export failed.", "error");
    }
  }

  async function exportPunchesCsv(useTodayOnly) {
    if (useTodayOnly) {
      openExportDialog("today", "daily");
      return;
    }
    openExportDialog(filters.date_from && filters.date_to ? "custom" : "week", "log");
  }

  function openPosterWindow() {
    const posterWindow = window.open("about:blank", "_blank", "noopener");
    if (!posterWindow) {
      showPunchNote("Allow pop-ups to print the QR poster.", "warn");
      return null;
    }
    void openAllSitesPoster(posterWindow);
    return posterWindow;
  }

  function bindSetupGuideActions() {
    const guide = $("punch-setup-guide");
    if (!guide || guide.dataset.actionsBound === "1") return;
    guide.dataset.actionsBound = "1";
    guide.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || !guide.contains(button)) return;
      if (button.id === "punch-setup-sync-btn") {
        event.preventDefault();
        void syncFromAddress(button);
        return;
      }
      if (button.id === "punch-setup-poster-btn") {
        event.preventDefault();
        openPosterWindow();
        return;
      }
      if (button.id === "punch-setup-view-qr-btn") {
        event.preventDefault();
        void viewQrCodesFromSetup();
      }
    });
  }

  function bindEvents() {
    if (bound) return;
    bound = true;

    bindSetupGuideActions();
    setRecordsViewMode("each");
    $("sync-punch-site-btn")?.addEventListener("click", (e) => syncFromAddress(e.currentTarget));

    document.querySelectorAll(".punch-view-tab").forEach((tab) => {
      tab.addEventListener("click", () => setActiveTab(tab.dataset.punchTab));
    });

    $("punch-header-export-btn")?.addEventListener("click", () => openExportDialog("week"));
    $("punch-export-hours-pdf-btn")?.addEventListener("click", () => openExportDialog("last-month"));
    $("punch-export-last-month-pdf-btn")?.addEventListener("click", () => {
      openExportDialog("last-month");
      const formatEl = $("punch-export-format");
      if (formatEl) formatEl.value = "hours-pdf";
    });
    $("punch-header-admin-btn")?.addEventListener("click", () => {
      setActiveTab("log");
      $("punch-admin-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("punch-admin-employee")?.focus();
    });

    $("punch-add-site-btn")?.addEventListener("click", () => {
      $("punch-manual-form").hidden = false;
      setActiveTab("sites");
    });
    $("punch-print-all-poster-btn")?.addEventListener("click", () => {
      openPosterWindow();
    });
    $("punch-gallery-poster-btn")?.addEventListener("click", () => {
      openPosterWindow();
    });
    $("punch-timesheet-prev")?.addEventListener("click", () => shiftTimesheetWeek(-1));
    $("punch-timesheet-next")?.addEventListener("click", () => shiftTimesheetWeek(1));
    $("punch-timesheet-this-week")?.addEventListener("click", () => {
      timesheetWeekStart = rotaWeekStartIso();
      loadTimesheet();
    });
    $("punch-timesheet-approve-all")?.addEventListener("click", () => approveAllTimesheets("approved"));
    $("punch-hide-manual-btn")?.addEventListener("click", () => {
      $("punch-manual-form").hidden = true;
    });

    $("punch-radius-preset")?.addEventListener("change", (event) => {
      $("punch-radius-custom-wrap").hidden = event.target.value !== "custom";
    });
    $("punch-permitted-roles")?.addEventListener("change", (event) => {
      $("punch-roles-custom-wrap").hidden = event.target.value !== "custom";
    });

    $("punch-manual-form-el")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitManualSite(event.currentTarget);
    });

    $("punch-admin-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAdminPunch(event.currentTarget);
    });

    $("punch-filter-last-month")?.addEventListener("click", () => applyLastMonthFilters());
    $("punch-filter-apply")?.addEventListener("click", async () => {
      filters = {
        date_from: $("punch-filter-from")?.value || "",
        date_to: $("punch-filter-to")?.value || "",
        employee_id: $("punch-filter-employee")?.value || "",
        site_id: $("punch-filter-site")?.value || "",
        punch_type: $("punch-filter-type")?.value || "",
      };
      await loadPunches();
    });

    $("punch-filter-clear")?.addEventListener("click", async () => {
      filters = { date_from: "", date_to: "", employee_id: "", site_id: "", punch_type: "" };
      ["punch-filter-from", "punch-filter-to", "punch-filter-employee", "punch-filter-site", "punch-filter-type"].forEach(
        (id) => {
          const el = $(id);
          if (el) el.value = "";
        }
      );
      await loadPunches();
    });

    $("punch-export-csv-btn")?.addEventListener("click", () => openExportDialog("week", "log"));
    $("punch-preview-export-btn")?.addEventListener("click", () => {
      if (punchHistoryDate === todayIso()) {
        openExportDialog("today", "daily");
        return;
      }
      openExportDialog("custom", "daily");
      const fromEl = $("punch-export-from");
      const toEl = $("punch-export-to");
      if (fromEl) fromEl.value = punchHistoryDate;
      if (toEl) toEl.value = punchHistoryDate;
      highlightExportPreset("custom");
    });
    $("punch-day-filter-apply")?.addEventListener("click", () => {
      dailyFilters = {
        employee_id: $("punch-day-filter-employee")?.value || "",
        site_id: $("punch-day-filter-site")?.value || "",
        punch_type: $("punch-day-filter-type")?.value || "",
        review_status: $("punch-day-filter-review")?.value || "",
      };
      void loadDailyPunches(punchHistoryDate);
    });
    $("punch-day-filter-clear")?.addEventListener("click", () => {
      dailyFilters = { employee_id: "", site_id: "", punch_type: "", review_status: "" };
      ["punch-day-filter-employee", "punch-day-filter-site", "punch-day-filter-type", "punch-day-filter-review"].forEach(
        (id) => {
          const el = $(id);
          if (el) el.value = "";
        }
      );
      void loadDailyPunches(punchHistoryDate);
    });
    $("punch-records-view-each")?.addEventListener("click", () => setRecordsViewMode("each"));
    $("punch-records-view-shifts")?.addEventListener("click", () => setRecordsViewMode("shifts"));
    $("punch-records-review-all")?.addEventListener("click", () => {
      void acceptVisiblePunchRecords();
    });
    $("punch-open-records-btn")?.addEventListener("click", () => setActiveTab("records"));
    $("punch-day-prev")?.addEventListener("click", () => {
      void loadDailyPunches(shiftIsoDate(punchHistoryDate, -1));
    });
    $("punch-day-next")?.addEventListener("click", () => {
      void loadDailyPunches(shiftIsoDate(punchHistoryDate, 1));
    });
    $("punch-day-today")?.addEventListener("click", () => {
      void loadDailyPunches(todayIso());
    });
    $("punch-day-picker")?.addEventListener("change", (event) => {
      const value = event.target.value;
      if (value) void loadDailyPunches(value);
    });
    $("punch-day-refresh")?.addEventListener("click", () => {
      void refreshPunchFeed();
    });

    document.querySelectorAll("[data-punch-export-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.punchExportPreset || "week";
        fillExportDialogFields(preset);
      });
    });
    $("punch-export-cancel")?.addEventListener("click", () => $("punch-export-dialog")?.close());
    $("punch-export-dialog")?.addEventListener("close", () => {
      const formatEl = $("punch-export-format");
      if (formatEl) formatEl.value = "csv";
    });
    $("punch-export-dialog")?.querySelector("form")?.addEventListener("submit", (event) => {
      void submitExportDialog(event);
    });
    $("punch-accountant-save-btn")?.addEventListener("click", () => saveAccountantSettings());
    $("punch-accountant-send-btn")?.addEventListener("click", () => sendAccountantReportNow());
  }

  async function maybeAutoSyncPrimarySite() {
    if (sites.length || !hasBusinessAddress()) return;
    await syncFromAddress($("sync-punch-site-btn"));
  }

  function mountPunchSyncPicker() {
    const host = $("punch-sync-address-host");
    if (!host) return;
    window.AdminAddressPicker?.mountSyncPanel?.(host, {
      address: tenantProfile?.registered_address || window.Admin?.getCachedTenantRegisteredAddress?.(),
      latitude: tenantProfile?.registered_latitude ?? window.Admin?.getCachedTenantRegisteredCoords?.()?.latitude,
      longitude: tenantProfile?.registered_longitude ?? window.Admin?.getCachedTenantRegisteredCoords?.()?.longitude,
    });
  }

  async function initSection() {
    bindEvents();
    resetPunchFilters();
    punchHistoryDate = todayIso();
    syncPunchHistoryControls();
    showPunchNote("");
    startPunchAutoRefresh();
    try {
      if (window.Admin?.loadTenantFeatures) {
        await window.Admin.loadTenantFeatures();
        syncRotaWeekStartDay(window.Admin?.tenantFeatures?.rota_week_start_day);
        timesheetWeekStart = rotaWeekStartIso();
      }
      await loadTenantProfile();
    } catch (error) {
      console.warn("Time punch profile load failed:", error);
    }
    mountPunchSyncPicker();
    await Promise.all([
      loadEmployeeList(),
      loadSites(),
      loadPunches(),
      loadTodayPunches(),
      loadWeekPunches(),
    ]);
    setActiveTab(activeTab);
    updatePunchStats();
    applyTimePunchRoute();
    if (!sites.length && hasBusinessAddress()) {
      await maybeAutoSyncPrimarySite();
    }
  }

  function bootTimePunchSection() {
    if (parseHashBaseSection(window.location.hash) !== "time-punch") return;
    if (sectionReady) return;
    sectionReady = true;
    void initSection();
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "time-punch") {
      if (!sectionReady) {
        sectionReady = true;
        void initSection();
      } else {
        startPunchAutoRefresh();
        void refreshPunchFeed({ quiet: true });
        if (applyTimePunchRoute()) return;
        applyRotaPunchPrefill();
      }
      return;
    }
    stopPunchAutoRefresh();
  });

  window.addEventListener("admin:address-picked", () => {
    updateSetupUi();
  });

  window.addEventListener("admin:tenant-profile-saved", (event) => {
    mergeTenantProfile(event.detail);
    mountPunchSyncPicker();
    updateSetupUi();
    if (parseHashBaseSection(window.location.hash) === "time-punch") {
      void loadTenantProfile().then(() => {
        updateSetupUi();
        if (!sites.length && hasBusinessAddress()) {
          void maybeAutoSyncPrimarySite();
        }
      });
      return;
    }
    void loadTenantProfile().then(updateSetupUi);
  });

  window.addEventListener("admin:open-punch-day", (event) => {
    const { employee_id, shift_date } = event.detail || {};
    if (shift_date) openPunchDayView(employee_id, shift_date);
  });

  window.addEventListener("hashchange", () => {
    if (parseHashBaseSection(window.location.hash) !== "time-punch") return;
    if (applyTimePunchRoute()) return;
    bootTimePunchSection();
  });
  bootTimePunchSection();
})();
