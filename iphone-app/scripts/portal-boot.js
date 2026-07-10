/**
 * iPhone app portal boot — hydrate session, load scripts in order, fetch profile.
 * Bundled App://localhost only. No production URL hijacks.
 */
(function iphonePortalBoot() {
  const SCRIPTS = [
    "auth-guard.js",
    "portal-pwa-stability.js",
    "employee-pwa.js",
    "app-icons.js",
    "native-geolocation.js",
    "native-shift-alerts.js",
    "native-remote-push.js",
    "push-notifications.js",
    "mobile-shell.js",
    "mobile-tables.js",
    "admin-icons.js",
    "employee-mobile.js",
    "action-feedback.js",
    "employee.js",
    "employee-push-alerts.js",
    "employee-time-punch.js",
    "employee-timesheet.js",
    "employee-rota.js",
    "employee-shift-reminders.js",
    "employee-documents.js",
    "employee-notes.js",
    "employee-security.js",
    "employee-leave.js",
    "employee-my-details.js",
  ];

  function isEmployeePage() {
    return /employee\.html/i.test(String(window.location.pathname || window.location.href || ""));
  }

  if (!isEmployeePage()) return;

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
      script.src = `./${file}?v=iphone`;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(file));
      document.head.appendChild(script);
    });
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((resolve) => window.setTimeout(() => resolve(null), ms)),
    ]);
  }

  function nameFromEmail(email) {
    const local = String(email || "").split("@")[0] || "Employee";
    const cleaned = local.replace(/\d+$/, "") || local;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  function paintIdentity(user) {
    const displayNameEl = document.getElementById("employee-display-name");
    const welcome = document.getElementById("employee-welcome");
    const employerHeader = document.getElementById("topbar-employer-name");
    const employerSubtitle = document.getElementById("mobile-employer-subtitle");

    const label =
      user?.display_name ||
      localStorage.getItem("employeeDisplayName") ||
      localStorage.getItem("employeeFirstName") ||
      nameFromEmail(user?.username || localStorage.getItem("employeeUsername"));
    const employer = user?.employer_name || "Your employer";

    if (displayNameEl) displayNameEl.textContent = label;
    if (welcome) welcome.textContent = `${label} · ${employer}`;
    if (employerHeader && user?.employer_name) employerHeader.textContent = user.employer_name;
    if (employerSubtitle && user?.employer_name) employerSubtitle.textContent = user.employer_name;
    window.EmployeeMobile?.refreshGreeting?.();
  }

  async function ensureSession() {
    window.ShiftSwiftNativeApiFetch?.boot?.();
    const session = window.ShiftSwiftSession;
    if (!session) throw new Error("Session module missing");
    if (session.waitForNativeSession) {
      return session.waitForNativeSession({ maxMs: 10000 });
    }
    await session.hydrateNativeSession?.({ force: true });
    if (!session.hasSession?.() && session.getRefreshToken?.()) {
      await session.refreshAccessToken?.();
      await session.hydrateNativeSession?.({ force: true });
    }
    return Boolean(session.hasSession?.());
  }

  async function fetchProfile() {
    const session = window.ShiftSwiftSession;
    if (!session?.hasSession?.()) return null;
    try {
      const res = await session.fetchWithAuth(
        "/auth/verify",
        {},
        {
          apiBase: session.getApiBase(),
          loginUrl: session.resolveLoginUrl?.(),
          forceLogoutOn401: false,
        },
      );
      if (!res.ok) return null;
      const user = await res.json();
      if (user?.username) localStorage.setItem("employeeUsername", user.username);
      if (user?.tenant_id != null) localStorage.setItem("tenantId", String(user.tenant_id));
      if (user?.display_name) localStorage.setItem("employeeDisplayName", user.display_name);
      if (user?.first_name) localStorage.setItem("employeeFirstName", user.first_name);
      paintIdentity(user);
      window.dispatchEvent(new CustomEvent("employee:profile-loaded", { detail: { user } }));
      return user;
    } catch {
      return null;
    }
  }

  function paintIcons() {
    if (!window.AdminIcons) return;
    document.querySelectorAll("[data-icon]").forEach((el) => {
      const name = el.getAttribute("data-icon");
      if (name) el.innerHTML = window.AdminIcons.svg(name, "employee-home-card__svg");
    });
    document.querySelectorAll("#mobile-tab-bar [data-tab-icon]").forEach((btn) => {
      const wrap = btn.querySelector(".mobile-tab__icon-wrap");
      const name = btn.getAttribute("data-tab-icon");
      if (wrap && name) wrap.innerHTML = window.AdminIcons.svg(name, "mobile-tab__icon");
    });
  }

  function markSessionReady() {
    window.__SSHR_NATIVE_SESSION_READY = true;
    window.dispatchEvent(new CustomEvent("shiftswift:native-session-ready"));
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
    document.body.classList.remove("portal-startup-pending", "native-startup-active");
    document.body.classList.add("portal-startup-ready");
    hideSplash();
    window.__SSHR_PORTAL_READY = true;
    window.ShiftSwiftNativeApp?.dismissStartupLoader?.();
    window.dispatchEvent(new CustomEvent("shiftswift:portal-ready"));
  }

  function clearLoadingPlaceholders() {
    document.querySelectorAll("[id$='-summary'], .employee-leave-placeholder, .employee-timesheet-placeholder, .employee-shifts-placeholder, #punch-work-state-label").forEach((el) => {
      const text = String(el.textContent || "").trim();
      if (text === "Loading…" || text === "…") el.textContent = "—";
    });
  }

  async function loadScripts(files) {
    for (const file of files) {
      try {
        await loadScript(file);
      } catch (error) {
        console.error("Script failed:", file, error);
      }
    }
  }

  const PRIORITY_SCRIPTS = [
    "portal-pwa-stability.js",
    "app-icons.js",
    "admin-icons.js",
    "mobile-shell.js",
    "employee-mobile.js",
    "auth-guard.js",
    "employee.js",
  ];

  function wirePortalChrome() {
    if (window.MobileShell) {
      const sidebar = window.MobileShell.initSidebar();
      window.EmployeeMobile?.init?.();
      window.MobileShell.initHashSections({
        defaultSection: "overview",
        sectionEvent: "employee:section",
        sidebar,
      });
    } else {
      window.EmployeeMobile?.init?.();
    }
    window.ShiftSwiftAuthGuard?.bindSignOut?.();
    window.__SSHR_PORTAL_HANDLERS_READY = true;
    window.dispatchEvent(new CustomEvent("shiftswift:portal-handlers-ready"));
  }

  const DEFERRED_SCRIPTS = SCRIPTS.filter((file) => !PRIORITY_SCRIPTS.includes(file));

  async function boot() {
    hideSplash();
    applyPortalShellClasses();
    try {
      localStorage.setItem("sshrUnifiedNativeApp", "1");
    } catch {
      /* ignore */
    }

    const hasSession = await ensureSession();
    paintIdentity(null);

    if (!hasSession) {
      hideSplash();
      const loginUrl =
        window.ShiftSwiftSession?.unifiedNativeLoginUrl?.() ||
        window.ShiftSwiftSession?.resolveLoginUrl?.() ||
        "./index.html";
      const notice = document.createElement("div");
      notice.setAttribute("role", "alert");
      notice.style.cssText =
        "position:fixed;inset:0;z-index:99999;background:#0f6e56;color:#fff;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;font:17px/1.45 system-ui,-apple-system,sans-serif";
      notice.innerHTML =
        "<div><p style='margin:0 0 12px'>Your sign-in could not be opened on this page.</p>" +
        "<p style='margin:0;opacity:0.9;font-size:15px'><a href='./index.html' style='color:#fff;font-weight:600'>Return to sign in</a></p></div>";
      document.body.appendChild(notice);
      window.setTimeout(() => window.location.replace(loginUrl), 8000);
      return;
    }

    markSessionReady();
    window.ShiftSwiftNativeApiFetch?.bootWhenReady?.();
    unlockPortalUi();
    clearLoadingPlaceholders();

    await loadScripts(PRIORITY_SCRIPTS);
    wirePortalChrome();
    void withTimeout(fetchProfile(), 8000).then(() => paintIdentity(null));
    void loadScripts(DEFERRED_SCRIPTS).then(() => {
      paintIcons();
      window.ShiftSwiftNativeApiFetch?.bootWhenReady?.();
      window.ShiftSwiftNativeApiFetch?.retryPortalData?.();
      window.dispatchEvent(new CustomEvent("employee:profile-retry"));
      try {
        if (localStorage.getItem("sshrNativeShiftAlerts") === "1") {
          void window.ShiftSwiftNativeRemotePush?.registerForRemotePush?.();
        } else {
          void window.ShiftSwiftNativeRemotePush?.syncStoredToken?.();
        }
      } catch {
        /* ignore */
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  } else {
    void boot();
  }
})();
