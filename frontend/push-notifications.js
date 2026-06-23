/** Web Push subscription helper for employee PWAs (Time Clock + portal). */
(function () {
  const PROMPT_KEY = "shiftswiftPushPrompted";
  let audioContext = null;

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
    return output;
  }

  function authHeaders(token, tenantId, json = true) {
    const headers = {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantId || "",
    };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  async function fetchConfig(apiBase, token, tenantId) {
    const response = await fetch(`${apiBase}/employee/push/config`, {
      headers: authHeaders(token, tenantId, false),
    });
    if (!response.ok) return { enabled: false, public_key: null };
    return response.json();
  }

  async function subscribe(apiBase, token, tenantId, publicKey) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !publicKey) {
      return { ok: false, reason: "unsupported" };
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const json = subscription.toJSON();
    const response = await fetch(`${apiBase}/employee/push/subscribe`, {
      method: "POST",
      headers: authHeaders(token, tenantId),
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: {
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
        },
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { ok: false, reason: data.detail || "subscribe_failed" };
    }
    return { ok: true };
  }

  function playAlertSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContext) audioContext = new AudioCtx();
      const ctx = audioContext;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      const now = ctx.currentTime;
      const tones = [
        { offset: 0, freq: 880 },
        { offset: 0.28, freq: 988 },
        { offset: 0.56, freq: 880 },
      ];
      tones.forEach(({ offset, freq }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.42, now + offset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.24);
      });
    } catch {
      /* ignore — device may block audio until user gesture */
    }
  }

  async function getStatus({ apiBase, token, tenantId }) {
    const supported =
      "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
    if (!supported) {
      return { supported: false, permission: "unsupported", subscribed: false, serverEnabled: false };
    }

    const permission = Notification.permission;
    let serverEnabled = false;
    if (token && tenantId) {
      const config = await fetchConfig(apiBase, token, tenantId);
      serverEnabled = Boolean(config.enabled && config.public_key);
    }

    let subscribed = false;
    if (permission === "granted" && "serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        subscribed = Boolean(await registration.pushManager.getSubscription());
      } catch {
        subscribed = false;
      }
    }

    return { supported, permission, subscribed, serverEnabled };
  }

  window.ShiftSwiftPush = {
    playAlertSound,

    async getStatus(opts) {
      return getStatus(opts);
    },

    /**
     * Ask for notification permission in context (after clock tab / geofence check).
     * Only prompts once per device unless force=true.
     */
    async promptSubscribe({ apiBase, token, tenantId, reason, force = false }) {
      if (!token || !tenantId) return { ok: false, reason: "not_signed_in" };
      if (!force && localStorage.getItem(PROMPT_KEY) === "1") {
        return { ok: false, reason: "already_prompted" };
      }
      if (!("Notification" in window)) return { ok: false, reason: "unsupported" };

      const config = await fetchConfig(apiBase, token, tenantId);
      if (!config.enabled || !config.public_key) {
        return { ok: false, reason: "server_disabled" };
      }

      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
        localStorage.setItem(PROMPT_KEY, "1");
      }
      if (permission !== "granted") {
        return { ok: false, reason: "denied" };
      }

      try {
        const result = await subscribe(apiBase, token, tenantId, config.public_key);
        if (result.ok && reason && typeof console !== "undefined") {
          console.info("[ShiftSwiftPush]", reason);
        }
        return result;
      } catch (error) {
        return { ok: false, reason: error?.message || "subscribe_error" };
      }
    },

    async enableAlerts({ apiBase, token, tenantId }) {
      const result = await window.ShiftSwiftPush.promptSubscribe({
        apiBase,
        token,
        tenantId,
        reason: "Shift reminders and clock-in alerts enabled.",
        force: true,
      });
      if (result.ok) {
        playAlertSound();
      }
      return result;
    },
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "SHIFT_ALERT") {
        playAlertSound();
        if (event.data?.urgent && "vibrate" in navigator) {
          try {
            navigator.vibrate([400, 120, 400, 120, 400]);
          } catch {
            /* ignore */
          }
        }
      }
    });
  }
})();
