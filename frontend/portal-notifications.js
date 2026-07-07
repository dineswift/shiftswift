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

  function ensureNotificationsHost(bellBtn) {
    if (!bellBtn) return null;
    const parent = bellBtn.parentElement;
    if (parent?.classList.contains("topbar-notifications-wrap")) return parent;
    const wrap = document.createElement("div");
    wrap.className = "topbar-notifications-wrap";
    parent?.insertBefore(wrap, bellBtn);
    wrap.appendChild(bellBtn);
    return wrap;
  }

  function setPanelOpen(bellBtn, panel, open) {
    panel.hidden = !open;
    bellBtn?.setAttribute("aria-expanded", open ? "true" : "false");
    bellBtn?.classList.toggle("topbar-icon-btn--active", open);
    bellBtn?.classList.toggle("employee-topbar-alerts-btn--active", open);
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
      <div class="portal-notifications-panel__failures" data-delivery-failures hidden>
        <div class="portal-notifications-panel__failures-head">
          <strong>Failed email deliveries</strong>
        </div>
        <div class="portal-notifications-panel__failures-list" data-delivery-failures-list></div>
        <p class="portal-notifications-panel__empty muted" data-delivery-failures-empty hidden>No failed deliveries.</p>
      </div>
    `;
    host.appendChild(panel);
    panel.hidden = true;
    return panel;
  }

  function renderDeliveryFailures(panel, items) {
    const section = panel.querySelector("[data-delivery-failures]");
    const list = panel.querySelector("[data-delivery-failures-list]");
    const empty = panel.querySelector("[data-delivery-failures-empty]");
    if (!section || !list || !empty) return;
    if (!items.length) {
      section.hidden = true;
      list.innerHTML = "";
      empty.hidden = true;
      return;
    }
    section.hidden = false;
    empty.hidden = true;
    list.innerHTML = items
      .map(
        (item) => `
      <div class="portal-notifications-failure">
        <div class="portal-notifications-failure__meta">
          <span class="portal-notifications-failure__title">${escapeHtml(item.label || item.subject || "Email")}</span>
          <span class="portal-notifications-failure__body muted">${escapeHtml(item.to || "Unknown recipient")}${item.delivery_error ? ` · ${escapeHtml(item.delivery_error)}` : ""}</span>
        </div>
        <button type="button" class="btn outline btn-sm" data-resend-delivery="${item.id}">Resend</button>
      </div>`,
      )
      .join("");
  }

  async function loadDeliveryFailures(panel) {
    const res = await apiFetch("/admin/notifications/delivery-failures?limit=8");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not load failed deliveries");
    renderDeliveryFailures(panel, data.items || []);
    return data;
  }

  async function resendDeliveryFailure(panel, notificationId) {
    const res = await apiFetch(`/admin/notifications/${notificationId}/resend`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Resend failed");
    await loadDeliveryFailures(panel);
    return data;
  }

  function renderList(panel, items) {
    const list = panel.querySelector("[data-notifications-list]");
    const empty = panel.querySelector("[data-notifications-empty]");
    if (!list || !empty) return;
    if (!items.length) {
      list.innerHTML = "";
      empty.hidden = false;
      if (!empty.dataset.defaultMessage) {
        empty.dataset.defaultMessage = empty.textContent || "No notifications yet.";
      }
      empty.textContent = empty.dataset.defaultMessage;
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
    if (config.audience === "hr") {
      await loadDeliveryFailures(config.panel).catch(() => renderDeliveryFailures(config.panel, []));
    }
    return data;
  }

  function showFeedError(panel, badgeEl, message) {
    renderList(panel, []);
    updateBadge(badgeEl, 0);
    const empty = panel.querySelector("[data-notifications-empty]");
    if (empty) {
      empty.hidden = false;
      empty.textContent = message || "Could not load notifications.";
    }
  }

  function bind(config) {
    const { bellBtn, badgeEl, audience } = config;
    if (!bellBtn || bellBtn.dataset.notificationsBound) return;
    bellBtn.dataset.notificationsBound = "1";
    const host = ensureNotificationsHost(bellBtn) || bellBtn.closest(".topbar-tools, .topbar") || bellBtn.parentElement;
    const panel = ensurePanel(host);
    bellBtn.setAttribute("aria-haspopup", "true");
    bellBtn.setAttribute("aria-expanded", "false");
    setPanelOpen(bellBtn, panel, false);

    bellBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const opening = panel.hidden;
      setPanelOpen(bellBtn, panel, opening);
      if (opening) {
        try {
          await loadFeed({ ...config, panel, badgeEl });
        } catch (error) {
          showFeedError(panel, badgeEl, error.message || "Could not load notifications.");
        }
      }
    });

    panel.addEventListener("click", async (event) => {
      const resendBtn = event.target.closest("[data-resend-delivery]");
      if (resendBtn) {
        const id = resendBtn.getAttribute("data-resend-delivery");
        resendBtn.disabled = true;
        try {
          await resendDeliveryFailure(panel, id);
        } catch (error) {
          resendBtn.textContent = "Failed";
          resendBtn.title = error.message || "Resend failed";
        } finally {
          resendBtn.disabled = false;
        }
        return;
      }
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
      setPanelOpen(bellBtn, panel, false);
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
      setPanelOpen(bellBtn, panel, false);
    });

    loadFeed({ ...config, panel, badgeEl }).catch((error) => {
      showFeedError(panel, badgeEl, error.message);
    });
    window.setInterval(() => {
      loadFeed({ ...config, panel, badgeEl }).catch(() => {
        updateBadge(badgeEl, 0);
      });
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
