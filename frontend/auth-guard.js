(function () {
  async function guard() {
    if (window.ShiftSwiftSession?.hydrateNativeSession) {
      await window.ShiftSwiftSession.hydrateNativeSession();
    }
    if (!window.ShiftSwiftSession?.hasSession?.()) {
      window.location.replace(window.ShiftSwiftSession?.resolveLoginUrl?.() || "./native-app-login.html");
    }
  }

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
  window.location.href = window.ShiftSwiftSession?.resolveLoginUrl?.() || "./native-app-login.html";
}

document.querySelectorAll("[data-sign-out]").forEach((el) => {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    signOut();
  });
});
