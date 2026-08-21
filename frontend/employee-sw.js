/* ShiftSwift Employee Portal — PWA service worker (employee shell only). */
const CACHE_NAME = "shiftswift-employee-v15";
const SHELL = [
  "./employee.html",
  "./employee-login.html",
  "./employee-forgot-password.html",
  "./install-employee.html",
  "./reset-password.html",
  "./employee-manifest.webmanifest",
  "./styles.css",
  "./theme.css",
  "./brand-config.js",
  "./session-auth.js",
  "./employee-pwa.js",
  "./login.js",
  "./portal-pwa-install.js",
  "./portal-pwa-stability.js",
  "./pwa-ios.js",
  "./native-app.js",
  "./pwa-install-qr.js",
  "./push-notifications.js",
  "./action-feedback.js",
  "./mobile-shell.js",
  "./employee-mobile.js",
  "./employee.js",
  "./employee-time-punch.js",
  "./employee-rota.js",
  "./employee-my-details.js",
  "./employee-leave.js",
  "./assets/shiftswift-employee-app-icon-192.png",
  "./assets/shiftswift-employee-app-icon.png",
  "./assets/shiftswift-employee-app-icon-180.png",
  "./assets/shiftswift-employee-splash-1170x2532.png",
];

const STATIC_EXTENSIONS = /\.(css|js|png|svg|webmanifest|html)$/i;
const MUTABLE_EXTENSIONS = /\.(css|js)$/i;
const CACHE_FIRST_EXTENSIONS = /\.(png|svg|woff2?)$/i;
const EMPLOYEE_SHELL_PATHS = /\/(employee|employee-login|employee-forgot-password|install-employee)\.html$/i;

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

function employeeLoginUrl(requestUrl) {
  return new URL("./employee-login.html", requestUrl).toString();
}

function fallbackDocument(url) {
  const path = new URL(url).pathname;
  if (path.includes("employee-login")) return "./employee-login.html";
  if (path.includes("employee-forgot-password")) return "./employee-forgot-password.html";
  return "./employee.html";
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
    return;
  }
  if (event.data?.type === "SHOW_CLOCK_ALERT") {
    const title = event.data.title || "ShiftSwift Employee";
    const shown = self.registration.showNotification(
      title,
      buildClockNotificationOptions({
        body: event.data.body || "",
        tag: event.data.tag || "shiftswift-employee",
        url: event.data.url || "./employee.html#time-clock",
        alert_type: event.data.alert_type || "clock_in",
        urgent: true,
      }),
    );
    if (typeof event.waitUntil === "function") event.waitUntil(shown);
    else void shown;
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !isSameOrigin(event.request)) return;

  if (isNavigation(event.request)) {
    const path = new URL(event.request.url).pathname;
    if (!EMPLOYEE_SHELL_PATHS.test(path)) {
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
    title: "ShiftSwift Employee",
    body: "",
    url: "./employee.html#time-clock",
    tag: "shiftswift-employee",
    alert_type: "general",
    urgent: false,
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

const CLOCK_ALERT_TYPES = new Set([
  "shift_reminder",
  "shift_end_reminder",
  "clock_in",
  "clock_out",
  "missed_clock_in",
  "missed_clock_in_early",
]);

function buildClockNotificationOptions(data) {
  const urgent = Boolean(data.urgent || CLOCK_ALERT_TYPES.has(data.alert_type));
  const isClockOut = data.alert_type === "clock_out";
  return {
    body: data.body,
    icon: "./assets/shiftswift-employee-app-icon-192.png",
    badge: "./assets/shiftswift-employee-app-icon-192.png",
    tag: data.tag || "shiftswift-employee",
    renotify: true,
    silent: false,
    requireInteraction: urgent,
    vibrate: urgent ? [400, 120, 400, 120, 400, 120, 400] : [180, 80, 180],
    data: { url: data.url || "./employee.html#time-clock", alert_type: data.alert_type || "general" },
    actions: [
      { action: "open", title: isClockOut ? "Clock out now" : "Clock in now" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const data = parsePushPayload(event);
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        client.postMessage({ type: "SHIFT_ALERT", title: data.title, body: data.body, urgent: data.urgent });
      }
      await self.registration.showNotification(data.title, buildClockNotificationOptions(data));
    })()
  );
});

function resolveNotificationTarget(rawUrl) {
  try {
    return new URL(rawUrl, self.location.href).href;
  } catch {
    return new URL("./employee.html#time-clock", self.location.href).href;
  }
}

function hashFromTarget(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return url.hash || "";
  } catch {
    return "";
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = resolveNotificationTarget(
    event.notification.data?.url || "./employee.html#time-clock",
  );
  const hash = hashFromTarget(targetUrl);
  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if (client.url.includes("employee.html") || client.url.includes("employee-login.html")) {
          await client.focus();
          if (hash) {
            client.postMessage({ type: "SHIFT_NAVIGATE", hash });
          }
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
              return;
            } catch {
              /* fall through */
            }
          }
          if (hash) return;
        }
      }
      await clients.openWindow(targetUrl);
    })()
  );
});
