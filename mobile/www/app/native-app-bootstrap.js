/** Early bootstrap — load bundled native shell when viewing production pages in Capacitor. */
(function bootstrapNativeShellFromBundle() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    if (document.querySelector("script[data-sshr-native-bootstrap]")) return;
    var scheme = window.Capacitor.config && window.Capacitor.config.ios
      ? window.Capacitor.config.ios.scheme
      : "App";
    if (!scheme) scheme = "App";
    var script = document.createElement("script");
    script.src = scheme + "://localhost/native-app.js?v=4";
    script.setAttribute("data-sshr-native-bootstrap", "1");
    script.async = true;
    document.head.appendChild(script);
  } catch (e) {}
})();
