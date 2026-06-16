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
  let timesheetWeekStart = rotaWeekStartIso();
  let timesheetData = null;
  let rotaWeekStartDay = 0;
  let filters = { date_from: "", date_to: "", employee_id: "", site_id: "", punch_type: "" };
  let bound = false;
  let punchDataLoadedAt = null;

  function mergeTenantProfile(data) {
    if (!data || typeof data !== "object") return;
    tenantProfile = { ...(tenantProfile || {}), ...data };
    window.Admin?.rememberTenantRegisteredAddress?.(tenantProfile.registered_address);
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

  function rotaWeekStartIso(d = new Date(), weekStartDay = rotaWeekStartDay) {
    const day = new Date(d);
    const jsStart = jsDayFromPythonWeekday(weekStartDay);
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
    return Boolean(resolveRegisteredAddress());
  }

  function resolveRegisteredAddress() {
    const candidates = [
      tenantProfile?.registered_address,
      window.Admin?.tenantProfileSnapshot?.registered_address,
      window.Admin?.getCachedTenantRegisteredAddress?.(),
      primarySite()?.address,
      registeredAddressFromDom(),
    ];
    for (const value of candidates) {
      const trimmed = String(value || "").trim();
      if (trimmed) return trimmed;
    }
    return "";
  }

  async function ensureRegisteredAddressSaved(address) {
    const trimmed = String(address || "").trim();
    if (!trimmed) return "";
    const current = String(tenantProfile?.registered_address || "").trim();
    if (current === trimmed) return trimmed;
    const res = await apiFetch("/admin/tenant-profile", {
      method: "PATCH",
      body: JSON.stringify({ registered_address: trimmed }),
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

  function showMessage(text, tone) {
    const msg = $("punch-admin-message");
    if (!msg) return;
    if (!text) {
      msg.hidden = true;
      msg.textContent = "";
      msg.className = "muted punch-admin-message";
      return;
    }
    msg.hidden = false;
    msg.textContent = text;
    msg.className = tone === "ok" ? "punch-admin-message punch-admin-message--ok" : "muted punch-admin-message";
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
    const selectHint = $("punch-detail-select-hint");
    const noSites = !sites.length;
    const hasAddress = hasBusinessAddress();

    if (warning) warning.hidden = hasAddress;
    const syncMeta = $("punch-sync-meta");
    if (syncMeta) syncMeta.textContent = lastSyncLabel();

    ["sync-punch-site-btn", "punch-setup-sync-btn"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      btn.disabled = !hasAddress;
      btn.title = hasAddress
        ? "Create or refresh your primary punch site from the registered business address"
        : "Add your registered business address in Settings → Business profile first";
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

    const posterBtn = $("punch-print-all-poster-btn");
    if (posterBtn) {
      posterBtn.disabled = noSites;
      posterBtn.title = noSites
        ? "Sync or add a punch site first — then print the premises QR poster."
        : "Print an A4 poster with QR codes for all active sites";
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
    document.querySelectorAll(".punch-view-tab").forEach((btn) => {
      const isActive = btn.dataset.punchTab === tab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    document.querySelectorAll(".punch-tab-panel").forEach((panel) => {
      panel.hidden = panel.dataset.punchPanel !== tab;
    });
    if (tab === "sites") {
      void Promise.all([loadSites(), loadTodayPunches()]).then(updatePunchStats);
    }
    if (tab === "log") void loadPunches();
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
    populateSelect($("punch-filter-employee"), employeeOptions, "All employees");
    populateSelect($("punch-admin-employee"), employeeOptions, "Select employee…");
    populateSelect(
      $("punch-filter-site"),
      sites.map((s) => ({ value: s.id, label: s.name })),
      "All sites"
    );
    populateSelect(
      $("punch-admin-site"),
      sites.filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name })),
      "Select site…"
    );
  }

  function geofenceVizSvg(radiusMeters) {
    return `
      <div class="punch-geofence-viz" aria-hidden="true">
        <svg viewBox="0 0 220 220" class="punch-geofence-viz__svg">
          <rect width="220" height="220" rx="12" fill="#f0faf6"/>
          <circle cx="110" cy="110" r="78" fill="none" stroke="#74c69d" stroke-width="2" stroke-dasharray="6 5"/>
          <circle cx="110" cy="110" r="8" fill="#1b4332"/>
          <text x="110" y="198" text-anchor="middle" font-size="12" fill="#52796f">${escapeHtml(String(radiusMeters))}m radius</text>
        </svg>
      </div>`;
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
      <div class="hr-detail-head"><div><h3>${escapeHtml(site.name)}</h3><span class="contracts-status-pill contracts-status-pill--${site.is_active ? "signed" : "draft"}">${site.is_active ? "Active" : "Inactive"}</span></div></div>
      <dl class="hr-detail-grid">
        <div><dt>Address</dt><dd>${escapeHtml(site.address)}</dd></div>
        <div><dt>Geofence radius</dt><dd>${escapeHtml(site.radius_meters)} metres</dd></div>
        <div><dt>Permitted roles</dt><dd>${escapeHtml(roleLabel(site.permitted_roles))}</dd></div>
        <div><dt>Last synced</dt><dd>${escapeHtml(formatSyncShort(site.updated_at || lastSyncIso()))}</dd></div>
        <div><dt>Today's punches</dt><dd>${stats.total} punch${stats.total === 1 ? "" : "es"}${stats.outside ? ` · <span class="punch-outside-count">${stats.outside} outside geofence</span>` : ""}</dd></div>
      </dl>
      <article class="card punch-clock-qr-card" id="punch-clock-qr-card">
        <h4 class="hr-section-title">Premises QR clock-in</h4>
        <p class="muted punch-tab-intro">Print this QR indoors where GPS is weak. Staff scan it in the Time Clock app, then clock in or out without GPS for 10 minutes.</p>
        <div id="punch-clock-qr-body" class="punch-clock-qr-body muted">Loading QR…</div>
      </article>
      ${geofenceVizSvg(site.radius_meters)}
      ${alertsHtml}
      <div id="punch-edit-form-wrap" hidden></div>
      <div class="hr-detail-foot">
        <button type="button" class="btn outline" id="punch-test-geofence-btn"><span aria-hidden="true">◎</span> Test geofence</button>
        <button type="button" class="btn ghost" id="punch-edit-site-btn"><span aria-hidden="true">✎</span> Edit site</button>
      </div>
      <p id="punch-geofence-test-result" class="muted punch-geofence-result" aria-live="polite"></p>`;

    content.querySelector("#punch-test-geofence-btn")?.addEventListener("click", () => testGeofence(site));
    content.querySelector("#punch-edit-site-btn")?.addEventListener("click", () => showEditSiteForm(site));
    loadSiteClockQr(site.id);
    updateSetupUi();
  }

  function qrImageSrc(data) {
    return data.qr_image_data_uri || data.qr_image_url || "";
  }

  function storePunchCardPayload(payload) {
    sessionStorage.setItem("punchCardPayload", JSON.stringify(payload));
  }

  function openPunchCardPage(layout = "pocket") {
    const cardUrl = new URL("./punch-site-card.html", window.location.href);
    cardUrl.searchParams.set("layout", layout);
    const win = window.open(cardUrl.toString(), "_blank", "noopener");
    if (!win) {
      showMessage("Allow pop-ups to open the QR print page.");
    }
    return win;
  }

  async function downloadSiteClockQr(siteId, siteName) {
    const safeName = String(siteName || "work-site")
      .trim()
      .replace(/[^\w\s-]+/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();
    await downloadAuthenticated(
      `/admin/time-punch/sites/${siteId}/clock-qr.png`,
      `premises-clock-qr-${safeName || "site"}.png`,
    );
    showMessage("Premises QR downloaded.", "ok");
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

  async function loadSiteClockQr(siteId) {
    const host = $("punch-clock-qr-body");
    if (!host) return;
    host.textContent = "Loading QR…";
    try {
      const res = await apiFetch(`/admin/time-punch/sites/${siteId}/clock-qr`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Could not load QR");
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
          showMessage("Premises clock link copied.", "ok");
        } catch {
          showMessage("Could not copy link.");
        }
      });
      host.querySelector("#punch-download-clock-qr")?.addEventListener("click", () => {
        void downloadSiteClockQr(siteId, data.site_name).catch((error) => {
          showMessage(error.message || "Could not download QR.");
        });
      });
      host.querySelector("#punch-print-clock-card")?.addEventListener("click", () => {
        storePunchCardPayload({
          clock_url: data.clock_url,
          site_name: data.site_name || "Work site",
          qr_image_data_uri: qrSrc,
          layout: "pocket",
        });
        openPunchCardPage("pocket");
      });
      host.querySelector("#punch-print-tent-card")?.addEventListener("click", () => {
        storePunchCardPayload({
          clock_url: data.clock_url,
          site_name: data.site_name || "Work site",
          qr_image_data_uri: qrSrc,
          layout: "tent",
        });
        openPunchCardPage("tent");
      });
      host.querySelector("#punch-open-kiosk-btn")?.addEventListener("click", () => {
        const url =
          data.kiosk_url ||
          `./punch-kiosk.html?clock=${encodeURIComponent(data.clock_token || "")}`;
        window.open(new URL(url, window.location.href).toString(), "_blank", "noopener");
      });
      host.querySelector("#punch-rotate-clock-token")?.addEventListener("click", async () => {
        if (!window.confirm("Rotate this QR code? Old printed codes will stop working.")) return;
        showMessage("Rotating premises QR…");
        try {
          const rotateRes = await apiFetch(`/admin/time-punch/sites/${siteId}/rotate-clock-token`, {
            method: "POST",
          });
          const rotateData = await rotateRes.json().catch(() => ({}));
          if (!rotateRes.ok) throw new Error(rotateData.detail || "Rotate failed");
          showMessage("Premises QR rotated. Reprint the code at this site.", "ok");
          await loadSiteClockQr(siteId);
        } catch (error) {
          showMessage(error.message || "Could not rotate QR.");
        }
      });
    } catch (error) {
      host.textContent = error.message || "Could not load premises QR.";
    }
  }

  function showEditSiteForm(site) {
    const wrap = $("punch-edit-form-wrap");
    if (!wrap) return;
    wrap.hidden = false;
    wrap.innerHTML = `
      <form id="punch-edit-form" class="punch-inline-form punch-edit-form">
        <label class="edit-field"><span class="edit-label">Site name</span><input type="text" name="name" value="${escapeHtml(site.name)}" required /></label>
        <label class="edit-field"><span class="edit-label">Radius (metres)</span><input type="number" name="radius_meters" min="25" max="2000" value="${site.radius_meters}" required /></label>
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
      await saveSiteEdit(site.id, event.currentTarget);
    });
  }

  async function saveSiteEdit(siteId, form) {
    const payload = {
      name: form.name.value.trim(),
      radius_meters: Number(form.radius_meters.value),
      permitted_roles: form.permitted_roles.value,
    };
    try {
      const res = await apiFetch(`/admin/time-punch/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(data.detail || "Could not save site.");
        return;
      }
      showMessage("Site updated.", "ok");
      await loadSites();
      selectedSiteId = siteId;
      renderSiteDetail(sites.find((s) => s.id === siteId));
      updatePunchStats();
    } catch (error) {
      showMessage(error.message || "Could not save site.");
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
        '<tr><td colspan="5" class="muted">No punch sites yet. Sync from address or add one manually.</td></tr>';
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
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("[data-site-id]").forEach((row) => {
      row.addEventListener("click", () => {
        selectedSiteId = Number(row.dataset.siteId);
        renderSitesTable();
        renderSiteDetail(sites.find((s) => s.id === selectedSiteId));
      });
    });
  }

  function renderTodayPreview() {
    const tbody = $("punch-today-preview-body");
    if (!tbody) return;
    if (!todayPunches.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No punches today.</td></tr>';
      return;
    }
    tbody.innerHTML = todayPunches
      .slice(0, 8)
      .map(
        (row) => `<tr>
          <td>${escapeHtml(formatTimeShort(row.punched_at))}</td>
          <td>${escapeHtml(row.employee_name)}</td>
          <td>${renderTypeBadge(row.punch_type)}</td>
          <td>${renderLocationCell(row)}</td>
        </tr>`
      )
      .join("");
  }

  function scrollToTodayPreview() {
    const target = $("punch-today-preview-body")?.closest(".punch-today-preview");
    if (!target) return;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function applyTimePunchRoute() {
    const path = window.location.hash.replace("#", "");
    if (path === "time-punch/today") {
      setActiveTab("sites");
      scrollToTodayPreview();
      return true;
    }
    return false;
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
    const email = form.querySelector('[name="payroll_accountant_email"]')?.value?.trim() || "";
    const enabled = Boolean(form.querySelector('[name="payroll_hours_report_enabled"]')?.checked);
    setAccountantStatus("Saving…");
    try {
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
      setAccountantStatus("Settings saved.", "ok");
    } catch (error) {
      setAccountantStatus(error.message || "Could not save settings.");
    }
  }

  async function sendAccountantReportNow() {
    const form = $("punch-accountant-form");
    const email = form?.querySelector('[name="payroll_accountant_email"]')?.value?.trim() || "";
    if (!email) {
      setAccountantStatus("Add an accountant email first.");
      return;
    }
    setAccountantStatus("Sending report…");
    try {
      const res = await apiFetch("/admin/payroll-export/hours/email-now", {
        method: "POST",
        body: JSON.stringify({ accountant_email: email, use_previous_month: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Send failed");
      setAccountantStatus(
        `Sent ${data.period_start} to ${data.period_end} (${data.employee_count} staff, ${Number(data.total_hours).toFixed(1)}h) to ${data.recipient_email}.`,
        "ok"
      );
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
    renderSitesTable();
    refreshFilterSelects();
    if (sites.length && !selectedSiteId) {
      selectedSiteId = primarySite()?.id || sites[0].id;
      renderSiteDetail(sites.find((s) => s.id === selectedSiteId));
      renderSitesTable();
    }
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
        showMessage(error.message || "Could not load punch log.");
      }
    }
    renderPunchesTable();
  }

  async function loadTodayPunches() {
    const iso = todayIso();
    try {
      const res = await apiFetch(`/admin/time-punch/punches?limit=100&date_from=${iso}&date_to=${iso}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiDetail(data, "Could not load today's punches."));
      todayPunches = data.items || [];
      markPunchDataLoaded();
    } catch {
      todayPunches = [];
    }
    renderTodayPreview();
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
    let address = resolveRegisteredAddress();
    if (!address) {
      showMessage(
        "Add your registered business address in Settings → Business profile first (include a full UK postcode).",
      );
      updateSetupUi();
      return;
    }
    if (btn) btn.disabled = true;
    showMessage("Syncing from registered business address…");
    try {
      address = await ensureRegisteredAddressSaved(address);
      const res = await apiFetch("/admin/time-punch/sites/sync-from-address", {
        method: "POST",
        body: JSON.stringify({ registered_address: address }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(parseApiDetail(data, "Sync failed."));
        updateSetupUi();
        return;
      }
      localStorage.setItem("punch-last-sync-at", new Date().toISOString());
      showMessage(`Synced primary site: ${data.name}`, "ok");
      selectedSiteId = data.id;
      await Promise.all([loadSites(), loadTodayPunches(), loadWeekPunches()]);
      updatePunchStats();
    } catch (error) {
      showMessage(error.message || "Sync failed.");
    } finally {
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
      showMessage("Sync from address or add a site manually first — then print the QR poster.");
      return;
    }
    showMessage("Preparing A4 poster…");
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
      showMessage("Poster opened in a new tab — click Print poster.", "ok");
    } catch (error) {
      posterWindow?.close();
      showMessage(error.message || "Could not prepare poster.");
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
      showMessage(status === "approved" ? "Timesheet approved." : "Timesheet rejected.", "ok");
      await loadTimesheet();
    } catch (error) {
      showMessage(error.message || "Could not update approval.");
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
      showMessage(`${data.updated} timesheet${data.updated === 1 ? "" : "s"} marked ${status}.`, "ok");
      await loadTimesheet();
    } catch (error) {
      showMessage(error.message || "Could not approve all.");
    }
  }

  async function submitManualSite(form) {
    const payload = {
      name: form.name.value.trim(),
      address: form.address.value.trim(),
      radius_meters: resolveRadius(form),
      permitted_roles: resolvePermittedRoles(form),
    };
    showMessage("Adding punch site…");
    try {
      const res = await apiFetch("/admin/time-punch/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(data.detail || "Could not add site.");
        return;
      }
      form.reset();
      $("punch-manual-form").hidden = true;
      showMessage(`Added punch site: ${data.name}`, "ok");
      selectedSiteId = data.id;
      await loadSites();
      renderSiteDetail(data);
      updatePunchStats();
    } catch (error) {
      showMessage(error.message || "Could not add site.");
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
    showMessage("Recording admin punch…");
    try {
      const res = await apiFetch("/admin/time-punch/punches/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(data.detail || "Could not record punch.");
        return;
      }
      form.admin_note.value = "";
      showMessage(
        `Recorded ${data.punch_type === "in" ? "clock in" : "clock out"} for ${data.employee_name}`,
        "ok"
      );
      await Promise.all([loadPunches(), loadTodayPunches(), loadWeekPunches()]);
      if (selectedSiteId) renderSiteDetail(sites.find((s) => s.id === selectedSiteId));
      updatePunchStats();
    } catch (error) {
      showMessage(error.message || "Could not record punch.");
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
      showMessage(
        `Hours PDF downloaded for ${resolved.date_from} to ${resolved.date_to}. Send this to your accountant.`,
        "ok",
      );
    } catch (error) {
      showMessage(error.message || "Hours PDF export failed.");
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
    showMessage(`Showing punch log for ${period.date_from} to ${period.date_to}.`, "ok");
  }

  async function exportLastMonthHoursPdf() {
    await exportHoursPdf(previousCalendarMonthRange());
  }

  async function exportPunchesCsv(useTodayOnly) {
    try {
      const params = new URLSearchParams();
      if (useTodayOnly) {
        params.set("date_from", todayIso());
        params.set("date_to", todayIso());
      } else {
        if (filters.date_from) params.set("date_from", filters.date_from);
        if (filters.date_to) params.set("date_to", filters.date_to);
        if (filters.employee_id) params.set("employee_id", filters.employee_id);
        if (filters.site_id) params.set("site_id", filters.site_id);
        if (filters.punch_type) params.set("punch_type", filters.punch_type);
      }
      const qs = params.toString();
      await downloadAuthenticated(
        `/admin/time-punch/punches/export.csv${qs ? `?${qs}` : ""}`,
        `time-punches-${new Date().toISOString().slice(0, 10)}.csv`
      );
      showMessage("Punch export downloaded.", "ok");
    } catch (error) {
      showMessage(error.message || "Export failed.");
    }
  }

  function bindEvents() {
    if (bound) return;
    bound = true;

    $("sync-punch-site-btn")?.addEventListener("click", (e) => syncFromAddress(e.currentTarget));
    $("punch-setup-sync-btn")?.addEventListener("click", (e) => syncFromAddress(e.currentTarget));

    document.querySelectorAll(".punch-view-tab").forEach((tab) => {
      tab.addEventListener("click", () => setActiveTab(tab.dataset.punchTab));
    });

    $("punch-header-export-btn")?.addEventListener("click", () => exportPunchesCsv(false));
    $("punch-export-hours-pdf-btn")?.addEventListener("click", () => exportHoursPdf());
    $("punch-export-last-month-pdf-btn")?.addEventListener("click", () => exportLastMonthHoursPdf());
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
      const posterWindow = window.open("about:blank", "_blank", "noopener");
      if (!posterWindow) {
        showMessage("Allow pop-ups to print the QR poster.");
        return;
      }
      void openAllSitesPoster(posterWindow);
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

    $("punch-export-csv-btn")?.addEventListener("click", () => exportPunchesCsv(false));
    $("punch-preview-export-btn")?.addEventListener("click", () => exportPunchesCsv(true));
    $("punch-accountant-save-btn")?.addEventListener("click", () => saveAccountantSettings());
    $("punch-accountant-send-btn")?.addEventListener("click", () => sendAccountantReportNow());
  }

  async function maybeAutoSyncPrimarySite() {
    if (sites.length || !hasBusinessAddress()) return;
    await syncFromAddress($("sync-punch-site-btn"));
  }

  async function initSection() {
    bindEvents();
    resetPunchFilters();
    showMessage("");
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
    void initSection();
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "time-punch") void initSection();
  });

  window.addEventListener("admin:tenant-profile-saved", (event) => {
    mergeTenantProfile(event.detail);
    updateSetupUi();
    if (parseHashBaseSection(window.location.hash) === "time-punch") {
      void initSection();
      return;
    }
    void loadTenantProfile().then(updateSetupUi);
  });

  window.addEventListener("hashchange", () => {
    if (parseHashBaseSection(window.location.hash) !== "time-punch") return;
    if (applyTimePunchRoute()) return;
    bootTimePunchSection();
  });
  bootTimePunchSection();
})();
