/** OpenStreetMap address search for registered business address + geofencing pin. */
(function initAdminAddressPicker() {
  const escapeHtml = (value) => window.Admin?.escapeHtml?.(value) ?? String(value ?? "");
  const apiFetch = (...args) => window.Admin?.apiFetch?.(...args);

  let leafletPromise = null;
  let pendingSelection = null;

  function loadStylesheet(href) {
    if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  function loadScript(src) {
    if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    if (!leafletPromise) {
      leafletPromise = Promise.all([
        loadStylesheet("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"),
        loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"),
      ]);
    }
    return leafletPromise;
  }

  function formatSelectionLine(item) {
    let line = item.address_line || item.display_name || "";
    if (item.postcode && !line.toUpperCase().includes(String(item.postcode).toUpperCase())) {
      line = `${line}, ${item.postcode}`;
    }
    return line;
  }

  function rememberSelection(item) {
    const address = formatSelectionLine(item);
    pendingSelection = {
      address,
      address_line: address,
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      postcode: item.postcode || null,
    };
    window.Admin?.rememberTenantRegisteredAddress?.(address);
    window.Admin?.rememberTenantRegisteredCoords?.(pendingSelection.latitude, pendingSelection.longitude);
    window.dispatchEvent(new CustomEvent("admin:address-picked", { detail: pendingSelection }));
    return pendingSelection;
  }

  async function fetchAddressResults(query) {
    if (!apiFetch) throw new Error("Admin API not ready.");
    const res = await apiFetch(`/admin/address-search?q=${encodeURIComponent(query)}&limit=6`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail;
      const message =
        typeof detail === "string"
          ? detail
          : detail && typeof detail.message === "string"
            ? detail.message
            : "Address search failed.";
      throw new Error(message);
    }
    return data.items || [];
  }

  function bindPicker(picker, options = {}) {
    const {
      searchInput,
      resultsEl,
      statusEl,
      mapHost,
      selectedEl = null,
      latInput = null,
      lngInput = null,
      textarea = null,
      initialLatitude = null,
      initialLongitude = null,
      onSelect = null,
      selectStatus = "Location pinned on map.",
    } = options;

    let map = null;
    let marker = null;
    let searchTimer = null;
    let searchRequestId = 0;

    function setCoords(lat, lng) {
      if (latInput) latInput.value = lat == null ? "" : String(lat);
      if (lngInput) lngInput.value = lng == null ? "" : String(lng);
    }

    function setStatus(text, tone = "muted") {
      if (!statusEl) return;
      if (!text) {
        statusEl.hidden = true;
        statusEl.textContent = "";
        statusEl.className = "address-picker__status muted";
        return;
      }
      statusEl.hidden = false;
      statusEl.className = `address-picker__status muted address-picker__status--${tone}`;
      statusEl.textContent = text;
    }

    async function showMap(lat, lng) {
      if (!mapHost) return;
      await ensureLeaflet();
      mapHost.hidden = false;
      if (!map) {
        map = window.L.map(mapHost, { zoomControl: true, attributionControl: true }).setView([lat, lng], 16);
        window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors",
        }).addTo(map);
      } else {
        map.setView([lat, lng], 16);
      }
      if (marker) marker.remove();
      marker = window.L.marker([lat, lng]).addTo(map);
      window.setTimeout(() => map?.invalidateSize(), 140);
    }

    function hideResults() {
      if (!resultsEl) return;
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
    }

    function applySelection(item) {
      const line = rememberSelection(item).address;
      if (textarea) textarea.value = line;
      if (selectedEl) {
        selectedEl.hidden = false;
        selectedEl.textContent = line;
      }
      setCoords(item.latitude, item.longitude);
      hideResults();
      if (searchInput) searchInput.value = "";
      setStatus(onSelect ? onSelect(item, line) : `${selectStatus} Save to apply.`, "ok");
      void showMap(item.latitude, item.longitude);
    }

    function renderResults(items) {
      if (!resultsEl) return;
      if (!items.length) {
        resultsEl.innerHTML = `<li class="address-picker__empty muted">No UK matches — try a postcode or street name.</li>`;
        resultsEl.hidden = false;
        return;
      }
      resultsEl.innerHTML = items
        .map(
          (item, index) => `<li>
            <button type="button" class="address-picker__option" data-result-index="${index}">
              <strong>${escapeHtml(item.address_line || item.display_name)}</strong>
              <span class="muted">${escapeHtml(item.display_name || "")}</span>
            </button>
          </li>`
        )
        .join("");
      resultsEl.hidden = false;
      resultsEl.querySelectorAll("[data-result-index]").forEach((button) => {
        button.addEventListener("click", () => {
          const item = items[Number(button.dataset.resultIndex)];
          if (item) applySelection(item);
        });
      });
    }

    async function runSearch(query) {
      const requestId = ++searchRequestId;
      setStatus("Searching OpenStreetMap…");
      try {
        const items = await fetchAddressResults(query);
        if (requestId !== searchRequestId) return;
        renderResults(items);
        setStatus(items.length ? "Pick the address that matches your premises." : "");
      } catch (error) {
        if (requestId !== searchRequestId) return;
        hideResults();
        setStatus(error.message || "Could not search addresses.", "warn");
      }
    }

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        const query = searchInput.value.trim();
        if (query.length < 3) {
          hideResults();
          setStatus("");
          return;
        }
        searchTimer = window.setTimeout(() => {
          void runSearch(query);
        }, 420);
      });

      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hideResults();
      });
    }

    if (textarea) {
      textarea.addEventListener("input", () => {
        pendingSelection = null;
        setCoords(null, null);
        if (mapHost) mapHost.hidden = true;
        setStatus("Address edited manually — search and pick a result to pin the map.", "warn");
      });
    }

    if (picker) {
      document.addEventListener("click", (event) => {
        if (!picker.contains(event.target)) hideResults();
      });
    }

    const lat = Number(latInput?.value ?? initialLatitude);
    const lng = Number(lngInput?.value ?? initialLongitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      void showMap(lat, lng);
      setStatus("Saved location loaded.", "ok");
    }

    return { applySelection, setStatus, showMap };
  }

  function enhanceForm(form, { latitude = null, longitude = null, address = "" } = {}) {
    if (!form || form.dataset.addressPickerBound === "true") return;
    const existing = form.querySelector('[name="registered_address"]');
    if (!existing) return;

    const fieldWrap = existing.closest(".edit-field");
    if (!fieldWrap) return;

    form.dataset.addressPickerBound = "true";
    const initialAddress = existing.value || address || "";

    fieldWrap.innerHTML = `
      <span class="edit-label">Registered address</span>
      <div class="address-picker" data-address-picker>
        <label class="visually-hidden" for="address-picker-search">Search business address</label>
        <input type="search" id="address-picker-search" class="address-picker__search" placeholder="Search street, postcode, or business name…" autocomplete="off" />
        <ul class="address-picker__results" hidden></ul>
        <textarea name="registered_address" rows="3" placeholder="Selected address appears here">${escapeHtml(initialAddress)}</textarea>
        <p class="address-picker__hint muted">Search OpenStreetMap, pick your premises, then save. This pin powers Time punch geofencing.</p>
        <p class="address-picker__status muted" data-address-picker-status hidden></p>
        <div class="address-picker__map" data-address-picker-map hidden></div>
        <p class="address-picker__attribution muted">© OpenStreetMap contributors</p>
      </div>`;

    const picker = fieldWrap.querySelector("[data-address-picker]");
    const latInput = document.createElement("input");
    latInput.type = "hidden";
    latInput.name = "registered_latitude";
    latInput.value = latitude != null ? String(latitude) : "";
    const lngInput = document.createElement("input");
    lngInput.type = "hidden";
    lngInput.name = "registered_longitude";
    lngInput.value = longitude != null ? String(longitude) : "";
    picker.appendChild(latInput);
    picker.appendChild(lngInput);

    bindPicker(picker, {
      searchInput: picker.querySelector("#address-picker-search"),
      resultsEl: picker.querySelector(".address-picker__results"),
      statusEl: picker.querySelector("[data-address-picker-status]"),
      mapHost: picker.querySelector("[data-address-picker-map]"),
      latInput,
      lngInput,
      textarea: picker.querySelector('[name="registered_address"]'),
      initialLatitude: latitude,
      initialLongitude: longitude,
    });
  }

  function mountSyncPanel(host, { latitude = null, longitude = null, address = "" } = {}) {
    if (!host || host.dataset.addressPickerBound === "true") return;
    host.dataset.addressPickerBound = "true";

    host.innerHTML = `
      <div class="address-picker address-picker--sync" data-address-picker>
        <p class="address-picker__intro muted">Search your premises on OpenStreetMap, pick a result, then click <strong>Sync from address</strong>.</p>
        <label class="visually-hidden" for="punch-address-picker-search">Search business address</label>
        <input type="search" id="punch-address-picker-search" class="address-picker__search" placeholder="Search street, postcode, or business name…" autocomplete="off" />
        <ul class="address-picker__results" hidden></ul>
        <p class="address-picker__selected muted" data-address-selected hidden></p>
        <p class="address-picker__status muted" data-address-picker-status hidden></p>
        <div class="address-picker__map" data-address-picker-map hidden></div>
        <p class="address-picker__attribution muted">© OpenStreetMap contributors</p>
      </div>`;

    const picker = host.querySelector("[data-address-picker]");
    const selectedEl = picker.querySelector("[data-address-selected]");

    if (address) {
      selectedEl.hidden = false;
      selectedEl.textContent = address;
    }

    bindPicker(picker, {
      searchInput: picker.querySelector("#punch-address-picker-search"),
      resultsEl: picker.querySelector(".address-picker__results"),
      statusEl: picker.querySelector("[data-address-picker-status]"),
      mapHost: picker.querySelector("[data-address-picker-map]"),
      selectedEl,
      initialLatitude: latitude,
      initialLongitude: longitude,
      onSelect: () => "Pinned — now click Sync from address.",
    });

    if (latitude != null && longitude != null && address) {
      pendingSelection = {
        address,
        address_line: address,
        latitude: Number(latitude),
        longitude: Number(longitude),
      };
    }
  }

  function getPendingSelection() {
    return pendingSelection;
  }

  window.AdminAddressPicker = {
    enhanceForm,
    mountSyncPanel,
    getPendingSelection,
  };
})();
