/** Portal page fixes for Capacitor — hide loader, load bundled API + session helpers. */
(function initNativePortalFix() {
  function onPortalPage() {
    var path = String(window.location.pathname || "");
    return /admin\.html$|employee\.html$|master\.html$/i.test(path);
  }

  function scheme() {
    try {
      return (
        (window.Capacitor &&
          window.Capacitor.config &&
          window.Capacitor.config.server &&
          window.Capacitor.config.server.iosScheme) ||
        (window.Capacitor &&
          window.Capacitor.config &&
          window.Capacitor.config.ios &&
          window.Capacitor.config.ios.scheme) ||
        "App"
      );
    } catch (e) {
      return "App";
    }
  }

  function version() {
    return "45";
  }

  function injectHideStyles() {
    if (document.getElementById("sshr-portal-hide-loader")) return;
    var style = document.createElement("style");
    style.id = "sshr-portal-hide-loader";
    style.textContent =
      "#native-startup-loader,.native-startup-loader{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;opacity:0!important;pointer-events:none!important;position:absolute!important;left:-9999px!important;top:-9999px!important;width:0!important;}" +
      "html.native-startup-active,html.native-startup-active body,body.native-startup-active{overflow:auto!important;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function stripStartupLoader() {
    injectHideStyles();
    var loader = document.getElementById("native-startup-loader");
    var changed = false;
    if (loader) {
      loader.remove();
      changed = true;
    }
    if (document.documentElement.classList.contains("native-startup-active")) {
      document.documentElement.classList.remove("native-startup-active");
      changed = true;
    }
    if (document.body && document.body.classList.contains("native-startup-active")) {
      document.body.classList.remove("native-startup-active");
      changed = true;
    }
    return changed;
  }

  function settlePortalShell() {
    if (window.__SSHR_PORTAL_FIX_SETTLED) return;
    window.__SSHR_PORTAL_FIX_SETTLED = true;
    stripStartupLoader();
    if (window.__SSHR_PORTAL_FIX_OBSERVER) {
      window.__SSHR_PORTAL_FIX_OBSERVER.disconnect();
      window.__SSHR_PORTAL_FIX_OBSERVER = null;
    }
    if (window.__SSHR_PORTAL_FIX_INTERVAL) {
      window.clearInterval(window.__SSHR_PORTAL_FIX_INTERVAL);
      window.__SSHR_PORTAL_FIX_INTERVAL = null;
    }
  }

  function loadBundledScript(file) {
    if (document.querySelector('[data-sshr-portal-fix="' + file + '"]')) return;
    var script = document.createElement("script");
    script.src = scheme() + "://localhost/" + file + "?v=" + version();
    script.setAttribute("data-sshr-portal-fix", file);
    script.async = false;
    document.head.appendChild(script);
  }

  function hijackProductionPushScripts() {
    if (!/employee\.html$/i.test(String(window.location.pathname || ""))) return;

    function rewrite(node) {
      if (!node || node.tagName !== "SCRIPT") return;
      var src = node.getAttribute("src") || "";
      if (/employee-push-alerts\.js/i.test(src)) {
        node.src = scheme() + "://localhost/employee-push-alerts.js?v=" + version();
        return;
      }
      if (/native-shift-alerts\.js/i.test(src)) {
        node.src = scheme() + "://localhost/native-shift-alerts.js?v=" + version();
        return;
      }
      if (/push-notifications\.js/i.test(src)) {
        node.src = scheme() + "://localhost/push-notifications.js?v=" + version();
        return;
      }
      if (/employee\.js/i.test(src) && !/employee-push/.test(src)) {
        node.src = scheme() + "://localhost/employee.js?v=" + version();
      }
    }

    var existing = document.querySelectorAll("script[src]");
    for (var i = 0; i < existing.length; i += 1) rewrite(existing[i]);

    if (!window.__SSHR_PORTAL_FIX_SCRIPT_OBSERVER) {
      window.__SSHR_PORTAL_FIX_SCRIPT_OBSERVER = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m += 1) {
          var nodes = mutations[m].addedNodes;
          for (var n = 0; n < nodes.length; n += 1) rewrite(nodes[n]);
        }
      });
      if (document.documentElement) {
        window.__SSHR_PORTAL_FIX_SCRIPT_OBSERVER.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
    }
  }

  function loadBundledHelpers() {
    window.__SSHR_BUNDLED_NATIVE_BOOT = true;
    hijackProductionPushScripts();
    loadBundledScript("native-api-fetch.js");
    loadBundledScript("session-auth.js");
    loadBundledScript("native-app.js");
    if (/employee\.html$/i.test(String(window.location.pathname || ""))) {
      loadBundledScript("native-app-portal-guard.js");
      loadBundledScript("native-employee-portal.js");
      loadBundledScript("mobile-shell.js");
      loadBundledScript("employee-mobile.js");
      loadBundledScript("employee.js");
      loadBundledScript("native-shift-alerts.js");
      loadBundledScript("push-notifications.js");
      loadBundledScript("employee-push-alerts.js");
    }
  }

  function boot() {
    if (!onPortalPage()) return;
    window.__SSHR_PORTAL_GUARD = true;
    stripStartupLoader();
    if (window.__SSHR_UNLOCK_NATIVE_PORTAL_UI) {
      window.__SSHR_UNLOCK_NATIVE_PORTAL_UI();
    } else {
      try {
        document.documentElement.classList.remove("native-startup-active");
        document.body?.classList.remove("native-startup-active", "portal-startup-pending");
        document.body?.classList.add("portal-startup-ready");
      } catch (e) {
        /* ignore */
      }
    }
    loadBundledHelpers();
    window.setTimeout(function () {
      window.ShiftSwiftNativeApiFetch?.boot?.();
      window.ShiftSwiftNativeApp?.patchNativeSignOut?.();
      window.ShiftSwiftNativeApp?.sanitizeNativeApiBase?.();
      window.dispatchEvent(new CustomEvent("shiftswift:native-session-ready"));
      window.setTimeout(function () {
        window.ShiftSwiftNativeApiFetch?.retryPortalData?.();
      }, 600);
    }, 0);
  }

  window.__SSHR_PORTAL_FIX = {
    boot: boot,
    stripStartupLoader: stripStartupLoader,
  };

  if (!onPortalPage()) return;

  injectHideStyles();
  stripStartupLoader();

  if (!window.__SSHR_PORTAL_FIX_OBSERVER) {
    window.__SSHR_PORTAL_FIX_OBSERVER = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        if (mutations[i].type !== "childList") continue;
        if (document.getElementById("native-startup-loader")) {
          stripStartupLoader();
          return;
        }
      }
    });
    if (document.documentElement) {
      window.__SSHR_PORTAL_FIX_OBSERVER.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  var portalFixTicks = 0;
  window.__SSHR_PORTAL_FIX_INTERVAL = window.setInterval(function () {
    portalFixTicks += 1;
    stripStartupLoader();
    if (portalFixTicks >= 12) settlePortalShell();
  }, 500);

  window.addEventListener("shiftswift:portal-ready", settlePortalShell, { once: true });
  window.setTimeout(settlePortalShell, 10000);

  if (window.Capacitor?.isNativePlatform?.()) {
    boot();
  } else {
    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (window.Capacitor?.isNativePlatform?.()) {
        window.clearInterval(timer);
        boot();
      } else if (attempts > 600) {
        window.clearInterval(timer);
      }
    }, 10);
  }

  document.addEventListener("DOMContentLoaded", boot, { once: true });
  window.addEventListener("load", boot, { once: true });
})();
