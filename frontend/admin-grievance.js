/** Grievance case management — encrypted notes, ACAS deadlines, case workspace. */
(function () {
  const { apiFetch, loadFormOptions, loadEmployees, mountEditForm, renderTableBody, FORM_SCHEMAS, escapeHtml, downloadAuthenticated, parseHashBaseSection, emptyStateHtml, showAdminToast } = window.Admin;

  function grievanceToast(message, variant = "info") {
    if (showAdminToast) showAdminToast(message, { variant });
    else window.ShiftSwiftAction?.showActionToast?.(message, variant === "error" ? "error" : "ok");
  }

  let selectedCaseId = null;
  let sectionReady = false;
  let cases = [];
  let investigators = [];
  let formState = { severity: "medium" };

  function $(id) {
    return document.getElementById(id);
  }

  function allegationLabel(row) {
    return row.allegation_type_label || row.allegation_type || "Not set";
  }

  function severityBadge(severity) {
    const cls = {
      low: "grievance-severity-pill--low",
      medium: "grievance-severity-pill--medium",
      high: "grievance-severity-pill--high",
      critical: "grievance-severity-pill--critical",
    };
    return `<span class="grievance-severity-pill ${cls[severity] || ""}">${escapeHtml(severity || "medium")}</span>`;
  }

  function statusBadge(status, label) {
    const text = label || status || "open";
    const cls =
      status === "closed"
        ? "grievance-status-pill--resolved"
        : status === "hearing"
          ? "grievance-status-pill--acas"
          : "grievance-status-pill--investigating";
    return `<span class="grievance-status-pill ${cls}">${escapeHtml(text)}</span>`;
  }

  function acasDeadlineCell(row) {
    if (!row.acas_deadline) return `<span class="muted">Not set</span>`;
    const alert = row.acas_deadline_alert;
    const cls =
      alert === "overdue"
        ? "grievance-deadline--danger"
        : alert === "warn"
          ? "grievance-deadline--warn"
          : "";
    const remaining =
      row.acas_days_remaining != null
        ? row.acas_days_remaining < 0
          ? `${Math.abs(row.acas_days_remaining)} days overdue`
          : `${row.acas_days_remaining} days left`
        : "";
    return `<span class="grievance-deadline ${cls}">${escapeHtml(row.acas_deadline)}${remaining ? `<span class="muted"> · ${escapeHtml(remaining)}</span>` : ""}</span>`;
  }

  function isMobileGrievanceUi() {
    if (!document.getElementById("mobile-tab-bar")) return false;
    return window.isShiftSwiftMobileViewport?.() ?? window.matchMedia("(max-width: 860px)").matches;
  }

  function syncGrievanceMobileDetailLayout() {
    const section = $("grievance");
    if (!section) return;
    const showDetail = isMobileGrievanceUi() && Boolean(selectedCaseId);
    section.classList.toggle("grievance-mobile-detail-open", showDetail);
    renderMobileGrievanceShell();
  }

  function renderMobileGrievanceShell() {
    const shell = $("grievance-mobile-shell");
    if (!shell) return;
    const detailOpen = $("grievance")?.classList.contains("grievance-mobile-detail-open");
    if (!isMobileGrievanceUi() || detailOpen) {
      shell.hidden = true;
      return;
    }
    shell.hidden = false;
    renderMobileGrievanceCards();
  }

  function renderMobileGrievanceCards() {
    const host = $("grievance-mobile-cards");
    const heading = $("grievance-mobile-cases-heading");
    if (!host) return;

    const openCases = cases.filter((row) => row.status !== "closed");
    if (heading) heading.textContent = `Open cases (${openCases.length})`;

    if (!openCases.length) {
      host.innerHTML = `<p class="leave-mobile-empty muted">No open grievance cases.</p>`;
      return;
    }

    host.innerHTML = openCases
      .map((row) => {
        const canResolve = row.status !== "closed";
        return `<article class="leave-mobile-request-card" data-grievance-id="${row.id}">
          <div class="leave-mobile-request-card__head admin-mobile-case-card__tap" data-grievance-open="${row.id}" role="button" tabindex="0">
            <div class="leave-mobile-request-card__who">
              <strong>${escapeHtml(row.case_reference)}</strong>
              <span>${escapeHtml(row.employee_name || row.employee_id)} · ${escapeHtml(allegationLabel(row))}</span>
            </div>
            ${statusBadge(row.status, row.status_label)}
          </div>
          <div class="leave-mobile-request-card__meta">
            <span>${severityBadge(row.severity)}</span>
            <span>${acasDeadlineCell(row)}</span>
          </div>
          <div class="leave-mobile-request-card__actions">
            <button type="button" class="leave-mobile-action leave-mobile-action--approve" data-grievance-open-btn="${row.id}">Open</button>
            ${canResolve ? `<button type="button" class="leave-mobile-action leave-mobile-action--decline" data-grievance-resolve="${row.id}">Resolve</button>` : ""}
          </div>
        </article>`;
      })
      .join("");

    host.querySelectorAll("[data-grievance-open]").forEach((el) => {
      const open = () => void selectCase(Number(el.dataset.grievanceOpen));
      el.addEventListener("click", open);
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
    host.querySelectorAll("[data-grievance-open-btn]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        void selectCase(Number(btn.dataset.grievanceOpenBtn));
      });
    });
    host.querySelectorAll("[data-grievance-resolve]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        void resolveCase(Number(btn.dataset.grievanceResolve));
      });
    });
  }

  function calculateAcasDeadline(notificationDate) {
    if (!notificationDate) return "";
    const parts = notificationDate.split("-").map(Number);
    if (parts.length !== 3) return "";
    const base = new Date(parts[0], parts[1] - 1, parts[2]);
    const monthLater = new Date(base.getFullYear(), base.getMonth() + 1, base.getDate());
    monthLater.setDate(monthLater.getDate() + 14);
    return monthLater.toISOString().slice(0, 10);
  }

  function renderStatusWorkflow() {
    const host = $("grievance-status-workflow");
    if (!host) return;
    const steps = window.Admin.formOptions?.grievance_status_workflow || [
      { label: "Open" },
      { label: "Investigating" },
      { label: "ACAS" },
      { label: "Resolved" },
    ];
    host.innerHTML = steps
      .map(
        (step, index) =>
          `<span class="grievance-workflow-step">${escapeHtml(step.label)}</span>${index < steps.length - 1 ? '<span class="grievance-workflow-arrow" aria-hidden="true">→</span>' : ""}`
      )
      .join("");
  }

  function renderCasesTable() {
    const tbody = $("grievance-cases-body");
    if (!tbody) return;
    if (!cases.length) {
      tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="6">${emptyStateHtml({
        icon: "scale",
        title: "No grievance cases",
        message: "Log a case using the form above — notes are encrypted and ACAS deadlines are tracked automatically.",
        actionLabel: "Open case form",
        actionId: "grievance-scroll-form-btn",
        compact: true,
      })}</td></tr>`;
      document.getElementById("grievance-scroll-form-btn")?.addEventListener("click", () => {
        $("grievance-case-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
        $("grievance-case-form")?.querySelector("input, select, textarea")?.focus();
      });
      return;
    }
    tbody.innerHTML = cases
      .map((row) => {
        const selected = selectedCaseId === row.id ? " grievance-case-row--selected" : "";
        return `<tr class="grievance-case-row${selected}" data-row-id="${row.id}">
          <td><strong>${escapeHtml(row.case_reference)}</strong><div class="muted">${escapeHtml((row.date_received || "").slice(0, 10) || "")}</div></td>
          <td>${escapeHtml(row.employee_name || row.employee_id)}<div class="muted">${escapeHtml(row.employee_department || "")}</div></td>
          <td>${escapeHtml(allegationLabel(row))}</td>
          <td>${severityBadge(row.severity)}</td>
          <td>${statusBadge(row.status, row.status_label)}</td>
          <td>${acasDeadlineCell(row)}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".grievance-case-row").forEach((row) => {
      row.addEventListener("click", () => selectCase(Number(row.dataset.rowId)));
    });
    renderMobileGrievanceShell();
  }

  async function loadCases() {
    try {
      const res = await apiFetch("/grievance/cases");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      cases = data.items || [];
      renderCasesTable();
      updateNextReferencePreview();
      renderMobileGrievanceShell();
    } catch {
      cases = [];
      renderCasesTable();
      renderMobileGrievanceShell();
    }
  }

  function updateNextReferencePreview() {
    const el = $("grievance-next-ref");
    if (!el) return;
    const year = new Date().getFullYear();
    const next = String((cases.filter((c) => (c.case_reference || "").startsWith(`GRV-${year}-`)).length || 0) + 1).padStart(3, "0");
    el.textContent = `Reference will be assigned automatically (e.g. GRV-${year}-${next})`;
  }

  async function loadInvestigators() {
    try {
      const res = await apiFetch("/grievance/investigators");
      if (!res.ok) return;
      const data = await res.json();
      investigators = data.items || [];
    } catch {
      investigators = [];
    }
  }

  function renderDetailPanel(caseData, notes) {
    const empty = $("grievance-case-detail-empty");
    const content = $("grievance-case-detail-content");
    if (!content) return;
    empty?.setAttribute("hidden", "");
    content.hidden = false;

    const acasAlert =
      caseData.acas_deadline && caseData.acas_deadline_alert !== "ok"
        ? `<div class="grievance-acas-alert grievance-acas-alert--${escapeHtml(caseData.acas_deadline_alert || "warn")}">
            <strong>ACAS deadline ${caseData.acas_deadline_alert === "overdue" ? "overdue" : "approaching"}</strong>
            <p>ACAS early conciliation deadline: ${escapeHtml(caseData.acas_deadline)}${caseData.acas_days_remaining != null ? ` — ${escapeHtml(Math.abs(caseData.acas_days_remaining))} day${Math.abs(caseData.acas_days_remaining) === 1 ? "" : "s"} ${caseData.acas_days_remaining < 0 ? "overdue" : "remaining"}` : ""}.</p>
            ${caseData.acas_deadline_alert === "warn" ? '<p class="muted">Notify ACAS if not resolved.</p>' : ""}
          </div>`
        : "";

    content.innerHTML = `
      <div class="grievance-detail-head">
        <div>
          <h3>${escapeHtml(caseData.case_reference)}</h3>
          ${statusBadge(caseData.status, caseData.status_label)}
        </div>
      </div>
      <dl class="grievance-detail-grid">
        <div><dt>Employee</dt><dd>${escapeHtml(caseData.employee_name || caseData.employee_id)} · ${escapeHtml(caseData.employee_department || "Not set")}</dd></div>
        <div><dt>Allegation</dt><dd>${escapeHtml(allegationLabel(caseData))}</dd></div>
        <div><dt>Severity</dt><dd>${severityBadge(caseData.severity)}</dd></div>
        <div><dt>Date received</dt><dd>${escapeHtml(caseData.date_received || "Not set")}</dd></div>
        <div><dt>Investigator</dt><dd>${escapeHtml(caseData.assigned_investigator || "Not assigned")}</dd></div>
        <div><dt>Anonymous to line manager</dt><dd>${caseData.is_anonymous_to_manager ? "✓ Yes — confidential" : "No"}</dd></div>
      </dl>
      ${acasAlert}
      <ol class="grievance-timeline">
        ${(caseData.timeline || [])
          .map(
            (item) => `<li class="grievance-timeline__item grievance-timeline__item--${escapeHtml(item.state || "todo")}">
              <span class="grievance-timeline__dot">${item.state === "done" ? "✓" : item.state === "current" ? "●" : "○"}</span>
              <span><strong>${escapeHtml(item.label)}</strong>${item.date ? `<span class="muted"> · ${escapeHtml(item.date)}</span>` : ""}${item.detail ? `<span class="muted"> · ${escapeHtml(item.detail)}</span>` : ""}</span>
            </li>`
          )
          .join("")}
      </ol>
      <div class="hr-surface-panel">
        <h4 class="hr-section-title">Encrypted notes</h4>
        <div id="grievance-note-form"></div>
        <div class="hr-table-wrap">
          <table class="data-table">
            <thead><tr><th>Type</th><th>Author</th><th>When</th><th>Note</th></tr></thead>
            <tbody id="grievance-notes-body"></tbody>
          </table>
        </div>
      </div>
      <div class="grievance-detail-foot">
        <button type="button" class="btn ghost" id="grievance-add-note-btn">Add note</button>
        <button type="button" class="btn" id="grievance-resolve-btn" ${caseData.status === "closed" ? "disabled" : ""}>Mark resolved</button>
      </div>`;

    renderTableBody(content.querySelector("#grievance-notes-body"), {
      emptyMessage: "No encrypted notes yet.",
      columns: [
        { key: "note_type", render: (r) => escapeHtml(r.note_type) },
        { key: "created_by", render: (r) => escapeHtml(r.created_by) },
        { key: "created_at", render: (r) => escapeHtml((r.created_at || "").slice(0, 16)) },
        { key: "body", render: (r) => escapeHtml(r.body || "") },
      ],
      rows: notes,
    });

    mountNoteForm(content.querySelector("#grievance-note-form"));
    content.querySelector("#grievance-resolve-btn")?.addEventListener("click", () => resolveCase(caseData.id));
    content.querySelector("#grievance-add-note-btn")?.addEventListener("click", () => {
      content.querySelector("#grievance-note-form textarea")?.focus();
    });
  }

  async function selectCase(caseId) {
    selectedCaseId = caseId;
    renderCasesTable();
    syncGrievanceMobileDetailLayout();
    const content = $("grievance-case-detail-content");
    if (content) content.innerHTML = `<p class="muted">Loading case…</p>`;
    try {
      const [caseRes, notesRes] = await Promise.all([
        apiFetch(`/grievance/cases/${caseId}`),
        apiFetch(`/grievance/cases/${caseId}/notes`),
      ]);
      const caseData = await caseRes.json();
      const notesData = notesRes.ok ? await notesRes.json() : { items: [] };
      if (!caseRes.ok) throw new Error(caseData.detail || "Load failed");
      renderDetailPanel(caseData, notesData.items || []);
    } catch (error) {
      if (content) content.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load case.")}</p>`;
    }
  }

  async function resolveCase(caseId) {
    const outcome = window.prompt("Close outcome (upheld / rejected / withdrawn / dismissal / resignation):", "upheld");
    if (!outcome) return;
    const res = await apiFetch(`/grievance/cases/${caseId}/close`, {
      method: "POST",
      body: JSON.stringify({ close_outcome: outcome }),
    });
    if (!res.ok) {
      const err = await res.json();
      grievanceToast(err.detail || "Could not resolve case", "error");
      return;
    }
    await loadCases();
    await selectCase(caseId);
  }

  function mountNoteForm(host) {
    if (!host || !selectedCaseId) return;
    mountEditForm(host, FORM_SCHEMAS.grievanceNote, {
      onSubmit: async (payload) => {
        const res = await apiFetch(`/grievance/cases/${selectedCaseId}/notes`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Note failed");
        host.querySelector("form")?.reset();
        await selectCase(selectedCaseId);
      },
    });
  }

  function bindSeverityButtons(container) {
    container.querySelectorAll("[data-severity]").forEach((btn) => {
      btn.addEventListener("click", () => {
        formState.severity = btn.dataset.severity;
        container.querySelectorAll("[data-severity]").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.severity === formState.severity);
        });
      });
    });
  }

  function mountCaseForm() {
    const host = $("grievance-case-form");
    if (!host || host.dataset.mounted === "true") return;

    const allegationTypes = window.Admin.formOptions?.grievance_allegation_types || [];
    const today = new Date().toISOString().slice(0, 10);
    const employeeOptions = (window.Admin.formOptions?.employees || [])
      .map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)
      .join("");
    const investigatorOptions = ['<option value="">Select investigator</option>']
      .concat(
        investigators.map(
          (opt, index) =>
            `<option value="${escapeHtml(opt.value)}"${investigators.length === 1 && index === 0 ? " selected" : ""}>${escapeHtml(opt.label)}</option>`
        )
      )
      .join("");

    host.innerHTML = `
      <form id="grievance-open-case-form" class="edit-form edit-form--cols-2">
        <label class="edit-field"><span class="edit-label">Employee</span><select name="employee_id" required>${employeeOptions}</select></label>
        <label class="edit-field"><span class="edit-label">Date received</span><input name="date_received" type="date" required value="${today}" /></label>
        <label class="edit-field"><span class="edit-label">Allegation type</span><select name="allegation_type" required>${allegationTypes.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join("")}</select></label>
        <label class="edit-field" id="grievance-allegation-other-wrap" hidden><span class="edit-label">Describe allegation</span><input name="allegation_type_other" type="text" placeholder="Brief description" /></label>
        <label class="edit-field"><span class="edit-label">Investigator</span><select name="assigned_investigator">${investigatorOptions}</select></label>
        <div class="edit-field grievance-severity-field" data-span="2">
          <span class="edit-label">Severity</span>
          <div class="grievance-severity-toggle" role="group" aria-label="Case severity">
            <button type="button" class="grievance-severity-btn grievance-severity-btn--low" data-severity="low">Low</button>
            <button type="button" class="grievance-severity-btn grievance-severity-btn--medium is-active" data-severity="medium">Medium</button>
            <button type="button" class="grievance-severity-btn grievance-severity-btn--high" data-severity="high">High</button>
            <button type="button" class="grievance-severity-btn grievance-severity-btn--critical" data-severity="critical">Critical</button>
          </div>
        </div>
        <label class="edit-field"><span class="edit-label">ACAS notification date (if notified)</span><input name="acas_notification_date" type="date" /></label>
        <label class="edit-field"><span class="edit-label">ACAS deadline (auto-calculated)</span><input name="acas_deadline_preview" type="text" readonly placeholder="Auto — enter notification date" /></label>
        <label class="edit-field" data-span="2"><span class="edit-label">Absence / dispute context (optional)</span><textarea name="linked_absence_context" rows="2" placeholder="Optional. Links to sponsor absence monitoring."></textarea></label>
        <label class="edit-field" data-span="2"><span class="edit-label">Initial investigation note (encrypted)</span><textarea name="initial_note" rows="4" placeholder="Capture the first account while details are fresh."></textarea></label>
        <div class="edit-field grievance-anonymity-card" data-span="2">
          <label class="grievance-anonymity-card__inner">
            <input type="checkbox" name="is_anonymous_to_manager" />
            <span>
              <strong>Keep anonymous from line manager</strong>
              <span class="muted">This case will be hidden from the employee's line manager until the investigation is complete.</span>
            </span>
          </label>
        </div>
        <div class="edit-field" data-span="2">
          <p class="employee-section-hint employee-section-hint--warn">Opening a case creates an encrypted record and starts ACAS deadline tracking where applicable.</p>
        </div>
        <div class="edit-form-actions" data-span="2">
          <button type="submit" class="btn">Open grievance case</button>
          <p class="edit-form-status muted" data-status></p>
        </div>
      </form>`;

    const form = host.querySelector("#grievance-open-case-form");
    bindSeverityButtons(form);

    const allegationField = form.querySelector('[name="allegation_type"]');
    const otherWrap = form.querySelector("#grievance-allegation-other-wrap");
    allegationField?.addEventListener("change", () => {
      if (otherWrap) otherWrap.hidden = allegationField.value !== "other";
    });

    const notificationField = form.querySelector('[name="acas_notification_date"]');
    const deadlinePreview = form.querySelector('[name="acas_deadline_preview"]');
    notificationField?.addEventListener("change", () => {
      if (deadlinePreview) deadlinePreview.value = calculateAcasDeadline(notificationField.value);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-status]");
      if (
        !window.confirm(
          "This will create an encrypted case record and start the ACAS timeline where applicable. Continue?"
        )
      ) {
        return;
      }
      if (status) status.textContent = "Opening case…";
      const payload = Object.fromEntries(new FormData(form).entries());
      const body = {
        employee_id: Number(payload.employee_id),
        allegation_type: payload.allegation_type,
        allegation_type_other: payload.allegation_type === "other" ? payload.allegation_type_other || null : null,
        date_received: payload.date_received,
        acas_notification_date: payload.acas_notification_date || null,
        severity: formState.severity,
        linked_absence_context: payload.linked_absence_context || null,
        is_anonymous_to_manager: Boolean(payload.is_anonymous_to_manager),
        assigned_investigator: payload.assigned_investigator || null,
        initial_note: payload.initial_note || null,
      };
      try {
        const res = await apiFetch("/grievance/cases", { method: "POST", body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Could not open case");
        form.reset();
        formState.severity = "medium";
        form.querySelector('[name="date_received"]').value = today;
        bindSeverityButtons(form);
        if (status) status.textContent = `Case ${data.case_reference} opened.`;
        await loadCases();
        await selectCase(data.id);
      } catch (error) {
        if (status) status.textContent = error.message || "Could not open case";
      }
    });

    host.dataset.mounted = "true";
  }

  function renderDetailEmptyState() {
    const empty = $("grievance-case-detail-empty");
    if (!empty) return;
    empty.removeAttribute("hidden");
    empty.innerHTML = emptyStateHtml({
      icon: "scale",
      title: "No case selected",
      message: "Select a case from the register to view ACAS deadlines and encrypted notes.",
      actionLabel: "Open case form",
      actionId: "grievance-detail-scroll-form",
      compact: true,
    });
    document.getElementById("grievance-detail-scroll-form")?.addEventListener("click", () => {
      $("grievance-case-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("grievance-case-form")?.querySelector("input, select, textarea")?.focus();
    });
  }

  async function initGrievanceSection() {
    await loadFormOptions();
    await loadEmployees();
    renderStatusWorkflow();
    renderDetailEmptyState();
    await loadInvestigators();
    mountCaseForm();
    await loadCases();
    renderMobileGrievanceShell();

    window.addEventListener("resize", () => {
      if (!sectionReady) return;
      syncGrievanceMobileDetailLayout();
    });
  }

  $("grievance-export-btn")?.addEventListener("click", async () => {
    try {
      await downloadAuthenticated("/grievance/cases/export", `grievance-cases-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      grievanceToast("Could not export cases.", "error");
    }
  });

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "grievance" && !sectionReady) {
      sectionReady = true;
      initGrievanceSection();
    }
  });

  if (parseHashBaseSection(window.location.hash) === "grievance") {
    sectionReady = true;
    initGrievanceSection();
  }
})();
