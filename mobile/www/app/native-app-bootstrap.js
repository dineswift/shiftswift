/** Early bootstrap — load bundled native shell on production pages in Capacitor. */
(function bootstrapNativeShellFromBundle() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    if (window.ShiftSwiftNativeApp?.isCapacitorNative) return;
    if (document.querySelector("script[data-sshr-native-bootstrap]")) return;
    var scheme =
      window.Capacitor.config && window.Capacitor.config.ios
        ? window.Capacitor.config.ios.scheme
        : "App";
    if (!scheme) scheme = "App";

    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = scheme + "://localhost/native-app-chrome.css?v=11";
    link.setAttribute("data-sshr-native-bootstrap", "1");
    document.head.appendChild(link);

    var script = document.createElement("script");
    script.src = scheme + "://localhost/native-app.js?v=11";
    script.setAttribute("data-sshr-native-bootstrap", "1");
    document.head.appendChild(script);
  } catch (e) {}
})();
