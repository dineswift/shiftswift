/** Offboarding workflows — leaver register with detail panel. */
(function () {
  const { apiFetch, escapeHtml, statusPill, parseHashBaseSection, showAdminToast } = window.Admin;

  function offboardingToast(message, variant = "info") {
    if (showAdminToast) showAdminToast(message, { variant });
    else window.ShiftSwiftAction?.showActionToast?.(message, variant === "error" ? "error" : "ok");
  }

  const WORKFLOW_STEPS = [
    { id: "identified", label: "Leaver identified" },
    { id: "acas", label: "ACAS appeal window" },
    { id: "cessation", label: "Sponsor cessation" },
    { id: "complete", label: "Complete" },
  ];

  const CHECKLIST_ITEMS = [
    { id: "letter", label: "Resignation or termination letter on file" },
    { id: "final_pay", label: "Final pay and holiday accrual calculated" },
    { id: "p45", label: "P45 issued via payroll" },
    { id: "equipment", label: "Uniform, keys, and equipment returned" },
    { id: "access", label: "System access revoked (email, rota, time clock)" },
    { id: "cessation", label: "Sponsor cessation reported (if applicable)" },
    { id: "handover", label: "Handover notes and rota cover arranged" },
  ];

  let workflows = [];
  let selectedWorkflowId = null;
  let startBound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function formatDate(value) {
    if (!value) return "Not set";
    try {
      return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return value;
    }
  }

  function parseStartEmployeeFromHash() {
    const parts = window.location.hash.replace("#", "").split("/").filter(Boolean);
    if (parts[0] !== "offboarding" || parts[1] !== "start" || !parts[2]) return null;
    const id = Number(parts[2]);
    return Number.isFinite(id) ? id : null;
  }

  function checklistStorageKey(workflowId) {
    return `offboarding-checklist-${workflowId}`;
  }

  function readChecklistState(workflowId) {
    try {
      const raw = localStorage.getItem(checklistStorageKey(workflowId));
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeChecklistState(workflowId, state) {
    try {
      localStorage.setItem(checklistStorageKey(workflowId), JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }

  function acasDaysRemaining(deadline) {
    if (!deadline) return null;
    const end = new Date(deadline);
    end.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((end - today) / 86400000);
  }

  function acasCountdownHtml(row) {
    if (!row?.acas_appeal_deadline || row.status === "completed" || row.status === "cancelled") return "";
    const days = acasDaysRemaining(row.acas_appeal_deadline);
    if (days == null) return "";
    let cls = "offboarding-acas-pill";
    let text;
    if (days > 7) {
      text = `${days} days left in ACAS appeal window (until ${formatDate(row.acas_appeal_deadline)})`;
    } else if (days >= 0) {
      cls += " offboarding-acas-pill--warn";
      text =
        days === 0
          ? "ACAS appeal window ends today"
          : `${days} day${days === 1 ? "" : "s"} left — ACAS window closing soon`;
    } else {
      cls += " offboarding-acas-pill--overdue";
      text = `ACAS window ended ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
    }
    return `<p class="${cls}">${escapeHtml(text)}</p>`;
  }

  function acasTableSubtext(row) {
    if (!row.acas_appeal_deadline || row.status === "completed" || row.status === "cancelled") return "";
    const days = acasDaysRemaining(row.acas_appeal_deadline);
    if (days == null) return "";
    if (days > 7) return `<div class="muted">${days} days left</div>`;
    if (days >= 0) return `<div class="offboarding-acas-sub offboarding-acas-sub--warn">${days}d left</div>`;
    return `<div class="offboarding-acas-sub offboarding-acas-sub--overdue">Overdue</div>`;
  }

  function canComplete(row) {
    if (row.status !== "in_progress") return false;
    if (row.sponsorship_cessation_required && !row.sponsorship_cessation_reference) return false;
    return true;
  }

  function canCancel(row) {
    return row.status === "in_progress";
  }

  function buildReasonPayload() {
    const type = $("offboarding-reason-type")?.value || "";
    const detail = $("offboarding-reason-detail")?.value?.trim() || "";
    if (type === "Other") {
      if (!detail) return null;
      return detail.length >= 3 ? detail : null;
    }
    if (!detail) return type;
    return `${type}: ${detail}`;
  }

  function syncReasonDetailField() {
    const wrap = $("offboarding-reason-detail-wrap");
    const type = $("offboarding-reason-type")?.value;
    if (!wrap) return;
    const show = type === "Other";
    wrap.hidden = !show;
    if (!show) {
      const input = $("offboarding-reason-detail");
      if (input) input.value = "";
    }
  }

  function applyStartEmployeeFromHash() {
    const employeeId = parseStartEmployeeFromHash();
    if (!employeeId) return;
    const select = $("offboarding-employee");
    if (!select) return;
    const match = [...select.options].some((opt) => opt.value === String(employeeId));
    if (match) select.value = String(employeeId);
    const panel = document.querySelector(".offboarding-start-panel");
    panel?.classList.add("offboarding-start-panel--highlight");
    window.setTimeout(() => panel?.classList.remove("offboarding-start-panel--highlight"), 2400);
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    $("offboarding-reason-type")?.focus();
  }

  function computeStepStates(row) {
    if (!row) {
      return WORKFLOW_STEPS.map((step) => ({ ...step, state: "pending" }));
    }

    if (row.status === "completed") {
      return WORKFLOW_STEPS.map((step) => ({
        ...step,
        state: step.id === "cessation" && !row.sponsorship_cessation_required ? "skipped" : "done",
      }));
    }

    if (row.status === "cancelled") {
      return WORKFLOW_STEPS.map((step, index) => ({
        ...step,
        state: index === 0 ? "done" : "pending",
      }));
    }

    const done = new Set(["identified"]);
    let active = "acas";
    const appealOpen = acasDaysRemaining(row.acas_appeal_deadline);
    const appealStillOpen = appealOpen != null && appealOpen >= 0;

    if (!row.sponsorship_cessation_required) {
      if (appealStillOpen) {
        active = "acas";
      } else {
        done.add("acas");
        active = "complete";
      }
    } else if (row.sponsorship_cessation_reference) {
      done.add("acas");
      done.add("cessation");
      active = "complete";
    } else if (appealStillOpen) {
      active = "acas";
    } else {
      done.add("acas");
      active = "cessation";
    }

    return WORKFLOW_STEPS.map((step) => {
      if (!row.sponsorship_cessation_required && step.id === "cessation") {
        return { ...step, state: "skipped" };
      }
      if (done.has(step.id)) return { ...step, state: "done" };
      if (step.id === active) return { ...step, state: "active" };
      return { ...step, state: "pending" };
    });
  }

  function renderStatusWorkflow(row) {
    const host = $("offboarding-status-workflow");
    if (!host) return;
    const states = computeStepStates(row);
    host.innerHTML = states
      .map((step, index) => {
        const stepClass =
          step.state === "pending" ? "hr-workflow-step" : `hr-workflow-step hr-workflow-step--${step.state}`;
        const arrow =
          index < states.length - 1 ? '<span class="hr-workflow-arrow" aria-hidden="true">→</span>' : "";
        const skippedHint =
          step.state === "skipped" ? '<span class="visually-hidden"> (not required)</span>' : "";
        return `<span class="${stepClass}">${escapeHtml(step.label)}${skippedHint}</span>${arrow}`;
      })
      .join("");
  }

  function syncDetailLayout() {
    const workspace = $("offboarding-workspace");
    const panel = $("offboarding-detail-panel");
    const guide = $("offboarding-guide-panel");
    const hasSelection = Boolean(selectedWorkflowId);
    workspace?.classList.toggle("offboarding-workspace-layout--detail-open", hasSelection);
    if (panel) panel.hidden = !hasSelection;
    if (guide) guide.hidden = hasSelection;
    const row = workflows.find((w) => w.id === selectedWorkflowId);
    renderStatusWorkflow(row || null);
  }

  function clearSelection() {
    selectedWorkflowId = null;
    const content = $("offboarding-detail-content");
    if (content) content.hidden = true;
    renderWorkflowsTable();
    syncDetailLayout();
  }

  function renderChecklistHtml(workflowId) {
    const saved = readChecklistState(workflowId);
    const items = CHECKLIST_ITEMS.map((item) => {
      const checked = Boolean(saved[item.id]);
      return `<li>
        <input type="checkbox" id="offboarding-check-${workflowId}-${item.id}" data-check-id="${escapeHtml(item.id)}" ${checked ? "checked" : ""} />
        <label for="offboarding-check-${workflowId}-${item.id}">${escapeHtml(item.label)}</label>
      </li>`;
    }).join("");
    return `
      <p class="offboarding-detail-checklist__title">Leaver checklist</p>
      <ul class="offboarding-detail-checklist" id="offboarding-checklist">${items}</ul>
      <p class="muted offboarding-detail-checklist__foot">
        <a href="#templates">Download full leaver checklist template</a>
      </p>`;
  }

  function bindChecklist(workflowId) {
    const list = document.getElementById("offboarding-checklist");
    if (!list) return;
    list.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        const state = readChecklistState(workflowId);
        state[input.dataset.checkId] = input.checked;
        writeChecklistState(workflowId, state);
      });
    });
  }

  function renderWorkflowsTable() {
    const tbody = $("offboarding-body");
    if (!tbody) return;
    if (!workflows.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted">No offboarding workflows yet. Start a leaver workflow above when an employee is leaving.</td></tr>';
      return;
    }
    tbody.innerHTML = workflows
      .map((row) => {
        const selected = selectedWorkflowId === row.id ? " hr-register-row--selected" : "";
        const cessation = row.sponsorship_cessation_required
          ? row.sponsorship_cessation_reference
            ? escapeHtml(row.sponsorship_cessation_reference)
            : '<span class="muted">Required</span>'
          : "Not required";
        return `<tr class="hr-register-row${selected}" data-workflow-id="${row.id}">
          <td><strong>OFF-${escapeHtml(row.id)}</strong><div class="muted">${formatDate(row.started_at)}</div></td>
          <td>${escapeHtml(row.employee_name || row.employee_id)}<div class="muted">${escapeHtml(row.employee_department || "")}</div></td>
          <td>${escapeHtml(row.reason)}</td>
          <td>${statusPill(row.status)}</td>
          <td>${escapeHtml(formatDate(row.acas_appeal_deadline))}${acasTableSubtext(row)}</td>
          <td>${cessation}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".hr-register-row").forEach((row) => {
      row.addEventListener("click", () => selectWorkflow(Number(row.dataset.workflowId)));
    });
  }

  function renderDetailPanel(row) {
    const content = $("offboarding-detail-content");
    if (!content) return;
    content.hidden = false;

    const cancelNote =
      row.status === "cancelled" && row.cancellation_reason
        ? `<p class="muted">Cancelled: ${escapeHtml(row.cancellation_reason)}</p>`
        : "";
    const completedNote =
      row.status === "completed" && row.completed_at
        ? `<p class="muted">Completed ${escapeHtml(formatDate(row.completed_at))}</p>`
        : "";

    content.innerHTML = `
      <div class="hr-detail-head">
        <div>
          <h3>OFF-${escapeHtml(row.id)}</h3>
          ${statusPill(row.status)}
          ${completedNote}
          ${cancelNote}
        </div>
      </div>
      ${acasCountdownHtml(row)}
      <dl class="hr-detail-grid">
        <div><dt>Employee</dt><dd>${escapeHtml(row.employee_name || row.employee_id)} · ${escapeHtml(row.employee_department || "Not set")}</dd></div>
        <div><dt>Reason</dt><dd>${escapeHtml(row.reason)}</dd></div>
        <div><dt>Started</dt><dd>${escapeHtml(formatDate(row.started_at))}</dd></div>
        <div><dt>ACAS appeal by</dt><dd>${escapeHtml(formatDate(row.acas_appeal_deadline))}</dd></div>
        <div><dt>Sponsor cessation</dt><dd>${row.sponsorship_cessation_required ? (row.sponsorship_cessation_reference ? escapeHtml(row.sponsorship_cessation_reference) : "Required — not yet reported") : "Not required"}</dd></div>
        ${row.grievance_case_id ? `<div><dt>Linked grievance</dt><dd><a href="#grievance">Case #${escapeHtml(row.grievance_case_id)}</a></dd></div>` : ""}
      </dl>
      ${renderChecklistHtml(row.id)}
      <div class="hr-detail-foot">
        ${row.sponsorship_cessation_required && !row.sponsorship_cessation_reference ? `<button type="button" class="btn" id="offboarding-cessation-btn">Report cessation</button>` : ""}
        ${canComplete(row) ? `<button type="button" class="btn" id="offboarding-complete-btn">Mark complete</button>` : ""}
        ${canCancel(row) ? `<button type="button" class="btn btn--ghost btn--danger" id="offboarding-cancel-btn">Cancel workflow</button>` : ""}
        <a class="btn ghost" href="#employees/${escapeHtml(row.employee_id)}/offboarding">Open employee offboarding</a>
      </div>`;

    content.querySelector("#offboarding-cessation-btn")?.addEventListener("click", () => reportCessation(row.id));
    content.querySelector("#offboarding-complete-btn")?.addEventListener("click", () => completeWorkflow(row.id));
    content.querySelector("#offboarding-cancel-btn")?.addEventListener("click", () => cancelWorkflow(row.id));
    bindChecklist(row.id);
    syncDetailLayout();
  }

  async function selectWorkflow(workflowId) {
    selectedWorkflowId = workflowId;
    renderWorkflowsTable();
    const row = workflows.find((w) => w.id === workflowId);
    if (row) renderDetailPanel(row);
    else syncDetailLayout();
  }

  async function reportCessation(workflowId) {
    const ref = window.prompt("Home Office cessation report reference:");
    if (!ref) return;
    const res = await apiFetch(`/offboarding/workflows/${workflowId}/cessation-reported`, {
      method: "POST",
      body: JSON.stringify({ report_reference: ref }),
    });
    if (!res.ok) {
      const err = await res.json();
      offboardingToast(err.detail || "Update failed", "error");
      return;
    }
    await loadWorkflows();
    await selectWorkflow(workflowId);
  }

  async function completeWorkflow(workflowId) {
    if (!window.confirm("Mark this offboarding workflow as complete?")) return;
    const res = await apiFetch(`/offboarding/workflows/${workflowId}/complete`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      offboardingToast(data.detail || "Could not complete workflow", "error");
      return;
    }
    await loadWorkflows();
    await selectWorkflow(workflowId);
  }

  async function cancelWorkflow(workflowId) {
    const reason = window.prompt("Cancel this workflow? Optional reason:");
    if (reason === null) return;
    const res = await apiFetch(`/offboarding/workflows/${workflowId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: reason.trim() || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      offboardingToast(data.detail || "Could not cancel workflow", "error");
      return;
    }
    await loadWorkflows();
    await selectWorkflow(workflowId);
  }

  async function loadWorkflows() {
    try {
      const res = await apiFetch("/offboarding/workflows");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      workflows = data.items || [];
      if (selectedWorkflowId && !workflows.some((w) => w.id === selectedWorkflowId)) {
        selectedWorkflowId = null;
      }
      renderWorkflowsTable();
      if (selectedWorkflowId) {
        const row = workflows.find((w) => w.id === selectedWorkflowId);
        if (row) renderDetailPanel(row);
        else syncDetailLayout();
      } else {
        syncDetailLayout();
      }
    } catch {
      workflows = [];
      selectedWorkflowId = null;
      renderWorkflowsTable();
      syncDetailLayout();
    }
  }

  async function loadEmployeeSelect() {
    const select = $("offboarding-employee");
    if (!select) return;
    try {
      const res = await apiFetch("/admin/employees");
      const data = await res.json();
      select.innerHTML = (data.items || [])
        .map((emp) => `<option value="${emp.id}">${escapeHtml(emp.first_name)} ${escapeHtml(emp.last_name)}</option>`)
        .join("");
    } catch {
      select.innerHTML = `<option value="">Could not load employees</option>`;
    }
  }

  function bindStartForm() {
    if (startBound) return;
    $("offboarding-reason-type")?.addEventListener("change", syncReasonDetailField);

    $("offboarding-start-btn")?.addEventListener("click", async () => {
      const employeeId = $("offboarding-employee")?.value;
      const reason = buildReasonPayload();
      if (!employeeId || !reason) {
        offboardingToast("Select employee and enter a reason (at least 3 characters for Other).", "error");
        return;
      }
      if (!window.confirm("Start offboarding for this employee? An ACAS appeal window will be recorded.")) return;
      const res = await apiFetch("/offboarding/workflows", {
        method: "POST",
        body: JSON.stringify({ employee_id: Number(employeeId), reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail;
        if (res.status === 409 && detail?.existing_workflow_id) {
          await loadWorkflows();
          await selectWorkflow(Number(detail.existing_workflow_id));
          offboardingToast(detail.message || "This employee already has an active workflow — opened existing record.");
          return;
        }
        offboardingToast(typeof detail === "string" ? detail : detail?.message || "Could not start workflow", "error");
        return;
      }
      $("offboarding-reason-detail").value = "";
      $("offboarding-reason-type").value = "Resignation";
      syncReasonDetailField();
      await loadWorkflows();
      if (data.id) await selectWorkflow(data.id);
    });

    $("offboarding-detail-close")?.addEventListener("click", () => clearSelection());
    startBound = true;
  }

  async function initOffboardingSection() {
    bindStartForm();
    syncReasonDetailField();
    syncDetailLayout();
    await loadEmployeeSelect();
    applyStartEmployeeFromHash();
    await loadWorkflows();
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "offboarding") initOffboardingSection();
  });

  window.addEventListener("hashchange", () => {
    if (parseHashBaseSection(window.location.hash) !== "offboarding") return;
    applyStartEmployeeFromHash();
  });

  if (parseHashBaseSection(window.location.hash) === "offboarding") initOffboardingSection();
})();
