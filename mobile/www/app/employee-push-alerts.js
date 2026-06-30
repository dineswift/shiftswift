/** Employee home — shift alert bell + native local notifications / PWA web push. */
(function () {
  function shouldUseNativeAlerts() {
    try {
      return Boolean(
        window.Capacitor?.isNativePlatform?.() ||
          window.__SSHR_BUNDLED_NATIVE_BOOT ||
          window.__SSHR_PORTAL_GUARD ||
          document.documentElement.classList.contains("native-app") ||
          document.documentElement.classList.contains("capacitor-native") ||
          localStorage.getItem("sshrUnifiedNativeApp") === "1" ||
          localStorage.getItem("sshrNativeApp") === "1",
      );
    } catch {
      return false;
    }
  }

  if (window.__SSHR_EMPLOYEE_PUSH_ALERTS_READY__) {
    if (!shouldUseNativeAlerts()) return;
    window.__SSHR_EMPLOYEE_PUSH_ALERTS_READY__ = false;
  }

  function bootWhenReady() {
    const banner = document.getElementById("employee-alerts-banner");
    const enableBtn = document.getElementById("employee-enable-alerts-btn");
    const topbarBtn = document.getElementById("employee-topbar-alerts-btn");
    if (!banner && !enableBtn && !topbarBtn) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootWhenReady, { once: true });
      } else {
        window.setTimeout(bootWhenReady, 50);
      }
      return;
    }
    if (window.__SSHR_EMPLOYEE_PUSH_ALERTS_READY__) return;
    window.__SSHR_EMPLOYEE_PUSH_ALERTS_READY__ = true;
    start(banner, enableBtn, topbarBtn);
  }

  function start(banner, enableBtn, topbarBtn) {
    const session = window.ShiftSwiftSession;
    const NATIVE_ENABLED_KEY = "sshrNativeShiftAlerts";
    const statusEl = document.getElementById("employee-alerts-status");
    let nativeRetryTimer = null;

    function isNativeApp() {
      return shouldUseNativeAlerts();
    }

    function nativeNotificationsPlugin() {
      if (window.ShiftSwiftNativeShiftAlerts?.getNotificationsPlugin) {
        return window.ShiftSwiftNativeShiftAlerts.getNotificationsPlugin();
      }
      return window.Capacitor?.Plugins?.LocalNotifications;
    }

    async function waitForNotificationsPlugin() {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const plugin = nativeNotificationsPlugin();
        if (plugin?.checkPermissions) return plugin;
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
      return null;
    }

    function isNativeAlertsEnabled() {
      try {
        return localStorage.getItem(NATIVE_ENABLED_KEY) === "1";
      } catch {
        return false;
      }
    }

    function setNativeAlertsEnabled(enabled) {
      try {
        if (enabled) localStorage.setItem(NATIVE_ENABLED_KEY, "1");
        else localStorage.removeItem(NATIVE_ENABLED_KEY);
      } catch {
        /* ignore */
      }
    }

    async function getNativeAlertsStatus() {
      if (window.ShiftSwiftNativeShiftAlerts?.getPermissionStatus) {
        const status = await window.ShiftSwiftNativeShiftAlerts.getPermissionStatus();
        if (status.supported) return status;
      }

      if (!isNativeApp()) return null;

      const plugin = await waitForNotificationsPlugin();
      if (!plugin) return null;

      try {
        const result = await plugin.checkPermissions();
        const permission = result?.display || "prompt";
        return {
          supported: true,
          permission,
          enabled: isNativeAlertsEnabled() && permission === "granted",
        };
      } catch {
        return { supported: true, permission: "prompt", enabled: false };
      }
    }

    async function enableNativeAlerts() {
      if (window.ShiftSwiftNativeShiftAlerts?.enableAlerts) {
        return window.ShiftSwiftNativeShiftAlerts.enableAlerts();
      }

      const plugin = await waitForNotificationsPlugin();
      if (!plugin?.requestPermissions) return { ok: false, reason: "unsupported" };

      try {
        const result = await plugin.requestPermissions();
        const permission = result?.display || "denied";
        if (permission !== "granted") return { ok: false, reason: "denied" };
        setNativeAlertsEnabled(true);
        window.ShiftSwiftPush?.playAlertSound?.();
        window.dispatchEvent(new CustomEvent("employee:shift-alerts-enabled"));
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error?.message || "permission_error" };
      }
    }

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

    function stopNativeRetry() {
      if (!nativeRetryTimer) return;
      window.clearInterval(nativeRetryTimer);
      nativeRetryTimer = null;
    }

    function scheduleNativeRetry() {
      if (nativeRetryTimer) return;
      let attempts = 0;
      nativeRetryTimer = window.setInterval(() => {
        attempts += 1;
        if (attempts > 40) {
          stopNativeRetry();
          setBannerState({
            active: false,
            message:
              "Tap Turn on alerts to get a reminder at shift start — even when the app is closed.",
            hideBanner: false,
          });
          if (enableBtn) enableBtn.disabled = false;
          return;
        }
        void refreshStatus();
      }, 400);
    }

    async function refreshNativeStatus() {
      const native = await getNativeAlertsStatus();
      if (!native) {
        setBannerState({
          active: false,
          message: "Setting up shift alerts on your phone…",
          hideBanner: false,
        });
        if (enableBtn) enableBtn.disabled = false;
        scheduleNativeRetry();
        return;
      }

      stopNativeRetry();

      if (native.permission === "denied") {
        setBannerState({
          active: false,
          message:
            "Notifications are blocked. Open iPhone Settings → ShiftSwift HR → Notifications and allow alerts.",
          hideBanner: false,
        });
        if (enableBtn) {
          enableBtn.disabled = false;
          enableBtn.textContent = "Try again";
        }
        return;
      }

      if (native.enabled) {
        setBannerState({
          active: true,
          message:
            'Alerts on — you\'ll get "It\'s 09:00 and you can clock in now" at shift start, even when the app is closed.',
          hideBanner: true,
        });
        void window.ShiftSwiftNativeShiftAlerts?.ensureReadyForScheduling?.();
        return;
      }

      setBannerState({
        active: false,
        message:
          'Tap Turn on alerts for a reminder at shift start — "It\'s 09:00 and you can clock in now" — even when the app is closed.',
        hideBanner: false,
      });
      if (enableBtn) enableBtn.disabled = false;
    }

    async function refreshStatus() {
      const tenantId = localStorage.getItem("tenantId");
      if (!tenantId) {
        setBannerState({
          active: false,
          message: "Bell alerts before your shift starts and ends, plus clock-in reminders if you forget.",
          hideBanner: false,
        });
        if (enableBtn) enableBtn.disabled = false;
        return;
      }

      if (isNativeApp()) {
        await refreshNativeStatus();
        return;
      }

      if (!window.ShiftSwiftPush?.getStatus) {
        if (enableBtn) enableBtn.disabled = false;
        return;
      }

      const token = session?.getToken?.();
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
          message: "Alerts on — bell before shift start and end, plus clock-in reminders.",
          hideBanner: true,
        });
        return;
      }

      setBannerState({
        active: false,
        message: "Get bell alerts before your shift starts and ends, plus clock-in nudges.",
        hideBanner: false,
      });
      if (enableBtn) enableBtn.disabled = false;
    }

    async function enableAlerts() {
      const tenantId = localStorage.getItem("tenantId");

      const run = async () => {
        if (enableBtn) enableBtn.disabled = true;
        if (statusEl) statusEl.textContent = "Turning on alerts…";

        let result;
        if (isNativeApp()) {
          result = await enableNativeAlerts();
        } else {
          if (!tenantId) {
            setBannerState({
              active: false,
              message: "Sign in to turn on shift alerts.",
              hideBanner: false,
            });
            if (enableBtn) enableBtn.disabled = false;
            return false;
          }
          if (!window.ShiftSwiftPush?.enableAlerts) {
            result = { ok: false, reason: "unsupported" };
          } else {
            result = await window.ShiftSwiftPush.enableAlerts({
              apiBase: session.getApiBase(),
              token: session.getToken(),
              tenantId,
            });
          }
        }

        if (result.ok) {
          await refreshStatus();
          return "Alerts on";
        }

        if (result.reason === "denied") {
          setBannerState({
            active: false,
            message:
              "Notifications blocked — allow alerts in iPhone Settings → ShiftSwift HR, then tap Try again.",
            hideBanner: false,
          });
          if (enableBtn) {
            enableBtn.disabled = false;
            enableBtn.textContent = "Try again";
          }
          return false;
        }

        setBannerState({
          active: false,
          message: "Could not enable alerts. Tap Try again.",
          hideBanner: false,
        });
        if (enableBtn) {
          enableBtn.disabled = false;
          enableBtn.textContent = "Try again";
        }
        return false;
      };

      if (window.ShiftSwiftAction?.runButtonActionAuto) {
        await window.ShiftSwiftAction.runButtonActionAuto(enableBtn, run, {
          loadingLabel: "Turning on alerts…",
          successLabel: "Alerts on",
          successMessage: "Alerts on",
          errorMessage: "Could not enable alerts. Tap Try again.",
        });
        return;
      }

      await run();
    }

    async function boot() {
      await session?.hydrateNativeSession?.();
      if (!session?.hasSession?.()) return;
      await refreshStatus();
    }

    enableBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      void enableAlerts();
    });
    topbarBtn?.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      void enableAlerts();
    });

    window.ShiftSwiftPortalNotifications?.bindEmployee?.({ bellBtn: topbarBtn });

    window.addEventListener("employee:profile-loaded", () => {
      void refreshStatus();
      void window.ShiftSwiftNativeShiftAlerts?.ensureReadyForScheduling?.();
    });
    window.addEventListener("shiftswift:native-shift-alerts-ready", () => void refreshStatus());
    window.addEventListener("shiftswift:native-session-ready", () => void refreshStatus());
    window.addEventListener("shiftswift:portal-ready", () => void refreshStatus());

    window.ShiftSwiftEmployeePushAlerts = { refresh: refreshStatus, enable: enableAlerts };
    void boot();
  }

  bootWhenReady();
})();
