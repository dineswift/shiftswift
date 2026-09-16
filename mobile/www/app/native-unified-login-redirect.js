/** Force unified Capacitor app back to bundled login — runs on production legacy login URLs. */
(function enforceUnifiedNativeLogin() {
  var BUILD = "27";
  var VERSION = "39";

  function getCapacitorScheme() {
    try {
      var scheme =
        window.Capacitor?.config?.server?.iosScheme ||
        window.Capacitor?.config?.ios?.scheme ||
        "";
      if (scheme) return String(scheme);
      if (window.Capacitor?.isNativePlatform?.()) return "App";
      var match = String(location.href || "").match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/localhost/);
      if (match) return match[1];
    } catch (e) {
      /* ignore */
    }
    return "App";
  }

  function bundledLoginUrl() {
    return getCapacitorScheme() + "://localhost/index.html?build=" + BUILD + "&v=" + VERSION;
  }

  function isBundledUnifiedLogin() {
    try {
      return /\/\/localhost\//i.test(location.href) && /index\.html/i.test(location.pathname || "");
    } catch (e) {
      return false;
    }
  }

  function isLegacyLoginPath() {
    return /employee-login|business-login|sign-in|native-app-login/i.test(String(location.pathname || ""));
  }

  function isLegacyLoginBody() {
    try {
      if (!location.href.includes("app.shiftswifthr.co.uk")) return false;
      var page = document.body?.dataset?.loginPage;
      return page === "employee" || page === "business";
    } catch (e) {
      return false;
    }
  }

  function shouldRedirect() {
    try {
      if (window.Capacitor?.config?.appId === "co.uk.shiftswifthr.app") return false;
    } catch (e) {
      /* ignore */
    }
    if (isBundledUnifiedLogin()) return false;
    return isLegacyLoginPath() || isLegacyLoginBody();
  }

  function redirectIfNeeded() {
    if (!shouldRedirect()) return false;
    window.location.replace(bundledLoginUrl());
    return true;
  }

  if (window.__SSHR_UNIFIED_LOGIN_REDIRECT) return;
  window.__SSHR_UNIFIED_LOGIN_REDIRECT = true;

  redirectIfNeeded();

  var attempts = 0;
  var timer = window.setInterval(function () {
    attempts += 1;
    if (redirectIfNeeded() || attempts >= 120) {
      window.clearInterval(timer);
    }
  }, 25);

  try {
    var app = window.Capacitor?.Plugins?.App;
    if (app?.addListener) {
      app.addListener("appStateChange", function (state) {
        if (state?.isActive) redirectIfNeeded();
      }).catch(function () {});
    }
  } catch (e) {
    /* ignore */
  }
})();
