/** Native app startup loader — sliding logo animation while the shell loads. */
(function initNativeStartupLoader() {
  function boot() {
    const loader = document.getElementById("native-startup-loader");
    if (!loader) {
      try {
        window.Capacitor?.Plugins?.SplashScreen?.hide?.()?.catch?.(() => null);
      } catch {
        /* ignore */
      }
      return;
    }

    const root = document.documentElement;
    root.classList.add("native-startup-active");
    if (document.body) document.body.classList.add("native-startup-active");

    function hideCapacitorSplash() {
      try {
        const splash = window.Capacitor?.Plugins?.SplashScreen;
        if (splash?.hide) splash.hide().catch(() => null);
      } catch {
        /* ignore */
      }
    }

    hideCapacitorSplash();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const MIN_MS = reduced ? 280 : 1550;
    const MAX_MS = 4200;
    let finished = false;
    const started = performance.now();

    function finish() {
      if (finished) return;
      finished = true;
      loader.classList.add("is-done");
      loader.setAttribute("aria-hidden", "true");
      root.classList.remove("native-startup-active");
      document.body?.classList.remove("native-startup-active");
      hideCapacitorSplash();
      window.dispatchEvent(new CustomEvent("shiftswift:startup-loader-done"));
      window.setTimeout(() => loader.remove(), 120);
    }

    function finishAfterMinimum() {
      const elapsed = performance.now() - started;
      const wait = Math.max(0, MIN_MS - elapsed);
      window.setTimeout(finish, wait);
    }

    finishAfterMinimum();
    window.setTimeout(finish, MAX_MS);

    window.ShiftSwiftNativeStartup = {
      finish,
      hideCapacitorSplash,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
