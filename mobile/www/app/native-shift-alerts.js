/** Native local notifications for shift start/end reminders (Capacitor). */
(function initNativeShiftAlerts() {
  const ENABLED_KEY = "sshrNativeShiftAlerts";
  const PROMPTED_KEY = "sshrNativeShiftAlertsPrompted";

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
      try {
        localStorage.setItem(PROMPTED_KEY, "1");
      } catch {
        /* ignore */
      }
      window.ShiftSwiftPush?.playAlertSound?.();
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
        notifications.push({
          id: notificationId(shift.id, "start_exact"),
          title: "Reminder",
          body: `It's ${startClock} and you can clock in now`,
          schedule: { at: start },
          sound: "default",
          extra: { shiftId: shift.id, type: "shift_start_exact", hash: "#time-clock" },
        });
      }

      if (startLead > 0) {
        const startAt = new Date(start.getTime() - startLead * 60 * 1000);
        if (startAt.getTime() > now + 5000) {
          notifications.push({
            id: notificationId(shift.id, "start"),
            title: "Reminder",
            body: `Your shift starts in ${startLead} minutes (${startClock}).`,
            schedule: { at: startAt },
            sound: "default",
            extra: { shiftId: shift.id, type: "shift_start", hash: "#time-clock" },
          });
        }
      }

      if (end.getTime() > now + 5000) {
        notifications.push({
          id: notificationId(shift.id, "end_exact"),
          title: "Reminder",
          body: `It's ${endClock} — remember to clock out`,
          schedule: { at: end },
          sound: "default",
          extra: { shiftId: shift.id, type: "shift_end_exact", hash: "#time-clock" },
        });
      }

      if (endLead > 0) {
        const endAt = new Date(end.getTime() - endLead * 60 * 1000);
        if (endAt.getTime() > now + 5000) {
          notifications.push({
            id: notificationId(shift.id, "end"),
            title: "Reminder",
            body: `Your shift ends in ${endLead} minutes (${endClock}).`,
            schedule: { at: endAt },
            sound: "default",
            extra: { shiftId: shift.id, type: "shift_end", hash: "#time-clock" },
          });
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
      .addListener("localNotificationReceived", () => {
        window.ShiftSwiftPush?.playAlertSound?.();
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
  };
})();
