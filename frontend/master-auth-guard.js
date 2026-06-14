(function () {
  const session = window.ShiftSwiftMasterSession;
  const masterId = session?.masterTenantId?.() || localStorage.getItem("masterTenantId") || "999";

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
  const role = localStorage.getItem("userRole");

  if (!token || role !== "admin") {
    window.location.replace("./ops-9x7k2.html");
    return;
  }

  const tenantId = localStorage.getItem("tenantId");
  if (tenantId !== masterId) {
    window.location.replace("./ops-9x7k2.html");
  }
})();

function masterSignOut() {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("tenantId");
  localStorage.removeItem("masterTenantId");
  localStorage.removeItem("userRole");
  window.location.href = "./ops-9x7k2.html";
}

document.querySelectorAll("[data-master-sign-out]").forEach((el) => {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    masterSignOut();
  });
});
