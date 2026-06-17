/** Top-of-page install banner for ShiftSwift HR admin and employee portal PWAs. */
(function initPortalPwaInstall() {
  const script = document.currentScript;
  const portal = script?.dataset.portal || "portal";
  const appName = script?.dataset.appName || "ShiftSwift HR";
  const manifestHref = script?.dataset.manifest || "";
  const swHref = script?.dataset.sw || "./app-sw.js?v=2";
  const dismissKey = `pwaInstallDismissed:${portal}`;

  const banner = document.getElementById("portal-pwa-install-banner");
  const titleEl = document.getElementById("portal-pwa-install-title");
  const copyEl = document.getElementById("portal-pwa-install-copy");
  const installBtn = document.getElementById("portal-pwa-install-btn");
  const dismissBtn = document.getElementById("portal-pwa-install-dismiss");

  let deferredInstallPrompt = null;
  let manualHelpEl = null;

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function installDismissed() {
    return localStorage.getItem(dismissKey) === "1";
  }

  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  function manualInstallSteps() {
    if (isIos()) {
      return `In Safari: tap Share → Add to Home Screen. Then open ${appName} from your home screen.`;
    }
    if (isAndroid()) {
      return `In Chrome: tap ⋮ → Install app or Add to Home screen. You may also see an install icon in the address bar.`;
    }
    return `In Chrome or Edge: use the install icon in the address bar, or open the browser menu and choose Install ${appName}. On Safari for Mac: File → Add to Dock.`;
  }

  function ensureManualHelp() {
    if (manualHelpEl || !banner) return manualHelpEl;
    manualHelpEl = document.createElement("p");
    manualHelpEl.className = "portal-pwa-install-manual muted";
    manualHelpEl.hidden = true;
    banner.querySelector(".portal-pwa-install-banner__copy")?.appendChild(manualHelpEl);
    return manualHelpEl;
  }

  function showManualHelp() {
    const el = ensureManualHelp();
    if (el) {
      el.textContent = manualInstallSteps();
      el.hidden = false;
    }
    if (installBtn) installBtn.textContent = "Install steps shown above";
  }

  function setInstallButton(promptReady) {
    if (!installBtn) return;
    installBtn.hidden = false;
    installBtn.disabled = false;
    installBtn.textContent = promptReady ? "Install app" : "How to install";
  }

  function showBanner({ copy, promptReady }) {
    if (!banner || isStandalone() || installDismissed()) return;
    if (titleEl) titleEl.textContent = `Download ${appName} app`;
    if (copyEl) copyEl.textContent = copy;
    if (manualHelpEl) manualHelpEl.hidden = true;
    setInstallButton(promptReady);
    banner.hidden = false;
  }

  function maybeShowInstallBanner() {
    if (!banner || isStandalone() || installDismissed()) return;

    if (deferredInstallPrompt) {
      showBanner({
        copy: `Install ${appName} on this device for quick access from your home screen.`,
        promptReady: true,
      });
      return;
    }

    showBanner({
      copy: `Add ${appName} to your home screen or desktop for quick access.`,
      promptReady: false,
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (portal === "employee" && window.ShiftSwiftEmployeePwa?.registerEmployeeSw) {
      window.ShiftSwiftEmployeePwa.registerEmployeeSw();
      return;
    }
    navigator.serviceWorker.register(swHref, { scope: "./" }).catch(() => null);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    maybeShowInstallBanner();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    hideBanner();
  });

  installBtn?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      try {
        await deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (choice?.outcome === "accepted") {
          hideBanner();
          return;
        }
      } catch {
        deferredInstallPrompt = null;
        maybeShowInstallBanner();
      }
    }
    showManualHelp();
  });

  dismissBtn?.addEventListener("click", () => {
    localStorage.setItem(dismissKey, "1");
    hideBanner();
  });

  if (manifestHref && !document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = manifestHref;
    document.head.appendChild(link);
  }

  registerServiceWorker();
  maybeShowInstallBanner();
})();
