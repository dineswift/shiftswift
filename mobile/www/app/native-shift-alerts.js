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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function classifyAlertKind(source = {}) {
    const type = String(
      source.kind || source.alertType || source.alert_type || source.type || "",
    ).toLowerCase();
    const text = `${source.title || ""} ${source.body || ""}`.toLowerCase();
    if (/success|confirmed|clock-in-done|clock-out-done/.test(type)) return "success";
    if (
      /clock.?in|shift.?start|missed_clock_in|shift_reminder/.test(type) ||
      /clock in now|you can clock in|shift has started|shift starts in/.test(text)
    ) {
      return "clock-in";
    }
    if (
      /clock.?out|shift.?end|missed_clock_out/.test(type) ||
      /clock out|remember to clock out|shift ends in/.test(text)
    ) {
      return "clock-out";
    }
    return "employee-update";
  }

  function kindCopy(kind) {
    if (kind === "clock-in") {
      return { kicker: "Clock in", actionLabel: "Clock in now", hash: "#time-clock", durationMs: 18000 };
    }
    if (kind === "clock-out") {
      return { kicker: "Clock out", actionLabel: "Clock out now", hash: "#time-clock", durationMs: 18000 };
    }
    if (kind === "success") {
      return { kicker: "Confirmed", actionLabel: "", hash: "", durationMs: 8000 };
    }
    return { kicker: "Employee update", actionLabel: "View update", hash: "", durationMs: 14000 };
  }

  function playUrgentCue(kind, silent) {
    if (silent) return;
    const urgent = kind === "clock-in" || kind === "clock-out" || kind === "employee-update";
    try {
      if (urgent && window.ShiftSwiftPush?.playUrgentAlertSound) {
        window.ShiftSwiftPush.playUrgentAlertSound();
      } else {
        window.ShiftSwiftPush?.playAlertSound?.();
      }
    } catch {
      /* ignore */
    }
    try {
      if (urgent) window.ShiftSwiftNativeHaptics?.warning?.();
      else window.ShiftSwiftNativeHaptics?.success?.();
    } catch {
      /* ignore */
    }
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate(urgent ? [420, 90, 420, 90, 420] : [220, 60, 220]);
      } catch {
        /* ignore */
      }
    }
  }

  function openNotificationsPanel() {
    const btn =
      document.getElementById("employee-topbar-alerts-btn") ||
      document.getElementById("topbar-alerts-btn");
    if (btn && btn.getAttribute("aria-expanded") !== "true") {
      btn.click();
    }
  }

  function openAlertTarget({ hash, url, kind } = {}) {
    if (!hash && !url && kind === "employee-update") {
      openNotificationsPanel();
      return;
    }
    if (url) {
      try {
        const parsed = new URL(url, window.location.href);
        if (parsed.origin === window.location.origin) {
          const nextHash = (parsed.hash || hash || "").replace(/^#/, "");
          if (nextHash) window.location.hash = nextHash;
          if (kind === "clock-in" || kind === "clock-out" || /time-clock|punch/.test(nextHash)) {
            window.EmployeeMobile?.setTab?.("clock", { skipHash: true });
          }
          return;
        }
        window.location.href = url;
        return;
      } catch {
        /* fall through */
      }
    }
    const nextHash = String(hash || "").replace(/^#/, "");
    if (nextHash) window.location.hash = nextHash;
    if (kind === "clock-in" || kind === "clock-out" || nextHash === "time-clock") {
      window.EmployeeMobile?.setTab?.("clock", { skipHash: true });
    }
  }

  function hideUrgentAlert(host) {
    if (!host) return;
    host.classList.remove("is-visible");
    window.clearTimeout(showUrgentAlert._t);
    showUrgentAlert._t = window.setTimeout(() => {
      if (!host.classList.contains("is-visible")) host.hidden = true;
    }, 220);
  }

  function showUrgentAlert(options = {}) {
    const title = String(options.title || "Reminder");
    const body = String(options.body || "");
    const kind = options.kind || classifyAlertKind(options);
    const copy = kindCopy(kind);
    const hash = options.hash || copy.hash;
    const url = options.url || "";
    const actionLabel = options.actionLabel == null ? copy.actionLabel : options.actionLabel;
    const durationMs = Number(options.durationMs) || copy.durationMs;
    const showAction = Boolean(actionLabel && (hash || url || kind === "employee-update"));

    let host = document.getElementById("sshr-urgent-alert");
    if (!host) {
      host = document.createElement("div");
      host.id = "sshr-urgent-alert";
      host.className = "sshr-urgent-alert";
      document.body.appendChild(host);
      host.addEventListener("click", (event) => {
        if (event.target === host) hideUrgentAlert(host);
      });
    }

    host.className = `sshr-urgent-alert sshr-urgent-alert--${kind}`;
    host.setAttribute("role", "alertdialog");
    host.setAttribute("aria-live", "assertive");
    host.setAttribute("aria-modal", "true");
    host.hidden = false;
    host.innerHTML = `
      <div class="sshr-urgent-alert__card">
        <p class="sshr-urgent-alert__kicker">${escapeHtml(copy.kicker)}</p>
        <strong class="sshr-urgent-alert__title">${escapeHtml(title)}</strong>
        ${body ? `<p class="sshr-urgent-alert__body">${escapeHtml(body)}</p>` : ""}
        <div class="sshr-urgent-alert__actions">
          ${
            showAction
              ? `<button type="button" class="sshr-urgent-alert__cta" data-sshr-alert-action>${escapeHtml(actionLabel)}</button>`
              : ""
          }
          <button type="button" class="sshr-urgent-alert__dismiss" data-sshr-alert-dismiss>Dismiss</button>
        </div>
      </div>`;

    host.querySelector("[data-sshr-alert-dismiss]")?.addEventListener("click", () => hideUrgentAlert(host));
    host.querySelector("[data-sshr-alert-action]")?.addEventListener("click", () => {
      hideUrgentAlert(host);
      openAlertTarget({ hash, url, kind });
    });

    requestAnimationFrame(() => host.classList.add("is-visible"));
    playUrgentCue(kind, options.silent);
    window.clearTimeout(showUrgentAlert._t);
    showUrgentAlert._t = window.setTimeout(() => hideUrgentAlert(host), durationMs);
    return host;
  }

  function showInAppAlertBanner(title, body, options) {
    const opts = options && typeof options === "object" ? options : {};
    showUrgentAlert({
      title,
      body,
      ...opts,
      kind: opts.kind || classifyAlertKind({ title, body, ...opts }),
    });
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
      showUrgentAlert({
        title: "Alerts on",
        body: "You’ll get a full-screen reminder to clock in and clock out, plus employee updates.",
        kind: "success",
      });
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
            largeBody: `It's ${startClock} — your shift has started. Open ShiftSwift HR and clock in now.`,
            threadIdentifier: "shiftswift-clock-in",
            summaryArgument: "Clock in",
            schedule: { at: start, allowWhileIdle: true },
            extra: { shiftId: shift.id, type: "shift_start_exact", alert_type: "clock_in", hash: "#time-clock" },
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
              largeBody: `Your shift starts at ${startClock}. Open ShiftSwift HR and get ready to clock in.`,
              threadIdentifier: "shiftswift-clock-in",
              schedule: { at: startAt, allowWhileIdle: true },
              extra: { shiftId: shift.id, type: "shift_start", alert_type: "shift_reminder", hash: "#time-clock" },
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
            largeBody: `It's ${endClock} — your shift has ended. Open ShiftSwift HR and clock out now.`,
            threadIdentifier: "shiftswift-clock-out",
            summaryArgument: "Clock out",
            schedule: { at: end, allowWhileIdle: true },
            extra: { shiftId: shift.id, type: "shift_end_exact", alert_type: "clock_out", hash: "#time-clock" },
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
              largeBody: `Your shift ends at ${endClock}. Open ShiftSwift HR and clock out.`,
              threadIdentifier: "shiftswift-clock-out",
              schedule: { at: endAt, allowWhileIdle: true },
              extra: { shiftId: shift.id, type: "shift_end", alert_type: "shift_end_reminder", hash: "#time-clock" },
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
        const n = event?.notification || event || {};
        const extra = n.extra || {};
        showUrgentAlert({
          title: n.title || "Reminder",
          body: n.body || "",
          kind: classifyAlertKind({ title: n.title, body: n.body, ...extra }),
          hash: extra.hash || "#time-clock",
          url: extra.url,
        });
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
    classifyAlertKind,
    showUrgentAlert,
    showInAppAlertBanner,
  };
})();
