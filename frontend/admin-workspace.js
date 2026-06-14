/** Admin workspace sections — overview, employees, staff export, settings. */
(async function initAdminWorkspace() {
  const {
    apiFetch,
    loadFormOptions,
    loadTenantFeatures,
    applyFeatureGates,
    isFeatureEnabled,
    mountEditForm,
    renderTableBody,
    FORM_SCHEMAS,
    escapeHtml,
    statusPill,
  } = window.Admin;

  try {
    await loadFormOptions();
    await loadTenantFeatures();
    applyFeatureGates();
  } catch (error) {
    console.warn("Form metadata unavailable:", error.message);
  }

  window.addEventListener("admin:features-refresh", async () => {
    await loadTenantFeatures();
    applyFeatureGates();
  });

  async function loadTrialBanner() {
    const banner = document.getElementById("trial-upgrade-banner");
    if (!banner) return;
    try {
      const res = await apiFetch("/billing/status");
      if (!res.ok) {
        banner.hidden = true;
        return;
      }
      const status = await res.json();
      const days = status.days_remaining;
      const expired = status.upgrade_required || status.subscription_status === "trial_expired";
      const onHold = status.license_on_hold;
      const paymentWarning = status.license_warning;

      if (
        !onHold &&
        !paymentWarning &&
        status.access_allowed &&
        !expired &&
        (days == null || days > 7)
      ) {
        banner.hidden = true;
        return;
      }

      banner.hidden = false;
      banner.className = "promo-result promo-result-message";
      banner.classList.remove("promo-result--error");

      if (onHold) {
        banner.classList.add("promo-result--error");
        banner.innerHTML = `
          <p><strong>Licence on hold.</strong> ${escapeHtml(status.hold_message || "Direct Debit payment was not received after the grace period.")}</p>
          <button type="button" class="btn" id="trial-upgrade-btn">Update payment</button>`;
      } else if (paymentWarning) {
        banner.innerHTML = `
          <p><strong>Direct Debit failed.</strong> ${escapeHtml(status.warning_message || "Please update payment.")}
          <strong>${escapeHtml(status.grace_days_remaining)}</strong> day(s) before access is restricted.</p>
          <button type="button" class="btn" id="trial-upgrade-btn">Fix payment</button>
          <button type="button" class="btn secondary" id="trial-dd-btn">Set up Direct Debit</button>`;
      } else if (expired) {
        banner.classList.add("promo-result--error");
        banner.innerHTML = `
          <p><strong>Free trial ended.</strong> Upgrade your ShiftSwift HR subscription to continue using admin features.
          Reminder emails were sent to <strong>${escapeHtml(status.billing_email || "your billing email")}</strong>.</p>
          <button type="button" class="btn" id="trial-upgrade-btn">Upgrade now</button>`;
      } else {
        banner.innerHTML = `
          <p><strong>${escapeHtml(days)} day${days === 1 ? "" : "s"} left</strong> on your 14-day free trial.
          Upgrade anytime. We will email you at 7, 3, and 1 day before trial ends.</p>
          <button type="button" class="btn secondary" id="trial-upgrade-btn">View plans & upgrade</button>`;
      }
      document.getElementById("trial-upgrade-btn")?.addEventListener("click", startUpgrade);
      document.getElementById("trial-dd-btn")?.addEventListener("click", startDirectDebitSetup);
    } catch {
      banner.hidden = true;
    }
  }

  async function startDirectDebitSetup() {
    try {
      const res = await apiFetch("/billing/direct-debit/mandate", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      alert(data.message || data.detail || "Direct Debit setup unavailable");
    } catch (error) {
      alert(error.message || "Direct Debit setup failed");
    }
  }

  async function startUpgrade() {
    try {
      const res = await apiFetch("/billing/upgrade", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      alert(data.message || data.detail || "Upgrade is not available in local mode. Email support@shiftswifthr.co.uk.");
    } catch (error) {
      alert(error.message || "Upgrade request failed");
    }
  }

  function formatOverviewTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function moduleCard({ icon, title, value, sub, href, tone }) {
    const toneClass = tone ? ` overview-module-card--${tone}` : "";
    const iconSvg = window.AdminIcons?.svg?.(icon) || "";
    return `
      <a class="overview-module-card${toneClass}" href="${escapeHtml(href)}">
        <span class="overview-module-card__head">
          <span class="overview-module-card__icon" aria-hidden="true">${iconSvg}</span>
          <span class="overview-module-card__chevron" aria-hidden="true">${window.AdminIcons?.svg?.("chevron") || "›"}</span>
        </span>
        <span class="overview-module-card__title">${escapeHtml(title)}</span>
        <span class="overview-module-card__value">${escapeHtml(value)}</span>
        <span class="overview-module-card__sub">${escapeHtml(sub)}</span>
      </a>`;
  }

  function statCard({ icon, label, value, sub, href, tone, valueText, extraClass }) {
    const toneClass = tone ? ` hr-stat-card--${tone}` : "";
    const valueClass = valueText ? " hr-stat-card__value--text" : "";
    const iconSvg = window.AdminIcons?.svg?.(icon) || "";
    return `
      <a class="hr-stat-card hr-stat-card--link${toneClass}${extraClass ? ` ${extraClass}` : ""}" href="${escapeHtml(href)}">
        <span class="hr-stat-card__icon" aria-hidden="true">${iconSvg}</span>
        <span class="hr-stat-card__label">${escapeHtml(label)}</span>
        <span class="hr-stat-card__value${valueClass}">${escapeHtml(value)}</span>
        <span class="hr-stat-card__sub">${escapeHtml(sub)}</span>
      </a>`;
  }

  function updateTopbarMeta(data) {
    const businessName = data.trading_name || data.tenant_name || "ShiftSwift HR";
    const topbarName = document.getElementById("topbar-business-name");
    const userLabel = document.getElementById("topbar-user-label");
    const avatar = document.querySelector(".topbar-user-menu__avatar");
    const username = localStorage.getItem("username") || "Admin";
    if (topbarName) topbarName.textContent = businessName;
    if (userLabel) userLabel.textContent = username;
    if (avatar) {
      const initials = String(username)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
      avatar.textContent = initials || "HR";
    }
    const badge = document.getElementById("topbar-alerts-badge");
    const count = Number(data.open_actions_count) || 0;
    if (badge) {
      if (count > 0) {
        badge.hidden = false;
        badge.textContent = String(count);
      } else {
        badge.hidden = true;
        badge.textContent = "0";
      }
    }
  }

  function applyNavBadges(badges) {
    if (!badges) return;
    [
      ["compliance", badges.compliance],
      ["leave", badges.leave],
      ["disciplinary", badges.disciplinary],
      ["employees", badges.employees],
    ].forEach(([section, count]) => {
      const link = document.querySelector(`.nav-link[data-section="${section}"]`);
      if (!link) return;
      let badge = link.querySelector(".nav-badge");
      const total = Number(count) || 0;
      if (total > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "nav-badge";
          link.appendChild(badge);
        }
        badge.textContent = String(total);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  function actionItem(item) {
    return `
      <a class="overview-action overview-action--${escapeHtml(item.severity)}" href="${escapeHtml(item.href)}">
        <span class="overview-action__dot overview-action__dot--${escapeHtml(item.severity)}" aria-hidden="true"></span>
        <span class="overview-action__copy">
          <span class="overview-action__title">${escapeHtml(item.title)}</span>
          <span class="overview-action__detail muted">${escapeHtml(item.detail)}</span>
        </span>
        <span class="overview-action__chevron" aria-hidden="true">›</span>
      </a>`;
  }

  async function loadOverview() {
    const grid = document.getElementById("overview-metrics");
    const modulesHost = document.getElementById("overview-modules");
    const actionsHost = document.getElementById("overview-actions");
    const actionsCount = document.getElementById("overview-actions-count");
    const subtitle = document.getElementById("overview-subtitle");
    const trialNote = document.getElementById("overview-trial-note");
    if (!grid) return;
    try {
      const res = await apiFetch("/admin/overview");
      if (!res.ok) throw new Error("Overview unavailable");
      const data = await res.json();
      await loadTenantFeatures();
      applyFeatureGates();
      applyNavBadges(data.nav_badges);

      const businessName = data.trading_name || data.tenant_name || "your business";
      if (subtitle) {
        subtitle.textContent = `Welcome back — ${businessName} at a glance.`;
      }
      const mobileBusiness = document.getElementById("mobile-business-name");
      if (mobileBusiness) mobileBusiness.textContent = businessName;
      window.AdminMobile?.refreshGreeting?.();
      updateTopbarMeta(data);

      const openActions = data.open_actions || [];
      const actionPreview =
        openActions.length > 0
          ? openActions
              .slice(0, 3)
              .map((item) => item.title)
              .join(" · ")
          : "";

      if (trialNote) {
        if (data.trial_active) {
          trialNote.hidden = false;
          trialNote.className = "promo-result hr-overview-trial";
          trialNote.innerHTML = `Your <strong>14-day trial</strong> includes full HR, compliance, and workforce tools${data.days_remaining != null ? ` — <strong>${escapeHtml(data.days_remaining)} days</strong> remaining` : ""}.`;
        } else {
          trialNote.hidden = true;
          trialNote.innerHTML = "";
        }
      }

      const m = data.modules || {};
      const employees = m.employees || {};
      const punch = m.time_punch || {};
      const actions = data.open_actions_count || 0;
      const critical = openActions.filter((a) => a.severity === "critical").length;

      grid.innerHTML = `
        ${statCard({
          icon: "users",
          label: "Active employees",
          value: String(employees.active ?? 0),
          sub: `Limit ${employees.limit ?? data.max_employees ?? "—"} on ${data.plan_display_name || "current"} plan`,
          href: "#employees",
        })}
        ${statCard({
          icon: "clock",
          label: "Today's punches",
          value: String(punch.today_punches ?? 0),
          sub: punch.last_punch_at ? `Last punch ${formatOverviewTime(punch.last_punch_at)}` : "No punches yet",
          href: "#time-punch",
          tone: "ok",
        })}
        ${statCard({
          icon: critical ? "alert" : "check",
          label: "Open actions",
          value: String(actions),
          sub: critical
            ? `${critical} need immediate attention`
            : actions
              ? actionPreview || "Tap to review"
              : "All clear",
          href: "#overview-actions",
          tone: critical || actions ? "warn" : "",
        })}
        ${statCard({
          icon: "card",
          label: "Subscription",
          value: data.subscription_status || "Not set",
          sub: `${data.plan_display_name || data.subscription_plan || "No plan"} plan`,
          href: "#settings",
          valueText: true,
          extraClass: "hr-stat-card--subscription",
        })}`;

      const subscriptionCard = document.getElementById("mobile-subscription-card");
      if (subscriptionCard) {
        subscriptionCard.hidden = false;
        subscriptionCard.innerHTML = `
          <div class="mobile-subscription-card__head">
            ${window.AdminIcons?.svg?.("card") || ""}
            <span class="mobile-subscription-card__label">Subscription</span>
          </div>
          <p class="mobile-subscription-card__value">${escapeHtml(data.subscription_status || "Not set")}</p>
          <p class="mobile-subscription-card__sub muted">${escapeHtml(data.plan_display_name || data.subscription_plan || "No plan")} plan</p>
          <a class="mobile-subscription-card__link" href="#settings">Manage plan ›</a>`;
      }

      if (modulesHost) {
        const rtw = m.rtw || {};
        const absence = m.absence || {};
        const recruitment = m.recruitment || {};
        const rota = m.rota || {};
        const grievance = m.grievance || {};
        const disciplinary = m.disciplinary || {};
        const offboarding = m.offboarding || {};
        const contracts = m.contracts || {};
        const docs = m.documents || {};
        const leave = m.leave || {};
        const qualifications = m.qualifications || {};
        const rotaLabel =
          rota.status === "published"
            ? "Published this week"
            : rota.shift_count
              ? "Draft — not published"
              : "No shifts yet";

        modulesHost.innerHTML = [
          moduleCard({
            icon: "users",
            title: "Employees",
            value: String(employees.active ?? 0),
            sub: employees.portal_setup_pending
              ? `${employees.portal_setup_pending} portal setup pending`
              : (qualifications.expired ?? 0) > 0
                ? `${qualifications.expired} expired training cert(s)`
                : (qualifications.expiring_soon ?? 0) > 0
                  ? `${qualifications.expiring_soon} cert(s) expiring soon`
                  : employees.onboarding
                    ? `${employees.onboarding} onboarding`
                    : "Active register",
            href: "#employees",
            tone:
              (qualifications.expired ?? 0) > 0
                ? "danger"
                : employees.portal_setup_pending || (qualifications.expiring_soon ?? 0) > 0
                  ? "warn"
                  : undefined,
          }),
          moduleCard({
            icon: "clipboard",
            title: "Recruitment",
            value: String(recruitment.open_vacancies ?? 0),
            sub: recruitment.pending_applicants
              ? `${recruitment.pending_applicants} pending applicants`
              : "Open vacancies",
            href: "#recruitment",
          }),
          moduleCard({
            icon: "passport",
            title: "Right to work",
            value: String(rtw.verified ?? 0),
            sub: `${rtw.expiring_soon ?? 0} expiring · ${rtw.needs_review ?? 0} need review`,
            href: "#compliance-rtw",
            tone: (rtw.needs_review ?? 0) > 0 ? "danger" : (rtw.expiring_soon ?? 0) > 0 ? "warn" : "",
          }),
          moduleCard({
            icon: "medical",
            title: "Absence monitoring",
            value: String(absence.day9_alerts ?? 0),
            sub:
              (absence.day9_alerts ?? 0) > 0
                ? "Day-9 alerts need action"
                : `${absence.active_this_month ?? 0} absence days this month`,
            href: "#compliance",
            tone: (absence.day9_alerts ?? 0) > 0 ? "danger" : "",
          }),
          moduleCard({
            icon: "map-pin",
            title: "Time punch",
            value: String(punch.sites ?? 0),
            sub: punch.today_punches
              ? `${punch.today_punches} punch${punch.today_punches === 1 ? "" : "es"} today`
              : punch.sites
                ? "No punches today"
                : "Set up geofence sites",
            href: "#time-punch",
            tone: !punch.sites ? "warn" : "",
          }),
          moduleCard({
            icon: "calendar",
            title: "Rota",
            value: String(rota.shift_count ?? 0),
            sub: rotaLabel,
            href: "#rota",
            tone: rota.status !== "published" && rota.shift_count ? "warn" : "",
          }),
          moduleCard({
            icon: "scale",
            title: "Grievance",
            value: String(grievance.open_cases ?? 0),
            sub: grievance.open_cases ? "Open cases" : "No open cases",
            href: "#grievance",
            tone: (grievance.open_cases ?? 0) > 0 ? "warn" : "",
          }),
          moduleCard({
            icon: "clipboard",
            title: "Disciplinary",
            value: String(disciplinary.open_cases ?? 0),
            sub: disciplinary.open_cases ? "Open cases" : "No open cases",
            href: "#disciplinary",
            tone: (disciplinary.open_cases ?? 0) > 0 ? "warn" : "",
          }),
          moduleCard({
            icon: "file",
            title: "Employment contracts",
            value: String(contracts.pending_signature ?? 0),
            sub: contracts.pending_signature ? "Awaiting signature" : "Up to date",
            href: "#employment-contracts",
            tone: (contracts.pending_signature ?? 0) > 0 ? "warn" : "",
          }),
          moduleCard({
            icon: "door",
            title: "Offboarding",
            value: String(offboarding.in_progress ?? 0),
            sub: offboarding.in_progress ? "In progress" : "No active leavers",
            href: "#offboarding",
          }),
          moduleCard({
            icon: "beach",
            title: "Leave",
            value: String(leave.pending_requests ?? 0),
            sub: leave.pending_requests ? "Awaiting HR approval" : "No pending requests",
            href: "#leave",
            tone: (leave.pending_requests ?? 0) > 0 ? "warn" : "",
          }),
          moduleCard({
            icon: "folder",
            title: "Documents",
            value: String(docs.count ?? data.document_count ?? 0),
            sub: "In tenant document store",
            href: "#settings",
          }),
        ].join("");
        if (!window.matchMedia("(max-width: 860px)").matches) {
          modulesHost.closest(".overview-main")?.removeAttribute("hidden");
        }
      }

      if (actionsHost) {
        const items = data.open_actions || [];
        if (actionsCount) actionsCount.textContent = String(items.length);
        actionsHost.innerHTML = items.length
          ? items.map(actionItem).join("")
          : `<p class="overview-actions-empty muted">No open actions — your workspace looks good.</p>`;
      }

      window.dispatchEvent(new CustomEvent("admin:overview-loaded", { detail: { data } }));
      window.AdminMobile?.renderMobileCompliance?.(data);
    } catch (error) {
      const message = escapeHtml(error.message || "Could not load overview.");
      grid.innerHTML = `<p class="muted">${message}</p>`;
      if (modulesHost) modulesHost.innerHTML = `<p class="muted">${message}</p>`;
      if (actionsHost) actionsHost.innerHTML = "";
    }
  }

  async function loadTenantProfileForm() {
    /* Business profile form is rendered in admin-settings.js */
  }

  async function loadDocuments() {
    /* Settings documents load via admin-settings.js */
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "overview") loadOverview();
  });

  loadOverview();
  loadTrialBanner();
})();
