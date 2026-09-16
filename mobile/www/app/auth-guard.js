(function () {
  if (window.__SSHR_AUTH_GUARD_INSTANCE) return;
  window.__SSHR_AUTH_GUARD_INSTANCE = true;

  async function waitForSession() {
    if (!window.ShiftSwiftSession) return false;

    const isNativePortal =
      window.Capacitor?.isNativePlatform?.() &&
      /\/(employee|admin|master)\.html$/i.test(window.location.pathname || "");
    const maxAttempts = isNativePortal ? 20 : 4;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await window.ShiftSwiftSession.hydrateNativeSession?.({ force: attempt < 3 });
      if (window.ShiftSwiftSession.hasSession?.()) return true;
      if (attempt < maxAttempts - 1) {
        const delayMs = isNativePortal ? 90 * (attempt + 1) : 60 * (attempt + 1);
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }
    }

    if (window.ShiftSwiftSession.getRefreshToken?.()) {
      const refreshed = await window.ShiftSwiftSession.refreshAccessToken?.();
      if (refreshed && window.ShiftSwiftSession.hasSession?.()) return true;
    }

    return Boolean(window.ShiftSwiftSession.hasSession?.());
  }

  function loginRedirectUrl() {
    try {
      if (
        window.Capacitor?.config?.appId === "co.uk.shiftswifthr.app" ||
        localStorage.getItem("sshrUnifiedNativeApp") === "1"
      ) {
        return (
          window.ShiftSwiftSession?.unifiedNativeLoginUrl?.() ||
          window.ShiftSwiftNativeBundledUrl?.assetUrl?.("index.html?build=27&v=40", "45") ||
          `${window.Capacitor?.config?.server?.iosScheme || window.Capacitor?.config?.ios?.scheme || "App"}://localhost/index.html?build=27&v=40`
        );
      }
    } catch {
      /* ignore */
    }
    return window.ShiftSwiftSession?.resolveLoginUrl?.() || "./sign-in.html";
  }

  function isBundledNativeEmployeePortal() {
    try {
      if (window.__SSHR_BUNDLED_NATIVE_BOOT) return true;
      if (!window.Capacitor?.isNativePlatform?.()) return false;
      const href = String(window.location.href || "");
      const path = String(window.location.pathname || "");
      return /\/\/localhost\//i.test(href) && /(employee|admin)\.html/i.test(path);
    } catch {
      return false;
    }
  }

  async function guard() {
    if (isBundledNativeEmployeePortal()) return;

    if (window.Capacitor?.isNativePlatform?.()) {
      if (!window.__SSHR_NATIVE_SESSION_READY) {
        await Promise.race([
          new Promise((resolve) => {
            if (window.__SSHR_NATIVE_SESSION_READY) {
              resolve();
              return;
            }
            window.addEventListener("shiftswift:native-session-ready", () => resolve(), { once: true });
          }),
          new Promise((resolve) => window.setTimeout(resolve, 2000)),
        ]);
      }
    }
    const ok = await waitForSession();
    if (ok) return;
    if (
      window.Capacitor?.isNativePlatform?.() &&
      /\/(employee|admin|master)\.html$/i.test(window.location.pathname || "") &&
      window.ShiftSwiftSession?.getRefreshToken?.()
    ) {
      return;
    }
    try {
      sessionStorage.setItem("sshrAuthBouncedToLogin", "1");
    } catch {
      /* ignore */
    }
    window.location.replace(loginRedirectUrl());
  }

  async function signOut() {
    const loginUrl =
      window.ShiftSwiftAuthGuard?.loginRedirectUrl?.() ||
      window.ShiftSwiftSession?.resolveLoginUrl?.() ||
      "./sign-in.html";
    if (window.ShiftSwiftSession?.signOut) {
      await window.ShiftSwiftSession.signOut(loginUrl);
      return;
    }
    await window.ShiftSwiftSession?.clearSession?.();
    window.location.replace(loginUrl);
  }

  window.ShiftSwiftAuthGuard = { loginRedirectUrl, signOut };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void guard(), { once: true });
  } else {
    void guard();
  }
})();

document.querySelectorAll("[data-sign-out]").forEach((el) => {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    void (window.ShiftSwiftAuthGuard?.signOut?.() ||
      window.ShiftSwiftSession?.signOut?.(window.ShiftSwiftAuthGuard?.loginRedirectUrl?.()));
  });
});
