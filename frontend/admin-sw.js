/* ShiftSwift HR Admin — PWA service worker (business HR shell only). */
const CACHE_NAME = "shiftswift-admin-v1";
const SHELL = [
  "./admin.html",
  "./business-login.html",
  "./admin-manifest.webmanifest",
  "./styles.css",
  "./theme.css",
  "./brand-config.js",
  "./session-auth.js",
  "./admin-pwa.js",
  "./login.js",
  "./auth-guard.js",
  "./portal-pwa-install.js",
  "./push-notifications.js",
  "./mobile-shell.js",
  "./admin-mobile.js",
  "./assets/shiftswift-hr-app-icon-192.png",
  "./assets/shiftswift-hr-app-icon.png",
];

const STATIC_EXTENSIONS = /\.(css|js|png|svg|webmanifest|html)$/i;
const EMPLOYEE_ONLY_PATHS =
  /\/(employee-login|employee|punch)\.html$/i;

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
    if (EMPLOYEE_ONLY_PATHS.test(path)) {
      event.respondWith(Response.redirect(businessLoginUrl(event.request.url), 302));
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
        })
    );
    return;
  }

  const url = new URL(event.request.url);
  if (!STATIC_EXTENSIONS.test(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }
      return networkFetch.then((response) => response || caches.match(fallbackDocument(event.request.url)));
    })
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
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: "./assets/shiftswift-hr-app-icon-192.png",
        badge: "./assets/shiftswift-hr-app-icon-192.png",
        tag: data.tag || "shiftswift-admin",
        renotify: true,
        data: { url: data.url || "./admin.html#time-punch" },
        actions: [
          { action: "open", title: "Open app" },
          { action: "dismiss", title: "Dismiss" },
        ],
      });
    })()
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
        if (client.url.includes("admin.html") || client.url.includes("business-login.html")) {
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
    })()
  );
});
