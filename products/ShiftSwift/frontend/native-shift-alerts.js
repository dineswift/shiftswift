/** Native local notifications for shift start/end reminders (Capacitor). */
(function initNativeShiftAlerts() {
  const ENABLED_KEY = "sshrNativeShiftAlerts";

  function isNative() {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  }

  function localNotifications() {
    return window.Capacitor?.Plugins?.LocalNotifications;
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
      window.ShiftSwiftPush?.playAlertSound?.();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error?.message || "permission_error" };
    }
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
    if (!isEnabled()) return { scheduled: 0 };
    const plugin = localNotifications();
    if (!plugin?.schedule) return { scheduled: 0 };

    const status = await getPermissionStatus();
    if (status.permission !== "granted") return { scheduled: 0 };

    await cancelScheduled();

    const startLead = Number(config.minutes_before_start) || 10;
    const endLead = Number(config.minutes_before_end) || 10;
    const now = Date.now();
    const notifications = [];

    for (const shift of shifts || []) {
      const { start, end } = shiftBounds(shift);
      const startAt = new Date(start.getTime() - startLead * 60 * 1000);
      if (startAt.getTime() > now + 5000) {
        notifications.push({
          id: notificationId(shift.id, "start"),
          title: `Shift starts in ${startLead} minutes`,
          body: `Your shift starts at ${formatClock(shift.start_time)}.`,
          schedule: { at: startAt },
          sound: "default",
          extra: { shiftId: shift.id, type: "shift_start" },
        });
      }

      const endAt = new Date(end.getTime() - endLead * 60 * 1000);
      if (endAt.getTime() > now + 5000) {
        notifications.push({
          id: notificationId(shift.id, "end"),
          title: `Shift ends in ${endLead} minutes`,
          body: `Your shift ends at ${formatClock(shift.end_time)}.`,
          schedule: { at: endAt },
          sound: "default",
          extra: { shiftId: shift.id, type: "shift_end" },
        });
      }
    }

    if (notifications.length) {
      await plugin.schedule({ notifications });
    }
    return { scheduled: notifications.length };
  }

  if (isNative() && localNotifications()?.addListener) {
    localNotifications()
      .addListener("localNotificationReceived", () => {
        window.ShiftSwiftPush?.playAlertSound?.();
      })
      .catch(() => null);
    localNotifications()
      .addListener("localNotificationActionPerformed", () => {
        window.ShiftSwiftPush?.playAlertSound?.();
      })
      .catch(() => null);
  }

  window.ShiftSwiftNativeShiftAlerts = {
    isNative,
    isEnabled,
    getPermissionStatus,
    enableAlerts,
    scheduleFromShifts,
    cancelScheduled,
  };
})();
