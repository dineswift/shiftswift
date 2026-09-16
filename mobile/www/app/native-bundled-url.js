/** Resolve bundled Capacitor asset URLs — preserve iosScheme case (App, not app). */
(function initNativeBundledUrl() {
  function nativeBundledScheme() {
    try {
      const fromConfig =
        window.Capacitor?.config?.server?.iosScheme || window.Capacitor?.config?.ios?.scheme;
      if (fromConfig) return String(fromConfig);
      if (window.Capacitor?.isNativePlatform?.()) return "App";
    } catch {
      /* ignore */
    }
    return "capacitor";
  }

  function nativeBundledAssetUrl(file, version) {
    const scheme = nativeBundledScheme();
    const name = String(file || "").replace(/^\.\//, "");
    const v = version != null ? String(version) : "49";
    return `${scheme}://localhost/${name}?v=${v}`;
  }

  window.ShiftSwiftNativeBundledUrl = {
    scheme: nativeBundledScheme,
    assetUrl: nativeBundledAssetUrl,
  };
})();
