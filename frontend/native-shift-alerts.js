/** Native local notifications for clock-in/out — fire on the lock screen when the app is closed. */
(function initNativeShiftAlerts() {
  const ENABLED_KEY = "sshrNativeShiftAlerts";
  const CHANNEL_ID = "clock-reminders";

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
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }

  function formatClock(time) {
    return String(time || "").slice(0, 5);
  }

  async function ensureChannel() {
    const plugin = localNotifications();
    if (!plugin?.createChannel) return;
    try {
      await plugin.createChannel({
        id: CHANNEL_ID,
        name: "Clock in and out",
        description: "Reminders to clock in and clock out, including when the app is closed.",
        importance: 5,
        visibility: 1,
        vibration: true,
        sound: "default",
        lights: true,
      });
    } catch {
      /* Android-only; ignore on iOS */
    }
  }

  async function registerActions() {
    const plugin = localNotifications();
    if (!plugin?.registerActionTypes) return;
    try {
      await plugin.registerActionTypes({
        types: [
          {
            id: "CLOCK_IN",
            actions: [{ id: "open", title: "Clock in now", foreground: true }],
          },
          {
            id: "CLOCK_OUT",
            actions: [{ id: "open", title: "Clock out now", foreground: true }],
          },
        ],
      });
    } catch {
      /* ignore */
    }
  }

  function openClockScreen() {
    try {
      if (!/#time-clock/i.test(location.hash || "")) {
        location.hash = "time-clock";
      }
    } catch {
      /* ignore */
    }
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
      await ensureChannel();
      await registerActions();
      window.ShiftSwiftPush?.playAlertSound?.();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error?.message || "permission_error" };
    }
  }

  async function pendingNotifications() {
    const plugin = localNotifications();
    if (!plugin?.getPending) return [];
    try {
      const pending = await plugin.getPending();
      return pending?.notifications || [];
    } catch {
      return [];
    }
  }

  async function cancelIds(ids) {
    const plugin = localNotifications();
    if (!plugin?.cancel || !ids.length) return;
    try {
      await plugin.cancel({ notifications: ids.map((id) => ({ id })) });
    } catch {
      /* ignore */
    }
  }

  async function cancelScheduled() {
    const pending = await pendingNotifications();
    await cancelIds(pending.map((item) => item.id).filter(Boolean));
  }

  async function cancelTypes(types) {
    const wanted = new Set(types);
    const pending = await pendingNotifications();
    const ids = pending
      .filter((item) => wanted.has(item.extra?.type || item.extra?.alertType))
      .map((item) => item.id)
      .filter(Boolean);
    await cancelIds(ids);
  }

  function buildNotification({ id, title, body, at, type, shiftId, actionTypeId }) {
    return {
      id,
      title,
      body,
      schedule: { at, allowWhileIdle: true },
      sound: "default",
      channelId: CHANNEL_ID,
      actionTypeId,
      extra: { shiftId, type, url: "#time-clock" },
      autoCancel: true,
    };
  }

  async function scheduleFromShifts(shifts, config = {}) {
    if (!isEnabled()) return { scheduled: 0 };
    const plugin = localNotifications();
    if (!plugin?.schedule) return { scheduled: 0 };

    const status = await getPermissionStatus();
    if (status.permission !== "granted") return { scheduled: 0 };

    await ensureChannel();
    await registerActions();
    await cancelScheduled();

    const startLead = Number(config.minutes_before_start) || 10;
    const endLead = Number(config.minutes_before_end) || 10;
    const missedEarly = Number(config.missed_clock_in_early_minutes) || 10;
    const missedLate = Number(config.missed_clock_in_late_minutes) || 30;
    const alreadyIn = Boolean(config.clocked_in);
    const now = Date.now();
    const notifications = [];

    for (const shift of shifts || []) {
      const bounds = shiftBounds(shift);
      if (!bounds) continue;
      const { start, end } = bounds;
      const startClock = formatClock(shift.start_time);
      const endClock = formatClock(shift.end_time);

      if (!alreadyIn) {
        const soonAt = new Date(start.getTime() - startLead * 60 * 1000);
        if (soonAt.getTime() > now + 5000) {
          notifications.push(
            buildNotification({
              id: notificationId(shift.id, "start"),
              title: `Clock in soon — shift in ${startLead} minutes`,
              body: `Your shift starts at ${startClock}. Open the app to clock in.`,
              at: soonAt,
              type: "shift_start_soon",
              shiftId: shift.id,
              actionTypeId: "CLOCK_IN",
            }),
          );
        }

        if (start.getTime() > now + 5000) {
          notifications.push(
            buildNotification({
              id: notificationId(shift.id, "clock_in"),
              title: "Clock in now",
              body: `Your shift has started (${startClock}). Tap to clock in — this alert still appears if the app is closed.`,
              at: start,
              type: "clock_in",
              shiftId: shift.id,
              actionTypeId: "CLOCK_IN",
            }),
          );
        }

        const earlyAt = new Date(start.getTime() + missedEarly * 60 * 1000);
        if (earlyAt.getTime() > now + 5000 && earlyAt.getTime() < end.getTime()) {
          notifications.push(
            buildNotification({
              id: notificationId(shift.id, "missed_early"),
              title: "Reminder: clock in for your shift",
              body: `Your shift started ${missedEarly} minutes ago and you have not clocked in yet.`,
              at: earlyAt,
              type: "missed_clock_in",
              shiftId: shift.id,
              actionTypeId: "CLOCK_IN",
            }),
          );
        }

        const lateAt = new Date(start.getTime() + missedLate * 60 * 1000);
        if (lateAt.getTime() > now + 5000 && lateAt.getTime() < end.getTime()) {
          notifications.push(
            buildNotification({
              id: notificationId(shift.id, "missed_late"),
              title: "You still haven't clocked in",
              body: "Tap to clock in, or contact your manager if you cannot work this shift.",
              at: lateAt,
              type: "missed_clock_in",
              shiftId: shift.id,
              actionTypeId: "CLOCK_IN",
            }),
          );
        }
      }

      const endSoonAt = new Date(end.getTime() - endLead * 60 * 1000);
      if (endSoonAt.getTime() > now + 5000) {
        notifications.push(
          buildNotification({
            id: notificationId(shift.id, "end"),
            title: `Clock out soon — shift ends in ${endLead} minutes`,
            body: `Your shift ends at ${endClock}. Remember to clock out.`,
            at: endSoonAt,
            type: "shift_end_soon",
            shiftId: shift.id,
            actionTypeId: "CLOCK_OUT",
          }),
        );
      }

      if (end.getTime() > now + 5000) {
        notifications.push(
          buildNotification({
            id: notificationId(shift.id, "clock_out"),
            title: "Clock out now",
            body: `Your shift has ended (${endClock}). Tap to clock out — this alert still appears if the app is closed.`,
            at: end,
            type: "clock_out",
            shiftId: shift.id,
            actionTypeId: "CLOCK_OUT",
          }),
        );
      }
    }

    if (notifications.length) {
      await plugin.schedule({ notifications });
    }
    return { scheduled: notifications.length };
  }

  async function onPunch(punchType) {
    if (punchType === "in") {
      await cancelTypes(["clock_in", "missed_clock_in", "shift_start_soon"]);
      return;
    }
    if (punchType === "out") {
      await cancelTypes(["clock_out", "shift_end_soon"]);
    }
  }

  function bindListeners() {
    const plugin = localNotifications();
    if (!isNative() || !plugin?.addListener) return;
    plugin
      .addListener("localNotificationReceived", () => {
        window.ShiftSwiftPush?.playAlertSound?.();
      })
      .catch(() => null);
    plugin
      .addListener("localNotificationActionPerformed", (event) => {
        window.ShiftSwiftPush?.playAlertSound?.();
        openClockScreen();
        const type = event?.notification?.extra?.type;
        if (type === "clock_in" || type === "missed_clock_in") {
          window.dispatchEvent(new CustomEvent("employee:clock-alert-opened", { detail: { type } }));
        }
      })
      .catch(() => null);
  }

  bindListeners();

  window.ShiftSwiftNativeShiftAlerts = {
    isNative,
    isEnabled,
    getPermissionStatus,
    enableAlerts,
    scheduleFromShifts,
    cancelScheduled,
    cancelTypes,
    onPunch,
  };
})();
