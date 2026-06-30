/** In-app notification bell + feed (HR admin + employee portals). */
(function () {
  function apiBase() {
    return window.Admin?.getApiBase?.() || window.ShiftSwiftBrand?.getApiBase?.() || "http://localhost:3000";
  }

  function authHeaders(json = true) {
    const token = localStorage.getItem("token") || "";
    const tenantId = localStorage.getItem("tenantId") || "";
    const headers = {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantId,
    };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  async function apiFetch(path, options = {}) {
    if (window.Admin?.apiFetch) {
      return window.Admin.apiFetch(path, options);
    }
    const session = window.ShiftSwiftSession;
    if (session?.authorizedFetch) {
      return session.authorizedFetch(`${apiBase()}${path}`, options);
    }
    return fetch(`${apiBase()}${path}`, {
      ...options,
      headers: { ...authHeaders(options.body != null), ...(options.headers || {}) },
    });
  }

  function escapeHtml(value) {
    if (window.Admin?.escapeHtml) return window.Admin.escapeHtml(value);
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensurePanel(host) {
    let panel = host.querySelector(".portal-notifications-panel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.className = "portal-notifications-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="portal-notifications-panel__head">
        <strong>Notifications</strong>
        <button type="button" class="btn ghost btn-sm" data-notifications-mark-all>Mark all read</button>
      </div>
      <div class="portal-notifications-panel__list" data-notifications-list></div>
      <p class="portal-notifications-panel__empty muted" data-notifications-empty hidden>No notifications yet.</p>
    `;
    host.appendChild(panel);
    return panel;
  }

  function renderList(panel, items) {
    const list = panel.querySelector("[data-notifications-list]");
    const empty = panel.querySelector("[data-notifications-empty]");
    if (!list || !empty) return;
    if (!items.length) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = items
      .map(
        (item) => `
      <button type="button" class="portal-notifications-item${item.read_at ? "" : " portal-notifications-item--unread"}" data-notification-id="${item.id}" data-notification-url="${escapeHtml(item.url || "")}">
        <span class="portal-notifications-item__title">${escapeHtml(item.title)}</span>
        <span class="portal-notifications-item__body muted">${escapeHtml(item.body)}</span>
      </button>`,
      )
      .join("");
  }

  function updateBadge(badgeEl, count) {
    if (!badgeEl) return;
    const total = Number(count) || 0;
    if (total > 0) {
      badgeEl.hidden = false;
      badgeEl.textContent = total > 99 ? "99+" : String(total);
    } else {
      badgeEl.hidden = true;
      badgeEl.textContent = "0";
    }
  }

  async function loadFeed(config) {
    const res = await apiFetch(config.listPath);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not load notifications");
    renderList(config.panel, data.items || []);
    updateBadge(config.badgeEl, data.unread_count);
    return data;
  }

  function bind(config) {
    const { bellBtn, badgeEl, audience } = config;
    if (!bellBtn || bellBtn.dataset.notificationsBound) return;
    bellBtn.dataset.notificationsBound = "1";
    const host = bellBtn.closest(".topbar-tools, .topbar") || bellBtn.parentElement;
    const panel = ensurePanel(host);

    bellBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !panel.hidden;
      panel.hidden = open;
      if (!open) {
        try {
          await loadFeed({ ...config, panel, badgeEl });
        } catch {
          renderList(panel, []);
        }
      }
    });

    panel.addEventListener("click", async (event) => {
      const markAll = event.target.closest("[data-notifications-mark-all]");
      if (markAll) {
        await apiFetch(config.readAllPath, { method: "POST" });
        await loadFeed({ ...config, panel, badgeEl });
        return;
      }
      const itemBtn = event.target.closest("[data-notification-id]");
      if (!itemBtn) return;
      const id = itemBtn.getAttribute("data-notification-id");
      const url = itemBtn.getAttribute("data-notification-url");
      await apiFetch(`${config.readPathPrefix}/${id}/read`, { method: "POST" }).catch(() => null);
      panel.hidden = true;
      if (url) {
        try {
          const parsed = new URL(url, window.location.href);
          if (parsed.origin === window.location.origin) {
            window.location.hash = parsed.hash || "";
            if (parsed.pathname.endsWith("admin.html") || parsed.pathname.endsWith("employee.html")) {
              window.dispatchEvent(new CustomEvent(audience === "hr" ? "admin:section" : "employee:section"));
            }
          } else {
            window.location.href = url;
          }
        } catch {
          /* ignore */
        }
      }
      await loadFeed({ ...config, panel, badgeEl }).catch(() => null);
    });

    document.addEventListener("click", (event) => {
      if (panel.hidden) return;
      if (panel.contains(event.target) || bellBtn.contains(event.target)) return;
      panel.hidden = true;
    });

    loadFeed({ ...config, panel, badgeEl }).catch(() => null);
    window.setInterval(() => {
      loadFeed({ ...config, panel, badgeEl }).catch(() => null);
    }, 60_000);
  }

  window.ShiftSwiftPortalNotifications = {
    bindAdmin(options = {}) {
      bind({
        bellBtn: options.bellBtn || document.getElementById("topbar-alerts-btn"),
        badgeEl: options.badgeEl || document.getElementById("topbar-alerts-badge"),
        listPath: "/admin/notifications",
        readPathPrefix: "/admin/notifications",
        readAllPath: "/admin/notifications/read-all",
        audience: "hr",
      });
    },
    bindEmployee(options = {}) {
      bind({
        bellBtn: options.bellBtn || document.getElementById("employee-topbar-alerts-btn"),
        badgeEl: options.badgeEl || document.getElementById("employee-topbar-alerts-badge"),
        listPath: "/employee/push/notifications",
        readPathPrefix: "/employee/push/notifications",
        readAllPath: "/employee/push/notifications/read-all",
        audience: "employee",
      });
    },
    refreshAdmin() {
      const badgeEl = document.getElementById("topbar-alerts-badge");
      const panel = document.querySelector(".portal-notifications-panel");
      if (!panel) return;
      loadFeed({
        panel,
        badgeEl,
        listPath: "/admin/notifications",
        readPathPrefix: "/admin/notifications",
        readAllPath: "/admin/notifications/read-all",
        audience: "hr",
      }).catch(() => null);
    },
  };
})();
