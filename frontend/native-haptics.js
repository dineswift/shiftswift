/** Light native haptics for punch / success moments. */
(function initShiftSwiftNativeHaptics() {
  function canUse() {
    return Boolean(window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Haptics);
  }

  async function impact(style = "Medium") {
    if (!canUse()) return;
    try {
      await window.Capacitor.Plugins.Haptics.impact({ style });
    } catch {
      /* ignore */
    }
  }

  async function success() {
    if (!canUse()) return;
    try {
      const Haptics = window.Capacitor.Plugins.Haptics;
      if (Haptics.notification) {
        await Haptics.notification({ type: "SUCCESS" });
        return;
      }
      await impact("Medium");
    } catch {
      /* ignore */
    }
  }

  async function error() {
    if (!canUse()) return;
    try {
      const Haptics = window.Capacitor.Plugins.Haptics;
      if (Haptics.notification) {
        await Haptics.notification({ type: "ERROR" });
        return;
      }
      await impact("Heavy");
    } catch {
      /* ignore */
    }
  }

  window.ShiftSwiftNativeHaptics = { impact, success, error, canUse };
})();
