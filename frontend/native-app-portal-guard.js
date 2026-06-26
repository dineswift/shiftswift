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
    var version = "21";

    function injectHideStyles() {
      if (document.getElementById("sshr-portal-hide-loader")) return;
      var style = document.createElement("style");
      style.id = "sshr-portal-hide-loader";
      style.textContent =
        "#native-startup-loader,.native-startup-loader{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;position:absolute!important;left:-9999px!important;top:-9999px!important;width:0!important;}" +
        "html.native-startup-active,html.native-startup-active body,body.native-startup-active{overflow:auto!important;}";
      (document.head || document.documentElement).appendChild(style);
    }

    function stripStartupLoader() {
      injectHideStyles();
      var loader = document.getElementById("native-startup-loader");
      if (loader) loader.remove();
      document.documentElement.classList.remove("native-startup-active");
      if (document.body) document.body.classList.remove("native-startup-active");
    }

    injectHideStyles();
    stripStartupLoader();

    var observer = new MutationObserver(function () {
      stripStartupLoader();
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
    window.setInterval(stripStartupLoader, 500);

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
