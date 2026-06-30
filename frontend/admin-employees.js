/** Employee workspace — lifecycle flow aligned to HR chart (recruitment → off-boarding). */
(function () {
  const { apiFetch, escapeHtml, mountEditForm, renderTableBody, statusPill, loadFormOptions, isFeatureEnabled, downloadAuthenticated, authHeaders, API_BASE, readApiError, friendlyNativeError, normalizeEmployeeListPayload, verifyAdminSession, getAdminOverviewCache, parseApiJson, fetchEmployeesList, peekEmployeesListCache, showAdminToast } = window.Admin;

  function employeesToast(message, variant = "info") {
    if (showAdminToast) showAdminToast(message, { variant });
    else window.ShiftSwiftAction?.showActionToast?.(message, variant === "error" ? "error" : "ok");
  }

  const DEFAULT_DOCUMENT_UPLOAD = {
    accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
    extensions: [".pdf", ".jpg", ".jpeg", ".png"],
    mime_types: ["application/pdf", "image/jpeg", "image/png"],
    max_bytes: 10 * 1024 * 1024,
    max_size_label: "10 MB",
    hint: "PDF, JPEG or PNG · max 10 MB per file",
  };

  function documentUploadPolicy() {
    return window.Admin.formOptions?.document_upload || DEFAULT_DOCUMENT_UPLOAD;
  }

  function fileExtension(name) {
    const base = String(name || "").trim().toLowerCase();
    const idx = base.lastIndexOf(".");
    return idx >= 0 ? base.slice(idx) : "";
  }

  function validateDocumentUploadFile(file, policy = documentUploadPolicy()) {
    if (!file || !file.size) return "Choose a file to upload.";
    const ext = fileExtension(file.name);
    const mime = String(file.type || "").toLowerCase();
    const extensions = policy.extensions || DEFAULT_DOCUMENT_UPLOAD.extensions;
    const mimeTypes = policy.mime_types || DEFAULT_DOCUMENT_UPLOAD.mime_types;
    const extOk = extensions.includes(ext);
    const mimeOk = !mime || mimeTypes.includes(mime);
    if (!extOk && !mimeOk) {
      return `Use PDF, JPEG or PNG only. ${policy.hint || DEFAULT_DOCUMENT_UPLOAD.hint}`;
    }
    const maxBytes = Number(policy.max_bytes) || DEFAULT_DOCUMENT_UPLOAD.max_bytes;
    if (file.size > maxBytes) {
      return `File is too large. Maximum size is ${policy.max_size_label || DEFAULT_DOCUMENT_UPLOAD.max_size_label}.`;
    }
    return null;
  }

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

  function isPortalSetupPending(row) {
    return Boolean(row?.portal_setup_pending || row?.portal_setup_status === "pending");
  }

  function renderPortalStatusCell(row) {
    if (row?.portal_setup_complete || row?.portal_setup_status === "complete") {
      return `<span class="employee-portal-pill employee-portal-pill--ok">Active</span>`;
    }
    if (isPortalSetupPending(row)) {
      return `<span class="employee-portal-pill employee-portal-pill--warn">Setup pending</span>`;
    }
    if (!row?.email) return `<span class="muted">No email</span>`;
    return `<span class="employee-portal-pill employee-portal-pill--muted">Not invited</span>`;
  }

  function getFilteredEmployees() {
    if (employeeRegisterFilter === "portal-pending") {
      return employeesCache.filter((row) => isPortalSetupPending(row));
    }
    return employeesCache;
  }

  function autoExpandLifecycleStage(items = employeesCache) {
    const buckets = bucketEmployeesByStage(items);
    const order = ["active", "onboarding", "recruitment", "offboarding"];
    const pick = order.find((key) => (buckets[key] || []).length) || "recruitment";
    lifecycleHubExpanded = { recruitment: false, onboarding: false, active: false, offboarding: false };
    lifecycleHubExpanded[pick] = true;
    lifecycleHubOpenStage = pick;
  }

  function renderLifecycleHubLoadError(message) {
    const hub = $("employees-lifecycle-hub");
    if (!hub || !isMobileEmployeesHub()) return;
    hub.hidden = false;
    hub.innerHTML = `<div class="overview-error" style="padding:16px 0;margin-bottom:12px">
      <p class="muted">${escapeHtml(message)}</p>
      <button type="button" class="btn outline btn-sm" id="employees-hub-retry-btn">Retry</button>
    </div>`;
    hub.querySelector("#employees-hub-retry-btn")?.addEventListener("click", () => {
      void initEmployeesSection();
    });
  }

  function syncEmployeesPresentation() {
    if (!employeesCache.length) {
      renderEmployeeSidePanel(null);
      renderLifecycleHub([]);
      renderEmployeeMobileCards([]);
      return;
    }
    autoExpandLifecycleStage(employeesCache);
    renderLifecycleHub(employeesCache);
    renderEmployeeMobileCards(getFilteredEmployees());
  }

  function renderEmployeeRegisterFilterBanner() {
    const banner = $("employees-register-filter-banner");
    if (!banner) return;
    if (employeeRegisterFilter !== "portal-pending") {
      banner.hidden = true;
      banner.innerHTML = "";
      return;
    }
    const count = getFilteredEmployees().length;
    banner.hidden = false;
    banner.innerHTML = `
      <div class="employees-register-filter-banner__copy">
        <strong>Portal setup pending</strong>
        <span class="muted">${count} employee${count === 1 ? "" : "s"} invited but has not set a portal password yet. Ask them to check junk mail or resend the link.</span>
      </div>
      <button type="button" class="btn ghost btn-sm" id="employees-clear-register-filter">Show all employees</button>`;
    banner.querySelector("#employees-clear-register-filter")?.addEventListener("click", () => {
      employeeRegisterFilter = null;
      if (window.location.hash.replace("#", "") === "employees/portal-pending") {
        window.location.hash = "employees";
        return;
      }
      renderEmployeeRegister();
    });
  }

  function renderEmployeeRegister() {
    renderEmployeeRegisterFilterBanner();
    const rows = getFilteredEmployees();
    const tbody = $("employees-table-body");

    if (!employeesCache.length) {
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="muted">No employees yet. Add your first team member above.</td></tr>';
      }
      syncEmployeesPresentation();
      return;
    }

    if (!rows.length) {
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="muted">No employees match this filter.</td></tr>';
      }
      renderEmployeeSidePanel(null);
      syncEmployeesPresentation();
      return;
    }

    if (!tbody) {
      syncEmployeesPresentation();
      return;
    }

    tbody.innerHTML = rows
      .map((row) => {
        const selected = selectedEmployeeId === row.id ? " hr-register-row--selected" : "";
        return `<tr class="hr-register-row${selected}" data-employee-id="${row.id}">
          <td><strong>${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</strong>${row.job_title ? `<div class="muted">${escapeHtml(row.job_title)}</div>` : ""}</td>
          <td>${escapeHtml(row.department || "Not set")}</td>
          <td>${statusPill(row.status)}</td>
          <td>${renderPortalStatusCell(row)}</td>
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

    if (selectedEmployeeId && rows.some((row) => row.id === selectedEmployeeId)) {
      renderEmployeeSidePanel(employeesCache.find((e) => e.id === selectedEmployeeId));
    } else if (employeeRegisterFilter === "portal-pending" && rows.length === 1) {
      selectedEmployeeId = rows[0].id;
      tbody.querySelectorAll(".hr-register-row").forEach((el) => {
        el.classList.toggle("hr-register-row--selected", Number(el.dataset.employeeId) === selectedEmployeeId);
      });
      void renderEmployeeSidePanel(rows[0]);
    } else {
      selectedEmployeeId = null;
      renderEmployeeSidePanel(null);
    }
    syncEmployeesPresentation();
  }

  function renderEmployeeMobileCards(rows = getFilteredEmployees()) {
    const host = $("employees-mobile-cards");
    const hub = $("employees-lifecycle-hub");
    if (!host || !isMobileEmployeesHub()) return;
    if (hub && !hub.hidden && hub.querySelector(".lifecycle-hub-section")) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    if (!employeesCache.length) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML = rows.length
      ? rows
          .map(
            (row) => `<button type="button" class="lifecycle-employee-card" data-employee-id="${row.id}">
              <span class="lifecycle-employee-card__name">${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</span>
              <span class="lifecycle-employee-card__meta muted">${escapeHtml(row.job_title || row.department || "Employee")} · ${escapeHtml(row.status || "active")}</span>
            </button>`,
          )
          .join("")
      : `<p class="muted">No employees match this filter.</p>`;
    host.querySelectorAll("[data-employee-id]").forEach((card) => {
      card.addEventListener("click", () => openEmployee(Number(card.dataset.employeeId)));
    });
  }

  function applyEmployeesListRoute() {
    const hash = window.location.hash.replace("#", "");
    if (hash === "employees/portal-pending") {
      employeeRegisterFilter = "portal-pending";
      showListView();
      renderEmployeeRegister();
      return true;
    }
    if (/^employees\/\d+/.test(hash)) return false;
    employeeRegisterFilter = null;
    showListView();
    renderEmployeeRegister();
    return true;
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

  function renderLifecycleStageRail(buckets, { selectedEmployee = null, totalEmployees = 0 } = {}) {
    const rail = $("lifecycle-stage-rail");
    if (!rail) return;

    const stageIndex = (id) => LIFECYCLE_STAGES.findIndex((stage) => stage.id === id);
    const selectedStage = selectedEmployee ? lifecycleStage(selectedEmployee) : null;
    const selectedIdx = selectedStage ? stageIndex(selectedStage) : -1;
    const progressPct =
      selectedIdx > 0 ? Math.round((selectedIdx / Math.max(1, LIFECYCLE_STAGES.length - 1)) * 100) : 0;

    const steps = LIFECYCLE_STAGES.map((stage, index) => {
      const count = buckets[stage.id]?.length ?? 0;
      let stateClass = "";
      let marker;
      let stateLabel = "";

      if (selectedEmployee) {
        const isDone = selectedIdx > index;
        const isCurrent = stage.id === selectedStage;
        if (isDone) {
          stateClass = " lifecycle-stage-rail__step--done";
          marker = `<span class="lifecycle-stage-rail__marker lifecycle-stage-rail__marker--done" aria-hidden="true">✓</span>`;
        } else if (isCurrent) {
          stateClass = " lifecycle-stage-rail__step--current";
          marker = `<span class="lifecycle-stage-rail__marker">${index + 1}</span>`;
          stateLabel = `<span class="lifecycle-stage-rail__state">In progress</span>`;
        } else {
          marker = `<span class="lifecycle-stage-rail__marker">${index + 1}</span>`;
        }
      } else {
        marker = `<span class="lifecycle-stage-rail__marker">${index + 1}</span>`;
        if (totalEmployees === 0 && index === 0) {
          stateLabel = `<span class="lifecycle-stage-rail__state">Start here</span>`;
        } else if (count > 0) {
          stateLabel = `<span class="lifecycle-stage-rail__state">${count} in stage</span>`;
        }
      }

      const shortcut =
        stage.id === "recruitment"
          ? `<span class="lifecycle-stage-rail__link">Recruitment pipeline →</span>`
          : stage.id === "offboarding"
            ? `<span class="lifecycle-stage-rail__link">Offboarding workflow →</span>`
            : "";

      return `<button type="button" class="lifecycle-stage-rail__step${stateClass}" data-lifecycle-stage="${stage.id}"${
        selectedEmployee && stage.id === selectedStage ? ' aria-current="step"' : ""
      }>
        ${marker}
        <span class="lifecycle-stage-rail__label">${escapeHtml(stage.shortLabel)}</span>
        ${stateLabel}
        ${shortcut}
      </button>`;
    });

    const lines = steps
      .slice(0, -1)
      .map(
        (_, index) =>
          `<span class="lifecycle-stage-rail__line${
            selectedEmployee && selectedIdx > index ? " lifecycle-stage-rail__line--filled" : ""
          }" aria-hidden="true"></span>`
      );

    const trackParts = [];
    steps.forEach((step, index) => {
      trackParts.push(step);
      if (index < lines.length) trackParts.push(lines[index]);
    });

    rail.innerHTML = `<div class="lifecycle-stage-rail__track${
      selectedEmployee ? "" : " lifecycle-stage-rail__track--neutral"
    }" style="--lifecycle-progress:${progressPct}%">${trackParts.join("")}</div>`;

    rail.querySelectorAll("[data-lifecycle-stage]").forEach((el) => {
      el.addEventListener("click", () => {
        const stageId = el.dataset.lifecycleStage;
        if (stageId === "recruitment") {
          window.location.hash = "recruitment";
          return;
        }
        if (stageId === "offboarding") {
          window.location.hash = "offboarding";
          return;
        }
        if (!isMobileEmployeesHub()) return;
        lifecycleHubOpenStage = stageId;
        lifecycleHubExpanded[lifecycleHubOpenStage] = true;
        renderLifecycleHub(employeesCache);
        document
          .querySelector(`[data-lifecycle-section="${lifecycleHubOpenStage}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    try {
    const overviewActive = Number(getAdminOverviewCache?.()?.modules?.employees?.active ?? 0);
    const mismatchBanner =
      !items.length && overviewActive > 0
        ? `<div class="overview-error" style="margin-bottom:10px"><p class="muted">Your dashboard shows ${overviewActive} active employee${overviewActive === 1 ? "" : "s"}, but the register is still empty. Tap Retry below or pull to refresh.</p><button type="button" class="btn outline btn-sm" id="employees-hub-retry-btn">Retry</button></div>`
        : "";
    const buckets = bucketEmployeesByStage(items);
    const selected =
      selectedEmployeeId && items.length ? items.find((row) => row.id === selectedEmployeeId) || null : null;
    renderLifecycleStageRail(buckets, { selectedEmployee: selected, totalEmployees: items.length });

    if (!isMobileEmployeesHub()) {
      hub.hidden = true;
      relocateQuickAddForm(document.querySelector(".employees-quick-add-panel"));
      return;
    }

    hub.hidden = false;
    const icon = (name) => window.AdminIcons?.svg?.(name) || "";

    hub.innerHTML = mismatchBanner + LIFECYCLE_STAGES.map((stage) => {
      const rows = buckets[stage.id] || [];
      const isOpen = Boolean(lifecycleHubExpanded[stage.id]);
      const showAll = Boolean(lifecycleHubShowAll[stage.id]);
      const visibleRows = showAll ? rows : rows.slice(0, LIFECYCLE_HUB_PAGE_SIZE);
      const cards = visibleRows.length
        ? visibleRows.map((row) => renderLifecycleEmployeeCard(row, stage.id)).join("")
        : stageEmptyStateHtml(stage.id);
      const viewAll =
        rows.length > LIFECYCLE_HUB_PAGE_SIZE && !showAll
          ? `<button type="button" class="btn ghost lifecycle-view-all-btn" data-lifecycle-view-all="${stage.id}">View all ${rows.length} employees</button>`
          : "";
      const recruitmentExtras =
        stage.id === "recruitment"
          ? `<div class="employees-recruitment-add">
              ${rows.length ? "" : `<p class="employees-recruitment-add__title">Start your register</p>`}
              <p class="muted employees-recruitment-add__lead">${
                rows.length
                  ? "Add another employee — name and email is enough."
                  : "Add your first employee — name and email is enough to begin."
              }</p>
              <div class="employees-recruitment-form-slot" id="employees-recruitment-form-slot"></div>
            </div>`
          : "";
      const bulkInvite =
        stage.id === "active"
          ? `<div class="lifecycle-bulk-invite">
              <button type="button" class="btn outline" id="employees-hub-bulk-invite-btn">Invite all without portal accounts</button>
              <p class="muted" id="employees-hub-bulk-invite-status" aria-live="polite"></p>
            </div>`
          : "";
      const stageBody =
        stage.id === "recruitment"
          ? !rows.length
            ? recruitmentExtras
            : `${cards}${viewAll}${recruitmentExtras}`
          : `${cards}${viewAll}${bulkInvite}`;

      return `<section class="lifecycle-hub-section${isOpen ? " is-open" : ""}" data-lifecycle-section="${stage.id}">
        <button type="button" class="lifecycle-hub-section__header" data-lifecycle-toggle="${stage.id}" aria-expanded="${isOpen}">
          <span class="lifecycle-hub-section__icon">${icon(stage.icon)}</span>
          <span class="lifecycle-hub-section__title">${escapeHtml(stage.label)}</span>
          <span class="lifecycle-hub-section__badge">${rows.length}</span>
          <span class="lifecycle-hub-section__chevron" aria-hidden="true"></span>
        </button>
        <div class="lifecycle-hub-section__body"${isOpen ? "" : " hidden"}>
          ${stageBody}
        </div>
      </section>`;
    }).join("");

    if (lifecycleHubExpanded.recruitment) {
      relocateQuickAddForm($("employees-recruitment-form-slot"));
    } else {
      relocateQuickAddForm(document.querySelector(".employees-quick-add-panel"));
    }

    hub.querySelector("#employees-hub-retry-btn")?.addEventListener("click", () => {
      void initEmployeesSection();
    });

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

    hub.querySelector("#employees-stage-add-btn")?.addEventListener("click", () => focusRecruitmentAddForm());

    $("employees-hub-bulk-invite-btn")?.addEventListener("click", () => sendBulkPortalInvites("employees-hub-bulk-invite-status"));
    } catch (error) {
      console.error("Employee lifecycle hub render failed:", error);
      if (!isMobileEmployeesHub()) return;
      hub.hidden = false;
      hub.innerHTML = `<div class="overview-error"><p class="muted">Could not display employees.</p><button type="button" class="btn outline btn-sm" id="employees-hub-render-retry">Retry</button></div>`;
      hub.querySelector("#employees-hub-render-retry")?.addEventListener("click", () => {
        void refreshEmployeesTable();
      });
    }
  }

  function focusRecruitmentAddForm() {
    lifecycleHubExpanded.recruitment = true;
    lifecycleHubOpenStage = "recruitment";
    renderLifecycleHub(employeesCache);
    window.requestAnimationFrame(() => {
      $("employees-recruitment-form-slot")?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("employee-quick-add-form")?.querySelector("input")?.focus();
    });
  }

  function stageEmptyStateHtml(stageId) {
    const { emptyStateHtml } = window.Admin;
    if (stageId === "recruitment") {
      return "";
    }
    if (stageId === "onboarding") {
      return emptyStateHtml({
        icon: "clipboard",
        title: "No one onboarding",
        message: "When you hire someone, set their status to Onboarding and complete lifecycle steps here.",
        actionLabel: "Add employee",
        actionId: "employees-stage-add-btn",
        compact: true,
      });
    }
    if (stageId === "active") {
      return emptyStateHtml({
        icon: "users",
        title: "No active employees",
        message: "Complete onboarding or add staff who are already working.",
        actionLabel: "Add employee",
        actionId: "employees-stage-add-btn",
        compact: true,
      });
    }
    return emptyStateHtml({
      icon: "user-minus",
      title: "No leavers in progress",
      message: "Offboarding workflows appear here when someone is leaving.",
      actionLabel: "View offboarding",
      actionHref: "#offboarding",
      compact: true,
    });
  }

  let activeEmployeeId = null;
  let selectedEmployeeId = null;
  let sidePanelEmployeeId = null;
  let sidePanelWorkspace = null;
  let sidePanelExpandedSection = null;
  let sidePanelRenderRequest = 0;
  let employeesCache = [];
  let employeesRefreshGeneration = 0;
  let employeesRefreshInflight = null;

  function employeesFromFormOptions() {
    const options = window.Admin?.formOptions?.employees || [];
    return options.map((row) => ({
      id: row.id,
      first_name: row.first_name || String(row.label || "").split(",")[0]?.trim() || "Employee",
      last_name: row.last_name || "",
      job_title: row.job_title || "",
      department: row.department || "",
      status: row.status || "active",
      email: row.email || "",
      completion_pct: row.completion_pct ?? 0,
      next_section: row.next_section ?? null,
    }));
  }

  function applyEmployeesCache(items, meta = {}) {
    employeesCache = items;
    try {
      window.__SSHR_LAST_API = {
        ...(window.__SSHR_LAST_API || {}),
        path: "/admin/employees",
        count: items.length,
        tenantId: meta.tenantId || localStorage.getItem("tenantId"),
        at: Date.now(),
      };
    } catch {
      /* ignore */
    }
    renderEmployeeRegister();
  }
  let employeeRegisterFilter = null;
  let activeSection = "recruitment";
  let workspaceCache = null;
  let sectionLoaded = false;
  let openEmployeeRequest = 0;
  let pendingDocumentSigningUi = null;

  function $(id) {
    return document.getElementById(id);
  }

  function employeeApiError(res, data, fallback = "Request failed") {
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
    return fallback;
  }

  function duplicateEmployeeId(res, data) {
    if (res.status !== 409) return null;
    const detail = data?.detail;
    if (detail && typeof detail === "object" && detail.existing_employee_id) {
      return Number(detail.existing_employee_id);
    }
    return null;
  }

  async function focusExistingEmployee(employeeId) {
    if (!employeeId) return;
    selectedEmployeeId = employeeId;
    sidePanelExpandedSection = null;
    await refreshEmployeesTable();
    if (!isMobileEmployeesHub()) {
      document.getElementById("employees-side-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      await openEmployee(employeeId);
    }
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

  const HISTORY_FIELD_LABELS = {
    first_name: "First name",
    last_name: "Last name",
    email: "Work email",
    phone: "Telephone",
    home_address: "Home address",
    job_title: "Job title",
    salary: "Salary",
    work_location: "Work location",
    department: "Department",
    employment_type: "Employment type",
    contract_hours_weekly: "Contract hours (weekly)",
    start_date: "Start date",
    status: "Status",
    date_of_birth: "Date of birth",
    ni_number: "NI number",
    probation_end_date: "Probation end date",
    termination_date: "Termination date",
    termination_reason: "Termination reason",
    emergency_contact_name: "Emergency contact name",
    emergency_contact_phone: "Emergency contact phone",
    emergency_contact_relationship: "Emergency contact relationship",
    is_sponsored: "Sponsored worker",
  };

  function historyFieldLabel(field) {
    return HISTORY_FIELD_LABELS[field] || field.replace(/_/g, " ");
  }

  function formatHistoryValue(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }

  function renderHistoryChangeRows(changes) {
    if (!changes?.length) {
      return `<p class="muted employee-change-history__empty">No field changes recorded in this version.</p>`;
    }
    return `<ul class="employee-change-history__changes">
      ${changes
        .map(
          (change) => `
        <li>
          <strong>${escapeHtml(historyFieldLabel(change.field))}</strong>
          <span class="employee-change-history__from">${escapeHtml(formatHistoryValue(change.old))}</span>
          <span class="employee-change-history__arrow" aria-hidden="true">→</span>
          <span class="employee-change-history__to">${escapeHtml(formatHistoryValue(change.new))}</span>
        </li>`,
        )
        .join("")}
    </ul>`;
  }

  function hideEmployeeHistoryPanels() {
    $("employee-change-history-panel")?.setAttribute("hidden", "");
    $("employee-leave-history-panel")?.setAttribute("hidden", "");
  }

  function bindChangeHistoryPanel() {
    $("employee-change-history-close")?.addEventListener("click", () => {
      $("employee-change-history-panel")?.setAttribute("hidden", "");
    });
    $("employee-leave-history-close")?.addEventListener("click", () => {
      $("employee-leave-history-panel")?.setAttribute("hidden", "");
    });
  }

  function formatLeaveDate(iso) {
    if (!iso) return "—";
    return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function leaveStatusPill(status) {
    const tone =
      status === "approved" ? "ok" : status === "rejected" ? "danger" : status === "cancelled" ? "muted" : "warn";
    return `<span class="status-pill status-pill--${tone}">${escapeHtml(status)}</span>`;
  }

  function renderLeaveHistorySummary(balance) {
    const host = $("employee-leave-history-summary");
    if (!host) return;
    if (!balance) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML = `
      <p class="employee-leave-history-summary__label">Annual leave balance (${escapeHtml(String(balance.year))})</p>
      <p class="employee-leave-history-summary__value">
        <strong>${escapeHtml(String(balance.remaining_days))}</strong> working day(s) remaining
        <span class="muted">· allowance ${escapeHtml(String(balance.allowance_days))} · used ${escapeHtml(String(balance.used_days))} · pending ${escapeHtml(String(balance.pending_days))}</span>
      </p>`;
  }

  async function loadEmployeeLeaveHistory(employeeId) {
    const panel = $("employee-leave-history-panel");
    const list = $("employee-leave-history-list");
    if (!panel || !list || !employeeId) return;

    hideEmployeeHistoryPanels();
    panel.hidden = false;
    list.innerHTML = `<p class="muted">Loading leave history…</p>`;
    renderLeaveHistorySummary(null);

    try {
      const [requestsRes, balanceRes] = await Promise.all([
        apiFetch(`/admin/leave/requests?employee_id=${employeeId}`),
        apiFetch(`/admin/leave/employees/${employeeId}/balance`),
      ]);
      const data = await requestsRes.json();
      if (!requestsRes.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Could not load leave history");
      }
      if (balanceRes.ok) {
        renderLeaveHistorySummary(await balanceRes.json());
      }

      const items = data.items || [];
      if (!items.length) {
        list.innerHTML = `<p class="muted">No leave requests yet. When this employee submits holiday or absence requests in the portal, they appear here.</p>`;
        return;
      }

      list.innerHTML = items
        .map(
          (item) => `
        <article class="employee-change-history__item employee-leave-history__item">
          <header class="employee-change-history__meta">
            <strong>${escapeHtml(item.leave_type_label || item.leave_type)}</strong>
            ${leaveStatusPill(item.status)}
          </header>
          <p class="muted employee-leave-history__dates">
            ${escapeHtml(formatLeaveDate(item.start_date))} → ${escapeHtml(formatLeaveDate(item.end_date))}
            · ${escapeHtml(String(item.days_requested))} working day(s)
          </p>
          ${item.reason ? `<p class="employee-leave-history__reason">${escapeHtml(item.reason)}</p>` : ""}
          <p class="muted employee-change-history__actor">
            Submitted ${escapeHtml(formatNoteWhen(item.created_at))}
            ${item.reviewed_by ? ` · Reviewed by ${escapeHtml(item.reviewed_by)}${item.reviewed_at ? ` (${escapeHtml(formatNoteWhen(item.reviewed_at))})` : ""}` : ""}
          </p>
          ${item.review_note ? `<p class="muted employee-leave-history__review-note">Review note: ${escapeHtml(item.review_note)}</p>` : ""}
        </article>`,
        )
        .join("");
    } catch (error) {
      list.innerHTML = `<p class="form-error-message">${escapeHtml(error.message || "Could not load leave history")}</p>`;
    }
  }

  async function loadEmployeeChangeHistory(employeeId) {
    const panel = $("employee-change-history-panel");
    const list = $("employee-change-history-list");
    if (!panel || !list || !employeeId) return;

    hideEmployeeHistoryPanels();
    panel.hidden = false;
    list.innerHTML = `<p class="muted">Loading history…</p>`;

    try {
      const res = await apiFetch(`/admin/employees/${employeeId}/history`);
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not load history");

      const versions = data.versions || [];
      if (!versions.length) {
        list.innerHTML = `<p class="muted">No changes recorded yet. Updates to address, telephone, job details, and other profile fields will appear here.</p>`;
        return;
      }

      list.innerHTML = versions
        .map(
          (version) => `
        <article class="employee-change-history__item">
          <header class="employee-change-history__meta">
            <strong>Version ${version.version_no}</strong>
            <span class="muted">${escapeHtml(formatNoteWhen(version.effective_from || version.created_at))}</span>
          </header>
          <p class="muted employee-change-history__actor">Updated by ${escapeHtml(version.changed_by || "HR")} (${escapeHtml(version.changed_by_role || "hr")})</p>
          ${renderHistoryChangeRows(version.changed_fields)}
        </article>`,
        )
        .join("");
    } catch (error) {
      list.innerHTML = `<p class="form-error-message">${escapeHtml(error.message || "Could not load history")}</p>`;
    }
  }

  function renderAdvancedLinks(employee) {
    const host = $("employee-advanced-link-row");
    if (!host) return;
    const sponsored = Boolean(employee?.is_sponsored);
    const employeeId = employee?.id || activeEmployeeId;
    host.innerHTML = `
      <button type="button" class="btn ghost" id="employee-change-history-btn">Change history</button>
      <button type="button" class="btn ghost" id="employee-leave-history-btn">Leave history</button>
      ${sponsored ? '<a href="#compliance" class="btn ghost">Sponsor compliance</a>' : ""}
      <a href="#grievance" class="btn ghost">Grievance cases</a>
      <a href="${employeeId ? `#employment-contracts/start/${employeeId}` : "#employment-contracts"}" class="btn ghost">Employment contract</a>
      <a href="${employeeId ? `#offboarding/start/${employeeId}` : "#offboarding"}" class="btn ghost">Off-boarding workflow</a>
      <a href="#time-punch" class="btn ghost">Time punch</a>`;
    host.querySelector("#employee-change-history-btn")?.addEventListener("click", () => {
      if (employeeId) void loadEmployeeChangeHistory(employeeId);
    });
    host.querySelector("#employee-leave-history-btn")?.addEventListener("click", () => {
      if (employeeId) void loadEmployeeLeaveHistory(employeeId);
    });
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
      employeesToast(error.message || "Could not generate PIN", "error");
    }
  }

  async function saveSidePanelSection(employeeId, sectionKey, updates) {
    const res = await apiFetch(`/admin/employees/${employeeId}/sections/${sectionKey}`, {
      method: "PATCH",
      body: JSON.stringify(normalizePayload(sectionKey, updates)),
    });
    const data = await res.json();
    if (!res.ok) {
      const existingId = duplicateEmployeeId(res, data);
      if (existingId) {
        await focusExistingEmployee(existingId);
      }
      throw new Error(employeeApiError(res, data, "Save failed"));
    }
    sidePanelWorkspace = data;
    const idx = employeesCache.findIndex((item) => item.id === employeeId);
    if (idx >= 0) {
      employeesCache[idx] = { ...employeesCache[idx], ...data.employee, completion_pct: data.completion_pct, next_section: data.next_section };
    }
    return data;
  }

  function splitEmployeeDocuments(docs) {
    const businessOnly = [];
    const shared = [];
    (docs || []).forEach((doc) => {
      if (doc.employee_visible) shared.push(doc);
      else businessOnly.push(doc);
    });
    return { businessOnly, shared };
  }

  function renderEmployeeRecordDocItem(doc) {
    const meta = [
      categoryLabel(doc.category),
      (doc.created_at || "").slice(0, 10) || null,
      doc.signing_status === "signed" ? "Signed" : doc.signing_status === "sent" ? "Awaiting signature" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const actions = [];
    if (doc.has_file) {
      actions.push(`<button type="button" class="btn ghost btn-sm" data-record-download-doc="${doc.id}">Download</button>`);
    } else if (doc.document_url) {
      actions.push(`<a class="btn ghost btn-sm" href="${escapeHtml(doc.document_url)}" target="_blank" rel="noopener">Open</a>`);
    }
    actions.push(`<button type="button" class="btn ghost btn-sm" data-record-delete-doc="${doc.id}">Remove</button>`);
    return `<li class="employee-record-doc-item">
      <span class="employee-record-doc-item__title">${escapeHtml(doc.title)}</span>
      <span class="employee-record-doc-item__meta muted">${escapeHtml(meta || "—")}</span>
      <div class="employee-record-doc-item__actions">${actions.join("")}</div>
    </li>`;
  }

  function renderEmployeeRecordDocumentLists(workspace) {
    const { businessOnly, shared } = splitEmployeeDocuments(workspace.documents || []);
    const businessCount = document.getElementById("employees-side-doc-business-count");
    const sharedCount = document.getElementById("employees-side-doc-shared-count");
    const businessList = document.getElementById("employees-side-doc-business-list");
    const sharedList = document.getElementById("employees-side-doc-shared-list");
    if (businessCount) businessCount.textContent = String(businessOnly.length);
    if (sharedCount) sharedCount.textContent = String(shared.length);
    if (businessList) {
      businessList.innerHTML = businessOnly.length
        ? businessOnly.map(renderEmployeeRecordDocItem).join("")
        : `<li><p class="employee-record-doc-empty muted">No HR-only documents yet.</p></li>`;
    }
    if (sharedList) {
      sharedList.innerHTML = shared.length
        ? shared.map(renderEmployeeRecordDocItem).join("")
        : `<li><p class="employee-record-doc-empty muted">Nothing shared with the employee portal yet.</p></li>`;
    }
    bindEmployeeRecordDocumentActions(document.getElementById("employees-side-documents"), workspace);
  }

  function bindEmployeeRecordDocumentActions(container, workspace) {
    if (!container || !workspace?.employee?.id) return;
    const employeeId = workspace.employee.id;
    const docs = workspace.documents || [];
    const statusEl = container.querySelector("#employees-side-doc-status");

    container.querySelectorAll("[data-record-delete-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Remove this document?")) return;
        if (statusEl) statusEl.textContent = "Removing…";
        try {
          const res = await apiFetch(`/admin/employees/${employeeId}/documents/${btn.dataset.recordDeleteDoc}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Remove failed");
          }
          await refreshEmployeeRecordDocuments(employeeId);
          if (statusEl) statusEl.textContent = "Document removed.";
        } catch (error) {
          if (statusEl) statusEl.textContent = error.message || "Remove failed";
        }
      });
    });

    container.querySelectorAll("[data-record-download-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = docs.find((item) => String(item.id) === btn.dataset.recordDownloadDoc);
        const name = row?.original_filename || `${row?.title || "document"}.bin`;
        try {
          await downloadAuthenticated(
            `/admin/employees/${employeeId}/documents/${btn.dataset.recordDownloadDoc}/file`,
            name,
          );
        } catch (error) {
          employeesToast(error.message || "Download failed", "error");
        }
      });
    });
  }

  async function refreshEmployeeRecordDocuments(employeeId) {
    const host = document.getElementById("employees-side-documents");
    if (!host || !employeeId) return;
    const res = await apiFetch(`/admin/employees/${employeeId}/workspace`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not refresh documents");
    sidePanelWorkspace = data;
    renderEmployeeRecordDocumentLists(data);
    updateSidePanelProgress(data);
    const idx = employeesCache.findIndex((item) => item.id === employeeId);
    if (idx >= 0) {
      employeesCache[idx] = {
        ...employeesCache[idx],
        ...data.employee,
        completion_pct: data.completion_pct,
        next_section: data.next_section,
      };
      refreshEmployeesTableRowFromCache(employeeId);
    }
  }

  function mountEmployeeRecordDocumentUpload(employeeId) {
    const form = document.getElementById("employees-side-doc-upload");
    const categorySelect = document.getElementById("employees-side-doc-category");
    const payPeriodField = document.getElementById("employees-side-doc-pay-period-field");
    const payPeriodInput = document.getElementById("employees-side-doc-pay-period");
    const shareCheckbox = document.getElementById("employees-side-doc-share");
    const fileInput = document.getElementById("employees-side-doc-file");
    const hint = document.getElementById("employees-side-doc-upload-hint");
    const statusEl = document.getElementById("employees-side-doc-status");
    if (!form || form.dataset.bound || !employeeId) return;
    form.dataset.bound = "1";

    const uploadPolicy = documentUploadPolicy();
    if (fileInput) fileInput.accept = uploadPolicy.accept || DEFAULT_DOCUMENT_UPLOAD.accept;
    if (hint) hint.textContent = uploadPolicy.hint || DEFAULT_DOCUMENT_UPLOAD.hint;

    if (categorySelect) {
      const categories = window.Admin.formOptions?.employee_document_categories || [];
      categorySelect.innerHTML = categories
        .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
        .join("");
      const syncCategory = () => {
        const isPayslip = categorySelect.value === "payslip";
        if (payPeriodField) payPeriodField.hidden = !isPayslip;
        if (payPeriodInput) payPeriodInput.required = isPayslip;
        if (shareCheckbox && isPayslip) shareCheckbox.checked = true;
      };
      categorySelect.addEventListener("change", syncCategory);
      syncCategory();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (categorySelect?.value === "payslip" && !payPeriodInput?.value.trim()) {
        if (statusEl) statusEl.textContent = "Pay period is required for payslips.";
        return;
      }
      const uploadFile = fileInput?.files?.[0];
      const fileError = validateDocumentUploadFile(uploadFile);
      if (fileError) {
        if (statusEl) statusEl.textContent = fileError;
        return;
      }

      const fd = new FormData(form);
      fd.set("employee_visible", shareCheckbox?.checked ? "true" : "false");
      fd.set("notify_employee", shareCheckbox?.checked ? "true" : "false");
      fd.set("send_email", "false");
      if (categorySelect?.value !== "payslip") fd.delete("pay_period");

      if (statusEl) statusEl.textContent = "Uploading…";
      try {
        const res = await fetch(`${API_BASE}/admin/employees/${employeeId}/documents/upload`, {
          method: "POST",
          headers: authHeaders(false),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Upload failed");
        form.reset();
        if (categorySelect) categorySelect.dispatchEvent(new Event("change"));
        await refreshEmployeeRecordDocuments(employeeId);
        if (statusEl) statusEl.textContent = "Document uploaded.";
      } catch (error) {
        if (statusEl) statusEl.textContent = error.message || "Upload failed";
      }
    });
  }

  function renderEmployeeRecordSectionsHtml(employee, workspace) {
    const emp = workspace.employee || employee || {};
    const { businessOnly, shared } = splitEmployeeDocuments(workspace.documents || []);
    const requirements = workspace.document_requirements || {};
    const reqSummary = requirements.complete
      ? `<p class="employee-doc-status employee-doc-status--ok">Required documents complete.</p>`
      : requirements.missing_required
        ? `<p class="employee-doc-status employee-doc-status--warn">${requirements.missing_required} required document(s) still missing.</p>`
        : "";

    return `<div class="employee-record-sections" id="employees-side-sections">
      <section class="employee-record-block" aria-labelledby="employees-side-personal-title">
        <div class="employee-record-block__head">
          <h4 id="employees-side-personal-title">Personal details</h4>
        </div>
        <div class="employee-record-grid">
          <label class="employee-record-field">
            <span class="employee-record-field__label">Mobile phone</span>
            <input type="tel" id="employees-side-phone" value="${escapeHtml(emp.phone || "")}" placeholder="Not set" autocomplete="tel" />
          </label>
          <label class="employee-record-field">
            <span class="employee-record-field__label">Date of birth</span>
            <input type="date" id="employees-side-dob" value="${escapeHtml((emp.date_of_birth || "").slice(0, 10))}" />
          </label>
          <label class="employee-record-field">
            <span class="employee-record-field__label">NI number</span>
            <input type="text" id="employees-side-ni" value="${escapeHtml(emp.ni_number || "")}" placeholder="Not set" />
          </label>
          <label class="employee-record-field employee-record-field--full">
            <span class="employee-record-field__label">Home address</span>
            <textarea id="employees-side-address" rows="2" placeholder="Not set">${escapeHtml(emp.home_address || "")}</textarea>
          </label>
        </div>
      </section>

      <section class="employee-record-block" aria-labelledby="employees-side-emergency-title">
        <div class="employee-record-block__head">
          <h4 id="employees-side-emergency-title">Emergency contact</h4>
        </div>
        <div class="employee-record-grid">
          <label class="employee-record-field employee-record-field--full">
            <span class="employee-record-field__label">Contact name</span>
            <input type="text" id="employees-side-emergency-name" value="${escapeHtml(emp.emergency_contact_name || "")}" placeholder="Not set" />
          </label>
          <label class="employee-record-field">
            <span class="employee-record-field__label">Phone</span>
            <input type="tel" id="employees-side-emergency-phone" value="${escapeHtml(emp.emergency_contact_phone || "")}" placeholder="Not set" />
          </label>
          <label class="employee-record-field">
            <span class="employee-record-field__label">Relationship</span>
            <input type="text" id="employees-side-emergency-relationship" value="${escapeHtml(emp.emergency_contact_relationship || "")}" placeholder="Not set" />
          </label>
        </div>
      </section>

      <section class="employee-record-block" id="employees-side-documents" aria-labelledby="employees-side-documents-title">
        <div class="employee-record-block__head">
          <h4 id="employees-side-documents-title">Documents</h4>
          <span class="employee-record-block__count muted">${businessOnly.length + shared.length} on file</span>
        </div>
        ${reqSummary}
        <div class="employee-record-doc-group">
          <h5 class="employee-record-doc-group__title">Business only <span class="muted">(HR only)</span> <span class="employee-record-block__count" id="employees-side-doc-business-count">${businessOnly.length}</span></h5>
          <ul class="employee-record-doc-list" id="employees-side-doc-business-list">${
            businessOnly.length
              ? businessOnly.map(renderEmployeeRecordDocItem).join("")
              : `<li><p class="employee-record-doc-empty muted">No HR-only documents yet.</p></li>`
          }</ul>
        </div>
        <div class="employee-record-doc-group">
          <h5 class="employee-record-doc-group__title">Employee portal <span class="employee-record-block__count" id="employees-side-doc-shared-count">${shared.length}</span></h5>
          <ul class="employee-record-doc-list" id="employees-side-doc-shared-list">${
            shared.length
              ? shared.map(renderEmployeeRecordDocItem).join("")
              : `<li><p class="employee-record-doc-empty muted">Nothing shared with the employee portal yet.</p></li>`
          }</ul>
        </div>
        <details class="employee-record-doc-upload">
          <summary>Upload document</summary>
          <form id="employees-side-doc-upload" class="employee-record-upload-form" enctype="multipart/form-data">
            <label class="employee-record-field employee-record-field--full">
              <span class="employee-record-field__label">Title</span>
              <input type="text" name="title" required placeholder="e.g. Signed contract" />
            </label>
            <label class="employee-record-field employee-record-field--full">
              <span class="employee-record-field__label">File</span>
              <input type="file" name="file" id="employees-side-doc-file" required />
              <span class="muted edit-hint" id="employees-side-doc-upload-hint">${escapeHtml(DEFAULT_DOCUMENT_UPLOAD.hint)}</span>
            </label>
            <label class="employee-record-field">
              <span class="employee-record-field__label">Category</span>
              <select name="category" id="employees-side-doc-category"></select>
            </label>
            <label class="employee-record-field" id="employees-side-doc-pay-period-field" hidden>
              <span class="employee-record-field__label">Pay period</span>
              <input type="text" name="pay_period" id="employees-side-doc-pay-period" placeholder="e.g. 2026-04" />
            </label>
            <label class="ss-check-row employee-record-field--full">
              <input class="ss-check-row__input" type="checkbox" id="employees-side-doc-share" name="employee_visible" value="true" />
              <span class="ss-check-row__box" aria-hidden="true"></span>
              <span class="ss-check-row__content">
                <span class="ss-check-row__title">Employee portal</span>
                <span class="ss-check-row__hint muted">HR confidential if unchecked — contracts, RTW, disciplinary records, etc.</span>
              </span>
            </label>
            <div class="edit-form-actions">
              <button type="submit" class="btn outline btn-sm">Upload</button>
            </div>
          </form>
        </details>
        <p class="muted employee-record-field-status" id="employees-side-doc-status" aria-live="polite"></p>
        <p class="employee-record-lifecycle-link">
          <button type="button" class="employee-record-link" id="employees-side-doc-manage-btn">Signing &amp; full document store →</button>
        </p>
      </section>
    </div>`;
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

    const saveInduction = (updates) => saveField("induction", updates);

    document.getElementById("employees-side-job-title")?.addEventListener("change", (event) => {
      void saveField("onboarding", { job_title: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-department")?.addEventListener("change", (event) => {
      void saveField("onboarding", { department: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-email")?.addEventListener("change", (event) => {
      void saveField("recruitment", { email: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-phone")?.addEventListener("change", (event) => {
      void saveInduction({ phone: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-dob")?.addEventListener("change", (event) => {
      void saveInduction({ date_of_birth: event.target.value || null });
    });
    document.getElementById("employees-side-ni")?.addEventListener("change", (event) => {
      void saveInduction({ ni_number: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-address")?.addEventListener("change", (event) => {
      void saveInduction({ home_address: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-emergency-name")?.addEventListener("change", (event) => {
      void saveInduction({ emergency_contact_name: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-emergency-phone")?.addEventListener("change", (event) => {
      void saveInduction({ emergency_contact_phone: event.target.value.trim() || null });
    });
    document.getElementById("employees-side-emergency-relationship")?.addEventListener("change", (event) => {
      void saveInduction({ emergency_contact_relationship: event.target.value.trim() || null });
    });

    bindEmployeeRecordDocumentActions(document.getElementById("employees-side-documents"), workspace);
    mountEmployeeRecordDocumentUpload(employeeId);
    document.getElementById("employees-side-doc-manage-btn")?.addEventListener("click", () => {
      void openEmployee(employeeId, "document_store");
    });
    document.getElementById("employees-side-lifecycle-btn")?.addEventListener("click", () => {
      void openEmployee(employeeId, workspace.next_section || "recruitment");
    });
  }

  function updateSidePanelProgress(workspace) {
    const meta = sectionProgressMeta(workspace);
    const fill = document.getElementById("employees-side-progress-fill");
    const copy = document.getElementById("employees-side-progress-copy");
    if (fill) fill.style.width = `${Math.min(100, meta.pct)}%`;
    if (copy) copy.textContent = `${meta.completed} of ${meta.total} sections done`;
  }

  function openEmployeeSectionFromPanel(employeeId, sectionKey) {
    void openEmployee(employeeId, sectionKey);
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
    target.cells[3].innerHTML = renderPortalStatusCell(row);
    target.cells[4].innerHTML = renderRegisterProgressCell(row);
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

  function readEmployeeUploadPreferences(form) {
    if (!form) return null;
    return {
      category: form.querySelector("#employee-document-upload-category")?.value || "",
      pay_period: form.querySelector("#employee-document-upload-pay-period")?.value || "",
      expires_at: form.querySelector('[name="expires_at"]')?.value || "",
      notify_employee: form.querySelector("#employee-document-upload-notify")?.checked ?? true,
      send_email: form.querySelector("#employee-document-upload-email")?.checked ?? true,
    };
  }

  function applyEmployeeUploadPreferences(form, prefs) {
    if (!form || !prefs) return;
    const category = form.querySelector("#employee-document-upload-category");
    const payPeriod = form.querySelector("#employee-document-upload-pay-period");
    const payPeriodField = form.querySelector("#employee-document-upload-pay-period-field");
    const expiresAt = form.querySelector('[name="expires_at"]');
    const notify = form.querySelector("#employee-document-upload-notify");
    const sendEmail = form.querySelector("#employee-document-upload-email");
    if (category && prefs.category) category.value = prefs.category;
    if (payPeriod) payPeriod.value = prefs.pay_period || "";
    if (expiresAt) expiresAt.value = prefs.expires_at || "";
    if (notify) notify.checked = prefs.notify_employee;
    if (sendEmail) sendEmail.checked = prefs.send_email;
    const isPayslip = category?.value === "payslip";
    if (payPeriodField) payPeriodField.hidden = !isPayslip;
    if (payPeriod) payPeriod.required = isPayslip;
  }

  function resetEmployeeUploadFormKeepingPreferences(form) {
    if (!form) return;
    const prefs = readEmployeeUploadPreferences(form);
    form.reset();
    applyEmployeeUploadPreferences(form, prefs);
    const title = form.querySelector('[name="title"]');
    if (title) title.value = "";
    const fileInput = form.querySelector("#employee-document-upload-file");
    if (fileInput) fileInput.value = "";
  }

  function renderEmployeeDocumentActions(row) {
    const canSign =
      row.has_file &&
      row.category !== "payslip" &&
      row.signing_status !== "signed";
    const parts = [];
    if (row.has_file) {
      parts.push(`<button type="button" class="btn ghost btn-sm" data-download-doc="${row.id}">Download</button>`);
    }
    if (canSign) {
      parts.push(`<button type="button" class="btn ghost btn-sm" data-send-sign-doc="${row.id}">E-sign</button>`);
    }
    if (row.document_url) {
      parts.push(
        `<a class="btn ghost btn-sm" href="${escapeHtml(row.document_url)}" target="_blank" rel="noopener">Open</a>`,
      );
    }
    parts.push(`<button type="button" class="btn ghost btn-sm" data-delete-doc="${row.id}">Remove</button>`);
    return `<div class="table-actions">${parts.join("")}</div>`;
  }

  async function refreshEmployeeDocumentStoreList(container) {
    if (!container || !activeEmployeeId) return;
    const res = await apiFetch(`/admin/employees/${activeEmployeeId}/workspace`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not refresh documents");
    workspaceCache = data;
    const intro = container.querySelector(".employee-section-intro");
    if (intro) {
      const section = (data.sections || []).find((item) => item.key === "document_store");
      intro.innerHTML = `
        <h4>${escapeHtml(section?.label || "Document store")}</h4>
        <p class="muted">${escapeHtml(section?.description || "")}</p>
        ${renderRequirementsChecklist(data.document_requirements || {})}`;
    }
    const tbody = container.querySelector("#employee-documents-body");
    if (!tbody) return;
    renderTableBody(tbody, {
      emptyMessage: "No documents recorded yet.",
      columns: [
        { key: "title", render: (row) => `<strong>${escapeHtml(row.title)}</strong>` },
        { key: "category", render: (row) => escapeHtml(categoryLabel(row.category)) },
        { key: "expires_at", render: (row) => escapeHtml((row.expires_at || "").slice(0, 10) || "Not set") },
        { key: "created_at", render: (row) => escapeHtml((row.created_at || "").slice(0, 10) || "Not set") },
        {
          key: "signing_status",
          render: (row) => {
            if (row.signing_status === "signed") return '<span class="badge">Signed</span>';
            if (row.signing_status === "sent") return '<span class="badge pill">Awaiting signature</span>';
            return "";
          },
        },
        {
          key: "actions",
          render: (row) => renderEmployeeDocumentActions(row),
        },
      ],
      rows: data.documents || [],
    });
    bindEmployeeDocumentTableActions(container, data.documents || []);
  }

  function bindEmployeeDocumentTableActions(container, docs) {
    container.querySelectorAll("[data-delete-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Remove this document record?")) return;
        const actionStatus = container.querySelector("#employee-document-action-status");
        const run = window.ShiftSwiftAction?.runButtonAction;
        const performDelete = async () => {
          const res = await apiFetch(`/admin/employees/${activeEmployeeId}/documents/${btn.dataset.deleteDoc}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Delete failed");
          }
          await refreshEmployeeDocumentStoreList(container);
          return "Removed.";
        };
        if (run) {
          await run(btn, actionStatus, {
            loadingLabel: "Removing…",
            successMessage: "Removed.",
            errorMessage: "Remove failed.",
            successLabel: "Removed",
            onAction: performDelete,
          });
        } else {
          try {
            if (actionStatus) actionStatus.textContent = "Removing…";
            const message = await performDelete();
            if (actionStatus) actionStatus.textContent = message;
          } catch (error) {
            window.ShiftSwiftAction?.showActionToast?.(error.message || "Delete failed", "error");
          }
        }
      });
    });

    container.querySelectorAll("[data-download-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const actionStatus = container.querySelector("#employee-document-action-status");
        const row = docs.find((item) => String(item.id) === btn.dataset.downloadDoc);
        const name = row?.original_filename || `${row?.title || "document"}.bin`;
        const run = window.ShiftSwiftAction?.runButtonAction;
        const performDownload = async () => {
          await downloadAuthenticated(
            `/admin/employees/${activeEmployeeId}/documents/${btn.dataset.downloadDoc}/file`,
            name,
          );
          return "Download started.";
        };
        if (run) {
          await run(btn, actionStatus, {
            loadingLabel: "Downloading…",
            successMessage: "Download started.",
            errorMessage: "Download failed.",
            successLabel: "Done",
            clearStatusAfterMs: 3000,
            onAction: performDownload,
          });
        } else {
          try {
            await performDownload();
          } catch (error) {
            window.ShiftSwiftAction?.showActionToast?.(error.message || "Download failed", "error");
          }
        }
      });
    });

    container.querySelectorAll("[data-send-sign-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const signingStatus = container.querySelector("#employee-document-signing-status");
        const run = window.ShiftSwiftAction?.runButtonAction;
        const performSend = async () => {
          const res = await apiFetch(
            `/admin/employees/${activeEmployeeId}/documents/${btn.dataset.sendSignDoc}/send-for-signature`,
            {
              method: "POST",
              body: JSON.stringify({ frontend_base: window.location.origin }),
            },
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "Send failed");
          const linkBox = container.querySelector("#employee-document-signing-link");
          if (linkBox && data.signing_url) {
            linkBox.hidden = false;
            linkBox.innerHTML = `<p><strong>Signing link</strong> (also emailed to employee):</p>
              <input type="text" readonly value="${escapeHtml(data.signing_url)}" style="width:100%;" onclick="this.select()" />`;
          }
          await refreshEmployeeDocumentStoreList(container);
          return `Sent for signature · ${data.reference_code}`;
        };
        if (run) {
          await run(btn, signingStatus, {
            loadingLabel: "Sending…",
            successMessage: "Sent for signature.",
            errorMessage: "Send failed.",
            successLabel: "Sent",
            onAction: performSend,
          });
        } else {
          if (signingStatus) signingStatus.textContent = "Sending signing link…";
          try {
            const message = await performSend();
            if (signingStatus) signingStatus.textContent = message;
          } catch (error) {
            if (signingStatus) signingStatus.textContent = error.message || "Send failed";
          }
        }
      });
    });
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
        <label class="edit-field"><span class="edit-label">Upload title</span><input name="title" required placeholder="e.g. April 2026 payslip" /></label>
        <label class="edit-field"><span class="edit-label">File</span><input name="file" type="file" id="employee-document-upload-file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required /><span class="muted edit-hint" id="employee-document-upload-hint">PDF, JPEG or PNG · max 10 MB per file</span></label>
        <label class="edit-field"><span class="edit-label">Category</span><select name="category" id="employee-document-upload-category"></select></label>
        <label class="edit-field" id="employee-document-upload-pay-period-field" hidden><span class="edit-label">Pay period</span><input name="pay_period" id="employee-document-upload-pay-period" type="text" placeholder="e.g. 2026-04 or April 2026" /></label>
        <label class="edit-field"><span class="edit-label">Expiry date</span><input name="expires_at" type="date" /><span class="muted edit-hint">Set for food hygiene, first aid, and other renewable certificates.</span></label>
        <label class="ss-check-row" data-span="2">
          <input class="ss-check-row__input" type="checkbox" name="notify_employee" id="employee-document-upload-notify" value="true" checked />
          <span class="ss-check-row__box" aria-hidden="true"></span>
          <span class="ss-check-row__content">
            <span class="ss-check-row__title">Portal alert</span>
            <span class="ss-check-row__hint muted">In-app alert in the employee portal. Email is optional below.</span>
          </span>
        </label>
        <label class="ss-check-row" data-span="2">
          <input class="ss-check-row__input" type="checkbox" name="send_email" id="employee-document-upload-email" value="true" checked />
          <span class="ss-check-row__box" aria-hidden="true"></span>
          <span class="ss-check-row__content">
            <span class="ss-check-row__title">Email copy</span>
            <span class="ss-check-row__hint muted">Sends an email with a secure link to the document.</span>
          </span>
        </label>
        <div class="edit-form-actions" data-span="2"><button class="btn secondary" type="submit">Upload file</button><p class="edit-form-status muted" data-upload-status></p></div>
      </form>
      <div id="employee-document-signing-link" class="signing-link-box" hidden></div>
      <p class="edit-form-status muted" id="employee-document-action-status" aria-live="polite"></p>
      <p class="edit-form-status muted" id="employee-document-signing-status" aria-live="polite"></p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Title</th><th>Category</th><th>Expires</th><th>Added</th><th>Signature</th><th>Actions</th></tr></thead>
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
        await refreshEmployeeDocumentStoreList(container);
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
          key: "signing_status",
          render: (row) => {
            if (row.signing_status === "signed") return '<span class="badge">Signed</span>';
            if (row.signing_status === "sent") return '<span class="badge pill">Awaiting signature</span>';
            return "";
          },
        },
        {
          key: "actions",
          render: (row) => renderEmployeeDocumentActions(row),
        },
      ],
      rows: docs,
    });

    bindEmployeeDocumentTableActions(container, docs);

    const uploadForm = container.querySelector("#employee-document-upload-form");
    const uploadCategory = container.querySelector("#employee-document-upload-category");
    const payPeriodField = container.querySelector("#employee-document-upload-pay-period-field");
    const payPeriodInput = container.querySelector("#employee-document-upload-pay-period");
    const uploadFileInput = container.querySelector("#employee-document-upload-file");
    const uploadHint = container.querySelector("#employee-document-upload-hint");
    const uploadPolicy = documentUploadPolicy();
    if (uploadFileInput) uploadFileInput.accept = uploadPolicy.accept || DEFAULT_DOCUMENT_UPLOAD.accept;
    if (uploadHint) uploadHint.textContent = uploadPolicy.hint || DEFAULT_DOCUMENT_UPLOAD.hint;
    if (uploadCategory) {
      const categories = window.Admin.formOptions?.employee_document_categories || [];
      uploadCategory.innerHTML = categories
        .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
        .join("");
      if (categories.some((item) => item.value === "payslip")) {
        uploadCategory.value = "payslip";
      }
      if (!uploadCategory.dataset.ready) {
        const syncPayPeriod = () => {
          const isPayslip = uploadCategory.value === "payslip";
          if (payPeriodField) payPeriodField.hidden = !isPayslip;
          if (payPeriodInput) payPeriodInput.required = isPayslip;
        };
        uploadCategory.addEventListener("change", syncPayPeriod);
        syncPayPeriod();
        uploadCategory.dataset.ready = "true";
      }
    }
    uploadForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = uploadForm.querySelector("[data-upload-status]");
      if (uploadCategory?.value === "payslip" && !payPeriodInput?.value.trim()) {
        if (window.ShiftSwiftAction?.setActionStatus) {
          window.ShiftSwiftAction.setActionStatus(status, "Pay period is required for payslips.", "error");
        } else if (status) {
          status.textContent = "Pay period is required for payslips.";
        }
        return;
      }
      const uploadFile = uploadForm.querySelector('input[name="file"]')?.files?.[0];
      const fileError = validateDocumentUploadFile(uploadFile);
      if (fileError) {
        if (window.ShiftSwiftAction?.setActionStatus) {
          window.ShiftSwiftAction.setActionStatus(status, fileError, "error");
        } else if (status) {
          status.textContent = fileError;
        }
        return;
      }

      const performUpload = async () => {
        const fd = new FormData(uploadForm);
        const notify = uploadForm.querySelector("#employee-document-upload-notify")?.checked ?? true;
        const sendEmail = uploadForm.querySelector("#employee-document-upload-email")?.checked ?? true;
        fd.set("notify_employee", notify ? "true" : "false");
        fd.set("send_email", sendEmail ? "true" : "false");
        if (uploadCategory?.value !== "payslip") fd.delete("pay_period");
        const res = await fetch(`${API_BASE}/admin/employees/${activeEmployeeId}/documents/upload`, {
          method: "POST",
          headers: authHeaders(false),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Upload failed");
        resetEmployeeUploadFormKeepingPreferences(uploadForm);
        const notified = data?.notifications?.notified_count;
        await refreshEmployeeDocumentStoreList(container);
        return notified != null ? "Uploaded. Staff alerted." : "Uploaded.";
      };

      const run = window.ShiftSwiftAction?.runFormSubmit;
      if (run) {
        await run(uploadForm, status, {
          loadingLabel: "Uploading…",
          successMessage: "Uploaded.",
          errorMessage: "Upload failed.",
          successLabel: "Uploaded",
          onAction: performUpload,
        });
        return;
      }

      if (status) status.textContent = "Uploading…";
      try {
        const message = await performUpload();
        if (status) status.textContent = message;
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    });

    if (pendingDocumentSigningUi) {
      const { signing_url: signingUrl, reference_code: referenceCode } = pendingDocumentSigningUi;
      const linkBox = container.querySelector("#employee-document-signing-link");
      const signingStatus = container.querySelector("#employee-document-signing-status");
      if (linkBox && signingUrl) {
        linkBox.hidden = false;
        linkBox.innerHTML = `<p><strong>Signing link</strong> (also emailed to employee):</p>
          <input type="text" readonly value="${escapeHtml(signingUrl)}" style="width:100%;" onclick="this.select()" />`;
      }
      if (signingStatus) {
        const message = `Sent for signature · ${referenceCode}`;
        if (window.ShiftSwiftAction?.setActionStatus) {
          window.ShiftSwiftAction.setActionStatus(signingStatus, message, "ok");
        } else {
          signingStatus.textContent = message;
        }
      }
      pendingDocumentSigningUi = null;
    }
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
    return visibility === "employee_visible" ? "Employee portal" : "HR confidential";
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
            <option value="hr_internal">HR confidential (encrypted)</option>
            <option value="employee_visible">Employee portal</option>
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
            const row = employeesCache.find((item) => item.id === (sidePanelWorkspace || workspace).employee?.id);
            if (row) void renderEmployeeSidePanel(row);
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
          const row = employeesCache.find((item) => item.id === employeeId);
          if (row) void renderEmployeeSidePanel(row);
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
    hideEmployeeHistoryPanels();
    showDetailView();
    const accordion = lifecycleAccordionHost();
    if (accordion) accordion.innerHTML = `<p class="muted lifecycle-accordion-content">Loading employee lifecycle…</p>`;

    const res = await apiFetch(`/admin/employees/${employeeId}/workspace`);
    if (requestId !== openEmployeeRequest) return;
    const data = await res.json();
    if (!res.ok) {
      employeesToast(data.detail || "Could not load employee", "error");
      showListView();
      return;
    }

    activeSection = section || data.next_section || "recruitment";
    renderWorkspace(data);
  }

  async function refreshEmployeesTable(options = {}) {
    const force = Boolean(options.force);
    if (!force && employeesRefreshInflight) {
      return employeesRefreshInflight;
    }
    const requestId = ++employeesRefreshGeneration;
    const tbody = $("employees-table-body");
    const mobileCards = $("employees-mobile-cards");

    const run = async () => {
      try {
        const tenantId = window.ShiftSwiftSession?.readTokenTenantId?.() || localStorage.getItem("tenantId");
        const items = await fetchEmployeesList({ force: Boolean(options.force) });
        if (requestId !== employeesRefreshGeneration) return;
        applyEmployeesCache(items, { tenantId, status: 200 });

        const overview = getAdminOverviewCache?.();
        const activeCount = Number(overview?.modules?.employees?.active ?? 0);
        if (!items.length && activeCount > 0) {
          const hub = $("employees-lifecycle-hub");
          if (hub && isMobileEmployeesHub()) {
            hub.insertAdjacentHTML(
              "afterbegin",
              `<div class="overview-error" style="margin-bottom:10px"><p class="muted">Your dashboard shows ${activeCount} active employee${activeCount === 1 ? "" : "s"}, but the register returned none (tenant ${escapeHtml(tenantId || "?")}). Tap Retry or sign out and sign in again.</p></div>`,
            );
          }
        }
      } catch (error) {
        if (requestId !== employeesRefreshGeneration) return;
        const fallback = employeesFromFormOptions();
        if (fallback.length) {
          applyEmployeesCache(fallback);
          return;
        }
        if (employeesCache.length) {
          renderEmployeeRegister();
          return;
        }
        employeesCache = [];
        const message = friendlyNativeError(error, "Could not load employees.");
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(message)} Try again or check your connection.</td></tr>`;
        }
        if (mobileCards) {
          mobileCards.hidden = false;
          mobileCards.innerHTML = `<div class="overview-error"><p class="muted">${escapeHtml(message)}</p><button type="button" class="btn outline btn-sm" id="employees-retry-btn">Retry</button></div>`;
          mobileCards.querySelector("#employees-retry-btn")?.addEventListener("click", () => {
            void initEmployeesSection();
          });
        }
        renderLifecycleHubLoadError(`${message} Try again or check your connection.`);
      }
    };

    employeesRefreshInflight = run().finally(() => {
      employeesRefreshInflight = null;
    });
    return employeesRefreshInflight;
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
      renderLifecycleHub(employeesCache);
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
      if (!window.Admin.formOptions?.employee_document_categories) {
        await loadFormOptions();
      }
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
            <p class="employee-record-lifecycle-link">
              <button type="button" class="employee-record-link" id="employees-side-lifecycle-btn">Full lifecycle record →</button>
            </p>
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

          ${renderEmployeeRecordSectionsHtml(employee, workspace)}

          <footer class="employee-record-foot muted">
            <span class="employee-record-portal-icon" aria-hidden="true"></span>
            ${escapeHtml(portalStatusCopy(employee))}
          </footer>
          <p class="muted" id="employees-side-invite-status" aria-live="polite"></p>
        </article>`;

      void refreshEmployeeSidePanelKioskPin(employee.id);
      bindSidePanelInlineFields(employee, workspace);
      renderLifecycleHub(employeesCache);

      content.querySelector("#employees-side-invite-btn")?.addEventListener("click", () => {
        void sendPortalInvite(employee.id, "employees-side-invite-status");
      });
      content.querySelector("#employees-side-delete-btn")?.addEventListener("click", async () => {
        if (!window.confirm("Remove this employee record?")) return;
        const deleteRes = await apiFetch(`/admin/employees/${employee.id}`, { method: "DELETE" });
        if (!deleteRes.ok) {
          const err = await deleteRes.json();
          employeesToast(err.detail || "Delete failed", "error");
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
        if (!res.ok) {
          const existingId = duplicateEmployeeId(res, data);
          if (existingId) {
            await focusExistingEmployee(existingId);
          }
          throw new Error(employeeApiError(res, data, "Create failed"));
        }
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

  function showEmployeesLoadingState() {
    if (!isMobileEmployeesHub()) return;
    const hub = $("employees-lifecycle-hub");
    const cards = $("employees-mobile-cards");
    if (hub) {
      hub.hidden = false;
      hub.innerHTML = '<p class="muted" style="padding:12px 0">Loading employees…</p>';
    }
    if (cards) {
      cards.hidden = false;
      cards.innerHTML = '<p class="muted">Loading employees…</p>';
    }
    const tbody = $("employees-table-body");
    if (tbody && !employeesCache.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading employees…</td></tr>';
    }
  }

  async function initEmployeesSection() {
    const warmed = peekEmployeesListCache?.();
    if (warmed?.length && !employeesCache.length) {
      applyEmployeesCache(warmed);
    }
    showEmployeesLoadingState();
    if (!sectionLoaded) {
      sectionLoaded = true;
      mountQuickAddForm();
      mountKioskPinForm();
      bindChangeHistoryPanel();
      document.getElementById("employees-bulk-invite-btn")?.addEventListener("click", () => sendBulkPortalInvites());
      window.addEventListener("resize", () => {
        renderLifecycleHub(employeesCache);
        renderEmployeeMobileCards(getFilteredEmployees());
      });
    }
    try {
      const warmed = peekEmployeesListCache?.();
      const needsForce = !warmed?.length && !employeesCache.length;
      await Promise.race([
        refreshEmployeesTable({ force: needsForce }),
        new Promise((_, reject) =>
          window.setTimeout(() => reject(new Error("Request timed out")), 45000),
        ),
      ]);
    } catch (error) {
      if (!employeesCache.length) {
        renderLifecycleHubLoadError(
          `${friendlyNativeError(error, "Could not load employees.")} Tap Retry or check your connection.`,
        );
      }
    }
    if (!window.__SSHR_BUNDLED_NATIVE_BOOT) {
      void loadFormOptions().catch(() => null);
    }
  }

  async function prefetchEmployeesTable() {
    try {
      await refreshEmployeesTable();
    } catch {
      /* warm cache — section open will retry */
    }
  }

  $("employee-back-btn")?.addEventListener("click", showListView);

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section !== "employees") return;
    showEmployeesLoadingState();
    if (employeesCache.length) {
      renderEmployeeRegister();
    }
    void (async () => {
      await initEmployeesSection();

      const hash = window.location.hash.replace("#", "");
      const match = hash.match(/^employees\/(\d+)(?:\/([\w_]+))?$/);
      if (match) {
        employeeRegisterFilter = null;
        await openEmployee(Number(match[1]), match[2] || null);
      } else {
        applyEmployeesListRoute();
      }
    })();
  });

  window.addEventListener("admin:employees-cache-ready", () => {
    const warmed = peekEmployeesListCache?.();
    if (warmed?.length && !employeesCache.length) {
      applyEmployeesCache(warmed);
    }
  });

  window.addEventListener("admin:deferred-ready", () => {
    const active = document.getElementById("employees")?.classList.contains("admin-section--active");
    const onEmployees = /#employees/i.test(window.location.hash) || active;
    if (onEmployees) void initEmployeesSection();
  });

  window.addEventListener("hashchange", () => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "employees" || hash === "employees/portal-pending") {
      if (document.getElementById("employees")?.classList.contains("admin-section--active")) {
        applyEmployeesListRoute();
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

  window.addEventListener("admin:portal-native-retry", () => {
    const active =
      document.getElementById("employees")?.classList.contains("admin-section--active") ||
      /#employees/i.test(window.location.hash);
    if (active) void initEmployeesSection();
  });

  window.addEventListener("admin:overview-loaded", () => {
    void prefetchEmployeesTable();
  });

  window.addEventListener("shiftswift:portal-ready", () => {
    if (/#employees/i.test(window.location.hash)) void initEmployeesSection();
  });

  if (
    /#employees/i.test(window.location.hash) ||
    document.getElementById("employees")?.classList.contains("admin-section--active")
  ) {
    void initEmployeesSection();
  }

  window.ShiftSwiftAdminEmployees = {
    initEmployeesSection,
    refreshEmployeesTable,
    prefetchEmployeesTable,
    getEmployeesCount: () => employeesCache.length,
  };
})();
