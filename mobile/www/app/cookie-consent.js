(function () {
  const CONSENT_KEY = "shiftswift_cookie_consent";
  const CONSENT_VERSION = "1";
  const CSS_HREF = "./cookie-consent.css?v=1";

  function loadStylesheet() {
    if (document.querySelector('link[href*="cookie-consent.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function readConsent() {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== CONSENT_VERSION) return null;
      return parsed.level === "all" || parsed.level === "essential" ? parsed.level : null;
    } catch {
      return null;
    }
  }

  function writeConsent(level) {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({
        version: CONSENT_VERSION,
        level,
        updatedAt: new Date().toISOString(),
      })
    );
    window.dispatchEvent(new CustomEvent("shiftswift:cookie-consent", { detail: { level } }));
  }

  function hideBanner(root) {
    root.hidden = true;
    document.body.classList.remove("cookie-consent-open");
  }

  function showBanner(root) {
    root.hidden = false;
    document.body.classList.add("cookie-consent-open");
  }

  function buildBanner() {
    const root = document.createElement("aside");
    root.id = "cookie-consent-banner";
    root.className = "cookie-consent";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-label", "Cookie preferences");
    root.innerHTML = `
      <div class="cookie-consent__inner">
        <p class="cookie-consent__text">
          We use strictly necessary cookies and local storage so ShiftSwift HR works — sign-in, security, and your workspace.
          Optional functional storage remembers dismissed banners. See our
          <a href="./cookies.html">Cookie policy</a>.
        </p>
        <div class="cookie-consent__actions">
          <button type="button" class="cookie-consent__btn cookie-consent__btn--primary" data-consent="all">Accept all</button>
          <button type="button" class="cookie-consent__btn cookie-consent__btn--ghost" data-consent="essential">Essential only</button>
          <button type="button" class="cookie-consent__btn cookie-consent__btn--link" data-consent-toggle>Manage</button>
        </div>
        <div class="cookie-consent__panel" data-consent-panel hidden>
          <div class="cookie-consent__option">
            <div>
              <strong>Strictly necessary</strong>
              <span>Sign-in tokens, security, load balancing, and cookie preference storage.</span>
            </div>
            <span class="cookie-consent__badge">Always on</span>
          </div>
          <div class="cookie-consent__option">
            <div>
              <strong>Functional</strong>
              <span>Remembers UI preferences and dismissed install banners.</span>
            </div>
            <span class="cookie-consent__badge">Optional</span>
          </div>
          <div class="cookie-consent__option">
            <div>
              <strong>Analytics</strong>
              <span>We do not use analytics cookies today. If we add them, we will ask for consent first.</span>
            </div>
            <span class="cookie-consent__badge">Not used</span>
          </div>
        </div>
      </div>
    `;

    root.querySelectorAll("[data-consent]").forEach((btn) => {
      btn.addEventListener("click", () => {
        writeConsent(btn.getAttribute("data-consent"));
        hideBanner(root);
      });
    });

    const toggle = root.querySelector("[data-consent-toggle]");
    const panel = root.querySelector("[data-consent-panel]");
    toggle?.addEventListener("click", () => {
      if (!panel) return;
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.textContent = open ? "Hide" : "Manage";
    });

    return root;
  }

  function init() {
    loadStylesheet();
    if (readConsent()) return;

    const banner = buildBanner();
    document.body.appendChild(banner);
    showBanner(banner);
  }

  window.ShiftSwiftCookieConsent = {
    getConsent: readConsent,
    setConsent: writeConsent,
    openBanner() {
      let banner = document.getElementById("cookie-consent-banner");
      if (!banner) {
        banner = buildBanner();
        document.body.appendChild(banner);
      }
      showBanner(banner);
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
