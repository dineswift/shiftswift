(function () {
  const provisionPlans = [];
  const params = new URLSearchParams(window.location.search);
  const tenantId = Number(params.get("id"));
  const errorEl = document.getElementById("master-tenant-load-error");

  function apiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    return localStorage.getItem("apiBaseUrl") || "http://localhost:3000";
  }

  function parseApiError(data, fallback = "Request failed") {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((item) => (typeof item === "string" ? item : item.msg || item.message || String(item)))
        .join("; ");
    }
    if (typeof data.message === "string") return data.message;
    return fallback;
  }

  async function apiRequest(path, options = {}) {
    let response;
    try {
      response = await window.ShiftSwiftSession.fetchWithAuth(path, options, {
        apiBase: apiBase(),
        loginUrl: "./ops-9x7k2.html",
        forceLogoutOn401: false,
      });
    } catch (error) {
      const message = error?.message || "Network request failed";
      if (message === "Load failed" || message === "Failed to fetch") {
        throw new Error("Could not reach the API — check your connection and try again.");
      }
      throw error;
    }

    if (response.status === 401) {
      window.ShiftSwiftMasterSession?.redirectToMasterLogin?.("Your master session expired. Sign in again.");
      throw new Error("Session expired. Sign in again.");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = parseApiError(data);
      if (response.status === 403 && window.ShiftSwiftMasterSession?.isMasterAuthError?.(message)) {
        window.ShiftSwiftMasterSession.redirectToMasterLogin(message);
      }
      throw new Error(message);
    }
    return data;
  }

  const apiGet = (path) => apiRequest(path);
  const apiPost = (path, body = {}) => apiRequest(path, { method: "POST", body: JSON.stringify(body) });
  const apiPut = (path, body) => apiRequest(path, { method: "PUT", body: JSON.stringify(body) });

  function showError(message) {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = message;
    }
    document.querySelector(".master-tenant-page__card")?.setAttribute("hidden", "");
  }

  async function loadTenant() {
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      showError("Missing or invalid tenant ID. Close this window and open a tenant from the master console.");
      return;
    }
    if (errorEl) errorEl.hidden = true;
    document.querySelector(".master-tenant-page__card")?.removeAttribute("hidden");
    try {
      const data = await apiGet(`/master/tenants/${tenantId}`);
      document.title = `${data.tenant.name} | ShiftSwift OPS`;
      window.ShiftSwiftMasterTenantDetail.render(data.tenant, {
        apiGet,
        apiPost,
        apiPut,
        provisionPlans,
        refresh: loadTenant,
        onDeleted: () => {
          window.opener?.postMessage?.({ type: "master-tenant-deleted", tenantId }, window.location.origin);
          window.close();
          setTimeout(() => {
            window.location.replace("./master.html#tenants");
          }, 150);
        },
      });
    } catch (error) {
      showError(error.message || "Could not load tenant.");
    }
  }

  async function bootstrap() {
    try {
      const verify = await apiGet("/auth/verify");
      const session = window.ShiftSwiftMasterSession;
      if (session && !session.isMasterVerify(verify)) {
        session.syncLocalRoleFromVerify(verify);
        session.redirectToMasterLogin(
          verify.impersonating
            ? "Exit impersonation before managing tenants."
            : "Your master session was replaced. Sign in again.",
        );
        return;
      }
      session?.syncLocalRoleFromVerify?.(verify);
    } catch {
      window.location.replace("./ops-9x7k2.html");
      return;
    }
    await loadTenant();
  }

  bootstrap();
})();
