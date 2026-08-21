/** Shift clock-in/out reminders — in-app plus system notifications (including when the page is in the background). */
(function initEmployeeShiftReminders() {
  const FIRED_KEY = "sshrShiftReminderFired";
  const POLL_MS = 30000;

  let reminderConfig = {
    minutes_before_start: 10,
    minutes_before_end: 10,
    missed_clock_in_early_minutes: 10,
    missed_clock_in_late_minutes: 30,
  };
  let shifts = [];
  let pollTimer = null;
  let clockedIn = false;
  let clockedOut = false;

  function firedStore() {
    try {
      return JSON.parse(sessionStorage.getItem(FIRED_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function markFired(key) {
    const store = firedStore();
    store[key] = Date.now();
    try {
      sessionStorage.setItem(FIRED_KEY, JSON.stringify(store));
    } catch {
      /* ignore */
    }
  }

  function wasFired(key) {
    return Boolean(firedStore()[key]);
  }

  function shiftBounds(shift) {
    const start = new Date(`${shift.shift_date}T${String(shift.start_time).slice(0, 5)}:00`);
    let end = new Date(`${shift.shift_date}T${String(shift.end_time).slice(0, 5)}:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }

  function showToast(title, body) {
    let toast = document.getElementById("employee-shift-reminder-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "employee-shift-reminder-toast";
      toast.className = "employee-shift-reminder-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "assertive");
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<strong>${title}</strong><span>${body}</span>`;
    toast.hidden = false;
    toast.classList.add("is-visible");
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => {
        toast.hidden = true;
      }, 220);
    }, 8000);
  }

  async function showSystemNotification(title, body, { tag, alertType }) {
    const options = {
      body,
      tag,
      alert_type: alertType,
      urgent: true,
      url: "./employee.html#time-clock",
    };
    try {
      if (navigator.serviceWorker) {
        const registration = await navigator.serviceWorker.ready;
        if (registration?.active) {
          registration.active.postMessage({ type: "SHOW_CLOCK_ALERT", title, ...options });
          return;
        }
        if (registration?.showNotification && Notification.permission === "granted") {
          await registration.showNotification(title, {
            body,
            tag,
            renotify: true,
            requireInteraction: true,
            icon: "./assets/shiftswift-employee-app-icon-192.png",
            data: { url: "./employee.html#time-clock", alert_type: alertType },
          });
          return;
        }
      }
    } catch {
      /* fall through */
    }
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, tag });
      } catch {
        /* ignore */
      }
    }
  }

  function fireReminder(type, shift, minutes) {
    const key = `${type}:${shift.id}:${shift.shift_date}`;
    if (wasFired(key)) return;

    const startLabel = String(shift.start_time).slice(0, 5);
    const endLabel = String(shift.end_time).slice(0, 5);
    let title = "";
    let body = "";
    let alertType = type;

    if (type === "start") {
      title = `Clock in soon — shift in ${minutes} minutes`;
      body = `Your shift starts at ${startLabel}.`;
      alertType = "shift_reminder";
    } else if (type === "end") {
      title = `Clock out soon — shift ends in ${minutes} minutes`;
      body = `Your shift ends at ${endLabel}.`;
      alertType = "shift_end_reminder";
    } else if (type === "clock_in") {
      title = "Clock in now";
      body = `Your shift has started (${startLabel}). Tap to clock in.`;
      alertType = "clock_in";
    } else if (type === "clock_out") {
      title = "Clock out now";
      body = `Your shift has ended (${endLabel}). Tap to clock out.`;
      alertType = "clock_out";
    } else if (type === "missed_early") {
      title = "Reminder: clock in for your shift";
      body = `Your shift started ${minutes} minutes ago and you have not clocked in yet.`;
      alertType = "missed_clock_in_early";
    } else if (type === "missed_late") {
      title = "You still haven't clocked in";
      body = "Tap to clock in, or contact your manager if you cannot work this shift.";
      alertType = "missed_clock_in";
    } else {
      return;
    }

    markFired(key);
    window.ShiftSwiftPush?.playAlertSound?.();
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate([400, 120, 400, 120, 400]);
      } catch {
        /* ignore */
      }
    }
    showToast(title, body);
    void showSystemNotification(title, body, { tag: key, alertType });
  }

  function evaluateReminders() {
    if (!shifts.length) return;
    const now = Date.now();
    const startLead = Number(reminderConfig.minutes_before_start) || 10;
    const endLead = Number(reminderConfig.minutes_before_end) || 10;
    const missedEarly = Number(reminderConfig.missed_clock_in_early_minutes) || 10;
    const missedLate = Number(reminderConfig.missed_clock_in_late_minutes) || 30;

    for (const shift of shifts) {
      const bounds = shiftBounds(shift);
      if (!bounds) continue;
      const { start, end } = bounds;
      const msUntilStart = start.getTime() - now;
      const msUntilEnd = end.getTime() - now;
      const msAfterStart = now - start.getTime();

      if (msUntilStart > 0 && msUntilStart <= startLead * 60 * 1000) {
        fireReminder("start", shift, startLead);
      }
      if (msUntilStart <= 0 && msUntilStart > -60000 && !clockedIn) {
        fireReminder("clock_in", shift, 0);
      }
      if (!clockedIn && msAfterStart >= missedEarly * 60 * 1000 && msAfterStart < missedEarly * 60 * 1000 + 60000) {
        fireReminder("missed_early", shift, missedEarly);
      }
      if (!clockedIn && msAfterStart >= missedLate * 60 * 1000 && msAfterStart < missedLate * 60 * 1000 + 60000) {
        fireReminder("missed_late", shift, missedLate);
      }
      if (msUntilEnd > 0 && msUntilEnd <= endLead * 60 * 1000) {
        fireReminder("end", shift, endLead);
      }
      if (msUntilEnd <= 0 && msUntilEnd > -60000 && !clockedOut) {
        fireReminder("clock_out", shift, 0);
      }
    }
  }

  function startPolling() {
    window.clearInterval(pollTimer);
    evaluateReminders();
    pollTimer = window.setInterval(evaluateReminders, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function applyReminderConfig(data) {
    if (!data?.shift_reminders) return;
    reminderConfig = {
      minutes_before_start: data.shift_reminders.minutes_before_start ?? 10,
      minutes_before_end: data.shift_reminders.minutes_before_end ?? 10,
      missed_clock_in_early_minutes: data.shift_reminders.missed_clock_in_early_minutes ?? 10,
      missed_clock_in_late_minutes: data.shift_reminders.missed_clock_in_late_minutes ?? 30,
    };
  }

  function onShiftsLoaded(event) {
    const data = event.detail || {};
    shifts = data.shifts || [];
    applyReminderConfig(data);
    startPolling();
    void window.ShiftSwiftNativeShiftAlerts?.scheduleFromShifts?.(shifts, {
      ...reminderConfig,
      clocked_in: clockedIn,
    });
  }

  document.addEventListener("employee:shifts-loaded", onShiftsLoaded);
  document.addEventListener("employee:shift-alerts-enabled", () => {
    void window.ShiftSwiftNativeShiftAlerts?.scheduleFromShifts?.(shifts, {
      ...reminderConfig,
      clocked_in: clockedIn,
    });
  });
  window.addEventListener("employee:work-state", (event) => {
    const next = event.detail?.workState === "clocked_in" || event.detail?.workState === "on_break";
    if (next === clockedIn) return;
    clockedIn = next;
    void window.ShiftSwiftNativeShiftAlerts?.scheduleFromShifts?.(shifts, {
      ...reminderConfig,
      clocked_in: clockedIn,
    });
  });
  window.addEventListener("employee:punched", (event) => {
    const punchType = event.detail?.punchType;
    if (punchType === "in") {
      clockedIn = true;
      clockedOut = false;
    }
    if (punchType === "out") {
      clockedIn = false;
      clockedOut = true;
    }
    void window.ShiftSwiftNativeShiftAlerts?.onPunch?.(punchType);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") evaluateReminders();
  });

  window.ShiftSwiftShiftReminders = {
    evaluateReminders,
    stopPolling,
  };
})();
