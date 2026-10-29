(function () {
  const STYLE_ID = "admin-impersonation-styles";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .admin-impersonation-banner {
        position: sticky;
        top: 0;
        z-index: 1000;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        justify-content: space-between;
        padding: 0.65rem 1rem;
        background: #1a2332;
        color: #fff;
        border-bottom: 3px solid #d4a017;
        font-size: 0.9rem;
      }
      .admin-impersonation-banner strong { color: #f3df9a; }
      .admin-impersonation-banner button {
        border: 1px solid rgba(255,255,255,0.35);
        background: transparent;
        color: #fff;
        border-radius: 999px;
        padding: 0.35rem 0.85rem;
        cursor: pointer;
        font: inherit;
      }
    `;
    document.head.appendChild(style);
  }

  function getApiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    return localStorage.getItem("apiBaseUrl") || "http://localhost:3000";
  }

  function readStoredImpersonation() {
    try {
      return JSON.parse(sessionStorage.getItem("impersonationActive") || "null");
    } catch {
      return null;
    }
  }

  function restoreMasterSession() {
    if (window.ShiftSwiftMasterSession?.restoreMasterReturnSession?.()) {
      window.location.href = "./master.html";
      return;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem("masterImpersonationReturn") || "null");
      if (!saved?.token) {
        window.location.href = "./ops-9x7k2.html";
        return;
      }
      localStorage.setItem("token", saved.token);
      if (saved.refreshToken) localStorage.setItem("refreshToken", saved.refreshToken);
      else localStorage.removeItem("refreshToken");
      localStorage.setItem("userRole", saved.userRole || "admin");
      if (saved.tenantId) localStorage.setItem("tenantId", saved.tenantId);
      if (saved.masterTenantId) localStorage.setItem("masterTenantId", saved.masterTenantId);
    } catch {
      /* fall through */
    }
    sessionStorage.removeItem("impersonationActive");
    sessionStorage.removeItem("masterImpersonationReturn");
    window.location.href = "./master.html";
  }

  function showBanner(info) {
    if (document.getElementById("admin-impersonation-banner")) return;

    const banner = document.createElement("div");
    banner.id = "admin-impersonation-banner";
    banner.className = "admin-impersonation-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML = `
      <div>
        <strong>Master impersonation</strong> — viewing <strong>${escapeHtml(
          info.tenantName || "tenant"
        )}</strong>
        as platform support. All actions are logged.
      </div>
      <button type="button" id="admin-exit-impersonation">Exit to master console</button>
    `;
    document.body.prepend(banner);
    document.getElementById("admin-exit-impersonation")?.addEventListener("click", restoreMasterSession);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function bootstrap() {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      localStorage.setItem("token", urlToken);
      const clean = window.location.pathname + (window.location.hash || "");
      window.history.replaceState({}, "", clean);
    }

    const stored = readStoredImpersonation();
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const response =
        window.ShiftSwiftSession?.fetchWithAuth
          ? await window.ShiftSwiftSession.fetchWithAuth("/auth/verify", {}, { forceLogoutOn401: false })
          : await (window.ShiftSwiftNativeApiFetch?.nativeAwareFetch || fetch)(
              `${getApiBase()}/auth/verify`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
      if (!response.ok) return;
      const user = await response.json();
      if (!user.impersonating && !stored) return;

      showBanner({
        tenantName:
          stored?.tenantName ||
          localStorage.getItem("businessName") ||
          `Tenant ${user.tenant_id || ""}`,
        impersonatedBy: user.impersonated_by || stored?.impersonatedBy,
      });
    } catch {
      if (stored) {
        showBanner({ tenantName: stored.tenantName, impersonatedBy: stored.impersonatedBy });
      }
    }
  }

  bootstrap();
})();
