/** Strip stale production startup loader on admin/employee/master in Capacitor. */
(function initNativePortalGuard() {
  try {
    var path = String(window.location.pathname || "");
    var onPortal =
      /admin\.html$/i.test(path) ||
      /employee\.html$/i.test(path) ||
      /master\.html$/i.test(path);
    if (!onPortal) return;

    window.__SSHR_PORTAL_GUARD = true;
    var version = "26";

    function markNativeShell() {
      try {
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
          document.documentElement.classList.add("native-app", "capacitor-native");
          if (document.body) document.body.classList.add("native-app");
        }
      } catch (e) {
        /* ignore */
      }
    }

    function injectHideStyles() {
      if (document.getElementById("sshr-portal-hide-loader")) return;
      var style = document.createElement("style");
      style.id = "sshr-portal-hide-loader";
      style.textContent =
        "#native-startup-loader,.native-startup-loader{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;position:absolute!important;left:-9999px!important;top:-9999px!important;width:0!important;}" +
        "#portal-pwa-install-banner,.portal-pwa-install-banner,.pwa-ios-sheet,.pwa-ios-sheet-backdrop{display:none!important;visibility:hidden!important;pointer-events:none!important;}" +
        "html.native-startup-active,html.native-startup-active body,body.native-startup-active{overflow:auto!important;}" +
        "html.native-app.capacitor-native .topbar.app-mobile-header,html.native-app.capacitor-native body.admin-mobile-detail .topbar,html.native-app.capacitor-native body.employee-mobile-detail .topbar{padding-top:max(12px,env(safe-area-inset-top))!important;padding-left:max(12px,env(safe-area-inset-left))!important;padding-right:max(12px,env(safe-area-inset-right))!important;}";
      (document.head || document.documentElement).appendChild(style);
    }

    markNativeShell();

    function stripStartupLoader() {
      injectHideStyles();
      var loader = document.getElementById("native-startup-loader");
      if (loader) loader.remove();
      if (document.documentElement.classList.contains("native-startup-active")) {
        document.documentElement.classList.remove("native-startup-active");
      }
      if (document.body && document.body.classList.contains("native-startup-active")) {
        document.body.classList.remove("native-startup-active");
      }
    }

    function settlePortalShell() {
      if (window.__SSHR_PORTAL_GUARD_SETTLED) return;
      window.__SSHR_PORTAL_GUARD_SETTLED = true;
      stripStartupLoader();
      observer.disconnect();
      if (window.__SSHR_PORTAL_GUARD_INTERVAL) {
        window.clearInterval(window.__SSHR_PORTAL_GUARD_INTERVAL);
        window.__SSHR_PORTAL_GUARD_INTERVAL = null;
      }
    }

    injectHideStyles();
    stripStartupLoader();

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        if (mutations[i].type !== "childList") continue;
        if (document.getElementById("native-startup-loader")) {
          stripStartupLoader();
          return;
        }
      }
    });

    function startObserver() {
      if (!document.documentElement) return;
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      stripStartupLoader();
    }

    if (document.documentElement) {
      startObserver();
    } else {
      document.addEventListener(
        "readystatechange",
        function onReady() {
          if (document.documentElement) {
            document.removeEventListener("readystatechange", onReady);
            startObserver();
          }
        },
        false,
      );
    }

    document.addEventListener("DOMContentLoaded", stripStartupLoader, { once: true });
    window.addEventListener("load", stripStartupLoader, { once: true });
    var guardTicks = 0;
    window.__SSHR_PORTAL_GUARD_INTERVAL = window.setInterval(function () {
      guardTicks += 1;
      stripStartupLoader();
      if (guardTicks >= 12) settlePortalShell();
    }, 500);
    window.addEventListener("shiftswift:portal-ready", settlePortalShell, { once: true });
    window.setTimeout(settlePortalShell, 10000);

    function assetUrl(file) {
      var scheme =
        window.Capacitor && window.Capacitor.config && window.Capacitor.config.ios
          ? window.Capacitor.config.ios.scheme
          : "App";
      if (!scheme) scheme = "App";
      return scheme + "://localhost/" + file + "?v=" + version;
    }

    function appendScript(src, marker) {
      if (document.querySelector('script[' + marker + '="1"]')) return;
      var script = document.createElement("script");
      script.src = src;
      script.setAttribute(marker, "1");
      script.async = false;
      document.head.appendChild(script);
    }

    function loadBundledPortalAssets() {
      try {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        appendScript(assetUrl("native-app-bootstrap.js"), "data-sshr-portal-guard-bootstrap");
        window.addEventListener(
          "load",
          function () {
            appendScript(assetUrl("native-api-fetch.js"), "data-sshr-portal-api-fetch");
            appendScript(assetUrl("session-auth.js"), "data-sshr-portal-session-auth");
            appendScript(assetUrl("auth-guard.js"), "data-sshr-portal-auth-guard");
            window.setTimeout(function () {
              window.ShiftSwiftNativeApiFetch?.boot?.();
              window.ShiftSwiftNativeApp?.patchNativeSignOut?.();
              window.dispatchEvent(new CustomEvent("shiftswift:native-session-ready"));
            }, 0);
          },
          { once: true },
        );
      } catch (e) {
        /* ignore */
      }
    }

    if (window.Capacitor?.isNativePlatform?.()) {
      loadBundledPortalAssets();
    } else {
      var attempts = 0;
      var timer = window.setInterval(function () {
        attempts += 1;
        if (window.Capacitor?.isNativePlatform?.()) {
          window.clearInterval(timer);
          loadBundledPortalAssets();
        } else if (attempts > 500) {
          window.clearInterval(timer);
        }
      }, 10);
    }
  } catch (e) {
    /* ignore */
  }
})();
