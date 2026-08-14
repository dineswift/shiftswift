/**
 * iPhone app admin portal boot — mirrors employee portal boot (session, verify, then data).
 * Bundled App://localhost only.
 */
(function iphoneAdminPortalBoot() {
  const BUILD = "85";

  const SCRIPTS = [
    "auth-guard.js",
    "portal-pwa-stability.js",
    "admin-pwa.js",
    "native-shift-alerts.js",
    "native-remote-push.js",
    "mobile-shell.js",
    "mobile-tables.js",
    "admin-icons.js",
    "admin-mobile.js",
    "admin-compliance-mobile.js",
    "action-feedback.js",
    "admin-shared.js",
    "admin-settings.js",
    "admin-workspace.js",
    "admin-address-picker.js",
    "admin-documents.js",
    "admin-employees.js",
    "admin-recruitment.js",
    "admin-promotions.js",
    "admin-crm.js",
    "admin-compliance.js",
    "admin-absence.js",
    "admin-rtw.js",
    "admin-grievance.js",
    "admin-disciplinary.js",
    "admin-offboarding.js",
    "admin-templates.js",
    "admin-global-documents.js",
    "native-geolocation.js",
    "admin-time-punch.js",
    "admin-rota.js",
    "admin-leave.js",
    "admin-profile-changes.js",
    "app.js",
    "contracts.js",
    "employment-contracts.js",
  ];

  const PRIORITY_SCRIPTS = [
    "portal-pwa-stability.js",
    "admin-icons.js",
    "mobile-shell.js",
    "admin-mobile.js",
    "admin-compliance-mobile.js",
    "auth-guard.js",
    "admin-shared.js",
    "admin-workspace.js",
    "admin-settings.js",
    "admin-employees.js",
    "admin-compliance.js",
    "admin-rtw.js",
    "admin-absence.js",
    "admin-rota.js",
    "app.js",
  ];

  function isAdminPage() {
    return /admin\.html/i.test(String(window.location.pathname || window.location.href || ""));
  }

  function isNative() {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  }

  function isBundledAdminShell() {
    try {
      const href = window.location.href;
      return /\/\/localhost\//i.test(href) || href.startsWith("capacitor://");
    } catch {
      return false;
    }
  }

  if (!isAdminPage() || !isNative() || !isBundledAdminShell()) return;

  window.__SSHR_BUNDLED_NATIVE_BOOT = true;

  function hideSplash() {
    try {
      window.Capacitor?.Plugins?.SplashScreen?.hide?.();
      window.ShiftSwiftNativeApp?.hideSplash?.();
    } catch {
      /* ignore */
    }
  }

  function loadScript(file) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `./${file}?v=iphone-admin-${BUILD}`;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(file));
      document.head.appendChild(script);
    });
  }

  async function loadScripts(files) {
    for (const file of files) {
      let loaded = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await loadScript(file);
          loaded = true;
          break;
        } catch (error) {
          console.error(`Admin script failed (${file}) attempt ${attempt + 1}:`, error);
        }
      }
      if (!loaded) {
        window.__SSHR_ADMIN_SCRIPT_ERRORS = window.__SSHR_ADMIN_SCRIPT_ERRORS || [];
        window.__SSHR_ADMIN_SCRIPT_ERRORS.push(file);
      }
    }
  }


  function applyPortalShellClasses() {
    const root = document.documentElement;
    root.classList.add("native-app", "capacitor-native", "iphone-app", "portal-pwa-shell", "portal-touch-polish");
    window.ShiftSwiftNativeLayout?.sync?.();
    const tablet = root.classList.contains("native-tablet");
    if (!tablet && document.getElementById("mobile-tab-bar")) {
      root.classList.add("portal-mobile-shell");
    } else {
      root.classList.remove("portal-mobile-shell");
    }
  }

  function unlockPortalUi() {
    applyPortalShellClasses();
    document.documentElement.classList.remove("native-startup-active");
    document.body?.classList.remove("portal-startup-pending", "native-startup-active", "no-scroll");
    document.body?.classList.add("portal-startup-ready");
    document.getElementById("native-startup-loader")?.remove();
    hideSplash();
    window.__SSHR_PORTAL_READY = true;
    window.ShiftSwiftNativeApp?.dismissStartupLoader?.();
    window.dispatchEvent(new CustomEvent("shiftswift:portal-ready"));
    const clockEnabled = localStorage.getItem("adminTimeClockEnabled") === "true";
    window.AdminMobile?.finishStartup?.(clockEnabled);
  }

  async function ensureSession() {
    window.ShiftSwiftNativeApiFetch?.boot?.();
    window.ShiftSwiftSession?.consumeNativeSessionHandoff?.();
    const session = window.ShiftSwiftSession;
    if (!session) throw new Error("Session module missing");

    if (session.hasSession?.() || localStorage.getItem("token")) {
      await session.hydrateNativeSession?.({ force: true });
      if (session.hasSession?.()) return true;
    }

    const postLogin = sessionStorage.getItem("sshrPostLoginTransition") === "1";
    const maxMs = postLogin ? 2500 : 8000;
    if (session.waitForNativeSession) {
      await session.waitForNativeSession({ maxMs });
    } else {
      await session.hydrateNativeSession?.({ force: true });
    }
    if (!session.hasSession?.() && session.getRefreshToken?.()) {
      await session.refreshAccessToken?.();
      await session.hydrateNativeSession?.({ force: true });
    }
    return Boolean(session.hasSession?.());
  }

  async function verifyAdminProfile() {
    if (window.Admin?.verifyAdminSession) {
      try {
        return await window.Admin.verifyAdminSession(true);
      } catch (error) {
        console.error("Admin verify failed:", error);
        return null;
      }
    }
    const session = window.ShiftSwiftSession;
    if (!session?.hasSession?.()) return null;
    try {
      window.ShiftSwiftNativeApiFetch?.boot?.();
      const res = await session.fetchWithAuth(
        "/auth/verify",
        {},
        {
          apiBase: session.getApiBase?.() || window.ShiftSwiftBrand?.getApiBase?.(),
          forceLogoutOn401: false,
        },
      );
      if (!res.ok) return null;
      const user = await res.json();
      if (user?.role === "employee") {
        window.location.replace(
          window.ShiftSwiftSession?.buildNativePortalRedirectUrl?.("employee.html") || "./employee.html",
        );
        return null;
      }
      window.Admin?.rememberVerifiedTenant?.(user?.tenant_id, user);
      if (user?.username) localStorage.setItem("adminUsername", user.username);
      if (user?.display_name) {
        localStorage.setItem("adminDisplayName", user.display_name);
        localStorage.setItem("adminFirstName", (user.display_name.split(/\s+/)[0] || user.display_name).trim());
      }
      await session.persistNativeSession?.();
      const mobileBusiness = document.getElementById("mobile-business-name");
      if (mobileBusiness && user?.employer_name) mobileBusiness.textContent = user.employer_name;
      window.AdminMobile?.refreshGreeting?.();
      try {
        sessionStorage.removeItem("sshrPostLoginTransition");
      } catch {
        /* ignore */
      }
      return user;
    } catch {
      return null;
    }
  }

  async function probeShiftSwiftHttp() {
    const cap = window.Capacitor;
    const out = [];
    try {
      if (cap?.registerPlugin) cap.registerPlugin("ShiftSwiftHttp");
    } catch {
      /* ignore */
    }
    out.push(`plugins=${Boolean(cap?.Plugins?.ShiftSwiftHttp)}`);
    const apiBase =
      window.ShiftSwiftSession?.getApiBase?.() ||
      window.ShiftSwiftBrand?.getApiBase?.() ||
      "https://api.shiftswifthr.co.uk";
    const token = localStorage.getItem("token") || "";
    const tenantId = localStorage.getItem("tenantId") || "";
    const authHeaders = {};
    if (token) authHeaders.Authorization = `Bearer ${token}`;
    if (tenantId) authHeaders["X-Tenant-Id"] = String(tenantId);

    async function hit(label, path, withAuth) {
      try {
        const res = await cap.nativePromise("ShiftSwiftHttp", "request", {
          url: `${apiBase}${path}`,
          method: "GET",
          headers: withAuth ? authHeaders : {},
          connectTimeout: 12000,
          readTimeout: 12000,
        });
        out.push(`${label}=${res?.status || "?"}`);
      } catch (error) {
        out.push(`${label}Err=${String(error?.message || error || "fail").slice(0, 70)}`);
      }
    }

    await hit("health", "/health", false);
    await hit("healthAuth", "/health", true);
    await hit("overview", "/admin/overview", true);
    await hit("week", "/admin/rota/weeks/2026-07-13", true);
    await hit("weekQ", "/admin/rota/weeks/2026-07-13?include_attendance=false", true);

    window.__SSHR_HTTP_PROBE = out.join(" · ");
    console.info("[SSHR HTTP probe]", window.__SSHR_HTTP_PROBE);
    return window.__SSHR_HTTP_PROBE;
  }

  function showBootError(message) {
    const grid = document.getElementById("overview-metrics");
    if (!grid) return;
    const probe = window.__SSHR_HTTP_PROBE ? `<p class="muted" style="font-size:12px">${window.__SSHR_HTTP_PROBE}</p>` : "";
    grid.innerHTML = `<div class="overview-error"><p class="muted">${message}</p>${probe}<button type="button" class="btn outline btn-sm" id="admin-boot-retry-btn">Retry</button></div>`;
    document.getElementById("admin-boot-retry-btn")?.addEventListener("click", () => {
      void loadPortalData(true).then(() => refreshActiveSection());
    });
  }

  async function unregisterNativeServiceWorkers() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch {
      /* ignore */
    }
  }

  function wireAdminChrome() {
    const sidebar = window.MobileShell?.initSidebar?.();
    window.AdminMobile?.init?.();
    const hashCtl = window.MobileShell?.initHashSections?.({
      defaultSection: "overview",
      sectionEvent: "admin:section",
      sidebar,
      resolveSection: (hash) => window.Admin?.resolveSectionFromHash?.(hash),
    });
    if (hashCtl?.routeFromHash) {
      window.Admin.routeFromHash = hashCtl.routeFromHash;
    }
    window.__SSHR_HASH_ROUTING_READY = true;
    window.ShiftSwiftAuthGuard?.bindSignOut?.();
    window.__SSHR_PORTAL_HANDLERS_READY = true;
    window.dispatchEvent(new CustomEvent("shiftswift:portal-handlers-ready"));
  }

  function refreshActiveSection() {
    const section =
      window.Admin?.resolveSectionFromHash?.(window.location.hash) ||
      window.location.hash.replace("#", "").split("/")[0] ||
      "overview";
    if (section === "employees") {
      void window.ShiftSwiftAdminEmployees?.initEmployeesSection?.();
      return;
    }
    if (section === "settings") {
      window.AdminSettings?.bootstrapSettingsSection?.();
      return;
    }
    if (section === "overview") {
      void window.ShiftSwiftAdminWorkspace?.loadOverview?.({ force: true });
      return;
    }
    if (section === "rota") {
      window.dispatchEvent(new CustomEvent("admin:section", { detail: { section: "rota" } }));
      window.dispatchEvent(new CustomEvent("admin:rota-mobile-open"));
      return;
    }
    if (section === "compliance" || String(section).startsWith("compliance")) {
      window.dispatchEvent(new CustomEvent("admin:compliance-refresh"));
    }
    window.dispatchEvent(new CustomEvent("admin:section", { detail: { section } }));
  }

  async function loadPortalData(force = false) {
    window.ShiftSwiftNativeApiFetch?.boot?.();
    await window.ShiftSwiftSession?.hydrateNativeSession?.({ force: Boolean(force) });
    if (window.ShiftSwiftSession?.refreshAccessToken) {
      await window.ShiftSwiftSession.refreshAccessToken();
      await window.ShiftSwiftSession?.hydrateNativeSession?.({ force: true });
    }
    await verifyAdminProfile();
    const verifiedTenant = sessionStorage.getItem("sshrVerifiedTenantId");
    if (!verifiedTenant) {
      showBootError("Could not verify your business workspace. Check your connection and try again.");
    }
    await window.Admin?.fetchAdminOverview?.(force).catch(() => null);
    await window.ShiftSwiftAdminWorkspace?.loadOverview?.({ force }).catch(() => null);
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    await window.Admin?.fetchEmployeesList?.({ force: false }).catch(() => null);
    window.dispatchEvent(new CustomEvent("admin:employees-cache-ready"));
    if (!window.__SSHR_BUNDLED_NATIVE_BOOT) {
      await window.Admin?.loadFormOptions?.(force).catch(() => null);
    }
    if (window.Capacitor?.isNativePlatform?.() && !window.Admin?.peekEmployeesListCache?.()?.length) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      await window.Admin?.fetchEmployeesList?.({ force: true, background: true }).catch(() => null);
      window.dispatchEvent(new CustomEvent("admin:employees-cache-ready"));
    }
    window.Admin?.applyFeatureGates?.();
  }

  function finalizePortalReady() {
    window.__SSHR_ADMIN_DEFERRED_READY = true;
    window.dispatchEvent(new CustomEvent("admin:deferred-ready"));
    if (typeof window.Admin?.routeFromHash === "function") {
      window.Admin.routeFromHash();
    } else {
      window.dispatchEvent(new CustomEvent("admin:section", { detail: { section: "overview" } }));
    }
    window.dispatchEvent(new CustomEvent("admin:portal-native-retry"));
    window.dispatchEvent(new CustomEvent("admin:compliance-refresh"));
    refreshActiveSection();
  }

  function schedulePortalRetries() {
    [2500, 5500].forEach((delayMs) => {
      window.setTimeout(async () => {
        const section =
          window.Admin?.resolveSectionFromHash?.(window.location.hash) ||
          window.location.hash.replace("#", "").split("/")[0] ||
          "overview";
        const employeesLoaded = window.ShiftSwiftAdminEmployees?.getEmployeesCount?.() > 0;
        const overviewOk = Boolean(document.getElementById("overview-metrics")?.querySelector(".hr-stat-card"));
        const sectionPanel = document.getElementById(section);
        const rotaMessage = document.getElementById("rota-admin-message");
        const rotaFailed =
          section === "rota" &&
          (rotaMessage?.dataset?.type === "error" ||
            /could not load|cannot reach|business not set|sign in again/i.test(
              String(rotaMessage?.textContent || ""),
            ) ||
            !document.getElementById("rota-week-label")?.textContent?.trim());
        const sectionEmpty =
          sectionPanel?.classList.contains("admin-section--active") &&
          !sectionPanel?.querySelector(
            ".overview-error, .hr-stat-card, .data-table tbody tr, .lifecycle-employee-card, .edit-form",
          );
        if (employeesLoaded && overviewOk && !sectionEmpty && !rotaFailed) return;
        if (section === "rota" || rotaFailed) {
          window.dispatchEvent(new CustomEvent("admin:portal-native-retry"));
          window.dispatchEvent(new CustomEvent("admin:rota-mobile-open"));
          refreshActiveSection();
          return;
        }
        await loadPortalData(true);
        window.dispatchEvent(new CustomEvent("admin:portal-native-retry"));
        refreshActiveSection();
      }, delayMs);
    });
  }

  async function boot() {
    hideSplash();
    applyPortalShellClasses();
    unlockPortalUi();

    try {
      localStorage.setItem("sshrUnifiedNativeApp", "1");
      localStorage.setItem("apiBaseUrl", "https://api.shiftswifthr.co.uk");
      if (window.ShiftSwiftBrand?.urls) {
        window.ShiftSwiftBrand.urls.api = "https://api.shiftswifthr.co.uk";
      }
    } catch {
      /* ignore */
    }

    try {
      await unregisterNativeServiceWorkers();

      const hasSession = await ensureSession();
      if (!hasSession) {
        window.location.replace(
          window.ShiftSwiftNativeApp?.capacitorAssetUrl?.("business-login.html?source=native") ||
            window.ShiftSwiftSession?.resolveLoginUrl?.() ||
            "./business-login.html",
        );
        return;
      }
      await probeShiftSwiftHttp();

      window.__SSHR_NATIVE_SESSION_READY = true;
      window.dispatchEvent(new CustomEvent("shiftswift:native-session-ready"));
      window.ShiftSwiftNativeApiFetch?.boot?.();

      const overviewGrid = document.getElementById("overview-metrics");
      if (overviewGrid) {
        overviewGrid.innerHTML = '<p class="muted">Loading admin…</p>';
      }

      await loadScripts(PRIORITY_SCRIPTS);
      unlockPortalUi();
      wireAdminChrome();

      const remaining = SCRIPTS.filter((file) => !PRIORITY_SCRIPTS.includes(file));
      void loadScripts(remaining)
        .then(() => {
          try {
            void window.ShiftSwiftNativeRemotePush?.registerForRemotePush?.();
          } catch {
            /* ignore */
          }
        })
        .catch((error) => {
          console.error("Admin deferred scripts failed:", error);
        });

      await loadPortalData(true);
      finalizePortalReady();
      schedulePortalRetries();
    } catch (error) {
      console.error("Admin portal boot failed:", error);
      showBootError("Could not load admin. Check your connection and try again.");
    } finally {
      unlockPortalUi();
      hideSplash();
    }
  }

  window.ShiftSwiftAdminBoot = {
    verifyAdminProfile,
    loadPortalData,
    refreshActiveSection,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  } else {
    void boot();
  }
})();
