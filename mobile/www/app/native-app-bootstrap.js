/** Early bootstrap — bundled native shell on production pages in Capacitor. */
(function bootstrapNativeShellFromBundle() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;

    var version = "29";
    var path = String(window.location.pathname || "");
    var onPortal =
      /admin\.html$/i.test(path) ||
      /employee\.html$/i.test(path) ||
      /master\.html$/i.test(path);

    function assetOrigin() {
      try {
        var cap = window.Capacitor;
        var platform = cap && cap.getPlatform ? cap.getPlatform() : "";
        if (platform === "android") {
          var androidScheme =
            (cap.config && cap.config.android && cap.config.android.scheme) || "https";
          var host =
            (cap.config && cap.config.android && cap.config.android.hostname) || "localhost";
          return androidScheme + "://" + host;
        }
        var iosScheme =
          (cap.config && cap.config.ios && cap.config.ios.scheme) || "App";
        return iosScheme + "://localhost";
      } catch (e) {
        return "App://localhost";
      }
    }

    function assetUrl(file) {
      return assetOrigin() + "/" + file + "?v=" + version;
    }

    function appendStylesheet(href) {
      if (document.querySelector('link[data-sshr-native="' + href + '"]')) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute("data-sshr-native", href);
      document.head.appendChild(link);
    }

    function appendScript(src) {
      if (document.querySelector('script[data-sshr-native="' + src + '"]')) return;
      var script = document.createElement("script");
      script.src = src;
      script.setAttribute("data-sshr-native", src);
      script.async = false;
      document.head.appendChild(script);
    }

    /** Login page owns the animated loader — never inject it on portal pages. */
    function injectHideStyles() {
      if (document.getElementById("sshr-portal-hide-loader")) return;
      var style = document.createElement("style");
      style.id = "sshr-portal-hide-loader";
      style.textContent =
        "#native-startup-loader,.native-startup-loader{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;position:absolute!important;left:-9999px!important;top:-9999px!important;width:0!important;pointer-events:none!important}" +
        "#portal-pwa-install-banner,.portal-pwa-install-banner,.pwa-ios-sheet,.pwa-ios-sheet-backdrop{display:none!important;visibility:hidden!important;pointer-events:none!important}";
      (document.head || document.documentElement).appendChild(style);
    }

    function stripStartupLoader() {
      injectHideStyles();
      var loader = document.getElementById("native-startup-loader");
      if (loader) loader.remove();
      document.documentElement.classList.remove("native-startup-active");
      if (document.body) document.body.classList.remove("native-startup-active");
    }

    if (onPortal) {
      if (!window.__SSHR_PORTAL_GUARD) {
        appendScript(assetUrl("native-app-portal-guard.js"));
      }
      stripStartupLoader();
      document.addEventListener("DOMContentLoaded", stripStartupLoader, { once: true });
      window.addEventListener("load", stripStartupLoader, { once: true });

      if (!document.querySelector("script[data-sshr-native-bootstrap]")) {
        appendStylesheet(assetUrl("native-app-chrome.css"));
        appendScript(assetUrl("native-app.js"));
        document
          .querySelector('script[data-sshr-native="' + assetUrl("native-app.js") + '"]')
          ?.setAttribute("data-sshr-native-bootstrap", "1");
      }
      return;
    }

    if (window.ShiftSwiftNativeApp?.isCapacitorNative) return;
    if (document.querySelector("script[data-sshr-native-bootstrap]")) return;

    appendStylesheet(assetUrl("native-app-chrome.css"));
    appendScript(assetUrl("native-app.js"));
    document.querySelector('script[data-sshr-native="' + assetUrl("native-app.js") + '"]')?.setAttribute(
      "data-sshr-native-bootstrap",
      "1",
    );
  } catch (e) {
    /* ignore */
  }
})();
