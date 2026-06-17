/** Standard PWA / favicon links — Hastings-style app icons (brandkit-v5). */
(function () {
  const VERSION = "brandkit-v6";
  const ICONS = {
    hr: {
      favicon32: `./assets/shiftswift-hr-app-icon-192.png?v=${VERSION}`,
      faviconSvg: `./assets/app-icon-hr.svg?v=${VERSION}`,
      apple: `./assets/shiftswift-hr-app-icon-180.png?v=${VERSION}`,
    },
    clock: {
      favicon32: `./assets/shiftswift-clock-app-icon-192.png?v=${VERSION}`,
      faviconSvg: `./assets/app-icon-clock.svg?v=${VERSION}`,
      apple: `./assets/shiftswift-clock-app-icon-180.png?v=${VERSION}`,
    },
    employee: {
      favicon32: `./assets/shiftswift-employee-app-icon-192.png?v=${VERSION}`,
      faviconSvg: `./assets/app-icon-clock.svg?v=${VERSION}`,
      apple: `./assets/shiftswift-employee-app-icon-180.png?v=${VERSION}`,
    },
  };

  const variant = document.documentElement.dataset.appIcon || "hr";
  const set = ICONS[variant] || ICONS.hr;

  function upsertLink(rel, href, attrs) {
    const selector = attrs?.sizes ? `link[rel="${rel}"][sizes="${attrs.sizes}"]` : `link[rel="${rel}"]`;
    let el = document.head.querySelector(selector);
    if (!el) {
      el = document.createElement("link");
      el.rel = rel;
      document.head.appendChild(el);
    }
    if (attrs?.sizes) el.sizes = attrs.sizes;
    if (attrs?.type) el.type = attrs.type;
    el.href = href;
  }

  upsertLink("icon", set.favicon32, { sizes: "32x32", type: "image/png" });
  upsertLink("icon", set.faviconSvg, { type: "image/svg+xml" });
  upsertLink("apple-touch-icon", set.apple);
})();
