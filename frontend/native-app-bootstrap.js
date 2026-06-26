/** Early bootstrap — bundled native shell on production pages in Capacitor. */
(function bootstrapNativeShellFromBundle() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;

    var scheme =
      window.Capacitor.config && window.Capacitor.config.ios
        ? window.Capacitor.config.ios.scheme
        : "App";
    if (!scheme) scheme = "App";

    var version = "19";
    var path = String(window.location.pathname || "");
    var onPortal =
      /admin\.html$/i.test(path) ||
      /employee\.html$/i.test(path) ||
      /master\.html$/i.test(path);

    function assetUrl(file) {
      return scheme + "://localhost/" + file + "?v=" + version;
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
      document.head.appendChild(script);
    }

    /** Login page owns the animated loader — never inject it on portal pages. */
    function injectHideStyles() {
      if (document.getElementById("sshr-portal-hide-loader")) return;
      var style = document.createElement("style");
      style.id = "sshr-portal-hide-loader";
      style.textContent =
        "#native-startup-loader,.native-startup-loader{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;position:absolute!important;left:-9999px!important;top:-9999px!important;width:0!important;pointer-events:none!important}";
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
