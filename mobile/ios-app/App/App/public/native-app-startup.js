/** Native app startup loader — sliding logo animation while the shell loads. */
(function initNativeStartupLoader() {
  const LOADER_HTML = `
    <div id="native-startup-loader" class="native-startup-loader" role="status" aria-live="polite" aria-label="Loading ShiftSwift HR">
      <div class="native-startup-loader__inner">
        <div class="native-startup-loader__icon-wrap">
          <span class="native-startup-loader__ring" aria-hidden="true"></span>
          <svg class="native-startup-loader__mark" viewBox="0 0 68 72" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <g class="native-startup-loader__tile">
              <rect x="0" y="0" width="68" height="68" rx="14" fill="#0a5a47" />
              <rect x="14" y="14" width="26" height="5" rx="2.5" fill="#5DCAA5" />
              <rect x="14" y="24" width="18" height="5" rx="2.5" fill="#9FE1CB" />
              <rect x="14" y="34" width="22" height="5" rx="2.5" fill="#5DCAA5" />
              <g class="logo-arrow">
                <line class="logo-arrow__shaft" x1="14" y1="56" x2="54" y2="56" stroke="#ffffff" stroke-width="3" stroke-linecap="round" />
                <polyline class="logo-arrow__head" points="44,48 54,56 44,64" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              </g>
            </g>
          </svg>
        </div>
        <p class="native-startup-loader__title">ShiftSwift HR</p>
        <p class="native-startup-loader__tagline">Staff &amp; managers · one sign-in</p>
      </div>
    </div>`;

  window.__SSHR_STARTUP_LOADER_HTML = LOADER_HTML;

  function isNative() {
    try {
      return Boolean(window.Capacitor?.isNativePlatform?.());
    } catch {
      return false;
    }
  }

  function isPortalPage() {
    const cls = document.body?.classList;
    return Boolean(
      cls?.contains("admin-portal") || cls?.contains("employee-portal") || cls?.contains("master-app"),
    );
  }

  function isLoginPage() {
    return Boolean(document.body?.classList?.contains("portal-login-page"));
  }

  function injectLoader() {
    if (isPortalPage()) return null;
    const existing = document.getElementById("native-startup-loader");
    if (existing) return existing;
    if (!document.body || !isNative()) return null;
    if (!isPortalPage() && !isLoginPage()) return null;
    document.body.insertAdjacentHTML("afterbegin", LOADER_HTML);
    return document.getElementById("native-startup-loader");
  }

  function hideCapacitorSplash() {
    try {
      window.Capacitor?.Plugins?.SplashScreen?.hide?.()?.catch?.(() => null);
    } catch {
      /* ignore */
    }
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function waitForPortalReady() {
    if (!isPortalPage()) return Promise.resolve();
    if (window.__SSHR_PORTAL_READY) return Promise.resolve();
    return new Promise((resolve) => {
      window.addEventListener("shiftswift:portal-ready", () => resolve(), { once: true });
    });
  }

  function isPostLoginTransition() {
    try {
      return sessionStorage.getItem("sshrPostLoginTransition") === "1";
    } catch {
      return false;
    }
  }

  function consumePostLoginFlag() {
    if (!isPortalPage()) return isPostLoginTransition();
    try {
      const active = sessionStorage.getItem("sshrPostLoginTransition") === "1";
      if (active) sessionStorage.removeItem("sshrPostLoginTransition");
      return active;
    } catch {
      return false;
    }
  }

  async function hasStoredSession() {
    try {
      if (window.ShiftSwiftSession?.hydrateNativeSession) {
        await window.ShiftSwiftSession.hydrateNativeSession();
      }
    } catch {
      /* ignore */
    }
    return Boolean(
      window.ShiftSwiftSession?.hasSession?.() ||
        localStorage.getItem("token") ||
        localStorage.getItem("refreshToken"),
    );
  }

  function computeMinMs({ postLogin, sessionReady, isLogin, reduced }) {
    if (reduced) {
      if (postLogin) return 360;
      if (isLogin && sessionReady) return 240;
      return 320;
    }
    if (postLogin) return 1200;
    if (isLogin && !sessionReady) return 980;
    if (isLogin && sessionReady) return 520;
    if (isPortalPage()) return 720;
    return 920;
  }

  async function boot() {
    if (isPortalPage()) {
      document.getElementById("native-startup-loader")?.remove();
      document.documentElement.classList.remove("native-startup-active");
      document.body?.classList.remove("native-startup-active");
      hideCapacitorSplash();
      window.ShiftSwiftNativeStartup = {
        finish: hideCapacitorSplash,
        hideCapacitorSplash,
        injectLoader,
        dismissNativeStartupLoader: hideCapacitorSplash,
      };
      return;
    }

    const loader = document.getElementById("native-startup-loader") || injectLoader();
    if (!loader) {
      hideCapacitorSplash();
      return;
    }

    const root = document.documentElement;
    root.classList.add("native-startup-active");
    document.body?.classList.add("native-startup-active");
    hideCapacitorSplash();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const postLogin = consumePostLoginFlag();
    const sessionReady = await hasStoredSession();
    const minMs = computeMinMs({
      postLogin,
      sessionReady,
      isLogin: isLoginPage(),
      reduced,
    });
    const maxMs = postLogin ? 6500 : isPortalPage() ? 5200 : 4500;

    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      loader.classList.add("is-done");
      loader.setAttribute("aria-hidden", "true");
      root.classList.remove("native-startup-active");
      document.body?.classList.remove("native-startup-active");
      hideCapacitorSplash();
      window.dispatchEvent(new CustomEvent("shiftswift:startup-loader-done"));
      window.setTimeout(() => loader.remove(), 520);
    }

    window.ShiftSwiftNativeStartup = {
      finish,
      hideCapacitorSplash,
      injectLoader,
    };

    const maxTimer = window.setTimeout(finish, maxMs);

    if (isLoginPage()) {
      window.setTimeout(() => {
        if (!finished) finish();
      }, 1200);
    }

    await Promise.all([delay(minMs), waitForPortalReady()]);
    window.clearTimeout(maxTimer);
    finish();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  } else {
    void boot();
  }
})();
