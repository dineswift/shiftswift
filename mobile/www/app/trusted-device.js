/** Trusted device + optional Face ID quick unlock for native app and PWA login. */
(function initShiftSwiftTrustedDevice() {
  const TRUST_PREFIX = "sshrDeviceTrust:";
  const DEVICE_ID_KEY = "sshrDeviceId";
  const BIOMETRIC_FLAG = "sshrBiometricUnlock";
  const TRUST_DAYS_DEFAULT = 30;

  function isNativeShell() {
    return Boolean(window.ShiftSwiftNativeApp?.isCapacitorNative?.());
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch {
      return "unknown-device";
    }
  }

  function deviceLabel() {
    if (isNativeShell()) {
      const platform = window.Capacitor?.getPlatform?.() || "native";
      return `ShiftSwift HR (${platform})`;
    }
    return "ShiftSwift HR (browser)";
  }

  async function preferencesPlugin() {
    return window.Capacitor?.Plugins?.Preferences || null;
  }

  async function readTrustKey(key) {
    try {
      const prefs = await preferencesPlugin();
      if (prefs?.get) {
        const { value } = await prefs.get({ key });
        if (value) return value;
      }
    } catch {
      /* ignore */
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async function writeTrustKey(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    try {
      const prefs = await preferencesPlugin();
      if (!prefs) return;
      if (value) await prefs.set({ key, value: String(value) });
      else if (prefs.remove) await prefs.remove({ key });
    } catch {
      /* ignore */
    }
  }

  function trustStorageKey(username) {
    return `${TRUST_PREFIX}${normalizeEmail(username)}`;
  }

  async function getTrustedToken(username) {
    const email = normalizeEmail(username);
    if (!email) return "";
    return (await readTrustKey(trustStorageKey(email))) || "";
  }

  async function setTrustedToken(username, token, trustDays) {
    const email = normalizeEmail(username);
    if (!email || !token) return;
    await writeTrustKey(trustStorageKey(email), String(token));
    if (trustDays) {
      await writeTrustKey(`${trustStorageKey(email)}:days`, String(trustDays));
    }
  }

  async function clearTrustedToken(username) {
    const email = normalizeEmail(username);
    if (!email) return;
    await writeTrustKey(trustStorageKey(email), "");
    await writeTrustKey(`${trustStorageKey(email)}:days`, "");
  }

  async function rememberDeviceFromResponse(username, data) {
    if (!data?.device_token || !username) return;
    await setTrustedToken(username, data.device_token, data.device_trust_days || TRUST_DAYS_DEFAULT);
  }

  function shouldRememberDevice(explicitChecked) {
    if (typeof explicitChecked === "boolean") return explicitChecked;
    const mfaEl = document.getElementById("login-remember-device-mfa");
    if (mfaEl && !mfaEl.closest("[hidden]")) return Boolean(mfaEl.checked);
    if (isNativeShell()) return true;
    const el = document.getElementById("login-remember-device");
    return Boolean(el?.checked);
  }

  function isBiometricUnlockEnabled() {
    try {
      return localStorage.getItem(BIOMETRIC_FLAG) === "1";
    } catch {
      return false;
    }
  }

  function setBiometricUnlockEnabled(enabled) {
    try {
      if (enabled) localStorage.setItem(BIOMETRIC_FLAG, "1");
      else localStorage.removeItem(BIOMETRIC_FLAG);
    } catch {
      /* ignore */
    }
  }

  async function biometricPlugin() {
    return (
      window.Capacitor?.Plugins?.BiometricAuth ||
      window.Capacitor?.Plugins?.NativeBiometric ||
      null
    );
  }

  async function canUseBiometricUnlock() {
    if (window.ShiftSwiftPasskeyAuth?.canUsePasskeys?.()) return true;
    if (!isNativeShell()) return false;
    const plugin = await biometricPlugin();
    if (!plugin) return false;
    if (plugin.checkBiometry) {
      try {
        const result = await plugin.checkBiometry();
        return Boolean(result?.isAvailable ?? result?.available);
      } catch {
        return false;
      }
    }
    return Boolean(plugin.verify || plugin.authenticate);
  }

  async function verifyBiometricUnlock(reason) {
    const plugin = await biometricPlugin();
    if (!plugin) return true;
    const message = reason || "Unlock ShiftSwift HR";
    try {
      if (plugin.authenticate) {
        await plugin.authenticate({ reason: message, cancelTitle: "Use password" });
        return true;
      }
      if (plugin.verify) {
        const result = await plugin.verify({ reason: message, title: "ShiftSwift HR" });
        return Boolean(result?.verified ?? result?.success ?? true);
      }
    } catch {
      return false;
    }
    return false;
  }

  async function tryQuickUnlock() {
    if (window.ShiftSwiftSession?.hydrateNativeSession) {
      await window.ShiftSwiftSession.hydrateNativeSession();
    }
    if (!window.ShiftSwiftSession?.hasSession?.()) {
      if (window.ShiftSwiftPasskeyAuth?.tryAutoLogin) {
        return Boolean(await window.ShiftSwiftPasskeyAuth.tryAutoLogin());
      }
      return false;
    }
    if (isBiometricUnlockEnabled()) {
      const ok = await verifyBiometricUnlock("Sign in with Face ID");
      if (!ok) return false;
    }
    return Boolean(await window.ShiftSwiftSession.redirectIfLoggedIn?.());
  }

  window.ShiftSwiftTrustedDevice = {
    TRUST_DAYS_DEFAULT,
    getDeviceId,
    deviceLabel,
    getTrustedToken,
    setTrustedToken,
    clearTrustedToken,
    rememberDeviceFromResponse,
    shouldRememberDevice,
    isBiometricUnlockEnabled,
    setBiometricUnlockEnabled,
    canUseBiometricUnlock,
    verifyBiometricUnlock,
    tryQuickUnlock,
  };
})();
