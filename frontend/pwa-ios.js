/** iPhone PWA helpers — device classes, launch splashes, install detection. */
(function initPwaIos() {
  const VERSION = "brandkit-v7";
  const SPLASH_SIZES = [
    { w: 430, h: 932, img: "1290x2796" },
    { w: 393, h: 852, img: "1179x2556" },
    { w: 390, h: 844, img: "1170x2532" },
    { w: 414, h: 896, img: "828x1792" },
    { w: 375, h: 667, img: "750x1334" },
  ];

  const PORTAL = document.documentElement.dataset.pwaPortal || document.documentElement.dataset.appIcon || "hr";
  const splashSlug = PORTAL === "employee" ? "employee" : "hr";

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }

  function isStandalone() {
    if (window.ShiftSwiftNativeApp?.isNativeApp?.()) return true;
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true
    );
  }

  function isIosSafari() {
    if (!isIos()) return false;
    const ua = navigator.userAgent;
    return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  }

  function applyDeviceClasses() {
    const root = document.documentElement;
    if (isIos()) root.classList.add("ios-device");
    if (isIosSafari()) root.classList.add("ios-safari");
    if (isStandalone()) {
      root.classList.add("pwa-standalone");
      document.body?.classList.add("pwa-standalone");
    }
  }

  function upsertLink(rel, href, attrs) {
    const selector = attrs?.media
      ? `link[rel="${rel}"][media="${attrs.media}"]`
      : attrs?.sizes
        ? `link[rel="${rel}"][sizes="${attrs.sizes}"]`
        : `link[rel="${rel}"]`;
    let el = document.head.querySelector(selector);
    if (!el) {
      el = document.createElement("link");
      el.rel = rel;
      document.head.appendChild(el);
    }
    if (attrs?.media) el.media = attrs.media;
    if (attrs?.sizes) el.sizes = attrs.sizes;
    el.href = href;
  }

  function injectLaunchSplashes() {
    if (!isIos()) return;
    for (const size of SPLASH_SIZES) {
      upsertLink(
        "apple-touch-startup-image",
        `./assets/shiftswift-${splashSlug}-splash-${size.img}.png?v=${VERSION}`,
        { media: `(device-width: ${size.w}px) and (device-height: ${size.h}px) and (-webkit-device-pixel-ratio: 3)` },
      );
    }
    upsertLink(
      "apple-touch-startup-image",
      `./assets/shiftswift-${splashSlug}-splash-1170x2532.png?v=${VERSION}`,
    );
  }

  applyDeviceClasses();
  injectLaunchSplashes();

  window.ShiftSwiftPwaIos = {
    isIos,
    isStandalone,
    isIosSafari,
    portal: PORTAL,
  };
})();
