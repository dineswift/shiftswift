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
          `${window.Capacitor.config?.ios?.scheme || "App"}://localhost/index.html?build=14`
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

  window.ShiftSwiftAuthGuard = { loginRedirectUrl };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void guard(), { once: true });
  } else {
    void guard();
  }
})();

function signOut() {
  window.ShiftSwiftSession?.clearSession?.();
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("tenantId");
  localStorage.removeItem("userRole");
  window.location.href =
    window.ShiftSwiftAuthGuard?.loginRedirectUrl?.() ||
    window.ShiftSwiftSession?.resolveLoginUrl?.() ||
    "./native-app-login.html";
}

document.querySelectorAll("[data-sign-out]").forEach((el) => {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    signOut();
  });
});
