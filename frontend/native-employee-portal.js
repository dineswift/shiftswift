/** Native employee portal — unlock taps, route navigation, retry boot. */
(function initNativeEmployeePortal() {
  function isNativeEmployee() {
    try {
      if (!/employee\.html$/i.test(String(window.location.pathname || ""))) return false;
      if (window.__SSHR_BUNDLED_NATIVE_BOOT || window.__SSHR_PORTAL_GUARD) return true;
      if (document.documentElement.classList.contains("native-app")) return true;
      if (/shiftswifthr\.co\.uk/i.test(String(window.location.hostname || ""))) return true;
      return Boolean(window.Capacitor?.isNativePlatform?.());
    } catch {
      return false;
    }
  }

  function unlockUi() {
    try {
      document.documentElement.classList.remove("native-startup-active");
      if (document.body) {
        document.body.classList.remove("native-startup-active", "portal-startup-pending", "employee-gdpr-locked", "no-scroll");
        document.body.classList.add("portal-startup-ready");
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.left = "";
        document.body.style.right = "";
        document.body.style.width = "";
      }
      document.getElementById("native-startup-loader")?.remove();
      const gdpr = document.getElementById("employee-gdpr-modal");
      if (!gdpr || gdpr.hidden) {
        document.body?.classList.remove("employee-gdpr-locked");
      }
      const content = document.querySelector("main.content");
      if (content) {
        content.style.overflow = "";
        content.style.touchAction = "";
        content.style.pointerEvents = "";
      }
      window.Capacitor?.Plugins?.SplashScreen?.hide?.();
    } catch {
      /* ignore */
    }
  }

  function injectUnlockStyles() {
    if (document.getElementById("sshr-native-employee-unlock")) return;
    const style = document.createElement("style");
    style.id = "sshr-native-employee-unlock";
    style.textContent =
      "body.employee-portal .employee-app," +
      "body.employee-portal #mobile-tab-bar," +
      "body.employee-portal main.content," +
      "body.employee-portal button," +
      "body.employee-portal a," +
      "body.employee-portal .btn," +
      "html.native-app body.employee-portal .employee-app," +
      "html.native-app body.employee-portal #mobile-tab-bar," +
      "body.employee-portal.portal-startup-pending .app>main.content," +
      "body.employee-portal.portal-startup-pending #mobile-tab-bar," +
      "body.employee-portal.no-scroll main.content," +
      "html.native-startup-active body.employee-portal .employee-app," +
      "html.native-startup-active body.employee-portal #mobile-tab-bar{" +
      "pointer-events:auto!important;opacity:1!important;visibility:visible!important;" +
      "touch-action:manipulation!important}";
    (document.head || document.documentElement).appendChild(style);
  }

  function resolveTarget(event) {
    let el = event.target;
    if (!el || el === document.body || el === document.documentElement) {
      const x = event.clientX ?? event.pageX;
      const y = event.clientY ?? event.pageY;
      if (typeof x === "number" && typeof y === "number") {
        el = document.elementFromPoint(x, y);
      }
    }
    return el && el.closest ? el : null;
  }

  function routeNavigation(event) {
    unlockUi();
    const root = resolveTarget(event);
    if (!root) return;

    const tabBtn = root.closest("[data-mobile-tab]");
    if (tabBtn?.dataset?.mobileTab) {
      event.preventDefault();
      document.body.classList.remove("employee-mobile-detail");
      if (window.EmployeeMobile?.setTab) {
        window.EmployeeMobile.setTab(tabBtn.dataset.mobileTab);
        return;
      }
      const map = { home: "overview", shifts: "my-shifts", clock: "time-clock", leave: "leave" };
      const section = map[tabBtn.dataset.mobileTab];
      if (section) window.location.hash = section;
      return;
    }

    const hashLink = root.closest("a[href^='#']");
    if (hashLink) {
      const href = hashLink.getAttribute("href") || "";
      if (href.length > 1) {
        event.preventDefault();
        window.location.hash = href.slice(1);
      }
      return;
    }

    const signOut = root.closest("[data-sign-out]");
    if (signOut) {
      event.preventDefault();
      if (window.ShiftSwiftAuthGuard?.signOut) {
        void window.ShiftSwiftAuthGuard.signOut();
      } else if (window.ShiftSwiftSession?.signOut) {
        void window.ShiftSwiftSession.signOut();
      }
      return;
    }

    const alertsBtn = root.closest("#employee-enable-alerts-btn, #employee-topbar-alerts-btn");
    if (alertsBtn) {
      event.preventDefault();
      if (window.ShiftSwiftEmployeePushAlerts?.enable) {
        void window.ShiftSwiftEmployeePushAlerts.enable();
      } else if (window.ShiftSwiftNativeShiftAlerts?.enableAlerts) {
        void window.ShiftSwiftNativeShiftAlerts.enableAlerts();
      }
    }
  }

  function bootShell() {
    unlockUi();
    injectUnlockStyles();
    window.MobileShell?.initSidebar?.();
    window.EmployeeMobile?.init?.();
    window.ShiftSwiftNativeApiFetch?.boot?.();
    void window.ShiftSwiftSession?.hydrateNativeSession?.({ force: true });
    window.dispatchEvent(new CustomEvent("shiftswift:native-session-ready"));
    window.dispatchEvent(new CustomEvent("employee:profile-retry"));
    if (!window.__SSHR_PORTAL_READY) {
      window.__SSHR_PORTAL_READY = true;
      window.dispatchEvent(new CustomEvent("shiftswift:portal-ready"));
    }
  }

  function startNativeEmployeePortal() {
    window.__SSHR_UNLOCK_NATIVE_PORTAL_UI = unlockUi;
    window.__SSHR_BOOT_NATIVE_EMPLOYEE_PORTAL = bootShell;

    injectUnlockStyles();
    unlockUi();

    document.addEventListener("click", routeNavigation, true);
    document.addEventListener(
      "touchend",
      (event) => {
        if (event.changedTouches?.length !== 1) return;
        const touch = event.changedTouches[0];
        routeNavigation({
          ...event,
          clientX: touch.clientX,
          clientY: touch.clientY,
          target: document.elementFromPoint(touch.clientX, touch.clientY),
          preventDefault: () => event.preventDefault(),
        });
      },
      { capture: true, passive: false },
    );
    document.addEventListener("DOMContentLoaded", bootShell, { once: true });
    window.addEventListener("load", bootShell, { once: true });
    window.addEventListener("shiftswift:native-session-ready", bootShell);

    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      unlockUi();
      if (ticks === 1) bootShell();
      if (window.__SSHR_PORTAL_READY || ticks >= 8) window.clearInterval(timer);
    }, 400);
  }

  if (isNativeEmployee()) {
    startNativeEmployeePortal();
  } else {
    let waits = 0;
    const waitTimer = window.setInterval(() => {
      waits += 1;
      if (isNativeEmployee()) {
        window.clearInterval(waitTimer);
        startNativeEmployeePortal();
      } else if (waits > 120) {
        window.clearInterval(waitTimer);
      }
    }, 25);
  }
})();
