/** Shared premises QR print-card link helpers (admin + punch-site-card.html). */
(function (root) {
  const PAYLOAD_KEY = "punchCardPayload";
  const CARD_FILE = "punch-site-card.html";
  const CACHE_BUST = "37";

  function locationParts(locationLike) {
    const loc = locationLike || root.location || {};
    if (loc.origin && loc.pathname) {
      return { origin: loc.origin, pathname: loc.pathname, href: loc.href || loc.origin + loc.pathname };
    }
    const href = loc.href || String(loc || "https://app.shiftswifthr.co.uk/admin.html");
    const parsed = new URL(href, "https://app.shiftswifthr.co.uk/admin.html");
    return { origin: parsed.origin, pathname: parsed.pathname, href: parsed.href };
  }

  function punchCardPageUrl(locationLike) {
    const { origin, pathname } = locationParts(locationLike);
    return new URL(CARD_FILE, origin + pathname);
  }

  function buildPunchCardHref(layout, qrData, locationLike) {
    const clockUrl = String(qrData?.clock_url || "").trim();
    const siteName = String(qrData?.site_name || "Work site").trim() || "Work site";
    const layoutMode = layout === "tent" || layout === "desk" ? layout : "pocket";
    const cardUrl = punchCardPageUrl(locationLike);
    cardUrl.searchParams.set("layout", layoutMode);
    cardUrl.searchParams.set("v", CACHE_BUST);
    if (clockUrl) cardUrl.searchParams.set("url", clockUrl);
    if (siteName) cardUrl.searchParams.set("site", siteName);
    const hashParams = new URLSearchParams();
    if (clockUrl) hashParams.set("url", clockUrl);
    if (siteName) hashParams.set("site", siteName);
    hashParams.set("layout", layoutMode);
    cardUrl.hash = hashParams.toString();
    return { href: cardUrl.toString(), clockUrl, siteName, layout: layoutMode };
  }

  function readStoredPayload(storages) {
    const list = storages || defaultStorages();
    for (const storage of list) {
      try {
        const raw = storage.getItem(PAYLOAD_KEY);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        /* ignore quota / JSON */
      }
    }
    return null;
  }

  function defaultStorages() {
    const list = [];
    try {
      if (root.localStorage) list.push(root.localStorage);
    } catch {
      /* ignore */
    }
    try {
      if (root.sessionStorage) list.push(root.sessionStorage);
    } catch {
      /* ignore */
    }
    return list;
  }

  function hashParams(locationLike) {
    const loc = locationLike || root.location || {};
    const raw = String(loc.hash || "").replace(/^#/, "");
    return new URLSearchParams(raw);
  }

  function readPunchCardParams(locationLike, storages) {
    const loc = locationLike || root.location || {};
    const search = new URLSearchParams(loc.search || "");
    const hash = hashParams(loc);
    const stored = readStoredPayload(storages);
    const layoutRaw = search.get("layout") || hash.get("layout") || stored?.layout || "pocket";
    const layout = layoutRaw === "tent" || layoutRaw === "desk" ? layoutRaw : "pocket";
    return {
      clockUrl: search.get("url") || hash.get("url") || stored?.clock_url || "",
      siteName: search.get("site") || hash.get("site") || stored?.site_name || "Work site",
      layout,
      embeddedQr: stored?.qr_image_data_uri || "",
    };
  }

  function qrSrc(url, embedded) {
    if (embedded) return embedded;
    if (!url) return "";
    return (
      "https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=" + encodeURIComponent(url)
    );
  }

  function applyLayout(document, mode) {
    const body = document.body;
    if (body) {
      body.classList.remove("layout-pocket", "layout-desk", "layout-tent");
      body.classList.add(`layout-${mode}`);
    }
    const cardWrap = document.querySelector(".punch-card-wrap");
    const tentWrap = document.querySelector(".tent-wrap");
    const isTent = mode === "tent";
    if (cardWrap) cardWrap.hidden = isTent;
    if (tentWrap) tentWrap.hidden = !isTent;
    const rootEl = document.documentElement;
    if (!rootEl?.style?.setProperty) return;
    if (mode === "desk") {
      rootEl.style.setProperty("--card-w", "105mm");
      rootEl.style.setProperty("--card-h", "74mm");
    } else if (mode === "pocket") {
      rootEl.style.setProperty("--card-w", "85mm");
      rootEl.style.setProperty("--card-h", "55mm");
    }
  }

  function bootPunchSiteCard(document, locationLike, storages) {
    const params = readPunchCardParams(locationLike, storages);
    const empty = document.getElementById("card-empty");
    const preview = document.getElementById("card-preview");
    if (!params.clockUrl) {
      if (empty) empty.hidden = false;
      if (preview) preview.hidden = true;
      return { ok: false, ...params };
    }
    if (empty) empty.hidden = true;
    if (preview) preview.hidden = false;
    const siteEl = document.getElementById("card-site-name");
    const tentSiteEl = document.getElementById("tent-site-name");
    const qrImg = document.getElementById("card-qr-image");
    const tentQrImg = document.getElementById("tent-qr-image");
    if (siteEl) siteEl.textContent = params.siteName;
    if (tentSiteEl) tentSiteEl.textContent = params.siteName;
    const qr = qrSrc(params.clockUrl, params.embeddedQr);
    if (qrImg) {
      qrImg.src = qr;
      qrImg.alt = "Premises clock-in QR for " + params.siteName;
    }
    if (tentQrImg) {
      tentQrImg.src = qr;
      tentQrImg.alt = qrImg?.alt || "Premises clock-in QR for " + params.siteName;
    }
    applyLayout(document, params.layout);
    return { ok: true, ...params };
  }

  root.ShiftSwiftPunchCards = {
    PAYLOAD_KEY,
    CACHE_BUST,
    punchCardPageUrl,
    buildPunchCardHref,
    readPunchCardParams,
    readStoredPayload,
    bootPunchSiteCard,
    applyLayout,
    qrSrc,
  };
})(typeof window !== "undefined" ? window : globalThis);
