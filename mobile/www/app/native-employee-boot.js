/** Bundled employee portal — hydrate session, load profile, then feature scripts. */
(function initBundledEmployeeBoot() {
  function isEmployeePortalPage() {
    const href = String(window.location.href || "");
    const path = String(window.location.pathname || "");
    return /employee\.html/i.test(href) || /employee\.html/i.test(path);
  }

  function isNativeBundledEmployee() {
    if (!isEmployeePortalPage()) return false;
    if (window.Capacitor?.isNativePlatform?.()) return true;
    return /localhost/i.test(String(window.location.href || ""));
  }

  if (!isNativeBundledEmployee()) return;

  window.__SSHR_BUNDLED_NATIVE_BOOT = true;
  try {
    localStorage.setItem("sshrUnifiedNativeApp", "1");
  } catch {
    /* ignore */
  }

  const SCRIPTS = [
    "auth-guard.js",
    "portal-pwa-stability.js",
    "employee-pwa.js",
    "native-geolocation.js",
    "native-shift-alerts.js",
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
      const marker = `data-sshr-employee-boot="${file}"`;
      if (document.querySelector(`script[${marker}]`)) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = `./${file}?v=bundled`;
      script.async = false;
      script.setAttribute("data-sshr-employee-boot", file);
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${file}`));
      document.head.appendChild(script);
    });
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((resolve) => window.setTimeout(() => resolve(null), ms)),
    ]);
  }

  function usernameLabel(username) {
    const local = String(username || "").split("@")[0] || String(username || "");
    const cleaned = local.replace(/\d+$/, "") || local || "Employee";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  function applyIdentityToDom(user) {
    const displayNameEl = document.getElementById("employee-display-name");
    const welcome = document.getElementById("employee-welcome");
    const employerHeader = document.getElementById("topbar-employer-name");
    const employerSubtitle = document.getElementById("mobile-employer-subtitle");

    const displayName =
      user?.display_name ||
      localStorage.getItem("employeeDisplayName") ||
      localStorage.getItem("employeeFirstName") ||
      usernameLabel(user?.username || localStorage.getItem("employeeUsername"));
    const employer = user?.employer_name || "Your employer";

    if (displayNameEl) displayNameEl.textContent = displayName;
    if (welcome) welcome.textContent = `${displayName} · ${employer}`;
    if (employerHeader && user?.employer_name) employerHeader.textContent = user.employer_name;
    if (employerSubtitle && user?.employer_name) employerSubtitle.textContent = user.employer_name;
    window.EmployeeMobile?.refreshGreeting?.();
  }

  function hydrateEmployeeChrome() {
    if (!window.AdminIcons) return;
    const iconClass = (el) => {
      if (el.classList.contains("employee-topbar-alerts-btn__icon")) return "employee-topbar-alerts-btn__svg";
      if (el.classList.contains("employee-alerts-banner__icon")) return "employee-alerts-banner__svg";
      if (el.classList.contains("employee-quick-btn__icon")) return "employee-quick-btn__svg";
      return "employee-home-card__svg";
    };
    document.querySelectorAll("[data-icon]").forEach((el) => {
      const name = el.getAttribute("data-icon");
      if (name) el.innerHTML = window.AdminIcons.svg(name, iconClass(el));
    });
    document.querySelectorAll(".employee-quick-btn__icon").forEach((el, index) => {
      if (el.innerHTML.trim()) return;
      const name = index === 0 ? "clock" : "calendar";
      el.innerHTML = window.AdminIcons.svg(name, "employee-quick-btn__svg");
    });
    document.querySelectorAll("#mobile-tab-bar [data-tab-icon]").forEach((btn) => {
      const wrap = btn.querySelector(".mobile-tab__icon-wrap");
      const name = btn.getAttribute("data-tab-icon");
      if (wrap && name) wrap.innerHTML = window.AdminIcons.svg(name, "mobile-tab__icon");
    });
  }

  async function prepareSession() {
    window.ShiftSwiftNativeApiFetch?.boot?.();
    const session = window.ShiftSwiftSession;
    if (!session) return false;
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

  async function loadProfileFromApi() {
    const session = window.ShiftSwiftSession;
    if (!session?.hasSession?.()) return null;
    try {
      const response = await session.fetchWithAuth(
        "/auth/verify",
        {},
        {
          apiBase: session.getApiBase(),
          loginUrl: session.unifiedNativeLoginUrl?.() || session.resolveLoginUrl?.(),
          forceLogoutOn401: false,
        },
      );
      if (!response.ok) return null;
      const user = await response.json();
      if (user?.username) localStorage.setItem("employeeUsername", user.username);
      if (user?.tenant_id != null) localStorage.setItem("tenantId", String(user.tenant_id));
      if (user?.display_name) localStorage.setItem("employeeDisplayName", user.display_name);
      if (user?.first_name) localStorage.setItem("employeeFirstName", user.first_name);
      applyIdentityToDom(user);
      window.dispatchEvent(new CustomEvent("employee:profile-loaded", { detail: { user } }));
      return user;
    } catch {
      return null;
    }
  }

  function markSessionReady() {
    window.__SSHR_NATIVE_SESSION_READY = true;
    window.dispatchEvent(new CustomEvent("shiftswift:native-session-ready"));
  }

  function unlockPortalUi() {
    const root = document.documentElement;
    root.classList.add("portal-pwa-shell", "portal-touch-polish");
    if (document.getElementById("mobile-tab-bar")) {
      root.classList.add("portal-mobile-shell");
    }
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
        console.error("Employee script load failed:", file, error);
      }
    }
  }

  const PRIORITY_SCRIPTS = [
    "portal-pwa-stability.js",
    "app-icons.js",
    "admin-icons.js",
    "mobile-shell.js",
    "employee-mobile.js",
    "employee.js",
  ];

  const DEFERRED_SCRIPTS = SCRIPTS.filter((file) => !PRIORITY_SCRIPTS.includes(file));

  async function boot() {
    hideSplash();
    try {
      localStorage.setItem("sshrUnifiedNativeApp", "1");
    } catch {
      /* ignore */
    }

    window.ShiftSwiftSession?.consumeNativeSessionHandoff?.();

    const hasSession = await prepareSession();
    await new Promise((resolve) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      } else {
        resolve();
      }
    });

    if (!hasSession) {
      applyIdentityToDom(null);
      const loginUrl =
        window.ShiftSwiftSession?.unifiedNativeLoginUrl?.() ||
        window.ShiftSwiftSession?.resolveLoginUrl?.() ||
        "./index.html";
      window.location.replace(loginUrl);
      return;
    }

    applyIdentityToDom(null);
    markSessionReady();
    unlockPortalUi();
    clearLoadingPlaceholders();

    await loadScripts(PRIORITY_SCRIPTS);
    window.EmployeeMobile?.init?.();
    void withTimeout(loadProfileFromApi(), 8000).then(() => applyIdentityToDom(null));
    void loadScripts(DEFERRED_SCRIPTS).then(() => {
      hydrateEmployeeChrome();
      window.dispatchEvent(new CustomEvent("employee:profile-retry"));
    });
  }

  void boot();
})();
