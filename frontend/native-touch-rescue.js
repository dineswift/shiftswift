/** Native touch rescue — unlock UI and route taps when portal handlers fail to bind. */
(function initNativeTouchRescue() {
  function onPortal() {
    return /\/(employee|admin|master)\.html$/i.test(String(window.location.pathname || ""));
  }

  function unlock() {
    try {
      document.documentElement.classList.remove("native-startup-active");
      if (document.body) {
        document.body.classList.remove(
          "native-startup-active",
          "portal-startup-pending",
          "employee-gdpr-locked",
          "no-scroll",
        );
        document.body.classList.add("portal-startup-ready");
        document.body.style.pointerEvents = "auto";
        document.body.style.touchAction = "manipulation";
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.left = "";
        document.body.style.right = "";
        document.body.style.width = "";
      }
      document.getElementById("native-startup-loader")?.remove();
      document.getElementById("sidebar-overlay")?.classList.remove("sidebar-overlay--visible");
      const content = document.querySelector("main.content");
      if (content) {
        content.style.overflow = "";
        content.style.touchAction = "manipulation";
        content.style.pointerEvents = "auto";
      }
      window.Capacitor?.Plugins?.SplashScreen?.hide?.();
      window.ShiftSwiftNativeApp?.hideSplash?.();
    } catch {
      /* ignore */
    }
  }

  function injectStyles() {
    if (document.getElementById("sshr-native-touch-rescue")) return;
    const style = document.createElement("style");
    style.id = "sshr-native-touch-rescue";
    style.textContent =
      "html,body,body.employee-portal,body.admin-portal,body.employee-portal .employee-app," +
      "body.employee-portal #mobile-tab-bar,body.employee-portal main.content," +
      "body.employee-portal button,body.employee-portal a,body.employee-portal .btn," +
      "html.native-startup-active body.employee-portal .employee-app," +
      "html.native-startup-active body.employee-portal #mobile-tab-bar," +
      "body.employee-portal.portal-startup-pending .app>main.content," +
      "body.employee-portal.portal-startup-pending #mobile-tab-bar," +
      "body.employee-portal.no-scroll,body.employee-portal.no-scroll main.content{" +
      "pointer-events:auto!important;touch-action:manipulation!important;" +
      "opacity:1!important;visibility:visible!important}";
    (document.head || document.documentElement).appendChild(style);
  }

  function targetFromEvent(event) {
    let el = event.target;
    if (el && el.closest && el !== document.body && el !== document.documentElement) {
      return el;
    }
    const touch = event.changedTouches?.[0] || event.touches?.[0];
    if (!touch) return null;
    return document.elementFromPoint(touch.clientX, touch.clientY);
  }

  function routeTap(event) {
    if (!onPortal() || window.__SSHR_PORTAL_HANDLERS_READY) return;
    unlock();
    const root = targetFromEvent(event);
    if (!root || !root.closest) return;

    const tab = root.closest("[data-mobile-tab]");
    if (tab?.dataset?.mobileTab) {
      event.preventDefault();
      event.stopPropagation();
      document.body.classList.remove("employee-mobile-detail", "admin-mobile-detail");
      if (window.EmployeeMobile?.setTab) {
        window.EmployeeMobile.setTab(tab.dataset.mobileTab);
      } else if (window.AdminMobile?.setTab) {
        window.AdminMobile.setTab(tab.dataset.mobileTab);
      } else {
        const map = { home: "overview", shifts: "my-shifts", clock: "time-clock", leave: "leave" };
        const section = map[tab.dataset.mobileTab];
        if (section) window.location.hash = section;
      }
      return;
    }

    const hashLink = root.closest("a[href^='#']");
    if (hashLink) {
      const href = hashLink.getAttribute("href") || "";
      if (href.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        window.location.hash = href.slice(1);
      }
      return;
    }

    const signOut = root.closest("[data-sign-out]");
    if (signOut) {
      event.preventDefault();
      event.stopPropagation();
      if (window.ShiftSwiftAuthGuard?.signOut) void window.ShiftSwiftAuthGuard.signOut();
      else if (window.ShiftSwiftSession?.signOut) {
        void window.ShiftSwiftSession.signOut(window.ShiftSwiftAuthGuard?.loginRedirectUrl?.());
      }
    }
  }

  async function unregisterServiceWorkers() {
    if (!window.Capacitor?.isNativePlatform?.() || !("serviceWorker" in navigator)) return;
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch {
      /* ignore */
    }
  }

  function start() {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    injectStyles();
    unlock();
    void unregisterServiceWorkers();
    document.addEventListener("touchstart", unlock, { capture: true, passive: true });
    document.addEventListener(
      "touchend",
      (event) => {
        unlock();
        routeTap(event);
      },
      { capture: true, passive: false },
    );
    document.addEventListener("DOMContentLoaded", unlock, { once: true });
    window.addEventListener("load", unlock, { once: true });
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      unlock();
      if (ticks >= 120) window.clearInterval(timer);
    }, 250);
  }

  start();
})();
