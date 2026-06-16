/** OpenStreetMap address search for registered business address + geofencing pin. */
(function initAdminAddressPicker() {
  const escapeHtml = (value) => window.Admin?.escapeHtml?.(value) ?? String(value ?? "");
  const apiFetch = (...args) => window.Admin?.apiFetch?.(...args);

  let leafletPromise = null;

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

  function setCoords(latInput, lngInput, lat, lng) {
    if (latInput) latInput.value = lat == null ? "" : String(lat);
    if (lngInput) lngInput.value = lng == null ? "" : String(lng);
  }

  function hasCoords(latInput, lngInput) {
    const lat = Number(latInput?.value);
    const lng = Number(lngInput?.value);
    return Number.isFinite(lat) && Number.isFinite(lng);
  }

  async function fetchAddressResults(query) {
    if (!apiFetch) throw new Error("Admin API not ready.");
    const res = await apiFetch(`/admin/address-search?q=${encodeURIComponent(query)}&limit=6`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Address search failed.");
    return data.items || [];
  }

  function enhanceForm(form, { latitude = null, longitude = null } = {}) {
    if (!form || form.dataset.addressPickerBound === "true") return;
    const existing = form.querySelector('[name="registered_address"]');
    if (!existing) return;

    const fieldWrap = existing.closest(".edit-field");
    if (!fieldWrap) return;

    form.dataset.addressPickerBound = "true";
    const initialAddress = existing.value || "";

    fieldWrap.innerHTML = `
      <span class="edit-label">Registered address</span>
      <div class="address-picker" data-address-picker>
        <label class="visually-hidden" for="address-picker-search">Search business address</label>
        <input
          type="search"
          id="address-picker-search"
          class="address-picker__search"
          placeholder="Search street, postcode, or business name…"
          autocomplete="off"
        />
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
    const lngInput = document.createElement("input");
    lngInput.type = "hidden";
    lngInput.name = "registered_longitude";
    picker.appendChild(latInput);
    picker.appendChild(lngInput);
    setCoords(latInput, lngInput, latitude, longitude);

    const searchInput = picker.querySelector("#address-picker-search");
    const resultsEl = picker.querySelector(".address-picker__results");
    const textarea = picker.querySelector('[name="registered_address"]');
    const statusEl = picker.querySelector("[data-address-picker-status]");
    const mapHost = picker.querySelector("[data-address-picker-map]");

    let map = null;
    let marker = null;
    let searchTimer = null;
    let searchRequestId = 0;

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
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
    }

    function applySelection(item) {
      textarea.value = item.address_line || item.display_name || "";
      setCoords(latInput, lngInput, item.latitude, item.longitude);
      hideResults();
      searchInput.value = "";
      setStatus("Location pinned on map — save to sync Time punch geofencing.", "ok");
      void showMap(item.latitude, item.longitude);
    }

    function renderResults(items) {
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

    textarea.addEventListener("input", () => {
      setCoords(latInput, lngInput, null, null);
      if (mapHost) mapHost.hidden = true;
      setStatus("Address edited manually — search and pick a result to pin the map.", "warn");
    });

    document.addEventListener("click", (event) => {
      if (!picker.contains(event.target)) hideResults();
    });

    if (hasCoords(latInput, lngInput)) {
      void showMap(Number(latInput.value), Number(lngInput.value));
      setStatus("Saved location loaded.", "ok");
    }
  }

  window.AdminAddressPicker = { enhanceForm };
})();
