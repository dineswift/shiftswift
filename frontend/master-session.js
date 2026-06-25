(function (global) {
  function masterTenantId() {
    return localStorage.getItem("masterTenantId") || "999";
  }

  function readMasterReturnSession() {
    try {
      return JSON.parse(sessionStorage.getItem("masterImpersonationReturn") || "null");
    } catch {
      return null;
    }
  }

  function restoreMasterReturnSession() {
    const saved = readMasterReturnSession();
    if (!saved?.token) return false;
    localStorage.setItem("token", saved.token);
    if (saved.refreshToken) localStorage.setItem("refreshToken", saved.refreshToken);
    else localStorage.removeItem("refreshToken");
    localStorage.setItem("userRole", saved.userRole || "admin");
    if (saved.tenantId) localStorage.setItem("tenantId", saved.tenantId);
    if (saved.masterTenantId) localStorage.setItem("masterTenantId", saved.masterTenantId);
    sessionStorage.removeItem("impersonationActive");
    sessionStorage.removeItem("masterImpersonationReturn");
    return true;
  }

  function isMasterVerify(verify) {
    if (!verify || verify.impersonating) return false;
    return verify.role === "admin" && String(verify.tenant_id) === masterTenantId();
  }

  function syncLocalRoleFromVerify(verify) {
    if (!verify?.role) return;
    localStorage.setItem("userRole", verify.role);
    if (verify.tenant_id != null) localStorage.setItem("tenantId", String(verify.tenant_id));
    if (verify.role === "admin" && verify.tenant_id != null) {
      localStorage.setItem("masterTenantId", String(verify.tenant_id));
    }
  }

  function redirectToMasterLogin(reason) {
    if (reason) sessionStorage.setItem("masterLoginNotice", reason);
    const url =
      global.ShiftSwiftSession?.resolveLoginUrl?.() ||
      global.ShiftSwiftNativeApp?.unifiedNativeLoginUrl?.() ||
      "./native-app-login.html";
    window.location.replace(url);
  }

  function isMasterAuthError(message) {
    return /admin role required|master admin|platform master|impersonation/i.test(String(message || ""));
  }

  global.ShiftSwiftMasterSession = {
    masterTenantId,
    readMasterReturnSession,
    restoreMasterReturnSession,
    isMasterVerify,
    syncLocalRoleFromVerify,
    redirectToMasterLogin,
    isMasterAuthError,
  };
})(window);
