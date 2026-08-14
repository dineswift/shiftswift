/** Resolve bundled Capacitor asset URLs — iOS uses App://, Android uses https:// */
(function initNativeBundledUrl() {
  function nativeBundledScheme() {
    try {
      const platform = window.Capacitor?.getPlatform?.();
      if (platform === "android") {
        return String(window.Capacitor?.config?.server?.androidScheme || "https");
      }
      const fromConfig =
        window.Capacitor?.config?.server?.iosScheme || window.Capacitor?.config?.ios?.scheme;
      if (fromConfig) return String(fromConfig);
      const match = String(location.href || "").match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/localhost/);
      if (match) return match[1];
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
