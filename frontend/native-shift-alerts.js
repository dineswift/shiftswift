/** Native local notifications for shift start/end reminders (Capacitor). */
(function initNativeShiftAlerts() {
  const ENABLED_KEY = "sshrNativeShiftAlerts";
  const PROMPTED_KEY = "sshrNativeShiftAlertsPrompted";
  const CHANNEL_ID = "shiftswift_hr_alerts";
  const SOUND_NAME =
    (typeof window !== "undefined" &&
      window.Capacitor?.getPlatform?.() === "android" &&
      "shiftswift_alert") ||
    "shiftswift_alert.caf";

  function isNative() {
    try {
      return Boolean(
        window.Capacitor?.isNativePlatform?.() ||
          window.__SSHR_BUNDLED_NATIVE_BOOT ||
          window.__SSHR_PORTAL_GUARD ||
          document.documentElement.classList.contains("native-app") ||
          document.documentElement.classList.contains("capacitor-native"),
      );
    } catch {
      return false;
    }
  }

  function localNotifications() {
    const cap = window.Capacitor;
    if (!cap) return null;

    const existing = cap.Plugins?.LocalNotifications;
    if (existing?.requestPermissions) return existing;

    if (typeof cap.registerPlugin === "function") {
      try {
        const registered = cap.registerPlugin("LocalNotifications");
        if (registered?.requestPermissions) return registered;
      } catch {
        /* ignore */
      }
    }

    return cap.Plugins?.LocalNotifications || null;
  }

  function platform() {
    try {
      return window.Capacitor?.getPlatform?.() || "";
    } catch {
      return "";
    }
  }

  async function ensureLocalChannel(plugin) {
    if (platform() !== "android" || !plugin?.createChannel) return;
    try {
      await plugin.createChannel({
        id: CHANNEL_ID,
        name: "ShiftSwift HR alerts",
        description: "Shift reminders, clock-in/out, and document alerts",
        importance: 5,
        visibility: 1,
        sound: "shiftswift_alert",
        vibration: true,
        lights: true,
      });
    } catch {
      /* ignore */
    }
  }

  function showInAppAlertBanner(title, body) {
    try {
      if (window.ShiftSwiftActionFeedback?.toast) {
        window.ShiftSwiftActionFeedback.toast({
          type: "warn",
          message: [title, body].filter(Boolean).join(" — "),
          durationMs: 5200,
        });
        return;
      }
    } catch {
      /* fall through */
    }
    let host = document.getElementById("sshr-native-alert-banner");
    if (!host) {
      host = document.createElement("div");
      host.id = "sshr-native-alert-banner";
      host.setAttribute("role", "status");
      host.style.cssText =
        "position:fixed;left:12px;right:12px;top:max(12px,env(safe-area-inset-top));z-index:1400;" +
        "padding:12px 14px;border-radius:14px;background:#0f6e56;color:#fff;font:600 0.88rem/1.35 -apple-system,sans-serif;" +
        "box-shadow:0 12px 28px rgba(18,53,44,0.28);opacity:0;transform:translateY(-8px);transition:opacity .2s ease,transform .2s ease;";
      document.body.appendChild(host);
    }
    host.innerHTML =
      `<strong style="display:block;margin-bottom:2px">${String(title || "Reminder")}</strong>` +
      `<span style="font-weight:500;opacity:.95">${String(body || "")}</span>`;
    requestAnimationFrame(() => {
      host.style.opacity = "1";
      host.style.transform = "translateY(0)";
    });
    window.clearTimeout(showInAppAlertBanner._t);
    showInAppAlertBanner._t = window.setTimeout(() => {
      host.style.opacity = "0";
      host.style.transform = "translateY(-8px)";
    }, 4800);
  }

  function isEnabled() {
    try {
      return localStorage.getItem(ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setEnabled(enabled) {
    try {
      if (enabled) localStorage.setItem(ENABLED_KEY, "1");
      else localStorage.removeItem(ENABLED_KEY);
    } catch {
      /* ignore */
    }
  }

  function notificationId(shiftId, type) {
    const raw = `${type}:${shiftId}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
      hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    }
    return (hash % 2147483640) + 1;
  }

  function shiftBounds(shift) {
    const start = new Date(`${shift.shift_date}T${String(shift.start_time).slice(0, 5)}:00`);
    let end = new Date(`${shift.shift_date}T${String(shift.end_time).slice(0, 5)}:00`);
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }

  function formatClock(time) {
    return String(time || "").slice(0, 5);
  }

  function baseNotification(partial) {
    return {
      sound: SOUND_NAME,
      channelId: CHANNEL_ID,
      ...partial,
    };
  }

  async function getPermissionStatus() {
    const plugin = localNotifications();
    if (!isNative() || !plugin?.checkPermissions) {
      return { supported: false, permission: "unsupported", enabled: false };
    }
    try {
      const result = await plugin.checkPermissions();
      const permission = result?.display || "prompt";
      return {
        supported: true,
        permission,
        enabled: isEnabled() && permission === "granted",
      };
    } catch {
      return { supported: false, permission: "unsupported", enabled: false };
    }
  }

  async function enableAlerts() {
    const plugin = localNotifications();
    if (!isNative() || !plugin?.requestPermissions) {
      return { ok: false, reason: "unsupported" };
    }
    try {
      const result = await plugin.requestPermissions();
      const permission = result?.display || "denied";
      if (permission !== "granted") {
        return { ok: false, reason: "denied" };
      }
      setEnabled(true);
      await ensureLocalChannel(plugin);
      try {
        localStorage.setItem(PROMPTED_KEY, "1");
      } catch {
        /* ignore */
      }
      window.ShiftSwiftPush?.playAlertSound?.();
      showInAppAlertBanner("Alerts on", "You’ll get sound and banners for shift clock-in and clock-out.");
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error?.message || "permission_error" };
    }
  }

  async function ensureReadyForScheduling() {
    const status = await getPermissionStatus();
    if (status.permission === "granted") {
      if (!isEnabled()) setEnabled(true);
      return true;
    }
    if (status.permission !== "prompt") return false;

    let alreadyPrompted = false;
    try {
      alreadyPrompted = localStorage.getItem(PROMPTED_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (alreadyPrompted) return false;

    const result = await enableAlerts();
    return Boolean(result.ok);
  }

  async function cancelScheduled() {
    const plugin = localNotifications();
    if (!plugin?.getPending) return;
    try {
      const pending = await plugin.getPending();
      const notifications = pending?.notifications || [];
      if (notifications.length) {
        await plugin.cancel({ notifications: notifications.map((n) => ({ id: n.id })) });
      }
    } catch {
      /* ignore */
    }
  }

  async function scheduleFromShifts(shifts, config = {}) {
    const plugin = localNotifications();
    if (!isNative() || !plugin?.schedule) return { scheduled: 0 };

    const ready = isEnabled() || (await ensureReadyForScheduling());
    if (!ready) return { scheduled: 0 };

    const status = await getPermissionStatus();
    if (status.permission !== "granted") return { scheduled: 0 };

    await ensureLocalChannel(plugin);
    await cancelScheduled();

    const startLead = Number(config.minutes_before_start);
    const endLead = Number(config.minutes_before_end);
    const now = Date.now();
    const notifications = [];

    for (const shift of shifts || []) {
      const { start, end } = shiftBounds(shift);
      const startClock = formatClock(shift.start_time);
      const endClock = formatClock(shift.end_time);

      if (start.getTime() > now + 5000) {
        notifications.push(
          baseNotification({
            id: notificationId(shift.id, "start_exact"),
            title: "Clock in now",
            body: `It's ${startClock} — your shift has started. Tap to clock in.`,
            schedule: { at: start, allowWhileIdle: true },
            extra: { shiftId: shift.id, type: "shift_start_exact", hash: "#time-clock" },
          }),
        );
      }

      if (startLead > 0) {
        const startAt = new Date(start.getTime() - startLead * 60 * 1000);
        if (startAt.getTime() > now + 5000) {
          notifications.push(
            baseNotification({
              id: notificationId(shift.id, "start"),
              title: `Shift in ${startLead} minutes`,
              body: `Starts at ${startClock}. Get ready to clock in.`,
              schedule: { at: startAt, allowWhileIdle: true },
              extra: { shiftId: shift.id, type: "shift_start", hash: "#time-clock" },
            }),
          );
        }
      }

      if (end.getTime() > now + 5000) {
        notifications.push(
          baseNotification({
            id: notificationId(shift.id, "end_exact"),
            title: "Clock out now",
            body: `It's ${endClock} — remember to clock out.`,
            schedule: { at: end, allowWhileIdle: true },
            extra: { shiftId: shift.id, type: "shift_end_exact", hash: "#time-clock" },
          }),
        );
      }

      if (endLead > 0) {
        const endAt = new Date(end.getTime() - endLead * 60 * 1000);
        if (endAt.getTime() > now + 5000) {
          notifications.push(
            baseNotification({
              id: notificationId(shift.id, "end"),
              title: `Shift ends in ${endLead} minutes`,
              body: `Ends at ${endClock}. Don’t forget to clock out.`,
              schedule: { at: endAt, allowWhileIdle: true },
              extra: { shiftId: shift.id, type: "shift_end", hash: "#time-clock" },
            }),
          );
        }
      }
    }

    if (notifications.length) {
      await plugin.schedule({ notifications });
    }
    return { scheduled: notifications.length };
  }

  function openClockTab(extra) {
    const hash = extra?.hash || "#time-clock";
    if (window.location.hash !== hash.replace(/^#/, "")) {
      window.location.hash = hash.replace(/^#/, "");
    }
    window.EmployeeMobile?.setTab?.("clock", { skipHash: true });
  }

  if (isNative() && localNotifications()?.addListener) {
    localNotifications()
      .addListener("localNotificationReceived", (event) => {
        window.ShiftSwiftPush?.playAlertSound?.();
        const n = event?.notification || event || {};
        showInAppAlertBanner(n.title || "Reminder", n.body || "");
      })
      .catch(() => null);
    localNotifications()
      .addListener("localNotificationActionPerformed", (event) => {
        window.ShiftSwiftPush?.playAlertSound?.();
        openClockTab(event?.notification?.extra);
      })
      .catch(() => null);
  }

  window.ShiftSwiftNativeShiftAlerts = {
    isNative,
    isEnabled,
    getPermissionStatus,
    enableAlerts,
    ensureReadyForScheduling,
    scheduleFromShifts,
    cancelScheduled,
    getNotificationsPlugin: localNotifications,
    showInAppAlertBanner,
  };
})();
