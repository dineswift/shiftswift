/** Early bootstrap — native startup loader + bundled shell on production pages in Capacitor. */
(function bootstrapNativeShellFromBundle() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;

    var scheme =
      window.Capacitor.config && window.Capacitor.config.ios
        ? window.Capacitor.config.ios.scheme
        : "App";
    if (!scheme) scheme = "App";

    var version = "14";
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

    if (onPortal) {
      document.documentElement.classList.add("native-startup-active");
      appendStylesheet(assetUrl("native-app-startup.css"));
      appendScript(assetUrl("native-app-startup.js"));

      if (!document.getElementById("native-startup-critical-style")) {
        var critical = document.createElement("style");
        critical.id = "native-startup-critical-style";
        critical.textContent =
          ".native-startup-loader{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;background:#0f6e56}" +
          ".native-startup-loader__mark{display:block;width:88px;height:auto;max-width:88px;aspect-ratio:68/72;flex-shrink:0}";
        document.head.appendChild(critical);
      }

      function injectStartupLoader() {
        if (document.getElementById("native-startup-loader")) return;
        if (!document.body) return;
        var html =
          window.__SSHR_STARTUP_LOADER_HTML ||
          '<div id="native-startup-loader" class="native-startup-loader" role="status" aria-live="polite" aria-label="Loading ShiftSwift HR"><div class="native-startup-loader__inner"><div class="native-startup-loader__icon-wrap"><span class="native-startup-loader__ring" aria-hidden="true"></span><svg class="native-startup-loader__mark" viewBox="0 0 68 72" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g class="native-startup-loader__tile"><rect x="0" y="0" width="68" height="68" rx="14" fill="#0a5a47" /><rect x="14" y="14" width="26" height="5" rx="2.5" fill="#5DCAA5" /><rect x="14" y="24" width="18" height="5" rx="2.5" fill="#9FE1CB" /><rect x="14" y="34" width="22" height="5" rx="2.5" fill="#5DCAA5" /><g class="logo-arrow"><line class="logo-arrow__shaft" x1="14" y1="56" x2="54" y2="56" stroke="#ffffff" stroke-width="3" stroke-linecap="round" /><polyline class="logo-arrow__head" points="44,48 54,56 44,64" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></g></g></svg></div><p class="native-startup-loader__title">ShiftSwift HR</p><p class="native-startup-loader__tagline">Staff &amp; managers · one sign-in</p></div></div>';
        document.body.insertAdjacentHTML("afterbegin", html);
        document.body.classList.add("native-startup-active");
      }

      if (document.body) {
        injectStartupLoader();
      } else {
        document.addEventListener(
          "readystatechange",
          function onReady() {
            if (document.readyState === "interactive" || document.readyState === "complete") {
              document.removeEventListener("readystatechange", onReady);
              injectStartupLoader();
            }
          },
          false,
        );
      }
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
