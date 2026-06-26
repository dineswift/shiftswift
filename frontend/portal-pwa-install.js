/** Top-of-page install banner + iPhone install sheet for ShiftSwift portal PWAs. */
(function initPortalPwaInstall() {
  const script = document.currentScript;
  const portal = script?.dataset.portal || "portal";
  const appName = script?.dataset.appName || "ShiftSwift HR";
  const manifestHref = script?.dataset.manifest || "";
  const swHref = script?.dataset.sw || "./app-sw.js?v=2";
  const dismissKey = `pwaInstallDismissed:${portal}`;
  const layout = script?.dataset.layout || "banner";

  const banner = document.getElementById("portal-pwa-install-banner");
  const titleEl = document.getElementById("portal-pwa-install-title");
  const copyEl = document.getElementById("portal-pwa-install-copy");
  const installBtn = document.getElementById("portal-pwa-install-btn");
  const dismissBtn = document.getElementById("portal-pwa-install-dismiss");

  let deferredInstallPrompt = null;
  let manualHelpEl = null;
  let iosSheetEl = null;
  let iosSheetBackdrop = null;

  const ios = window.ShiftSwiftPwaIos || {};

  function isNativeShell() {
    try {
      if (window.Capacitor?.isNativePlatform?.()) return true;
      if (window.ShiftSwiftNativeApp?.isCapacitorNative?.()) return true;
      if (window.ShiftSwiftNativeApp?.isNativeApp?.()) return true;
      if (window.ShiftSwiftBrand?.isCapacitorNative?.()) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function isStandalone() {
    if (isNativeShell()) return true;
    return ios.isStandalone?.() ||
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true;
  }

  function isIos() {
    return ios.isIos?.() || /iPad|iPhone|iPod/.test(navigator.userAgent);
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
    if (isIos() && layout !== "landing") {
      openIosInstallSheet();
      return;
    }
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
    installBtn.textContent = promptReady ? "Install app" : isIos() ? "Add to Home Screen" : "How to install";
  }

  function showBanner({ copy, promptReady }) {
    if (!banner || isStandalone() || installDismissed()) return;
    if (titleEl) titleEl.textContent = isIos() ? `Get ${appName} on iPhone` : `Download ${appName} app`;
    if (copyEl) {
      copyEl.textContent = isIos()
        ? `Install ${appName} on your home screen for a full-screen app experience — clock in, shifts, and alerts in one tap.`
        : copy;
    }
    if (manualHelpEl) manualHelpEl.hidden = true;
    setInstallButton(promptReady);
    banner.hidden = false;
    if (layout === "login-card") banner.classList.add("portal-pwa-install-banner--login");
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

  function ensureIosInstallSheet() {
    if (iosSheetEl) return iosSheetEl;

    iosSheetBackdrop = document.createElement("div");
    iosSheetBackdrop.className = "pwa-ios-sheet-backdrop";
    iosSheetBackdrop.hidden = true;

    iosSheetEl = document.createElement("section");
    iosSheetEl.className = "pwa-ios-sheet";
    iosSheetEl.setAttribute("role", "dialog");
    iosSheetEl.setAttribute("aria-modal", "true");
    iosSheetEl.setAttribute("aria-label", `Install ${appName}`);
    iosSheetEl.hidden = true;
    iosSheetEl.innerHTML = `
      <div class="pwa-ios-sheet__handle" aria-hidden="true"></div>
      <div class="pwa-ios-sheet__head">
        <img class="pwa-ios-sheet__icon" alt="" width="72" height="72" />
        <div>
          <h2 class="pwa-ios-sheet__title">Add to Home Screen</h2>
          <p class="pwa-ios-sheet__subtitle">Install <strong>${appName}</strong> like a native iPhone app.</p>
        </div>
      </div>
      <ol class="pwa-ios-sheet__steps">
        <li>
          <span class="pwa-ios-sheet__step-icon" aria-hidden="true">↑</span>
          <span>Tap <strong>Share</strong> in Safari’s toolbar (bottom of the screen).</span>
        </li>
        <li>
          <span class="pwa-ios-sheet__step-icon" aria-hidden="true">＋</span>
          <span>Scroll down and tap <strong>Add to Home Screen</strong>.</span>
        </li>
        <li>
          <span class="pwa-ios-sheet__step-icon" aria-hidden="true">▣</span>
          <span>Tap <strong>Add</strong>, then open ${appName} from your home screen.</span>
        </li>
      </ol>
      <p class="pwa-ios-sheet__note muted">Use Safari — Chrome and other browsers on iPhone cannot install this app.</p>
      <div class="pwa-ios-sheet__actions">
        <button type="button" class="btn primary pwa-ios-sheet__got-it">Got it</button>
        <button type="button" class="btn ghost pwa-ios-sheet__later">Not now</button>
      </div>
    `;

    const iconSrc =
      portal === "employee"
        ? "./assets/shiftswift-employee-app-icon-180.png?v=brandkit-v7"
        : "./assets/shiftswift-hr-app-icon-180.png?v=brandkit-v7";
    const iconImg = iosSheetEl.querySelector(".pwa-ios-sheet__icon");
    if (iconImg) iconImg.src = iconSrc;

    iosSheetBackdrop.addEventListener("click", closeIosInstallSheet);
    iosSheetEl.querySelector(".pwa-ios-sheet__got-it")?.addEventListener("click", closeIosInstallSheet);
    iosSheetEl.querySelector(".pwa-ios-sheet__later")?.addEventListener("click", () => {
      localStorage.setItem(dismissKey, "1");
      closeIosInstallSheet();
      hideBanner();
    });

    document.body.appendChild(iosSheetBackdrop);
    document.body.appendChild(iosSheetEl);
    return iosSheetEl;
  }

  function openIosInstallSheet() {
    ensureIosInstallSheet();
    if (!iosSheetEl || !iosSheetBackdrop) return;
    iosSheetBackdrop.hidden = false;
    iosSheetEl.hidden = false;
    document.body.classList.add("pwa-ios-sheet-open");
    iosSheetEl.querySelector(".pwa-ios-sheet__got-it")?.focus();
  }

  function closeIosInstallSheet() {
    if (!iosSheetEl || !iosSheetBackdrop) return;
    iosSheetBackdrop.hidden = true;
    iosSheetEl.hidden = true;
    document.body.classList.remove("pwa-ios-sheet-open");
  }

  function registerServiceWorker() {
    if (isNativeShell()) return;
    if (!("serviceWorker" in navigator)) return;
    if (portal === "employee" && window.ShiftSwiftEmployeePwa?.registerEmployeeSw) {
      window.ShiftSwiftEmployeePwa.registerEmployeeSw();
      return;
    }
    if (portal === "admin" && window.ShiftSwiftAdminPwa?.registerAdminSw) {
      window.ShiftSwiftAdminPwa.registerAdminSw();
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
    closeIosInstallSheet();
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

  function hideNativeInstallUi() {
    hideBanner();
    closeIosInstallSheet();
    document.querySelectorAll(".pwa-ios-sheet, .pwa-ios-sheet-backdrop").forEach((el) => {
      el.hidden = true;
      el.remove();
    });
  }

  if (isNativeShell()) {
    hideNativeInstallUi();
    window.ShiftSwiftPortalPwaInstall = {
      openIosInstallSheet() {},
      closeIosInstallSheet: hideNativeInstallUi,
      isStandalone: () => true,
    };
    return;
  }

  registerServiceWorker();

  if (layout === "landing" && isIos() && !isStandalone()) {
    openIosInstallSheet();
  } else {
    scheduleInstallBanner();
  }

  function scheduleInstallBanner() {
    const run = () => maybeShowInstallBanner();
    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 2000 });
      return;
    }
    window.setTimeout(run, 700);
  }

  window.ShiftSwiftPortalPwaInstall = {
    openIosInstallSheet,
    closeIosInstallSheet,
    isStandalone,
  };
})();
