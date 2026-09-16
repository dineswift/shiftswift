(function () {
  const session = window.ShiftSwiftMasterSession;
  const masterId = session?.masterTenantId?.() || localStorage.getItem("masterTenantId") || "999";

  function masterLoginUrl() {
    return (
      window.ShiftSwiftSession?.resolveLoginUrl?.() ||
      window.ShiftSwiftNativeApp?.unifiedNativeLoginUrl?.() ||
      "./native-app-login.html"
    );
  }

  if (sessionStorage.getItem("impersonationActive")) {
    if (session?.restoreMasterReturnSession?.()) {
      /* Restored platform token after returning from impersonation. */
    } else {
      session?.redirectToMasterLogin?.(
        "Exit the customer impersonation session before using the master console.",
      );
      return;
    }
  }

  const token = localStorage.getItem("token");
  const refresh = localStorage.getItem("refreshToken");
  const role = localStorage.getItem("userRole");

  if ((!token && !refresh) || role !== "admin") {
    window.location.replace(masterLoginUrl());
    return;
  }

  const tenantId = localStorage.getItem("tenantId");
  if (tenantId !== masterId) {
    window.location.replace(masterLoginUrl());
  }
})();

function masterSignOut() {
  const loginUrl =
    window.ShiftSwiftSession?.resolveLoginUrl?.() ||
    window.ShiftSwiftNativeApp?.unifiedNativeLoginUrl?.() ||
    "./native-app-login.html";
  if (window.ShiftSwiftSession?.signOut) {
    void window.ShiftSwiftSession.signOut(loginUrl);
    return;
  }
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("tenantId");
  localStorage.removeItem("masterTenantId");
  localStorage.removeItem("userRole");
  window.location.replace(loginUrl);
}

document.querySelectorAll("[data-master-sign-out]").forEach((el) => {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    masterSignOut();
  });
});
