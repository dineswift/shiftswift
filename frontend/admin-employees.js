/** Employee workspace — lifecycle flow aligned to HR chart (recruitment → off-boarding). */
(function () {
  const { apiFetch, escapeHtml, mountEditForm, renderTableBody, statusPill, loadFormOptions, isFeatureEnabled, downloadAuthenticated, authHeaders, API_BASE } = window.Admin;

  const SECTION_SCHEMAS = {
    recruitment: {
      id: "employee-recruitment",
      columns: 2,
      submitLabel: "Save recruitment details",
      successMessage: "Recruitment details saved.",
      fields: [
        { name: "first_name", label: "First name", type: "text", required: true },
        { name: "last_name", label: "Last name", type: "text", required: true },
        { name: "email", label: "Work email", type: "email" },
        {
          name: "worker_type",
          label: "Employee type",
          type: "select",
          optionsKey: "worker_types",
          defaultValue: "standard",
        },
      ],
    },
    onboarding: {
      id: "employee-onboarding",
      columns: 2,
      submitLabel: "Save on-boarding details",
      successMessage: "On-boarding details saved.",
      fields: [
        { name: "job_title", label: "Job title", type: "text", required: true },
        { name: "start_date", label: "Start date", type: "date", required: true },
        { name: "status", label: "Status", type: "select", optionsKey: "employee_statuses", defaultValue: "onboarding" },
        { name: "department", label: "Department", type: "text", placeholder: "Kitchen, Front of house…" },
        { name: "employment_type", label: "Employment type", type: "select", optionsKey: "employment_types", defaultValue: "full_time" },
        {
          name: "contract_hours_weekly",
          label: "Contract hours (per week)",
          type: "number",
          placeholder: "Blank = type default (e.g. 40 full-time)",
          step: "0.5",
          min: 0,
          max: 168,
        },
        { name: "work_location", label: "Work location", type: "text", placeholder: "London site" },
        { name: "probation_end_date", label: "Probation end date", type: "date" },
      ],
    },
    induction: {
      id: "employee-induction",
      columns: 2,
      submitLabel: "Save personal information",
      successMessage: "Personal information saved.",
      fields: [
        { name: "phone", label: "Mobile phone", type: "tel", required: true },
        { name: "date_of_birth", label: "Date of birth", type: "date" },
        { name: "ni_number", label: "National Insurance number", type: "text", placeholder: "AB 12 34 56 A" },
        { name: "home_address", label: "Home address", type: "textarea", span: 2, rows: 3, required: true },
        { name: "emergency_contact_name", label: "Emergency contact name", type: "text", required: true },
        { name: "emergency_contact_phone", label: "Emergency contact phone", type: "tel", required: true },
        { name: "emergency_contact_relationship", label: "Relationship", type: "text", placeholder: "Partner, parent…" },
      ],
    },
    job_performance: {
      id: "employee-job-performance",
      columns: 2,
      submitLabel: "Save salary details",
      successMessage: "Salary details saved.",
      fields: [
        { name: "salary", label: "Annual salary (£)", type: "number", placeholder: "28000", required: true },
      ],
    },
    compliance_reporting: {
      id: "employee-compliance",
      columns: 2,
      submitLabel: "Save compliance details",
      successMessage: "Compliance details saved.",
      fields: [
        { name: "visa_type", label: "Visa type", type: "text", placeholder: "Skilled Worker", required: true },
        { name: "visa_expiry_date", label: "Visa expiry date", type: "date" },
        { name: "share_code", label: "GOV.UK share code", type: "text" },
        { name: "cos_reference", label: "CoS reference", type: "text" },
        { name: "rtw_status", label: "Right to work status", type: "select", optionsKey: "rtw_statuses", defaultValue: "pending" },
      ],
    },
    offboarding: {
      id: "employee-offboarding",
      columns: 2,
      submitLabel: "Save off-boarding details",
      successMessage: "Off-boarding details saved.",
      fields: [
        { name: "termination_date", label: "Leave date", type: "date" },
        { name: "termination_reason", label: "Reason", type: "textarea", span: 2, rows: 3 },
      ],
    },
  };

  const SECTION_HINTS = {
    recruitment: "Set employee type here. Sponsor compliance (step 9) unlocks only for sponsored workers.",
    onboarding: "Set status to <strong>Onboarding</strong> for new starters. Contract hours drive rota over/under warnings — leave blank to use the default for the employment type.",
    induction: "Phone, home address, and emergency contact are required. NI number is validated when provided.",
    job_performance: "Salary is stored here for payroll CSV export. Run probation and annual reviews using HR Templates — file signed forms in Document store.",
    compliance_reporting: "Visa type plus a GOV.UK share code <em>or</em> CoS reference required.",
    support: "Add HR-only internal notes or messages the employee will see in their portal.",
    offboarding: "Set employee status to <strong>Terminated</strong> in on-boarding (or off-boarding workflow) to unlock this step.",
  };

  const LINK_SECTIONS = {
    development: {
      title: "Development",
      body: "Store training certificates in Document store (step 4) using the <strong>Qualification</strong> category and an expiry date — food hygiene, first aid, and other mandatory courses.",
      links: [
        { href: "#templates", label: "HR Templates & AI" },
      ],
    },
    support: {
      title: "Support",
      branch: "Health & wellbeing",
      body: "Mentoring, workplace assistance, and wellbeing resources. Link grievance or compliance workflows when needed.",
      links: [
        { href: "#grievance", label: "Grievance cases" },
        { href: "#compliance", label: "Sponsor compliance" },
      ],
    },
    performance_improvement: {
      title: "Performance improvement",
      branch: "Training & CPD",
      body: "Use HR templates for probation reviews, annual appraisals, and PIP meetings. Store signed copies in Document store.",
      links: [
        { href: "#templates", label: "Probation & appraisal templates" },
        { href: "#disciplinary", label: "Disciplinary cases (Growth+)" },
      ],
    },
  };

  const QUICK_ADD_SCHEMA = {
    id: "employee-quick-add",
    columns: 1,
    submitLabel: "Create employee",
    successMessage: "Employee added — complete their profile in the panel on the right.",
    fields: [
      { name: "first_name", label: "First name", type: "text", required: true },
      { name: "last_name", label: "Last name", type: "text", required: true },
      { name: "email", label: "Work email", type: "email" },
    ],
  };

  const LIFECYCLE_STAGES = [
    { id: "recruitment", label: "Recruitment", shortLabel: "Recruitment", icon: "user-plus", openDefault: true },
    { id: "onboarding", label: "Onboarding", shortLabel: "Onboarding", icon: "clipboard" },
    { id: "active", label: "Active employees", shortLabel: "Active", icon: "users" },
    { id: "offboarding", label: "Offboarding", shortLabel: "Offboarding", icon: "user-minus" },
  ];

  const LIFECYCLE_HUB_PAGE_SIZE = 5;
  const LIFECYCLE_EDITABLE_STEPS = 6;

  const SIDE_PANEL_CHECKLIST = [
    { key: "recruitment", sectionKey: "recruitment", label: "Recruitment" },
    { key: "induction", sectionKey: "induction", label: "Personal information" },
    { key: "rtw", sectionKey: "document_store", docCategory: "rtw", label: "Right to work" },
    { key: "contract", sectionKey: "document_store", docCategory: "contract", label: "Contract" },
  ];

  let lifecycleHubOpenStage = "recruitment";
  let lifecycleHubExpanded = { recruitment: true, onboarding: false, active: false, offboarding: false };
  let lifecycleHubShowAll = { recruitment: false, onboarding: false, active: false, offboarding: false };
  let quickAddMounted = false;

  function isMobileEmployeesHub() {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function lifecycleStage(row) {
    if (!row) return "recruitment";
    if (row.status === "terminated") return "offboarding";
    if (row.status === "active" && !row.next_section) return "active";
    if (row.next_section === "recruitment") return "recruitment";
    if (row.status === "active" && (row.completion_pct ?? 0) >= 100) return "active";
    if (row.status === "onboarding" || row.next_section) return "onboarding";
    return "active";
  }

  function bucketEmployeesByStage(items = []) {
    const buckets = { recruitment: [], onboarding: [], active: [], offboarding: [] };
    items.forEach((row) => {
      buckets[lifecycleStage(row)]?.push(row);
    });
    return buckets;
  }

  function progressCopy(row) {
    const pct = row.completion_pct ?? 0;
    const next = row.next_section ? sectionLabel(row.next_section) : null;
    if (!next || pct >= 100) return null;
    return `Onboarding ${pct}% complete — next: ${next}`;
  }

  function editableSections(workspace) {
    return (workspace?.sections || []).filter((section) => section.kind === "form" || section.kind === "documents");
  }

  function sectionProgressMeta(workspace) {
    const editable = editableSections(workspace);
    const completed = editable.filter((section) => section.complete).length;
    const total = editable.length || LIFECYCLE_EDITABLE_STEPS;
    const pct = workspace?.completion_pct ?? 0;
    return { completed, total, pct };
  }

  function checklistItemComplete(workspace, item) {
    if (item.docCategory) {
      const req = (workspace.document_requirements?.items || []).find((entry) => entry.category === item.docCategory);
      return Boolean(req?.satisfied);
    }
    const section = (workspace.sections || []).find((entry) => entry.key === item.sectionKey);
    return Boolean(section?.complete);
  }

  function checklistItemStarted(workspace, item) {
    if (item.docCategory) {
      return (workspace.documents || []).some((doc) => doc.category === item.docCategory);
    }
    const section = (workspace.sections || []).find((entry) => entry.key === item.sectionKey);
    if (!section?.data) return false;
    return Object.values(section.data).some((value) => value !== null && value !== undefined && String(value).trim() !== "");
  }

  function departmentSelectOptions(currentValue) {
    const options = window.Admin.formOptions?.recruitment_departments || [];
    const values = new Set(options.map((item) => item.value || item.label));
    let html = `<option value="">Not set</option>`;
    if (currentValue && !values.has(currentValue)) {
      html += `<option value="${escapeHtml(currentValue)}" selected>${escapeHtml(currentValue)}</option>`;
    }
    html += options
      .map((item) => {
        const value = item.value || item.label;
        const selected = value === currentValue ? " selected" : "";
        return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(item.label || value)}</option>`;
      })
      .join("");
    return html;
  }

  function renderRegisterProgressCell(row) {
    const pct = row.completion_pct ?? 0;
    if (pct >= 100 && !row.next_section) {
      return `<span class="employee-profile-pill employee-profile-pill--ok">Done</span>`;
    }
    return `<div class="employee-register-progress" title="Profile completeness">
      <span class="employee-register-progress__pct">${escapeHtml(String(pct))}%</span>
      <div class="employee-register-progress__bar"><span style="width:${Math.min(100, pct)}%"></span></div>
    </div>`;
  }

  function avatarPalette(employeeId) {
    const palettes = [
      { bg: "#E1F5EE", color: "#0F6E56" },
      { bg: "#E6F1FB", color: "#185FA5" },
      { bg: "#FAEEDA", color: "#854F0B" },
      { bg: "#FBEAF0", color: "#993556" },
    ];
    return palettes[Math.abs(Number(employeeId)) % palettes.length];
  }

  function renderLifecycleStageRail(buckets) {
    const rail = $("lifecycle-stage-rail");
    if (!rail) return;
    const stages = LIFECYCLE_STAGES.map((stage) => {
      const count = buckets[stage.id]?.length ?? 0;
      const isCurrent = lifecycleHubOpenStage === stage.id;
      const isComplete =
        stage.id === "recruitment"
          ? count === 0 && (buckets.onboarding?.length || buckets.active?.length)
          : false;
      const stateClass = isComplete ? " lifecycle-stage-rail__step--done" : isCurrent ? " lifecycle-stage-rail__step--current" : "";
      const marker = isComplete
        ? `<span class="lifecycle-stage-rail__marker lifecycle-stage-rail__marker--done" aria-hidden="true">✓</span>`
        : `<span class="lifecycle-stage-rail__marker">${LIFECYCLE_STAGES.indexOf(stage) + 1}</span>`;
      return `<div class="lifecycle-stage-rail__step${stateClass}" data-lifecycle-stage="${stage.id}">
        ${marker}
        <span class="lifecycle-stage-rail__label">${escapeHtml(stage.shortLabel)}</span>
      </div>`;
    }).join(`<span class="lifecycle-stage-rail__line" aria-hidden="true"></span>`);
    rail.innerHTML = `<div class="lifecycle-stage-rail__track">${stages}</div>`;
    rail.querySelectorAll("[data-lifecycle-stage]").forEach((el) => {
      el.addEventListener("click", () => {
        lifecycleHubOpenStage = el.dataset.lifecycleStage;
        lifecycleHubExpanded[lifecycleHubOpenStage] = true;
        renderLifecycleHub(employeesCache);
        document.querySelector(`[data-lifecycle-section="${lifecycleHubOpenStage}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function renderLifecycleEmployeeCard(row, stage) {
    const palette = avatarPalette(row.id);
    const initials = employeeInitials(row);
    const roleLine = [row.job_title, row.department].filter(Boolean).join(" · ") || "Details not set yet";
    const progress = progressCopy(row);
    const progressBlock =
      progress && stage !== "active"
        ? `<div class="lifecycle-employee-card__progress">
            <div class="lifecycle-progress-bar"><span style="width:${Math.min(100, row.completion_pct ?? 0)}%"></span></div>
            <span class="lifecycle-progress-meta">${escapeHtml(progress)}</span>
          </div>`
        : `<span class="lifecycle-employee-card__meta muted">${escapeHtml(roleLine)}</span>`;
    return `<button type="button" class="lifecycle-employee-card" data-employee-id="${row.id}">
      <span class="lifecycle-employee-card__avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(initials)}</span>
      <span class="lifecycle-employee-card__body">
        <strong class="lifecycle-employee-card__name">${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</strong>
        ${progressBlock}
      </span>
      <span class="lifecycle-employee-card__chevron" aria-hidden="true"></span>
    </button>`;
  }

  function relocateQuickAddForm(targetHost) {
    const formHost = $("employee-quick-add-form");
    if (!formHost || !targetHost) return;
    targetHost.appendChild(formHost);
  }

  function renderLifecycleHub(items = employeesCache) {
    const hub = $("employees-lifecycle-hub");
    if (!hub) return;
    const buckets = bucketEmployeesByStage(items);
    renderLifecycleStageRail(buckets);

    if (!isMobileEmployeesHub()) {
      hub.hidden = true;
      relocateQuickAddForm(document.querySelector(".employees-quick-add-panel"));
      return;
    }

    hub.hidden = false;
    const icon = (name) => window.AdminIcons?.svg?.(name) || "";

    hub.innerHTML = LIFECYCLE_STAGES.map((stage) => {
      const rows = buckets[stage.id] || [];
      const isOpen = Boolean(lifecycleHubExpanded[stage.id]);
      const showAll = Boolean(lifecycleHubShowAll[stage.id]);
      const visibleRows = showAll ? rows : rows.slice(0, LIFECYCLE_HUB_PAGE_SIZE);
      const cards = visibleRows.length
        ? visibleRows.map((row) => renderLifecycleEmployeeCard(row, stage.id)).join("")
        : `<div class="lifecycle-empty-state"><p class="muted">${escapeHtml(stageEmptyMessage(stage.id))}</p></div>`;
      const viewAll =
        rows.length > LIFECYCLE_HUB_PAGE_SIZE && !showAll
          ? `<button type="button" class="btn ghost lifecycle-view-all-btn" data-lifecycle-view-all="${stage.id}">View all ${rows.length} employees</button>`
          : "";
      const recruitmentExtras =
        stage.id === "recruitment"
          ? `<div class="employees-recruitment-form-slot" id="employees-recruitment-form-slot"></div>
             <button type="button" class="btn outline lifecycle-add-employee-btn" id="employees-hub-add-btn">+ Add employee</button>`
          : "";
      const bulkInvite =
        stage.id === "active"
          ? `<div class="lifecycle-bulk-invite">
              <button type="button" class="btn outline" id="employees-hub-bulk-invite-btn">Invite all without portal accounts</button>
              <p class="muted" id="employees-hub-bulk-invite-status" aria-live="polite"></p>
            </div>`
          : "";

      return `<section class="lifecycle-hub-section${isOpen ? " is-open" : ""}" data-lifecycle-section="${stage.id}">
        <button type="button" class="lifecycle-hub-section__header" data-lifecycle-toggle="${stage.id}" aria-expanded="${isOpen}">
          <span class="lifecycle-hub-section__icon">${icon(stage.icon)}</span>
          <span class="lifecycle-hub-section__title">${escapeHtml(stage.label)}</span>
          <span class="lifecycle-hub-section__badge">${rows.length}</span>
          <span class="lifecycle-hub-section__chevron" aria-hidden="true"></span>
        </button>
        <div class="lifecycle-hub-section__body"${isOpen ? "" : " hidden"}>
          ${cards}
          ${viewAll}
          ${recruitmentExtras}
          ${bulkInvite}
        </div>
      </section>`;
    }).join("");

    if (lifecycleHubExpanded.recruitment) {
      relocateQuickAddForm($("employees-recruitment-form-slot"));
    } else {
      relocateQuickAddForm(document.querySelector(".employees-quick-add-panel"));
    }

    hub.querySelectorAll("[data-lifecycle-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const stageId = btn.dataset.lifecycleToggle;
        lifecycleHubExpanded[stageId] = !lifecycleHubExpanded[stageId];
        if (lifecycleHubExpanded[stageId]) lifecycleHubOpenStage = stageId;
        renderLifecycleHub(items);
      });
    });

    hub.querySelectorAll(".lifecycle-employee-card").forEach((card) => {
      card.addEventListener("click", () => openEmployee(Number(card.dataset.employeeId)));
    });

    hub.querySelectorAll("[data-lifecycle-view-all]").forEach((btn) => {
      btn.addEventListener("click", () => {
        lifecycleHubShowAll[btn.dataset.lifecycleViewAll] = true;
        renderLifecycleHub(items);
      });
    });

    $("employees-hub-add-btn")?.addEventListener("click", () => {
      $("employees-recruitment-form-slot")?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("employee-quick-add-form")?.querySelector("input")?.focus();
    });

    $("employees-hub-bulk-invite-btn")?.addEventListener("click", () => sendBulkPortalInvites("employees-hub-bulk-invite-status"));
  }

  function stageEmptyMessage(stageId) {
    if (stageId === "recruitment") return "No one in recruitment yet — add your first employee below.";
    if (stageId === "onboarding") return "No employees currently onboarding.";
    if (stageId === "active") return "No active employees yet.";
    return "No employees in offboarding.";
  }

  let activeEmployeeId = null;
  let selectedEmployeeId = null;
  let sidePanelEmployeeId = null;
  let sidePanelWorkspace = null;
  let sidePanelExpandedSection = null;
  let sidePanelRenderRequest = 0;
  let employeesCache = [];
  let activeSection = "recruitment";
  let workspaceCache = null;
  let sectionLoaded = false;
  let openEmployeeRequest = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function showListView() {
    $("employees-list-view")?.removeAttribute("hidden");
    $("employees-detail-view")?.setAttribute("hidden", "");
    activeEmployeeId = null;
    workspaceCache = null;
    setSidebarBreadcrumb(null);
    window.location.hash = "employees";
    renderLifecycleHub(employeesCache);
  }

  function showDetailView() {
    $("employees-list-view")?.setAttribute("hidden", "");
    $("employees-detail-view")?.removeAttribute("hidden");
    $("employee-advanced-links")?.removeAttribute("hidden");
  }

  function employeeInitials(employee) {
    const first = (employee?.first_name || "").trim()[0] || "";
    const last = (employee?.last_name || "").trim()[0] || "";
    return (first + last).toUpperCase() || "?";
  }

  function formatJoinedDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
    return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function setSidebarBreadcrumb(name) {
    const crumb = $("employee-nav-crumb");
    if (!crumb) return;
    if (name) {
      crumb.hidden = false;
      crumb.innerHTML = `→ <span>${escapeHtml(name)}</span>`;
    } else {
      crumb.hidden = true;
      crumb.textContent = "";
    }
  }

  function renderSummaryStrip(employee) {
    const host = $("employee-summary-strip");
    if (!host) return;
    const items = [];
    if (employee.job_title) {
      items.push(
        `<span class="employee-strip-item"><span class="employee-strip-icon" aria-hidden="true">◆</span>${escapeHtml(employee.job_title)}</span>`
      );
    }
    const joined = formatJoinedDate(employee.start_date);
    if (joined) {
      items.push(
        `<span class="employee-strip-item"><span class="employee-strip-icon" aria-hidden="true">◷</span>Joined ${escapeHtml(joined)}</span>`
      );
    }
    const location = employee.work_location || employee.department;
    if (location) {
      items.push(
        `<span class="employee-strip-item"><span class="employee-strip-icon" aria-hidden="true">◎</span>${escapeHtml(location)}</span>`
      );
    }
    host.innerHTML = items.join("");
  }

  function renderEmployeeHeader(workspace) {
    const employee = workspace.employee || {};
    const fullName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim() || "Employee";
    $("employee-workspace-title").textContent = fullName;
    $("employee-workspace-subtitle").textContent = employee.is_sponsored
      ? "Sponsored worker"
      : "Standard employee";
    const avatar = $("employee-avatar");
    if (avatar) avatar.textContent = employeeInitials(employee);
    renderSummaryStrip(employee);
    renderPortalInviteActions(employee);
    setSidebarBreadcrumb(fullName);
  }

  function portalStatusCopy(employee) {
    if (employee?.portal_setup_complete || employee?.portal_setup_status === "complete") {
      return "Employee portal active";
    }
    if (employee?.portal_setup_pending || employee?.portal_setup_status === "pending") {
      return "Invite sent — waiting for employee to set password (check junk mail)";
    }
    if (!employee?.email) return "Add a work email to send a portal invite";
    if (employee?.status !== "active" && employee?.status !== "onboarding") {
      return "Portal invites are available for active or onboarding employees";
    }
    return "No employee portal account yet";
  }

  function renderPortalInviteActions(employee) {
    const copyHost = document.querySelector(".employee-profile-copy");
    if (!copyHost) return;
    let host = document.getElementById("employee-portal-invite-row");
    if (!host) {
      host = document.createElement("div");
      host.id = "employee-portal-invite-row";
      host.className = "employee-portal-invite-row";
      copyHost.appendChild(host);
    }
    const canInvite = Boolean(employee?.email) && employee?.portal_setup_status !== "complete";
    host.innerHTML = `
      <p class="muted employee-portal-status">${escapeHtml(portalStatusCopy(employee))}</p>
      <div class="link-row">
        <button type="button" class="btn outline" id="employee-portal-invite-btn" ${canInvite ? "" : "disabled"}>
          ${
            employee?.portal_setup_pending || employee?.portal_setup_status === "pending"
              ? "Resend portal setup link"
              : "Send portal invite"
          }
        </button>
      </div>
      <p class="muted employee-portal-invite-message" id="employee-portal-invite-message" aria-live="polite"></p>`;
    host.querySelector("#employee-portal-invite-btn")?.addEventListener("click", () => {
      if (activeEmployeeId) void sendPortalInvite(activeEmployeeId, "employee-portal-invite-message");
    });
  }

  function formatInviteError(error, data) {
    const message = error?.message || "";
    if (message === "Failed to fetch" || message === "Load failed") {
      return "Could not reach the API. Check your connection, then try again. If this keeps happening, sign out and back in.";
    }
    if (typeof data?.detail === "string" && data.detail) return data.detail;
    if (Array.isArray(data?.detail)) {
      const first = data.detail.find((item) => item?.msg)?.msg;
      if (first) return first;
    }
    return message || "Invite failed.";
  }

  async function sendPortalInvite(employeeId, statusId = "employees-bulk-invite-status") {
    const statusEl = document.getElementById(statusId);
    if (statusEl) statusEl.textContent = "Sending invite…";
    let data = {};
    try {
      const res = await apiFetch(`/admin/employees/${employeeId}/invite-portal`, { method: "POST", body: "{}" });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatInviteError(null, data));
      if (statusEl) statusEl.textContent = data.message || "Invite sent.";
      try {
        await refreshEmployeesTable();
      } catch {
        /* invite succeeded even if the register refresh fails */
      }
      if (activeEmployeeId === employeeId && workspaceCache) {
        workspaceCache.employee = {
          ...workspaceCache.employee,
          portal_setup_status: "pending",
          portal_setup_pending: true,
          portal_setup_complete: false,
          portal_has_account: false,
          portal_invite_eligible: true,
        };
        renderPortalInviteActions(workspaceCache.employee);
      }
    } catch (error) {
      if (statusEl) statusEl.textContent = formatInviteError(error, data);
    }
  }

  async function sendBulkPortalInvites(statusId = "employees-bulk-invite-status") {
    const statusEl = document.getElementById(statusId);
    const pending = employeesCache.filter(
      (row) => row.email && row.portal_setup_status !== "complete" && !row.portal_setup_pending
    );
    const message =
      pending.length === 0
        ? "No employees are waiting for a portal invite."
        : `Send portal invite emails to ${pending.length} employee${pending.length === 1 ? "" : "s"} without accounts?`;
    if (pending.length === 0) {
      if (statusEl) statusEl.textContent = message;
      return;
    }
    if (!window.confirm(`${message}\n\nEach person will receive an email with a setup link.`)) return;
    if (statusEl) statusEl.textContent = "Sending invites…";
    let data = {};
    try {
      const res = await apiFetch("/admin/employees/invite-portal", {
        method: "POST",
        body: JSON.stringify({ resend_existing: false }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatInviteError(null, data));
      if (statusEl) statusEl.textContent = data.message || "Invites sent.";
      try {
        await refreshEmployeesTable();
      } catch {
        /* keep success message */
      }
    } catch (error) {
      if (statusEl) statusEl.textContent = formatInviteError(error, data);
    }
  }

  function openLifecycleSection(sectionKey, workspace) {
    activeSection = sectionKey;
    window.location.hash = `employees/${activeEmployeeId}/${sectionKey}`;
    renderLifecycleAccordion(workspace || workspaceCache);
  }

  function collapseLifecycleSection(workspace) {
    activeSection = null;
    window.location.hash = `employees/${activeEmployeeId}`;
    renderLifecycleAccordion(workspace || workspaceCache);
  }

  function renderAdvancedLinks(employee) {
    const host = $("employee-advanced-link-row");
    if (!host) return;
    const sponsored = Boolean(employee?.is_sponsored);
    host.innerHTML = `
      ${sponsored ? '<a href="#compliance" class="btn ghost">Sponsor compliance</a>' : ""}
      <a href="#grievance" class="btn ghost">Grievance cases</a>
      <a href="#offboarding" class="btn ghost">Off-boarding workflow</a>
      <a href="#time-punch" class="btn ghost">Time punch</a>`;
  }

  let kioskPinLoadRequest = 0;

  function resetKioskPinForm() {
    const form = $("employee-kiosk-pin-form");
    if (!form) return;
    form.reset();
    const pinInput = form.querySelector('input[name="kiosk_pin"]');
    if (pinInput) pinInput.disabled = false;
    const saveStatus = $("employee-kiosk-pin-save-status");
    if (saveStatus) saveStatus.textContent = "";
  }

  async function loadKioskPinStatus(employeeId) {
    const panel = $("employee-kiosk-pin-panel");
    const statusLine = $("employee-kiosk-pin-status-line");
    if (!panel || !statusLine || !employeeId) return null;

    const requestId = ++kioskPinLoadRequest;
    statusLine.textContent = "Loading…";
    panel.hidden = false;

    try {
      const res = await apiFetch(`/admin/time-punch/employees/${employeeId}/kiosk-pin`);
      const data = await res.json().catch(() => ({}));
      if (requestId !== kioskPinLoadRequest) return null;
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not load kiosk PIN status");
      statusLine.textContent = data.kiosk_pin_set
        ? "PIN is set — staff can sign in on the shared tablet kiosk using employee #"
          + employeeId
          + " and this PIN."
        : "No PIN set — kiosk sign-in is disabled until you set one.";
      return data;
    } catch (error) {
      if (requestId !== kioskPinLoadRequest) return null;
      statusLine.textContent = error.message || "Could not load kiosk PIN status.";
      return null;
    }
  }

  function renderKioskPinPanel(employeeId) {
    resetKioskPinForm();
    const panel = $("employee-kiosk-pin-panel");
    if (!employeeId) {
      if (panel) panel.hidden = true;
      return;
    }
    void loadKioskPinStatus(employeeId);
  }

  function mountKioskPinForm() {
    const form = $("employee-kiosk-pin-form");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";

    form.querySelector('input[name="clear_kiosk_pin"]')?.addEventListener("change", (event) => {
      const pinInput = form.querySelector('input[name="kiosk_pin"]');
      if (pinInput) pinInput.disabled = event.target.checked;
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!activeEmployeeId) return;

      const saveStatus = $("employee-kiosk-pin-save-status");
      const fd = new FormData(form);
      const clear = fd.get("clear_kiosk_pin") === "on";
      const pinValue = String(fd.get("kiosk_pin") || "").trim();

      if (!clear) {
        if (!pinValue) {
          if (saveStatus) saveStatus.textContent = "Enter a new PIN or check Clear PIN.";
          return;
        }
        if (!/^\d{4,6}$/.test(pinValue)) {
          if (saveStatus) saveStatus.textContent = "PIN must be 4–6 digits.";
          return;
        }
      }

      const payload = clear ? { pin: null } : { pin: pinValue };

      try {
        if (saveStatus) saveStatus.textContent = "Saving…";
        const res = await apiFetch(`/admin/time-punch/employees/${activeEmployeeId}/kiosk-pin`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Save failed");
        if (saveStatus) {
          saveStatus.textContent = clear ? "Kiosk PIN cleared." : "Kiosk PIN saved.";
        }
        resetKioskPinForm();
        await loadKioskPinStatus(activeEmployeeId);
        if (selectedEmployeeId === activeEmployeeId) {
          void refreshEmployeeSidePanelKioskPin(activeEmployeeId);
        }
      } catch (error) {
        if (saveStatus) saveStatus.textContent = error.message || "Save failed.";
      }
    });
  }

  async function refreshEmployeeSidePanelKioskPin(employeeId) {
    const host = document.getElementById("employees-side-kiosk-pin");
    if (!host || !employeeId) return;
    host.innerHTML = `<span class="muted">Loading…</span>`;
    try {
      const res = await apiFetch(`/admin/time-punch/employees/${employeeId}/kiosk-pin`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      host.innerHTML = data.kiosk_pin_set
        ? `<span class="employee-record-kiosk__status">Set</span>`
        : `<span class="employee-record-kiosk__status muted">Not set</span>
           <button type="button" class="employee-record-link" data-generate-kiosk-pin>Generate</button>`;
      host.querySelector("[data-generate-kiosk-pin]")?.addEventListener("click", () => {
        void generateKioskPin(employeeId);
      });
    } catch {
      host.innerHTML = `<span class="muted">Unknown</span>`;
    }
  }

  async function generateKioskPin(employeeId) {
    const host = document.getElementById("employees-side-kiosk-pin");
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    try {
      if (host) host.innerHTML = `<span class="muted">Generating…</span>`;
      const res = await apiFetch(`/admin/time-punch/employees/${employeeId}/kiosk-pin`, {
        method: "PUT",
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not set PIN");
      await refreshEmployeeSidePanelKioskPin(employeeId);
      const status = document.getElementById("employees-side-invite-status");
      if (status) status.textContent = `Kiosk PIN set to ${pin} — share it with the employee privately.`;
    } catch (error) {
      if (host) host.innerHTML = `<span class="muted">Could not generate PIN</span>`;
      alert(error.message || "Could not generate PIN");
    }
  }

  async function saveSidePanelSection(employeeId, sectionKey, updates) {
    const res = await apiFetch(`/admin/employees/${employeeId}/sections/${sectionKey}`, {
      method: "PATCH",
      body: JSON.stringify(normalizePayload(sectionKey, updates)),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Save failed");
    sidePanelWorkspace = data;
    const idx = employeesCache.findIndex((item) => item.id === employeeId);
    if (idx >= 0) {
      employeesCache[idx] = { ...employeesCache[idx], ...data.employee, completion_pct: data.completion_pct, next_section: data.next_section };
    }
    return data;
  }

  function bindSidePanelInlineFields(employee, workspace) {
    const employeeId = employee.id;
    const statusEl = document.getElementById("employees-side-field-status");

    const saveField = async (sectionKey, updates) => {
      try {
        if (statusEl) statusEl.textContent = "Saving…";
        const data = await saveSidePanelSection(employeeId, sectionKey, updates);
        if (statusEl) statusEl.textContent = "Saved.";
        updateSidePanelProgress(data);
        refreshEmployeesTableRowFromCache(employeeId);
        window.setTimeout(() => {
          if (statusEl?.textContent === "Saved.") statusEl.textContent = "";
        }, 1800);
      } catch (error) {
        if (statusEl) statusEl.textContent = error.message || "Save failed";
      }
    };

    document.getElementById("employees-side-job-title")?.addEventListener("change", (event) => {
      void saveField("onboarding", { job_title: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-department")?.addEventListener("change", (event) => {
      void saveField("onboarding", { department: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-email")?.addEventListener("change", (event) => {
      void saveField("recruitment", { email: event.target.value.trim() || null });
    });
  }

  function updateSidePanelProgress(workspace) {
    const meta = sectionProgressMeta(workspace);
    const fill = document.getElementById("employees-side-progress-fill");
    const copy = document.getElementById("employees-side-progress-copy");
    if (fill) fill.style.width = `${Math.min(100, meta.pct)}%`;
    if (copy) copy.textContent = `${meta.completed} of ${meta.total} sections done`;
    renderSidePanelChecklist(workspace);
  }

  function renderSidePanelChecklist(workspace) {
    const host = document.getElementById("employees-side-checklist");
    if (!host) return;
    host.innerHTML = SIDE_PANEL_CHECKLIST.map((item) => {
      const complete = checklistItemComplete(workspace, item);
      const started = checklistItemStarted(workspace, item);
      const iconClass = complete
        ? "employee-record-check__icon employee-record-check__icon--done"
        : started
          ? "employee-record-check__icon employee-record-check__icon--active"
          : "employee-record-check__icon";
      const action = complete
        ? `<span class="employee-record-check__status">Complete</span>`
        : `<button type="button" class="employee-record-link" data-side-section="${escapeHtml(item.sectionKey)}">${started ? "Continue" : "Start"} ↗</button>`;
      return `<div class="employee-record-check">
        <span class="${iconClass}" aria-hidden="true">${complete ? "✓" : ""}</span>
        <span class="employee-record-check__label">${escapeHtml(item.label)}</span>
        ${action}
      </div>`;
    }).join("");
    host.querySelectorAll("[data-side-section]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openEmployeeSectionFromPanel(workspace.employee?.id, btn.dataset.sideSection);
      });
    });
  }

  function renderSidePanelSectionExpand(workspace) {
    const host = document.getElementById("employees-side-section-host");
    if (!host) return;
    if (!sidePanelExpandedSection) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    sidePanelEmployeeId = workspace.employee?.id || selectedEmployeeId;
    host.innerHTML = `<div class="employee-record-section-expand">
      <div class="employee-record-section-expand__head">
        <strong>${escapeHtml(sectionLabel(sidePanelExpandedSection))}</strong>
        <button type="button" class="employee-record-link" id="employees-side-section-close">Close</button>
      </div>
      <div id="employees-side-section-content"></div>
    </div>`;
    host.querySelector("#employees-side-section-close")?.addEventListener("click", () => {
      sidePanelExpandedSection = null;
      sidePanelEmployeeId = null;
      renderSidePanelSectionExpand(workspace);
    });
    const contentHost = host.querySelector("#employees-side-section-content");
    if (contentHost) {
      renderSectionContent(workspace, sidePanelExpandedSection, contentHost);
    }
  }

  function openEmployeeSectionFromPanel(employeeId, sectionKey) {
    if (isMobileEmployeesHub() || sectionKey === "document_store") {
      void openEmployee(employeeId, sectionKey);
      return;
    }
    sidePanelExpandedSection = sectionKey;
    if (sidePanelWorkspace?.employee?.id === employeeId) {
      renderSidePanelSectionExpand(sidePanelWorkspace);
      document.getElementById("employees-side-section-host")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    selectedEmployeeId = employeeId;
    void renderEmployeeSidePanel(employeesCache.find((item) => item.id === employeeId));
  }

  function refreshEmployeesTableProgressOnly() {
    const tbody = $("employees-table-body");
    if (!tbody) return;
    tbody.querySelectorAll(".hr-register-row").forEach((rowEl) => {
      const employeeId = Number(rowEl.dataset.employeeId);
      refreshEmployeesTableRowFromCache(employeeId, rowEl);
    });
  }

  function refreshEmployeesTableRowFromCache(employeeId, rowEl = null) {
    const row = employeesCache.find((item) => item.id === employeeId);
    const target = rowEl || document.querySelector(`.hr-register-row[data-employee-id="${employeeId}"]`);
    if (!row || !target) return;
    target.cells[0].innerHTML = `<strong>${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</strong>${
      row.job_title ? `<div class="muted">${escapeHtml(row.job_title)}</div>` : ""
    }`;
    target.cells[1].textContent = row.department || "Not set";
    target.cells[2].innerHTML = statusPill(row.status);
    target.cells[3].innerHTML = renderRegisterProgressCell(row);
  }

  function normalizePayload(section, payload) {
    const body = { ...payload };
    if (section === "job_performance" && body.salary !== undefined && body.salary !== "") {
      body.salary = Number(body.salary);
    } else if (section === "job_performance") {
      body.salary = null;
    }
    if (
      section === "onboarding" &&
      body.contract_hours_weekly !== undefined &&
      body.contract_hours_weekly !== null &&
      body.contract_hours_weekly !== ""
    ) {
      body.contract_hours_weekly = Number(body.contract_hours_weekly);
    }
    Object.keys(body).forEach((key) => {
      if (body[key] === "") body[key] = null;
    });
    return body;
  }

  function sectionMeta(key) {
    return (window.Admin.formOptions?.employee_sections || []).find((item) => item.value === key);
  }

  function sectionLabel(key) {
    return sectionMeta(key)?.label || key;
  }

  function sectionKindTag(section) {
    if (section.kind === "link") {
      return `<span class="lifecycle-kind lifecycle-kind--guidance">Guidance</span>`;
    }
    if (section.kind === "documents") {
      return `<span class="lifecycle-kind lifecycle-kind--documents">Documents</span>`;
    }
    return "";
  }

  function stepNumberMarkup(section, workspace, isOpen) {
    if (section.kind === "link") {
      return `<span class="lifecycle-accordion-num lifecycle-accordion-num--guidance" aria-label="Guidance">↗</span>`;
    }
    const isActive =
      section.key === workspace.next_section && !section.complete && section.kind !== "link";
    if (section.complete) {
      return `<span class="lifecycle-accordion-num lifecycle-accordion-num--done" aria-label="Complete">✓</span>`;
    }
    if (isActive || (isOpen && !section.complete)) {
      return `<span class="lifecycle-accordion-num lifecycle-accordion-num--active">${section.step}</span>`;
    }
    return `<span class="lifecycle-accordion-num">${section.step}</span>`;
  }

  function lifecycleStepActionButton(section, isOpen) {
    if (isOpen) return "";
    if (section.kind === "link") {
      return `<button type="button" class="lifecycle-step-edit" data-open-section="${escapeHtml(section.key)}">View</button>`;
    }
    if (section.complete && (section.kind === "form" || section.kind === "documents")) {
      return `<button type="button" class="lifecycle-step-edit" data-open-section="${escapeHtml(section.key)}">Edit</button>`;
    }
    return "";
  }

  function bindLifecycleAccordionEvents(accordion, workspace) {
    accordion.querySelectorAll("[data-open-section]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        openLifecycleSection(btn.dataset.openSection, workspace);
      });
    });

    accordion.querySelectorAll(".lifecycle-accordion-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.section;
        const item = btn.closest(".lifecycle-accordion-item");
        if (key === activeSection && item?.classList.contains("is-open")) {
          collapseLifecycleSection(workspace);
          return;
        }
        openLifecycleSection(key, workspace);
      });
    });

    accordion.querySelectorAll(".lifecycle-accordion-chevron-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = btn.dataset.section;
        const item = btn.closest(".lifecycle-accordion-item");
        if (key === activeSection && item?.classList.contains("is-open")) {
          collapseLifecycleSection(workspace);
          return;
        }
        openLifecycleSection(key, workspace);
      });
    });
  }

  function lifecycleAccordionHost() {
    return $("employee-lifecycle-accordion");
  }

  function renderLifecycleAccordion(workspace) {
    const accordion = lifecycleAccordionHost();
    if (!accordion) return;

    accordion.innerHTML = (workspace.sections || [])
      .map((section) => {
        const isOpen = Boolean(activeSection) && section.key === activeSection;
        const isActive =
          section.key === workspace.next_section && !section.complete && section.kind !== "link";
        const isCompleteEditable = section.complete && section.kind !== "link";
        const kindTag = sectionKindTag(section);
        const branch = section.branch
          ? `<span class="lifecycle-tag">${escapeHtml(section.branch)}</span>`
          : "";
        const actionBadge = isActive
          ? `<span class="lifecycle-action-badge">Action needed</span>`
          : "";
        const itemClasses = [
          "lifecycle-accordion-item",
          isOpen ? "is-open" : "",
          isActive ? "lifecycle-accordion-item--active-step" : "",
          isCompleteEditable ? "lifecycle-accordion-item--complete" : "",
          section.kind === "link" ? "lifecycle-accordion-item--guidance" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const stepAction = lifecycleStepActionButton(section, isOpen);

        return `<section class="${itemClasses}" data-section="${escapeHtml(section.key)}">
          <div class="lifecycle-accordion-header">
            <button type="button" class="lifecycle-accordion-toggle" data-section="${escapeHtml(section.key)}" aria-expanded="${isOpen}">
              ${stepNumberMarkup(section, workspace, isOpen)}
              <span class="lifecycle-accordion-copy">
                <strong>${escapeHtml(section.label)} ${actionBadge}${kindTag ? ` ${kindTag}` : ""}</strong>
                <span class="muted">${escapeHtml(section.description || "")}</span>
                ${branch}
              </span>
            </button>
            <div class="lifecycle-accordion-actions">
              ${stepAction}
              <button type="button" class="lifecycle-accordion-chevron-btn lifecycle-accordion-chevron" data-section="${escapeHtml(section.key)}" aria-label="${isOpen ? "Collapse" : "Expand"} section"></button>
            </div>
          </div>
          <div class="lifecycle-accordion-body"${isOpen ? "" : " hidden"}>
            <div class="lifecycle-accordion-content" data-section-content="${escapeHtml(section.key)}"></div>
          </div>
        </section>`;
      })
      .join("");

    bindLifecycleAccordionEvents(accordion, workspace);

    const contentHost = activeSection
      ? accordion.querySelector(`[data-section-content="${activeSection}"]`)
      : null;
    if (contentHost) {
      try {
        renderSectionContent(workspace, activeSection, contentHost);
      } catch (error) {
        contentHost.innerHTML = `<p class="form-error-message">${escapeHtml(error.message || "Could not load this section.")}</p>`;
      }
    }

    if (activeSection) {
      requestAnimationFrame(() => {
        accordion
          .querySelector(`.lifecycle-accordion-item[data-section="${activeSection}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }

  function renderProgress(workspace) {
    const pct = workspace.completion_pct || 0;
    $("employee-progress-fill").style.width = `${pct}%`;
    const next = workspace.next_section ? sectionLabel(workspace.next_section) : null;
    const heading = $("employee-progress-heading");
    const nextEl = $("employee-progress-next");
    if (heading) {
      heading.textContent =
        pct >= 100 || !next ? "Lifecycle complete" : `Onboarding ${pct}% complete`;
    }
    if (nextEl) {
      nextEl.textContent = next ? `Next: ${next}` : "All required steps complete";
    }
  }

  function categoryLabel(value) {
    const categories = window.Admin.formOptions?.employee_document_categories || [];
    return categories.find((item) => item.value === value)?.label || value;
  }

  function renderRequirementsChecklist(requirements) {
    if (!requirements?.items?.length) return "";
    const summary = requirements.complete
      ? `<p class="employee-doc-status employee-doc-status--ok">All required documents recorded.</p>`
      : `<p class="employee-doc-status employee-doc-status--warn">${requirements.missing_required} required document(s) still missing.</p>`;
    const list = requirements.items
      .map((item) => {
        const state = item.satisfied ? "complete" : item.required ? "missing" : "optional";
        const badge = item.satisfied ? "✓" : item.required ? "!" : "·";
        return `<li class="employee-doc-req employee-doc-req--${state}"><span>${badge}</span> ${escapeHtml(item.label)}${item.required ? "" : " <span class='muted'>(optional)</span>"}</li>`;
      })
      .join("");
    return `${summary}<ul class="employee-doc-checklist">${list}</ul>`;
  }

  function renderDocumentStorePanel(workspace, container) {
    const section = (workspace.sections || []).find((item) => item.key === "document_store");
    const requirements = workspace.document_requirements || {};
    const docs = workspace.documents || [];

    container.innerHTML = `
      <div class="employee-section-intro">
        <h4>${escapeHtml(section?.label || "Document store")}</h4>
        <p class="muted">${escapeHtml(section?.description || "")}</p>
        ${renderRequirementsChecklist(requirements)}
      </div>
      <div id="employee-document-form"></div>
      <form id="employee-document-upload-form" class="edit-form edit-form--cols-2" enctype="multipart/form-data" style="margin-bottom:1rem;">
        <label class="edit-field"><span class="edit-label">Upload title</span><input name="title" required placeholder="e.g. Signed contract" /></label>
        <label class="edit-field"><span class="edit-label">File</span><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/*" required /></label>
        <label class="edit-field"><span class="edit-label">Category</span><select name="category"><option value="contract">Employment contract</option><option value="id">ID / passport</option><option value="rtw">Right to work</option><option value="qualification">Qualification / training cert</option><option value="policy">Signed policy / handbook</option><option value="general">General</option><option value="other">Other</option></select></label>
        <label class="edit-field"><span class="edit-label">Expiry date</span><input name="expires_at" type="date" /><span class="muted edit-hint">Set for food hygiene, first aid, and other renewable certificates.</span></label>
        <div class="edit-form-actions" data-span="2"><button class="btn secondary" type="submit">Upload file</button><p class="edit-form-status muted" data-upload-status></p></div>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Title</th><th>Category</th><th>Expires</th><th>Added</th><th></th></tr></thead>
          <tbody id="employee-documents-body"></tbody>
        </table>
      </div>`;

    mountEditForm(container.querySelector("#employee-document-form"), {
      id: "employee-document",
      columns: 2,
      submitLabel: "Add document",
      successMessage: "Document added.",
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        {
          name: "category",
          label: "Category",
          type: "select",
          optionsKey: "employee_document_categories",
          defaultValue: "contract",
        },
        { name: "document_url", label: "Document URL", type: "url", placeholder: "https://..." },
        { name: "expires_at", label: "Expiry date", type: "date" },
        { name: "notes", label: "Notes", type: "textarea", span: 2 },
      ],
    }, {
      onSubmit: async (payload) => {
        const res = await apiFetch(`/admin/employees/${activeEmployeeId}/documents`, {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            lifecycle_stage: "document_store",
            document_url: payload.document_url || null,
            notes: payload.notes || null,
            expires_at: payload.expires_at || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Save failed");
        await openEmployee(activeEmployeeId, "document_store");
        if (workspaceCache?.document_requirements?.complete && workspaceCache.next_section) {
          const next = workspaceCache.next_section;
          if (next !== "document_store") {
            activeSection = next;
            window.location.hash = `employees/${activeEmployeeId}/${next}`;
            renderLifecycleAccordion(workspaceCache);
          }
        }
      },
    });

    renderTableBody(container.querySelector("#employee-documents-body"), {
      emptyMessage: "No documents recorded yet.",
      columns: [
        { key: "title", render: (row) => `<strong>${escapeHtml(row.title)}</strong>` },
        { key: "category", render: (row) => escapeHtml(categoryLabel(row.category)) },
        { key: "expires_at", render: (row) => escapeHtml((row.expires_at || "").slice(0, 10) || "Not set") },
        { key: "created_at", render: (row) => escapeHtml((row.created_at || "").slice(0, 10) || "Not set") },
        {
          key: "actions",
          render: (row) =>
            `<div class="table-actions">
              ${row.has_file ? `<button type="button" class="btn ghost" data-download-doc="${row.id}">Download</button>` : ""}
              ${row.document_url ? `<a class="btn ghost" href="${escapeHtml(row.document_url)}" target="_blank" rel="noopener">Open link</a>` : ""}
              <button type="button" class="btn ghost" data-delete-doc="${row.id}">Remove</button>
            </div>`,
        },
      ],
      rows: docs,
    });

    container.querySelectorAll("[data-delete-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Remove this document record?")) return;
        const res = await apiFetch(`/admin/employees/${activeEmployeeId}/documents/${btn.dataset.deleteDoc}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.detail || "Delete failed");
          return;
        }
        await openEmployee(activeEmployeeId, "document_store");
      });
    });

    container.querySelectorAll("[data-download-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = docs.find((item) => String(item.id) === btn.dataset.downloadDoc);
        const name = row?.original_filename || `${row?.title || "document"}.bin`;
        await downloadAuthenticated(
          `/admin/employees/${activeEmployeeId}/documents/${btn.dataset.downloadDoc}/file`,
          name
        );
      });
    });

    const uploadForm = container.querySelector("#employee-document-upload-form");
    uploadForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = uploadForm.querySelector("[data-upload-status]");
      if (status) status.textContent = "Uploading…";
      const fd = new FormData(uploadForm);
      try {
        const res = await fetch(`${API_BASE}/admin/employees/${activeEmployeeId}/documents/upload`, {
          method: "POST",
          headers: authHeaders(false),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Upload failed");
        uploadForm.reset();
        if (status) status.textContent = "Uploaded.";
        await openEmployee(activeEmployeeId, "document_store");
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    });
  }

  function formatNoteWhen(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return iso;
    }
  }

  function noteVisibilityLabel(visibility) {
    return visibility === "employee_visible" ? "Shared with employee" : "HR only";
  }

  async function loadEmployeeNotesList(container) {
    const list = container.querySelector("#employee-notes-list");
    if (!list || !activeEmployeeId) return;
    list.innerHTML = `<p class="muted">Loading notes…</p>`;
    try {
      const res = await apiFetch(`/admin/employees/${activeEmployeeId}/notes`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not load notes");
      const items = data.items || [];
      if (!items.length) {
        list.innerHTML = `<p class="muted">No notes yet.</p>`;
        return;
      }
      list.innerHTML = items
        .map(
          (note) => `
          <article class="employee-note-card employee-note-card--${escapeHtml(note.visibility)}">
            <header class="employee-note-card__head">
              <span class="employee-note-badge">${escapeHtml(noteVisibilityLabel(note.visibility))}</span>
              <span class="muted">${escapeHtml(formatNoteWhen(note.created_at))}</span>
            </header>
            <p class="employee-note-card__body">${escapeHtml(note.body || "")}</p>
            <footer class="employee-note-card__foot muted">Added by ${escapeHtml(note.created_by || "HR")}</footer>
          </article>`,
        )
        .join("");
    } catch (error) {
      list.innerHTML = `<p class="form-error-message">${escapeHtml(error.message || "Could not load notes")}</p>`;
    }
  }

  function renderNotesPanel(workspace, section, container) {
    container.innerHTML = `
      <div class="employee-section-intro">${buildSectionIntro(section, workspace)}</div>
      <form id="employee-note-form" class="edit-form edit-form--cols-2 employee-note-form">
        <label class="edit-field" data-span="2">
          <span class="edit-label">Note</span>
          <textarea name="body" rows="4" maxlength="4000" required placeholder="Record an HR-only note or a message for the employee portal…"></textarea>
        </label>
        <label class="edit-field">
          <span class="edit-label">Visibility</span>
          <select name="visibility">
            <option value="hr_internal">HR only (encrypted)</option>
            <option value="employee_visible">Shared with employee</option>
          </select>
        </label>
        <div class="edit-form-actions" data-span="2">
          <button class="btn secondary" type="submit">Save note</button>
          <p class="edit-form-status muted" data-note-status></p>
        </div>
      </form>
      <div id="employee-notes-list" class="employee-notes-list"><p class="muted">Loading notes…</p></div>`;

    const form = container.querySelector("#employee-note-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = container.querySelector("[data-note-status]");
      const payload = Object.fromEntries(new FormData(form).entries());
      if (status) status.textContent = "Saving…";
      try {
        const res = await apiFetch(`/admin/employees/${activeEmployeeId}/notes`, {
          method: "POST",
          body: JSON.stringify({
            body: payload.body,
            visibility: payload.visibility || "hr_internal",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Save failed");
        form.reset();
        if (status) status.textContent = "Note saved.";
        await loadEmployeeNotesList(container);
      } catch (error) {
        if (status) status.textContent = error.message || "Save failed";
      }
    });

    loadEmployeeNotesList(container);
  }

  function renderLinkPanel(section, container) {
    const meta = LINK_SECTIONS[section.key] || {};
    container.innerHTML = `
      <div class="employee-section-intro">
        <h4>${escapeHtml(meta.title || section.label)}</h4>
        ${meta.branch ? `<span class="lifecycle-tag">${escapeHtml(meta.branch)}</span>` : ""}
        <p class="muted">${escapeHtml(meta.body || section.description || "")}</p>
        <p class="link-row">${(meta.links || []).map((link) => `<a class="btn ghost" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join(" ")}</p>
      </div>`;
  }

  function buildSectionIntro(section, workspace) {
    let intro = `<h4>${escapeHtml(section.label)}</h4><p class="muted">${escapeHtml(section.description || "")}</p>`;
    if (section.branch) {
      intro += `<span class="lifecycle-tag">${escapeHtml(section.branch)}</span>`;
    }
    const hint = SECTION_HINTS[section.key];
    if (hint) {
      intro += `<p class="employee-section-hint">${hint}</p>`;
    }
    if (section.key === "job_performance") {
      intro += `<p class="employee-section-hint"><a href="#templates">Open HR Templates</a> for probation review and annual appraisal forms.</p>`;
    }
    return intro;
  }

  function renderSectionContent(workspace, sectionKey, container) {
    if (!container) return;

    const section = (workspace.sections || []).find((item) => item.key === sectionKey);
    if (!section) {
      container.innerHTML = `<p class="muted">This lifecycle step is not available for this employee.</p>`;
      return;
    }

    if (section.kind === "link") {
      renderLinkPanel(section, container);
      return;
    }

    if (section.kind === "documents") {
      if (!window.Admin.formOptions) {
        container.innerHTML = `<p class="muted">Loading document store…</p>`;
        void loadFormOptions().then(() => {
          if (activeSection === sectionKey && workspaceCache) {
            renderDocumentStorePanel(workspaceCache, container);
          }
        });
        return;
      }
      renderDocumentStorePanel(workspace, container);
      return;
    }

    if (section.kind === "notes") {
      renderNotesPanel(workspace, section, container);
      return;
    }

    const schema = SECTION_SCHEMAS[sectionKey];
    if (!schema) {
      container.innerHTML = `<p class="muted">This section is not available.</p>`;
      return;
    }

    const intro = buildSectionIntro(section, workspace);
    container.innerHTML = `<div class="employee-section-intro">${intro}</div><div id="employee-section-form"></div>`;

    const formSchema = {
      ...schema,
      submitLabel: sidePanelEmployeeId && !activeEmployeeId ? "Save" : "Save & continue",
      secondaryAction: {
        label: "Cancel",
        onClick: () => {
          if (sidePanelEmployeeId && !activeEmployeeId) {
            sidePanelExpandedSection = null;
            sidePanelEmployeeId = null;
            renderSidePanelSectionExpand(sidePanelWorkspace || workspace);
            return;
          }
          collapseLifecycleSection(workspace);
        },
      },
    };

    mountEditForm(container.querySelector("#employee-section-form"), formSchema, {
      values: section.data || {},
      onSubmit: async (payload) => {
        const employeeId = activeEmployeeId || sidePanelEmployeeId;
        const res = await apiFetch(`/admin/employees/${employeeId}/sections/${sectionKey}`, {
          method: "PATCH",
          body: JSON.stringify(normalizePayload(sectionKey, payload)),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Save failed");
        workspaceCache = data;
        sidePanelWorkspace = data;
        if (sectionKey === "recruitment") {
          window.dispatchEvent(new CustomEvent("admin:features-refresh"));
        }
        if (sidePanelEmployeeId && !activeEmployeeId) {
          const idx = employeesCache.findIndex((item) => item.id === employeeId);
          if (idx >= 0) {
            employeesCache[idx] = {
              ...employeesCache[idx],
              ...data.employee,
              completion_pct: data.completion_pct,
              next_section: data.next_section,
            };
          }
          updateSidePanelProgress(data);
          refreshEmployeesTableProgressOnly();
          renderSidePanelSectionExpand(data);
          return;
        }
        const next = data.next_section;
        if (next && next !== sectionKey) {
          activeSection = next;
          window.location.hash = `employees/${employeeId}/${next}`;
        }
        renderWorkspace(data);
      },
    });
  }

  function renderWorkspace(workspace) {
    workspaceCache = workspace;
    renderEmployeeHeader(workspace);
    renderAdvancedLinks(workspace.employee || {});
    renderKioskPinPanel(workspace.employee?.id);
    renderProgress(workspace);

    const sectionKeys = (workspace.sections || []).map((s) => s.key);
    if (activeSection && !sectionKeys.includes(activeSection)) {
      activeSection = workspace.next_section || "recruitment";
    }
    renderLifecycleAccordion(workspace);
  }

  async function openEmployee(employeeId, section = null) {
    const requestId = ++openEmployeeRequest;
    const desired = section ? `employees/${employeeId}/${section}` : `employees/${employeeId}`;
    if (window.location.hash.replace("#", "") !== desired) {
      window.location.hash = desired;
    }
    activeEmployeeId = employeeId;
    showDetailView();
    const accordion = lifecycleAccordionHost();
    if (accordion) accordion.innerHTML = `<p class="muted lifecycle-accordion-content">Loading employee lifecycle…</p>`;

    const res = await apiFetch(`/admin/employees/${employeeId}/workspace`);
    if (requestId !== openEmployeeRequest) return;
    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || "Could not load employee");
      showListView();
      return;
    }

    activeSection = section || data.next_section || "recruitment";
    renderWorkspace(data);
  }

  async function refreshEmployeesTable() {
    const tbody = $("employees-table-body");
    if (!tbody) return;

    try {
      const res = await apiFetch("/admin/employees");
      if (!res.ok) {
        let detail = "Load failed";
        try {
          const err = await res.json();
          detail = err.detail || err.message || detail;
        } catch {
          /* ignore */
        }
        throw new Error(typeof detail === "string" ? detail : "Load failed");
      }
      const data = await res.json();
      employeesCache = data.items || [];

      if (!employeesCache.length) {
        tbody.innerHTML =
          '<tr><td colspan="4" class="muted">No employees yet. Add your first team member above.</td></tr>';
        renderEmployeeSidePanel(null);
        renderLifecycleHub([]);
        return;
      }

      tbody.innerHTML = employeesCache
        .map((row) => {
          const selected = selectedEmployeeId === row.id ? " hr-register-row--selected" : "";
          return `<tr class="hr-register-row${selected}" data-employee-id="${row.id}">
            <td><strong>${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</strong>${row.job_title ? `<div class="muted">${escapeHtml(row.job_title)}</div>` : ""}</td>
            <td>${escapeHtml(row.department || "Not set")}</td>
            <td>${statusPill(row.status)}</td>
            <td>${renderRegisterProgressCell(row)}</td>
          </tr>`;
        })
        .join("");

      tbody.querySelectorAll(".hr-register-row").forEach((row) => {
        row.addEventListener("click", () => {
          const newId = Number(row.dataset.employeeId);
          if (selectedEmployeeId !== newId) {
            sidePanelExpandedSection = null;
          }
          selectedEmployeeId = newId;
          tbody.querySelectorAll(".hr-register-row").forEach((el) => {
            el.classList.toggle("hr-register-row--selected", Number(el.dataset.employeeId) === selectedEmployeeId);
          });
          void renderEmployeeSidePanel(employeesCache.find((e) => e.id === selectedEmployeeId));
        });
      });

      if (selectedEmployeeId) {
        renderEmployeeSidePanel(employeesCache.find((e) => e.id === selectedEmployeeId));
      }
      renderLifecycleHub(employeesCache);
    } catch (error) {
      const message = escapeHtml(error?.message || "Could not load employees.");
      tbody.innerHTML = `<tr><td colspan="4" class="muted">${message} Try refreshing the page — your saved employees are still in the database.</td></tr>`;
    }
  }

  async function renderEmployeeSidePanel(row) {
    const empty = $("employees-side-empty");
    const content = $("employees-side-content");
    if (!content) return;
    if (!row) {
      sidePanelWorkspace = null;
      sidePanelExpandedSection = null;
      sidePanelEmployeeId = null;
      empty?.removeAttribute("hidden");
      content.hidden = true;
      content.innerHTML = "";
      return;
    }
    empty?.setAttribute("hidden", "");
    content.hidden = false;

    const requestId = ++sidePanelRenderRequest;
    content.innerHTML = `<p class="muted employee-record-loading">Loading profile…</p>`;

    try {
      const res = await apiFetch(`/admin/employees/${row.id}/workspace`);
      if (requestId !== sidePanelRenderRequest) return;
      const workspace = await res.json();
      if (!res.ok) throw new Error(workspace.detail || "Could not load employee");

      sidePanelWorkspace = workspace;
      const employee = workspace.employee || row;
      const palette = avatarPalette(employee.id);
      const initials = employeeInitials(employee);
      const progress = sectionProgressMeta(workspace);
      const inviteDisabled = !(employee.email && employee.portal_setup_status !== "complete");
      const inviteLabel =
        employee.portal_setup_pending || employee.portal_setup_status === "pending"
          ? "Resend portal link"
          : "Send portal invite";

      content.innerHTML = `
        <article class="employee-record-card">
          <header class="employee-record-head">
            <div class="employee-record-identity">
              <span class="employee-record-avatar" style="background:${palette.bg};color:${palette.color}">${escapeHtml(initials)}</span>
              <div>
                <h3 class="employee-record-name">${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</h3>
                ${statusPill(employee.status)}
              </div>
            </div>
            <div class="employee-record-actions">
              <button type="button" class="btn outline btn-sm" id="employees-side-invite-btn" ${inviteDisabled ? "disabled" : ""}>${escapeHtml(inviteLabel)}</button>
              <button type="button" class="btn outline btn-sm employee-record-remove" id="employees-side-delete-btn">Remove</button>
            </div>
          </header>

          <div class="employee-record-progress">
            <div class="employee-record-progress__meta">
              <span>Profile completeness</span>
              <span id="employees-side-progress-copy">${progress.completed} of ${progress.total} sections done</span>
            </div>
            <div class="employee-record-progress__bar"><span id="employees-side-progress-fill" style="width:${Math.min(100, progress.pct)}%"></span></div>
          </div>

          <div class="employee-record-fields">
            <label class="employee-record-field">
              <span class="employee-record-field__label">Job title</span>
              <input type="text" id="employees-side-job-title" value="${escapeHtml(employee.job_title || "")}" placeholder="Not set" />
            </label>
            <label class="employee-record-field">
              <span class="employee-record-field__label">Department</span>
              <select id="employees-side-department">${departmentSelectOptions(employee.department || "")}</select>
            </label>
            <label class="employee-record-field">
              <span class="employee-record-field__label">Email</span>
              <input type="email" id="employees-side-email" value="${escapeHtml(employee.email || "")}" placeholder="Not set" />
            </label>
            <div class="employee-record-field">
              <span class="employee-record-field__label">Kiosk PIN</span>
              <div class="employee-record-kiosk" id="employees-side-kiosk-pin">Loading…</div>
            </div>
          </div>
          <p class="muted employee-record-field-status" id="employees-side-field-status" aria-live="polite"></p>

          <div class="employee-record-checklist-wrap">
            <h4 class="employee-record-checklist-title">Lifecycle sections</h4>
            <div class="employee-record-checklist" id="employees-side-checklist"></div>
          </div>

          <div id="employees-side-section-host" hidden></div>

          <footer class="employee-record-foot muted">
            <span class="employee-record-portal-icon" aria-hidden="true"></span>
            ${escapeHtml(portalStatusCopy(employee))}
          </footer>
          <p class="muted" id="employees-side-invite-status" aria-live="polite"></p>
        </article>`;

      renderSidePanelChecklist(workspace);
      renderSidePanelSectionExpand(workspace);
      void refreshEmployeeSidePanelKioskPin(employee.id);
      bindSidePanelInlineFields(employee, workspace);

      content.querySelector("#employees-side-invite-btn")?.addEventListener("click", () => {
        void sendPortalInvite(employee.id, "employees-side-invite-status");
      });
      content.querySelector("#employees-side-delete-btn")?.addEventListener("click", async () => {
        if (!window.confirm("Remove this employee record?")) return;
        const deleteRes = await apiFetch(`/admin/employees/${employee.id}`, { method: "DELETE" });
        if (!deleteRes.ok) {
          const err = await deleteRes.json();
          alert(err.detail || "Delete failed");
          return;
        }
        selectedEmployeeId = null;
        sidePanelExpandedSection = null;
        sidePanelWorkspace = null;
        await refreshEmployeesTable();
      });
    } catch (error) {
      if (requestId !== sidePanelRenderRequest) return;
      content.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load employee profile.")}</p>`;
    }
  }

  function mountQuickAddForm() {
    if (quickAddMounted) return;
    const host = $("employee-quick-add-form");
    if (!host) return;
    quickAddMounted = true;
    const stepEl = $("employees-step-indicator");
    if (stepEl) {
      stepEl.textContent = "Quick capture";
    }
    mountEditForm(host, QUICK_ADD_SCHEMA, {
      onSubmit: async (payload) => {
        const res = await apiFetch("/admin/employees", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            email: payload.email || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Create failed");
        selectedEmployeeId = data.id;
        sidePanelExpandedSection = null;
        await refreshEmployeesTable();
        if (isMobileEmployeesHub()) {
          await openEmployee(data.id, "recruitment");
        } else {
          document.getElementById("employees-side-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      },
    });
  }

  async function initEmployeesSection() {
    if (!sectionLoaded) {
      sectionLoaded = true;
      await loadFormOptions();
      mountQuickAddForm();
      mountKioskPinForm();
      document.getElementById("employees-bulk-invite-btn")?.addEventListener("click", () => sendBulkPortalInvites());
      window.addEventListener("resize", () => renderLifecycleHub(employeesCache));
    }
    await refreshEmployeesTable();
  }

  $("employee-back-btn")?.addEventListener("click", showListView);

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section !== "employees") return;
    void (async () => {
      await initEmployeesSection();

      const hash = window.location.hash.replace("#", "");
      const match = hash.match(/^employees\/(\d+)(?:\/([\w_]+))?$/);
      if (match) {
        await openEmployee(Number(match[1]), match[2] || null);
      } else {
        showListView();
      }
    })();
  });

  window.addEventListener("hashchange", () => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "employees") {
      if (document.getElementById("employees")?.classList.contains("admin-section--active")) {
        showListView();
      }
      return;
    }
    if (!hash.startsWith("employees/")) return;
    const match = hash.match(/^employees\/(\d+)(?:\/([\w_]+))?$/);
    if (!match) return;
    const id = Number(match[1]);
    const section = match[2] || null;
    if (id === activeEmployeeId) {
      if (!workspaceCache) return;
      const contentHost = section
        ? document.querySelector(`[data-section-content="${section}"]`)
        : null;
      const contentMissing = Boolean(contentHost && !contentHost.textContent?.trim());
      if (section !== activeSection || contentMissing) {
        activeSection = section;
        renderLifecycleAccordion(workspaceCache);
      }
      return;
    }
    void openEmployee(id, section);
  });
})();
