/** HR admin — Web Push subscribe + bell enablement. */
(function () {
  const PROMPT_KEY = "shiftswiftAdminPushPrompted";

  function apiBase() {
    return window.Admin?.getApiBase?.() || window.ShiftSwiftBrand?.getApiBase?.() || "http://localhost:3000";
  }

  function authHeaders(json = true) {
    const token = localStorage.getItem("token") || "";
    const tenantId = localStorage.getItem("tenantId") || "";
    const headers = {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantId,
    };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
    return output;
  }

  async function fetchConfig() {
    const res = await fetch(`${apiBase()}/admin/push/config`, { headers: authHeaders(false) });
    if (!res.ok) return { enabled: false, public_key: null };
    return res.json();
  }

  async function subscribe(publicKey) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !publicKey) {
      return { ok: false, reason: "unsupported" };
    }
    await window.ShiftSwiftAdminPwa?.registerAdminSw?.();
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const json = subscription.toJSON();
    const res = await fetch(`${apiBase()}/admin/push/subscribe`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, reason: data.detail || "subscribe_failed" };
    }
    return { ok: true };
  }

  async function getStatus() {
    const supported =
      !window.ShiftSwiftBrand?.isCapacitorNative?.() &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    if (!supported) {
      return { supported: false, permission: "unsupported", subscribed: false, serverEnabled: false };
    }
    const permission = Notification.permission;
    const config = await fetchConfig();
    let subscribed = false;
    if (permission === "granted") {
      try {
        const registration = await navigator.serviceWorker.ready;
        subscribed = Boolean(await registration.pushManager.getSubscription());
      } catch {
        subscribed = false;
      }
    }
    return {
      supported: true,
      permission,
      subscribed,
      serverEnabled: Boolean(config.enabled && config.public_key),
    };
  }

  async function enableAlerts({ force = false } = {}) {
    if (!force && localStorage.getItem(PROMPT_KEY) === "1") {
      return { ok: false, reason: "already_prompted" };
    }
    const config = await fetchConfig();
    if (!config.enabled || !config.public_key) {
      return { ok: false, reason: "server_disabled" };
    }
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
      localStorage.setItem(PROMPT_KEY, "1");
    }
    if (permission !== "granted") return { ok: false, reason: "denied" };
    const result = await subscribe(config.public_key);
    if (result.ok) {
      window.ShiftSwiftPush?.playAlertSound?.();
      document.getElementById("topbar-alerts-btn")?.classList.add("topbar-icon-btn--active");
    }
    return result;
  }

  function bindBell() {
    const bell = document.getElementById("topbar-alerts-btn");
    if (!bell || bell.dataset.adminPushBound) return;
    bell.dataset.adminPushBound = "1";
    bell.setAttribute("aria-label", "Notifications");

    void getStatus().then((status) => {
      if (status.subscribed) bell.classList.add("topbar-icon-btn--active");
    });

    bell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      void enableAlerts({ force: true });
    });
  }

  window.ShiftSwiftAdminPush = {
    getStatus,
    enableAlerts,
    bindBell,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindBell, { once: true });
  } else {
    bindBell();
  }
})();
