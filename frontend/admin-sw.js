/* ShiftSwift HR Admin — PWA service worker (business HR shell only). */
const CACHE_NAME = "shiftswift-admin-v15";
const SHELL = [
  "./admin.html",
  "./sign-in.html",
  "./sign-in-manifest.webmanifest",
  "./native-app-login.html",
  "./business-login.html",
  "./forgot-password.html",
  "./install-business.html",
  "./reset-password.html",
  "./admin-manifest.webmanifest",
  "./styles.css",
  "./theme.css",
  "./brand-config.js",
  "./session-auth.js",
  "./admin-pwa.js",
  "./admin-push-alerts.js",
  "./portal-notifications.js",
  "./login.js",
  "./auth-guard.js",
  "./portal-pwa-install.js",
  "./portal-pwa-stability.js",
  "./pwa-ios.js",
  "./native-app.js",
  "./pwa-install-qr.js",
  "./push-notifications.js",
  "./action-feedback.js",
  "./mobile-shell.js",
  "./admin-mobile.js",
  "./admin-profile-changes.js",
  "./admin-employees.js",
  "./unified-login.js",
  "./trusted-device.js",
  "./passkey-auth.js",
  "./assets/shiftswift-hr-app-icon-192.png",
  "./assets/shiftswift-hr-app-icon.png",
  "./assets/shiftswift-hr-app-icon-180.png",
  "./assets/shiftswift-hr-splash-1170x2532.png",
];

const STATIC_EXTENSIONS = /\.(css|js|png|svg|webmanifest|html)$/i;
const MUTABLE_EXTENSIONS = /\.(css|js)$/i;
const CACHE_FIRST_EXTENSIONS = /\.(png|svg|woff2?)$/i;

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request));
}

function staleWhileRevalidate(event, request, cached) {
  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkFetch);
    return cached;
  }
  return networkFetch.then((response) => response || caches.match(fallbackDocument(request.url)));
}
const ADMIN_SHELL_PATHS = /\/(admin|sign-in|business-login|forgot-password|reset-password|install-business)\.html$/i;

function isSameOrigin(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isNavigation(request) {
  return request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
}

function businessLoginUrl(requestUrl) {
  return new URL("./business-login.html", requestUrl).toString();
}

function fallbackDocument(url) {
  const path = new URL(url).pathname;
  if (path.includes("business-login")) return "./business-login.html";
  return "./admin.html";
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(SHELL.map((entry) => cache.add(new Request(entry, { cache: "reload" }))));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !isSameOrigin(event.request)) return;

  if (isNavigation(event.request)) {
    const path = new URL(event.request.url).pathname;
    if (!ADMIN_SHELL_PATHS.test(path)) {
      return;
    }

    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match(fallbackDocument(event.request.url));
          return fallback || Response.error();
        }),
    );
    return;
  }

  const url = new URL(event.request.url);
  if (!STATIC_EXTENSIONS.test(url.pathname)) return;

  if (MUTABLE_EXTENSIONS.test(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (CACHE_FIRST_EXTENSIONS.test(url.pathname)) {
        return staleWhileRevalidate(event, event.request, cached);
      }
      return networkFirst(event.request);
    }),
  );
});

function parsePushPayload(event) {
  const fallback = {
    title: "ShiftSwift HR",
    body: "",
    url: "./admin.html#time-punch",
    tag: "shiftswift-admin",
  };
  if (!event.data) return fallback;
  try {
    return { ...fallback, ...event.data.json() };
  } catch {
    try {
      return { ...fallback, body: event.data.text() };
    } catch {
      return fallback;
    }
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const data = parsePushPayload(event);
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        client.postMessage({
          type: "SHIFT_ALERT",
          title: data.title,
          body: data.body,
          urgent: Boolean(data.urgent),
          alert_type: data.alert_type || "general",
        });
      }
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: "./assets/shiftswift-hr-app-icon-192.png",
        badge: "./assets/shiftswift-hr-app-icon-192.png",
        tag: data.tag || "shiftswift-admin",
        renotify: true,
        silent: false,
        data: { url: data.url || "./admin.html#time-punch", alert_type: data.alert_type || "general" },
        actions: [
          { action: "open", title: "Open app" },
          { action: "dismiss", title: "Dismiss" },
        ],
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "./admin.html#time-punch";
  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if (client.url.includes("admin.html") || client.url.includes("sign-in.html") || client.url.includes("native-app-login.html")) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* focus only */
            }
          }
          return;
        }
      }
      await clients.openWindow(targetUrl);
    })(),
  );
});
