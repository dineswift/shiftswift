/** Capacitor Geolocation with navigator.geolocation fallback for punch geofencing. */
(function initNativeGeolocation() {
  function isNative() {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  }

  function geoPlugin() {
    return window.Capacitor?.Plugins?.Geolocation;
  }

  function friendlyGeoError(error) {
    if (error?.code === 1 || /denied|permission/i.test(String(error?.message || ""))) {
      return "Location permission denied. Enable location in your device settings.";
    }
    if (error?.code === 2) return "Location unavailable. Try moving outdoors or scan the premises QR.";
    if (error?.code === 3 || /timeout/i.test(String(error?.message || ""))) {
      return "Location timed out. Check GPS or scan the premises QR.";
    }
    return error?.message || "Could not read your location.";
  }

  function readWebOnce(options) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location is not supported on this device."));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }

  async function readWebLocation() {
    const primary = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };
    try {
      const pos = await readWebOnce(primary);
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_meters: pos.coords.accuracy,
      };
    } catch (firstError) {
      if (firstError?.code !== 3) throw new Error(friendlyGeoError(firstError));
      const pos = await readWebOnce({ enableHighAccuracy: false, timeout: 25000, maximumAge: 15000 });
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_meters: pos.coords.accuracy,
      };
    }
  }

  async function requestPermission() {
    const plugin = geoPlugin();
    if (!plugin?.requestPermissions) return "prompt";
    try {
      const result = await plugin.requestPermissions();
      return result?.location || result?.coarseLocation || "prompt";
    } catch {
      return "prompt";
    }
  }

  async function readCapacitorLocation() {
    const plugin = geoPlugin();
    if (!plugin?.getCurrentPosition) {
      throw new Error("Native location is not available.");
    }
    await requestPermission();
    const pos = await plugin.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy_meters: pos.coords.accuracy,
    };
  }

  async function readLocation() {
    if (isNative() && geoPlugin()?.getCurrentPosition) {
      try {
        return await readCapacitorLocation();
      } catch (nativeError) {
        try {
          return await readWebLocation();
        } catch {
          throw new Error(friendlyGeoError(nativeError));
        }
      }
    }
    return readWebLocation();
  }

  window.ShiftSwiftNativeGeo = {
    isNative,
    requestPermission,
    readLocation,
    friendlyGeoError,
  };
})();
