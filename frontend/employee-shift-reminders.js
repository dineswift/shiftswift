/** In-app rota shift reminders with alert sound (uses admin-configured timing). */
(function initEmployeeShiftReminders() {
  const FIRED_KEY = "sshrShiftReminderFired";
  const POLL_MS = 30000;

  let reminderConfig = { minutes_before_start: 10, minutes_before_end: 10 };
  let shifts = [];
  let pollTimer = null;

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
      toast.setAttribute("aria-live", "polite");
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

  function fireReminder(type, shift, minutes) {
    const key = `${type}:${shift.id}:${shift.shift_date}`;
    if (wasFired(key)) return;

    const timeLabel =
      type === "start"
        ? `${String(shift.start_time).slice(0, 5)}`
        : `${String(shift.end_time).slice(0, 5)}`;
    const title =
      type === "start"
        ? `Shift starts in ${minutes} minutes`
        : `Shift ends in ${minutes} minutes`;
    const body = `Your shift ${type === "start" ? "starts" : "ends"} at ${timeLabel}.`;

    markFired(key);
    window.ShiftSwiftPush?.playAlertSound?.();
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate([300, 80, 300]);
      } catch {
        /* ignore */
      }
    }
    showToast(title, body);

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, tag: key });
      } catch {
        /* ignore */
      }
    }
  }

  function evaluateReminders() {
    if (!shifts.length) return;
    const now = Date.now();
    const startLead = Number(reminderConfig.minutes_before_start) || 10;
    const endLead = Number(reminderConfig.minutes_before_end) || 10;

    for (const shift of shifts) {
      const { start, end } = shiftBounds(shift);
      const msUntilStart = start.getTime() - now;
      const msUntilEnd = end.getTime() - now;

      if (msUntilStart > 0 && msUntilStart <= startLead * 60 * 1000 + 60000) {
        if (msUntilStart <= startLead * 60 * 1000) {
          fireReminder("start", shift, startLead);
        }
      }

      if (msUntilEnd > 0 && msUntilEnd <= endLead * 60 * 1000 + 60000) {
        if (msUntilEnd <= endLead * 60 * 1000) {
          fireReminder("end", shift, endLead);
        }
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

  function onShiftsLoaded(event) {
    const data = event.detail || {};
    shifts = data.shifts || [];
    if (data.shift_reminders) {
      reminderConfig = {
        minutes_before_start: data.shift_reminders.minutes_before_start ?? 10,
        minutes_before_end: data.shift_reminders.minutes_before_end ?? 10,
      };
    }
    startPolling();
  }

  document.addEventListener("employee:shifts-loaded", onShiftsLoaded);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") evaluateReminders();
  });

  window.ShiftSwiftShiftReminders = {
    evaluateReminders,
    stopPolling,
  };
})();
