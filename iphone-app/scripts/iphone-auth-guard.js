/**
 * iPhone bundled portal — sign-out helper only.
 * Session redirect is handled by portal-boot.js (no auth bounce loop).
 */
(function iphoneAuthGuard() {
  function loginRedirectUrl() {
    return (
      window.ShiftSwiftSession?.unifiedNativeLoginUrl?.() ||
      window.ShiftSwiftSession?.resolveLoginUrl?.() ||
      "./index.html"
    );
  }

  async function signOut() {
    const loginUrl = loginRedirectUrl();
    if (window.ShiftSwiftSession?.signOut) {
      await window.ShiftSwiftSession.signOut(loginUrl);
      return;
    }
    await window.ShiftSwiftSession?.clearSession?.();
    window.location.replace(loginUrl);
  }

  function bindSignOut() {
    document.querySelectorAll("[data-sign-out]").forEach((el) => {
      if (el.dataset.sshrSignOutBound === "1") return;
      el.dataset.sshrSignOutBound = "1";
      el.addEventListener("click", (event) => {
        event.preventDefault();
        void signOut();
      });
    });
  }

  window.ShiftSwiftAuthGuard = { loginRedirectUrl, signOut, bindSignOut };

  bindSignOut();
  document.addEventListener("DOMContentLoaded", bindSignOut, { once: true });
  window.addEventListener("shiftswift:portal-ready", bindSignOut);
})();
