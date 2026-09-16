/** Native remote push (FCM / APNs) — register device token with ShiftSwift HR API. */
(function initNativeRemotePush() {
  const CHANNEL_ID = "shiftswift_hr_alerts";
  const SOUND_IOS = "shiftswift_alert.caf";
  const SOUND_ANDROID = "shiftswift_alert";

  function isNative() {
    try {
      return Boolean(window.Capacitor?.isNativePlatform?.());
    } catch {
      return false;
    }
  }

  function platform() {
    try {
      return window.Capacitor?.getPlatform?.() || "native";
    } catch {
      return "native";
    }
  }

  function pushPlugin() {
    const cap = window.Capacitor;
    if (!cap) return null;
    const existing = cap.Plugins?.PushNotifications;
    if (existing?.register) return existing;
    if (typeof cap.registerPlugin === "function") {
      try {
        return cap.registerPlugin("PushNotifications");
      } catch {
        /* ignore */
      }
    }
    return cap.Plugins?.PushNotifications || null;
  }

  function authHeaders(token, tenantId) {
    return {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantId || "",
      "Content-Type": "application/json",
    };
  }

  async function apiBase() {
    if (window.ShiftSwiftNativeApp?.sanitizeNativeApiBase) {
      return window.ShiftSwiftNativeApp.sanitizeNativeApiBase(
        localStorage.getItem("apiBase") || "https://api.shiftswifthr.co.uk",
      );
    }
    return localStorage.getItem("apiBase") || "https://api.shiftswifthr.co.uk";
  }

  function audience() {
    try {
      const role = String(localStorage.getItem("userRole") || "").toLowerCase();
      if (role === "employee") return "employee";
      if (role === "hr" || role === "admin") return "admin";
      if (document.body?.classList?.contains("admin-portal")) return "admin";
      if (document.body?.classList?.contains("employee-portal")) return "employee";
    } catch {
      /* ignore */
    }
    return "employee";
  }

  function subscribePath() {
    return audience() === "admin"
      ? "/admin/push/native-subscribe"
      : "/employee/push/native-subscribe";
  }

  async function subscribeToken(deviceToken) {
    const session = window.ShiftSwiftSession;
    if (!session?.getAccessToken || !session?.getTenantId) return { ok: false, reason: "no_session" };
    const token = session.getAccessToken();
    const tenantId = session.getTenantId();
    if (!token || !tenantId) return { ok: false, reason: "not_signed_in" };

    const base = await apiBase();
    const response = await fetch(`${base}${subscribePath()}`, {
      method: "POST",
      headers: authHeaders(token, tenantId),
      body: JSON.stringify({
        platform: platform() === "ios" ? "ios" : "android",
        device_token: deviceToken,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { ok: false, reason: data.detail || "subscribe_failed" };
    }
    return { ok: true, audience: audience() };
  }

  async function ensureAndroidChannel(plugin) {
    if (platform() !== "android" || !plugin?.createChannel) return;
    try {
      await plugin.createChannel({
        id: CHANNEL_ID,
        name: "ShiftSwift HR alerts",
        description: "Shift reminders, clock-in alerts, and HR notifications",
        importance: 5,
        visibility: 1,
        sound: SOUND_ANDROID,
        vibration: true,
        lights: true,
      });
    } catch {
      /* ignore */
    }
  }

  let booted = false;

  function androidFirebaseConfigured() {
    // Set at sync time when android/app/google-services.json is present.
    try {
      if (platform() !== "android") return true;
      if (window.__SSHR_ANDROID_FCM__ === true) return true;
      if (window.ShiftSwiftBrand?.androidFcmEnabled === true) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  async function registerForRemotePush() {
    if (!isNative() || booted) return { ok: false, reason: "skipped" };
    const plugin = pushPlugin();
    if (!plugin?.register) return { ok: false, reason: "unsupported" };
    if (!androidFirebaseConfigured()) {
      console.warn("[ShiftSwiftNativePush] skip Android FCM — google-services.json not configured");
      return { ok: false, reason: "firebase_not_configured" };
    }

    booted = true;

    try {
      plugin.addListener("registration", async (event) => {
        const deviceToken = event?.value;
        if (!deviceToken) return;
        try {
          localStorage.setItem("sshrNativePushToken", deviceToken);
        } catch {
          /* ignore */
        }
        try {
          await subscribeToken(deviceToken);
        } catch (error) {
          console.warn("[ShiftSwiftNativePush] subscribe failed", error);
        }
      });

      plugin.addListener("registrationError", (error) => {
        console.warn("[ShiftSwiftNativePush] registration failed", error);
      });

      plugin.addListener("pushNotificationReceived", (notification) => {
        try {
          window.ShiftSwiftPush?.playAlertSound?.();
          const title = notification?.title || notification?.data?.title || "ShiftSwift HR";
          const body = notification?.body || notification?.data?.body || "";
          window.ShiftSwiftNativeShiftAlerts?.showInAppAlertBanner?.(title, body);
        } catch {
          /* ignore */
        }
      });

      plugin.addListener("pushNotificationActionPerformed", (action) => {
        const data = action?.notification?.data || {};
        if (data.url) {
          try {
            window.location.href = data.url;
          } catch {
            /* ignore */
          }
        }
      });

      if (plugin.checkPermissions && plugin.requestPermissions) {
        const current = await plugin.checkPermissions();
        if ((current?.receive || "prompt") !== "granted") {
          const requested = await plugin.requestPermissions();
          if ((requested?.receive || "denied") !== "granted") {
            return { ok: false, reason: "denied" };
          }
        }
      }

      await ensureAndroidChannel(plugin);
      await plugin.register();
      return { ok: true };
    } catch (error) {
      // Missing google-services.json / Firebase init must never crash the app for reviewers.
      console.warn("[ShiftSwiftNativePush] register aborted", error);
      return { ok: false, reason: error?.message || "register_failed" };
    }
  }

  window.ShiftSwiftNativeRemotePush = {
    isNative,
    platform,
    audience,
    registerForRemotePush,
    SOUND_IOS,
    SOUND_ANDROID,
    async syncStoredToken() {
      try {
        const stored = localStorage.getItem("sshrNativePushToken");
        if (stored) return subscribeToken(stored);
      } catch {
        /* ignore */
      }
      return { ok: false, reason: "no_token" };
    },
  };
})();
