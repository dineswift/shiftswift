/** Portal page fixes for Capacitor — hide loader, load bundled API + session helpers. */
(function initNativePortalFix() {
  function onPortalPage() {
    var path = String(window.location.pathname || "");
    return /admin\.html$|employee\.html$|master\.html$/i.test(path);
  }

  function scheme() {
    try {
      return (
        (window.Capacitor &&
          window.Capacitor.config &&
          window.Capacitor.config.ios &&
          window.Capacitor.config.ios.scheme) ||
        "App"
      );
    } catch (e) {
      return "App";
    }
  }

  function version() {
    return "20";
  }

  function injectHideStyles() {
    if (document.getElementById("sshr-portal-hide-loader")) return;
    var style = document.createElement("style");
    style.id = "sshr-portal-hide-loader";
    style.textContent =
      "#native-startup-loader,.native-startup-loader{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;opacity:0!important;pointer-events:none!important;position:absolute!important;left:-9999px!important;top:-9999px!important;width:0!important;}" +
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

  function loadBundledScript(file) {
    if (document.querySelector('[data-sshr-portal-fix="' + file + '"]')) return;
    var script = document.createElement("script");
    script.src = scheme() + "://localhost/" + file + "?v=" + version();
    script.setAttribute("data-sshr-portal-fix", file);
    script.async = false;
    document.head.appendChild(script);
  }

  function loadBundledHelpers() {
    loadBundledScript("native-api-fetch.js");
    loadBundledScript("session-auth.js");
    loadBundledScript("native-app.js");
  }

  function boot() {
    if (!onPortalPage()) return;
    window.__SSHR_PORTAL_GUARD = true;
    stripStartupLoader();
    loadBundledHelpers();
    window.setTimeout(function () {
      window.ShiftSwiftNativeApiFetch?.boot?.();
      window.ShiftSwiftNativeApp?.patchNativeSignOut?.();
      window.ShiftSwiftNativeApp?.sanitizeNativeApiBase?.();
      window.dispatchEvent(new CustomEvent("shiftswift:native-session-ready"));
      window.setTimeout(function () {
        window.ShiftSwiftNativeApiFetch?.retryPortalData?.();
      }, 600);
    }, 0);
  }

  window.__SSHR_PORTAL_FIX = {
    boot: boot,
    stripStartupLoader: stripStartupLoader,
  };

  if (!onPortalPage()) return;

  injectHideStyles();
  stripStartupLoader();

  if (!window.__SSHR_PORTAL_FIX_OBSERVER) {
    window.__SSHR_PORTAL_FIX_OBSERVER = new MutationObserver(stripStartupLoader);
    if (document.documentElement) {
      window.__SSHR_PORTAL_FIX_OBSERVER.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }
  }

  window.setInterval(stripStartupLoader, 400);

  if (window.Capacitor?.isNativePlatform?.()) {
    boot();
  } else {
    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (window.Capacitor?.isNativePlatform?.()) {
        window.clearInterval(timer);
        boot();
      } else if (attempts > 600) {
        window.clearInterval(timer);
      }
    }, 10);
  }

  document.addEventListener("DOMContentLoaded", boot, { once: true });
  window.addEventListener("load", boot, { once: true });
})();
