(function () {
  async function waitForSession() {
    if (!window.ShiftSwiftSession) return false;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await window.ShiftSwiftSession.hydrateNativeSession?.();
      if (window.ShiftSwiftSession.hasSession?.()) return true;
      if (attempt < 3) {
        await new Promise((resolve) => window.setTimeout(resolve, 60 * (attempt + 1)));
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
      if (window.Capacitor?.config?.appId === "co.uk.shiftswifthr.app") {
        return (
          window.ShiftSwiftSession?.unifiedNativeLoginUrl?.() ||
          `${window.Capacitor.config?.ios?.scheme || "App"}://localhost/index.html?build=16`
        );
      }
    } catch {
      /* ignore */
    }
    return window.ShiftSwiftSession?.resolveLoginUrl?.() || "./native-app-login.html";
  }

  async function guard() {
    const ok = await waitForSession();
    if (ok) return;
    window.location.replace(loginRedirectUrl());
  }

  async function signOut() {
    const loginUrl =
      window.ShiftSwiftAuthGuard?.loginRedirectUrl?.() ||
      window.ShiftSwiftSession?.resolveLoginUrl?.() ||
      "./native-app-login.html";
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
