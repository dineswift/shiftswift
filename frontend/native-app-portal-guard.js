/** Strip stale production startup loader on admin/employee/master in Capacitor. */
(function initNativePortalGuard() {
  try {
    var path = String(window.location.pathname || "");
    var isLegacyLoginPage =
      /employee-login\.html$/i.test(path) ||
      /business-login\.html$/i.test(path) ||
      /sign-in\.html$/i.test(path) ||
      /native-app-login\.html$/i.test(path);

    if (isLegacyLoginPage) {
      var skipBundledLoginRedirect = false;
      try {
        skipBundledLoginRedirect = window.Capacitor?.config?.appId === "co.uk.shiftswifthr.app";
      } catch (e) {
        /* ignore */
      }
      if (!skipBundledLoginRedirect) {
        function bootLegacyLoginRedirect() {
          try {
            var cap = window.Capacitor;
            var scheme =
              window.ShiftSwiftNativeBundledUrl?.scheme?.() ||
              (cap?.getPlatform?.() === "android"
                ? cap?.config?.server?.androidScheme || "https"
                : cap?.config?.ios?.scheme || "App");
            var src = scheme + "://localhost/native-unified-login-redirect.js?v=37";
            if (!document.querySelector('script[data-sshr-unified-login-redirect="1"]')) {
              var boot = document.createElement("script");
              boot.src = src;
              boot.setAttribute("data-sshr-unified-login-redirect", "1");
              boot.async = false;
              (document.head || document.documentElement).appendChild(boot);
            }
          } catch (e) {
            /* ignore */
          }
        }
        bootLegacyLoginRedirect();
      }
      return;
    }

    var onPortal =
      /admin\.html$/i.test(path) ||
      /employee\.html$/i.test(path) ||
      /master\.html$/i.test(path);
    if (!onPortal) return;

    window.__SSHR_PORTAL_GUARD = true;
    var version = "54";

    if (
      /admin\.html$/i.test(path) &&
      /app\.shiftswifthr\.co\.uk/i.test(String(window.location.href || ""))
    ) {
      var unifiedIphone = false;
      try {
        unifiedIphone =
          window.Capacitor?.config?.appId === "co.uk.shiftswifthr.app" ||
          localStorage.getItem("sshrUnifiedNativeApp") === "1";
      } catch (e) {
        /* ignore */
      }
      if (!unifiedIphone) {
        try {
          var nativeScheme =
            window.ShiftSwiftNativeBundledUrl?.scheme?.() ||
            (window.Capacitor?.getPlatform?.() === "android"
              ? window.Capacitor?.config?.server?.androidScheme || "https"
              : window.Capacitor?.config?.server?.iosScheme ||
                window.Capacitor?.config?.ios?.scheme ||
                "App");
          var bundledAdmin = nativeScheme + "://localhost/admin.html" + (window.location.search || "") + (window.location.hash || "");
          window.location.replace(bundledAdmin);
          return;
        } catch (e) {
          /* ignore */
        }
      }
    }

    function hideNativeSplash() {
      try {
        window.Capacitor?.Plugins?.SplashScreen?.hide?.();
      } catch (e) {
        /* ignore */
      }
      try {
        window.ShiftSwiftNativeApp?.hideSplash?.();
        window.ShiftSwiftNativeApp?.dismissStartupLoader?.();
      } catch (e) {
        /* ignore */
      }
    }

    function unlockNativePortalUi() {
      try {
        hideNativeSplash();
        document.documentElement.classList.remove("native-startup-active");
        if (document.body) {
          document.body.classList.remove("native-startup-active", "portal-startup-pending");
          document.body.classList.add("portal-startup-ready");
        }
        var loader = document.getElementById("native-startup-loader");
        if (loader) loader.remove();
        var gdpr = document.getElementById("employee-gdpr-modal");
        if (!gdpr || gdpr.hidden) {
          document.body?.classList.remove("employee-gdpr-locked");
        }
        var overlay = document.getElementById("sidebar-overlay");
        if (!overlay || !overlay.classList.contains("sidebar-overlay--visible")) {
          if (window.ShiftSwiftPortalStability && window.ShiftSwiftPortalStability.lockBodyScroll) {
            window.ShiftSwiftPortalStability.lockBodyScroll(false);
          }
          if (document.body.classList.contains("no-scroll")) {
            document.body.classList.remove("no-scroll");
            document.body.style.position = "";
            document.body.style.top = "";
            document.body.style.left = "";
            document.body.style.right = "";
            document.body.style.width = "";
          }
        }
        var content = document.querySelector("main.content");
        if (content) {
          content.style.overflow = "";
          content.style.touchAction = "";
        }
      } catch (e) {
        /* ignore */
      }
    }

    window.__SSHR_UNLOCK_NATIVE_PORTAL_UI = unlockNativePortalUi;

    function markNativeShell() {
      try {
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
          window.__SSHR_BUNDLED_NATIVE_BOOT = true;
          document.documentElement.classList.add("native-app", "capacitor-native");
          if (document.body) document.body.classList.add("native-app");
        }
      } catch (e) {
        /* ignore */
      }
    }

    function injectHideStyles() {
      if (document.getElementById("sshr-portal-hide-loader")) return;
      var style = document.createElement("style");
      style.id = "sshr-portal-hide-loader";
      style.textContent =
        "#native-startup-loader,.native-startup-loader{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;position:absolute!important;left:-9999px!important;top:-9999px!important;width:0!important;}" +
        "#portal-pwa-install-banner,.portal-pwa-install-banner,.pwa-ios-sheet,.pwa-ios-sheet-backdrop{display:none!important;visibility:hidden!important;pointer-events:none!important;}" +
        "html.native-startup-active,html.native-startup-active body,body.native-startup-active{overflow:auto!important;}" +
        "html.native-app.capacitor-native body.employee-portal .employee-app,html.native-app.capacitor-native body.employee-portal #mobile-tab-bar,html.native-app.capacitor-native body.admin-portal #mobile-tab-bar,html.native-app body.employee-portal.portal-startup-pending .app>main.content,html.native-app body.employee-portal.portal-startup-pending #mobile-tab-bar,html.native-app body.admin-portal.portal-startup-pending .app>main.content,html.native-app body.admin-portal.portal-startup-pending #mobile-tab-bar{pointer-events:auto!important;}" +
        "html.native-app.capacitor-native .topbar.app-mobile-header,html.native-app.capacitor-native body.admin-mobile-detail .topbar,html.native-app.capacitor-native body.employee-mobile-detail .topbar{padding-top:max(12px,env(safe-area-inset-top))!important;padding-left:max(12px,env(safe-area-inset-left))!important;padding-right:max(12px,env(safe-area-inset-right))!important;}";
      (document.head || document.documentElement).appendChild(style);
    }

    markNativeShell();
    unlockNativePortalUi();

    function stripStartupLoader() {
      injectHideStyles();
      unlockNativePortalUi();
      var loader = document.getElementById("native-startup-loader");
      if (loader) loader.remove();
      if (document.documentElement.classList.contains("native-startup-active")) {
        document.documentElement.classList.remove("native-startup-active");
      }
      if (document.body && document.body.classList.contains("native-startup-active")) {
        document.body.classList.remove("native-startup-active");
      }
    }

    function settlePortalShell() {
      if (window.__SSHR_PORTAL_GUARD_SETTLED) return;
      window.__SSHR_PORTAL_GUARD_SETTLED = true;
      stripStartupLoader();
      observer.disconnect();
      if (window.__SSHR_PORTAL_GUARD_INTERVAL) {
        window.clearInterval(window.__SSHR_PORTAL_GUARD_INTERVAL);
        window.__SSHR_PORTAL_GUARD_INTERVAL = null;
      }
    }

    injectHideStyles();
    stripStartupLoader();

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        if (mutations[i].type !== "childList") continue;
        if (document.getElementById("native-startup-loader")) {
          stripStartupLoader();
          return;
        }
      }
    });

    function startObserver() {
      if (!document.documentElement) return;
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      stripStartupLoader();
    }

    if (document.documentElement) {
      startObserver();
    } else {
      document.addEventListener(
        "readystatechange",
        function onReady() {
          if (document.documentElement) {
            document.removeEventListener("readystatechange", onReady);
            startObserver();
          }
        },
        false,
      );
    }

    document.addEventListener("DOMContentLoaded", stripStartupLoader, { once: true });
    window.addEventListener("load", stripStartupLoader, { once: true });
    var guardTicks = 0;
    window.__SSHR_PORTAL_GUARD_INTERVAL = window.setInterval(function () {
      guardTicks += 1;
      stripStartupLoader();
      if (guardTicks >= 12) settlePortalShell();
    }, 500);
    window.addEventListener("shiftswift:portal-ready", settlePortalShell, { once: true });
    window.setTimeout(settlePortalShell, 10000);

    var unlockTicks = 0;
    window.__SSHR_PORTAL_UNLOCK_INTERVAL = window.setInterval(function () {
      unlockTicks += 1;
      unlockNativePortalUi();
      if (unlockTicks >= 30) {
        window.clearInterval(window.__SSHR_PORTAL_UNLOCK_INTERVAL);
        window.__SSHR_PORTAL_UNLOCK_INTERVAL = null;
      }
    }, 500);

    document.addEventListener("DOMContentLoaded", unlockNativePortalUi, { once: true });
    window.addEventListener("load", unlockNativePortalUi, { once: true });
    window.addEventListener("shiftswift:native-session-ready", unlockNativePortalUi, { once: true });
    window.addEventListener("employee:profile-loaded", unlockNativePortalUi, { once: true });
    window.addEventListener("admin:overview-loaded", unlockNativePortalUi, { once: true });

    function assetUrl(file) {
      if (window.ShiftSwiftNativeBundledUrl?.assetUrl) {
        return window.ShiftSwiftNativeBundledUrl.assetUrl(file, version);
      }
      var scheme =
        window.ShiftSwiftNativeBundledUrl?.scheme?.() ||
        (window.Capacitor?.getPlatform?.() === "android"
          ? window.Capacitor?.config?.server?.androidScheme || "https"
          : window.Capacitor?.config?.server?.iosScheme ||
            window.Capacitor?.config?.ios?.scheme ||
            "App");
      return String(scheme) + "://localhost/" + file + "?v=" + version;
    }

    function injectSessionHandoff() {
      try {
        var params = new URLSearchParams(window.location.search);
        var encoded = params.get("sshr_handoff");
        if (encoded) {
          var json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
          var data = JSON.parse(json);
          if (data && data.ts && Date.now() - data.ts < 120000) {
            ["token", "refreshToken", "tenantId", "userRole", "masterTenantId"].forEach(function (key) {
              if (data[key]) localStorage.setItem(key, String(data[key]));
            });
            window.__SSHR_HANDOFF_CONSUMED = true;
            params.delete("sshr_handoff");
            var query = params.toString();
            history.replaceState(
              null,
              "",
              window.location.pathname + (query ? "?" + query : "") + (window.location.hash || ""),
            );
          }
        }
        var bridge = sessionStorage.getItem("sshrNativeSessionBridge");
        if (bridge) {
          var bridgeData = JSON.parse(bridge);
          if (bridgeData && bridgeData.ts && Date.now() - bridgeData.ts < 120000) {
            ["token", "refreshToken", "tenantId", "userRole", "masterTenantId"].forEach(function (key) {
              if (bridgeData[key]) localStorage.setItem(key, String(bridgeData[key]));
            });
            sessionStorage.removeItem("sshrNativeSessionBridge");
          }
        }
      } catch (e) {
        /* ignore */
      }
    }

    injectSessionHandoff();

    function hijackProductionPortalScripts() {
      if (!/employee\.html$/i.test(path) && !/admin\.html$/i.test(path)) return;

      function rewrite(node) {
        if (!node || node.tagName !== "SCRIPT") return;
        var src = node.getAttribute("src") || "";
        if (/session-auth\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-session-auth")) return;
          node.setAttribute("data-sshr-portal-session-auth", "1");
          node.src = assetUrl("session-auth.js");
          return;
        }
        if (/native-api-fetch\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-api-fetch")) return;
          node.setAttribute("data-sshr-portal-api-fetch", "1");
          node.src = assetUrl("native-api-fetch.js");
          return;
        }
        if (/auth-guard\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-auth-guard")) return;
          node.setAttribute("data-sshr-portal-auth-guard", "1");
          node.src = assetUrl("auth-guard.js");
          return;
        }
        if (/admin-mobile\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-admin-mobile")) return;
          node.setAttribute("data-sshr-portal-admin-mobile", "1");
          node.src = assetUrl("admin-mobile.js");
          return;
        }
        if (/admin-workspace\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-admin-workspace")) return;
          node.setAttribute("data-sshr-portal-admin-workspace", "1");
          node.src = assetUrl("admin-workspace.js");
          return;
        }
        if (/admin-shared\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-admin-shared")) return;
          node.setAttribute("data-sshr-portal-admin-shared", "1");
          node.src = assetUrl("admin-shared.js");
          return;
        }
        if (!/employee\.html$/i.test(path)) return;
        if (/native-employee-portal\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-employee-native")) return;
          node.setAttribute("data-sshr-portal-employee-native", "1");
          node.src = assetUrl("native-employee-portal.js");
          return;
        }
        if (/employee-push-alerts\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-push-alerts")) return;
          node.setAttribute("data-sshr-portal-push-alerts", "1");
          node.src = assetUrl("employee-push-alerts.js");
          return;
        }
        if (/native-shift-alerts\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-shift-alerts")) return;
          node.setAttribute("data-sshr-portal-shift-alerts", "1");
          node.src = assetUrl("native-shift-alerts.js");
          return;
        }
        if (/push-notifications\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-push")) return;
          node.setAttribute("data-sshr-portal-push", "1");
          node.src = assetUrl("push-notifications.js");
          return;
        }
        if (/employee-mobile\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-employee-mobile")) return;
          node.setAttribute("data-sshr-portal-employee-mobile", "1");
          node.src = assetUrl("employee-mobile.js");
          return;
        }
        if (/mobile-shell\.js/i.test(src)) {
          if (node.getAttribute("data-sshr-portal-mobile-shell")) return;
          node.setAttribute("data-sshr-portal-mobile-shell", "1");
          node.src = assetUrl("mobile-shell.js");
          return;
        }
        if (/employee\.js/i.test(src) && !/employee-push/.test(src) && !/employee-mobile/.test(src)) {
          if (node.getAttribute("data-sshr-portal-employee")) return;
          node.setAttribute("data-sshr-portal-employee", "1");
          node.src = assetUrl("employee.js");
          return;
        }
      }

      var existing = document.querySelectorAll("script[src]");
      for (var e = 0; e < existing.length; e += 1) rewrite(existing[e]);

      var scriptObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i += 1) {
          var nodes = mutations[i].addedNodes;
          for (var j = 0; j < nodes.length; j += 1) rewrite(nodes[j]);
        }
      });
      scriptObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    hijackProductionPortalScripts();

    function appendScript(src, marker) {
      if (document.querySelector('script[' + marker + '="1"]')) return;
      var script = document.createElement("script");
      script.src = src;
      script.setAttribute(marker, "1");
      script.async = false;
      if (marker === "data-sshr-portal-shift-alerts") {
        script.onload = function () {
          window.dispatchEvent(new CustomEvent("shiftswift:native-shift-alerts-ready"));
        };
      }
      document.head.appendChild(script);
    }

    function appendStylesheet(href, marker) {
      if (document.querySelector('link[' + marker + '="1"]')) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute(marker, "1");
      document.head.appendChild(link);
    }

    function injectSyncScript(src, marker) {
      if (document.querySelector('script[' + marker + '="1"]')) return;
      document.write('<script src="' + src + '" ' + marker + '="1"><\/script>');
    }

    function loadBundledPortalAssets() {
      try {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        var isEmployee = /employee\.html$/i.test(path);
        var isAdmin = /admin\.html$/i.test(path);
        var onProductionAdmin =
          isAdmin && /app\.shiftswifthr\.co\.uk/i.test(String(window.location.href || ""));
        var unifiedIphone = false;
        try {
          unifiedIphone =
            window.Capacitor?.config?.appId === "co.uk.shiftswifthr.app" ||
            localStorage.getItem("sshrUnifiedNativeApp") === "1";
        } catch (e) {
          /* ignore */
        }
        var useProductionAdminShell = onProductionAdmin && unifiedIphone;
        var stillParsing = document.readyState === "loading";
        appendStylesheet(assetUrl("iphone-app-ui.css"), "data-sshr-portal-ui");
        if (isAdmin) {
          appendStylesheet(assetUrl("admin-mobile-polish.css"), "data-sshr-portal-admin-polish");
        }
        if (stillParsing) {
          injectSyncScript(assetUrl("native-bundled-url.js"), "data-sshr-portal-bundled-url");
          injectSyncScript(assetUrl("native-api-fetch.js"), "data-sshr-portal-api-fetch");
          injectSyncScript(assetUrl("session-auth.js"), "data-sshr-portal-session-auth");
          injectSyncScript(assetUrl("auth-guard.js"), "data-sshr-portal-auth-guard");
          if (isAdmin && !useProductionAdminShell) {
            injectSyncScript(assetUrl("admin-mobile.js"), "data-sshr-portal-admin-mobile");
            injectSyncScript(assetUrl("admin-portal-boot.js"), "data-sshr-portal-admin-boot");
          }
        }
        appendScript(assetUrl("native-bundled-url.js"), "data-sshr-portal-bundled-url");
        appendScript(assetUrl("native-api-fetch.js"), "data-sshr-portal-api-fetch");
        appendScript(assetUrl("session-auth.js"), "data-sshr-portal-session-auth");
        appendScript(assetUrl("auth-guard.js"), "data-sshr-portal-auth-guard");
        appendScript(assetUrl("action-feedback.js"), "data-sshr-portal-action-feedback");
        if (isAdmin) {
          appendScript(assetUrl("admin-mobile.js"), "data-sshr-portal-admin-mobile");
          if (!useProductionAdminShell) {
            appendScript(assetUrl("admin-portal-boot.js"), "data-sshr-portal-admin-boot");
          }
        }
        if (useProductionAdminShell && !document.getElementById("sshr-native-build-banner")) {
          var banner = document.createElement("div");
          banner.id = "sshr-native-build-banner";
          banner.style.cssText =
            "position:fixed;top:max(6px,env(safe-area-inset-top));right:8px;z-index:99999;padding:4px 8px;border-radius:999px;background:rgba(15,110,86,0.92);color:#fff;font:600 10px/1.2 system-ui,-apple-system,sans-serif";
          banner.textContent = "Build 43 · prod admin";
          document.body?.appendChild(banner);
        }
        if (useProductionAdminShell) {
          function bootProductionAdminShell() {
            hideNativeSplash();
            unlockNativePortalUi();
            document.body?.classList.remove("portal-startup-pending");
            document.body?.classList.add("portal-startup-ready");
            window.__SSHR_PORTAL_READY = true;
            window.dispatchEvent(new CustomEvent("shiftswift:portal-ready"));
            window.AdminMobile?.finishStartup?.(localStorage.getItem("adminTimeClockEnabled") === "true");
          }
          bootProductionAdminShell();
          document.addEventListener("DOMContentLoaded", bootProductionAdminShell, { once: true });
          window.addEventListener("load", bootProductionAdminShell, { once: true });
          [80, 300, 1000, 2500].forEach(function (ms) {
            window.setTimeout(bootProductionAdminShell, ms);
          });
        }
        if (isEmployee) {
          appendScript(assetUrl("native-employee-portal.js"), "data-sshr-portal-employee-native");
          appendScript(assetUrl("mobile-shell.js"), "data-sshr-portal-mobile-shell");
          appendScript(assetUrl("employee-mobile.js"), "data-sshr-portal-employee-mobile");
          appendScript(assetUrl("employee.js"), "data-sshr-portal-employee");
          appendScript(assetUrl("native-geolocation.js"), "data-sshr-portal-native-geo");
          appendScript(assetUrl("native-shift-alerts.js"), "data-sshr-portal-shift-alerts");
          appendScript(assetUrl("push-notifications.js"), "data-sshr-portal-push");
          appendScript(assetUrl("employee-push-alerts.js"), "data-sshr-portal-push-alerts");
        }
        appendScript(assetUrl("native-app-bootstrap.js"), "data-sshr-portal-guard-bootstrap");
        window.setTimeout(function () {
          window.ShiftSwiftNativeApiFetch?.bootWhenReady?.();
          window.ShiftSwiftSession?.consumeNativeSessionHandoff?.();
          void window.ShiftSwiftSession?.hydrateNativeSession?.({ force: true });
          window.ShiftSwiftNativeApp?.patchNativeSignOut?.();
          window.dispatchEvent(new CustomEvent("shiftswift:native-session-ready"));
        }, 0);
      } catch (e) {
        /* ignore */
      }
    }

    if (window.Capacitor?.isNativePlatform?.()) {
      loadBundledPortalAssets();
    } else {
      var attempts = 0;
      var timer = window.setInterval(function () {
        attempts += 1;
        if (window.Capacitor?.isNativePlatform?.()) {
          window.clearInterval(timer);
          loadBundledPortalAssets();
        } else if (attempts > 500) {
          window.clearInterval(timer);
        }
      }, 10);
    }

    bootNativeEmployeeShiftAlerts(path);
  } catch (e) {
    /* ignore */
  }

  function bootNativeEmployeeShiftAlerts(pagePath) {
    if (!/employee\.html$/i.test(pagePath)) return;

    var ENABLED_KEY = "sshrNativeShiftAlerts";

    function isNative() {
      try {
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
          return true;
        }
        if (window.__SSHR_BUNDLED_NATIVE_BOOT || window.__SSHR_PORTAL_GUARD) return true;
        if (document.documentElement.classList.contains("native-app")) return true;
        if (document.documentElement.classList.contains("capacitor-native")) return true;
      } catch (e) {
        /* ignore */
      }
      return false;
    }

    function notificationsPlugin() {
      if (window.ShiftSwiftNativeShiftAlerts && window.ShiftSwiftNativeShiftAlerts.getNotificationsPlugin) {
        return window.ShiftSwiftNativeShiftAlerts.getNotificationsPlugin();
      }
      return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    }

    function isEnabled() {
      try {
        return localStorage.getItem(ENABLED_KEY) === "1";
      } catch (e) {
        return false;
      }
    }

    function setEnabled(on) {
      try {
        if (on) localStorage.setItem(ENABLED_KEY, "1");
        else localStorage.removeItem(ENABLED_KEY);
      } catch (e) {
        /* ignore */
      }
    }

    function elements() {
      return {
        banner: document.getElementById("employee-alerts-banner"),
        statusEl: document.getElementById("employee-alerts-status"),
        enableBtn: document.getElementById("employee-enable-alerts-btn"),
        topbarBtn: document.getElementById("employee-topbar-alerts-btn"),
      };
    }

    function setBanner(active, message) {
      var els = elements();
      if (els.banner) {
        els.banner.hidden = Boolean(active);
        els.banner.classList.toggle("employee-alerts-banner--active", Boolean(active));
      }
      if (els.statusEl && message) els.statusEl.textContent = message;
      if (els.enableBtn) {
        els.enableBtn.textContent = active ? "Alerts on" : "Turn on alerts";
        els.enableBtn.disabled = Boolean(active);
      }
      if (els.topbarBtn) {
        els.topbarBtn.classList.toggle("employee-topbar-alerts-btn--active", Boolean(active));
      }
    }

    async function waitForPlugin() {
      var deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        var plugin = notificationsPlugin();
        if (plugin && plugin.checkPermissions) return plugin;
        await new Promise(function (resolve) {
          window.setTimeout(resolve, 200);
        });
      }
      return null;
    }

    async function refreshNativeAlerts() {
      if (!isNative()) return;

      var els = elements();
      if (!els.enableBtn && !els.banner) return;

      els.enableBtn && (els.enableBtn.disabled = false);

      if (!localStorage.getItem("tenantId")) {
        setBanner(false, "Turn on alerts for shift-start reminders on this phone.");
        return;
      }

      var plugin = await waitForPlugin();
      if (!plugin) {
        setBanner(
          false,
          "Tap Turn on alerts for shift-start reminders (e.g. It's 09:00 and you can clock in now).",
        );
        return;
      }

      try {
        var permResult = await plugin.checkPermissions();
        var permission = (permResult && permResult.display) || "prompt";

        if (permission === "denied") {
          setBanner(
            false,
            "Notifications blocked — open iPhone Settings → ShiftSwift HR → Notifications, then tap Try again.",
          );
          if (els.enableBtn) els.enableBtn.textContent = "Try again";
          return;
        }

        if (isEnabled() && permission === "granted") {
          setBanner(
            true,
            "Alerts on — you'll get \"It's 09:00 and you can clock in now\" at shift start, even when the app is closed.",
          );
          window.dispatchEvent(new CustomEvent("employee:shift-alerts-enabled"));
          return;
        }

        setBanner(
          false,
          "Tap Turn on alerts for a reminder at shift start — even when the app is closed.",
        );
      } catch (e) {
        setBanner(false, "Tap Turn on alerts to enable shift reminders on this phone.");
      }
    }

    async function enableNativeAlerts(event) {
      if (event) {
        event.preventDefault();
      }
      if (!isNative()) return;

      var els = elements();
      if (!els.enableBtn && !els.banner) return;

      if (event) event.stopImmediatePropagation();

      if (els.statusEl) els.statusEl.textContent = "Turning on alerts…";
      if (els.enableBtn) els.enableBtn.disabled = true;

      if (window.ShiftSwiftNativeShiftAlerts && window.ShiftSwiftNativeShiftAlerts.enableAlerts) {
        var viaModule = await window.ShiftSwiftNativeShiftAlerts.enableAlerts();
        if (viaModule.ok) {
          await refreshNativeAlerts();
          return;
        }
        if (viaModule.reason === "denied") {
          setBanner(
            false,
            "Notifications blocked — open iPhone Settings → ShiftSwift HR → Notifications, then tap Try again.",
          );
          if (els.enableBtn) {
            els.enableBtn.disabled = false;
            els.enableBtn.textContent = "Try again";
          }
          return;
        }
      }

      var plugin = await waitForPlugin();
      if (!plugin || !plugin.requestPermissions) {
        setBanner(false, "Could not reach notification services. Try again.");
        if (els.enableBtn) els.enableBtn.disabled = false;
        return;
      }

      try {
        var result = await plugin.requestPermissions();
        var permission = (result && result.display) || "denied";
        if (permission !== "granted") {
          setBanner(false, "Notifications blocked — allow alerts in iPhone Settings, then tap Try again.");
          if (els.enableBtn) {
            els.enableBtn.disabled = false;
            els.enableBtn.textContent = "Try again";
          }
          return;
        }
        setEnabled(true);
        window.dispatchEvent(new CustomEvent("employee:shift-alerts-enabled"));
        await refreshNativeAlerts();
      } catch (e) {
        setBanner(false, "Could not enable alerts. Tap Try again.");
        if (els.enableBtn) els.enableBtn.disabled = false;
      }
    }

    function bindUi() {
      if (window.__SSHR_NATIVE_SHIFT_ALERTS_UI__) return;
      window.__SSHR_NATIVE_SHIFT_ALERTS_UI__ = true;

      document.addEventListener(
        "click",
        function (event) {
          if (!isNative()) return;
          var target =
            event.target && event.target.closest
              ? event.target.closest("#employee-enable-alerts-btn, #employee-topbar-alerts-btn")
              : null;
          if (!target) return;
          void enableNativeAlerts(event);
        },
        true,
      );

      window.addEventListener("employee:profile-loaded", function () {
        void refreshNativeAlerts();
      });
      window.addEventListener("shiftswift:native-session-ready", function () {
        void refreshNativeAlerts();
      });
      window.addEventListener("shiftswift:portal-ready", function () {
        void refreshNativeAlerts();
      });
      window.addEventListener("employee:shift-alerts-enabled", function () {
        void refreshNativeAlerts();
      });
    }

    function start() {
      function attemptStart() {
        if (!isNative()) return false;
        bindUi();
        void refreshNativeAlerts();
        if (!window.__SSHR_NATIVE_SHIFT_ALERTS_UNLOCK__) {
          window.__SSHR_NATIVE_SHIFT_ALERTS_UNLOCK__ = true;
          window.setInterval(function () {
            if (!isNative()) return;
            var status = document.getElementById("employee-alerts-status");
            if (status && /not supported on this browser/i.test(status.textContent || "")) {
              void refreshNativeAlerts();
            }
            if (!isEnabled()) {
              var btn = document.getElementById("employee-enable-alerts-btn");
              if (btn && btn.disabled) btn.disabled = false;
            }
          }, 800);
        }
        return true;
      }

      if (!attemptStart()) {
        var tries = 0;
        var timer = window.setInterval(function () {
          tries += 1;
          if (attemptStart() || tries > 400) {
            window.clearInterval(timer);
          }
        }, 25);
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
    window.addEventListener("load", start, { once: true });
  }
})();
