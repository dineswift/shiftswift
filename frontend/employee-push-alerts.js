/** Employee home — shift alert bell + push opt-in. */
(function initEmployeePushAlerts() {
  const session = window.ShiftSwiftSession;
  if (!session?.hasSession?.()) return;

  const banner = document.getElementById("employee-alerts-banner");
  const statusEl = document.getElementById("employee-alerts-status");
  const enableBtn = document.getElementById("employee-enable-alerts-btn");
  const topbarBtn = document.getElementById("employee-topbar-alerts-btn");

  if (!banner && !enableBtn && !topbarBtn) return;

  function setBannerState({ active, message, hideBanner }) {
    if (banner) {
      banner.hidden = Boolean(hideBanner);
      banner.classList.toggle("employee-alerts-banner--active", Boolean(active));
    }
    if (statusEl && message) statusEl.textContent = message;
    if (enableBtn) {
      enableBtn.textContent = active ? "Alerts on" : "Turn on alerts";
      enableBtn.disabled = Boolean(active);
      enableBtn.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (topbarBtn) {
      topbarBtn.classList.toggle("employee-topbar-alerts-btn--active", Boolean(active));
      topbarBtn.setAttribute("aria-label", active ? "Shift alerts on" : "Turn on shift alerts");
    }
  }

  async function refreshStatus() {
    if (!window.ShiftSwiftPush?.getStatus) return;
    const tenantId = localStorage.getItem("tenantId");
    const token = session.getToken();
    if (!tenantId) {
      setBannerState({
        active: false,
        message: "Bell alerts 10 minutes before your shift and if you forget to clock in.",
        hideBanner: false,
      });
      return;
    }

    const status = await window.ShiftSwiftPush.getStatus({
      apiBase: session.getApiBase(),
      token,
      tenantId,
    });

    if (!status.supported) {
      setBannerState({
        active: false,
        message: "Shift alerts are not supported on this browser.",
        hideBanner: false,
      });
      if (enableBtn) enableBtn.disabled = true;
      return;
    }

    if (!status.serverEnabled) {
      setBannerState({
        active: false,
        message: "Shift alerts are not configured yet — ask HR to enable notifications.",
        hideBanner: false,
      });
      if (enableBtn) enableBtn.disabled = true;
      return;
    }

    if (status.permission === "denied") {
      setBannerState({
        active: false,
        message: "Notifications are blocked. Enable them in your phone settings to get shift alerts.",
        hideBanner: false,
      });
      if (enableBtn) {
        enableBtn.disabled = false;
        enableBtn.textContent = "Try again";
      }
      return;
    }

    if (status.subscribed) {
      setBannerState({
        active: true,
        message: "Alerts on — bell before shift, clock-in reminders, and clock-out at shift end.",
        hideBanner: true,
      });
      return;
    }

    setBannerState({
      active: false,
      message: "Get bell alerts before your shift, when to clock in, and when to clock out.",
      hideBanner: false,
    });
  }

  async function enableAlerts() {
    const tenantId = localStorage.getItem("tenantId");
    const token = session.getToken();
    if (!tenantId || !window.ShiftSwiftPush?.enableAlerts) return;

    if (enableBtn) enableBtn.disabled = true;
    if (statusEl) statusEl.textContent = "Turning on alerts…";

    const result = await window.ShiftSwiftPush.enableAlerts({
      apiBase: session.getApiBase(),
      token,
      tenantId,
    });

    if (result.ok) {
      await refreshStatus();
      return;
    }

    if (result.reason === "denied") {
      setBannerState({
        active: false,
        message: "Notifications blocked — allow alerts in your phone settings, then tap Try again.",
        hideBanner: false,
      });
      if (enableBtn) {
        enableBtn.disabled = false;
        enableBtn.textContent = "Try again";
      }
      return;
    }

    if (result.reason === "server_disabled") {
      setBannerState({
        active: false,
        message: "Shift alerts are not configured on the server yet.",
        hideBanner: false,
      });
      return;
    }

    setBannerState({
      active: false,
      message: "Could not enable alerts. Check your connection and try again.",
      hideBanner: false,
    });
    if (enableBtn) enableBtn.disabled = false;
  }

  enableBtn?.addEventListener("click", enableAlerts);
  topbarBtn?.addEventListener("click", enableAlerts);

  refreshStatus();
  window.addEventListener("employee:profile-loaded", refreshStatus);
})();
