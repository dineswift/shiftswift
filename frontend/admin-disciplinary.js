/** Disciplinary case management — encrypted notes and hearing outcomes. */
(function () {
  const { apiFetch, loadFormOptions, loadEmployees, mountEditForm, renderTableBody, FORM_SCHEMAS, escapeHtml, downloadAuthenticated, parseHashBaseSection, emptyStateHtml } = window.Admin;

  let selectedCaseId = null;
  let sectionReady = false;
  let cases = [];
  let investigators = [];
  let formState = { severity: "medium" };

  function $(id) {
    return document.getElementById(id);
  }

  function misconductLabel(row) {
    return row.misconduct_type_label || row.misconduct_type || "Not set";
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
    const text = label || status || "investigation";
    const cls =
      status === "closed"
        ? "grievance-status-pill--resolved"
        : status === "hearing"
          ? "grievance-status-pill--acas"
          : "grievance-status-pill--investigating";
    return `<span class="grievance-status-pill ${cls}">${escapeHtml(text)}</span>`;
  }

  function renderStatusWorkflow() {
    const host = $("disciplinary-status-workflow");
    if (!host) return;
    const steps = window.Admin.formOptions?.disciplinary_status_workflow || [
      { label: "Investigation" },
      { label: "Disciplinary hearing" },
      { label: "Appeal" },
      { label: "Closed" },
    ];
    host.innerHTML = steps
      .map(
        (step, index) =>
          `<span class="grievance-workflow-step">${escapeHtml(step.label)}</span>${index < steps.length - 1 ? '<span class="grievance-workflow-arrow" aria-hidden="true">→</span>' : ""}`
      )
      .join("");
  }

  function renderCasesTable() {
    const tbody = $("disciplinary-cases-body");
    if (!tbody) return;
    if (!cases.length) {
      tbody.innerHTML = `<tr class="admin-empty-state-row"><td colspan="5">${emptyStateHtml({
        icon: "clipboard",
        title: "No disciplinary cases",
        message: "Log a matter using the form above — investigation notes are encrypted.",
        actionLabel: "Open case form",
        actionId: "disciplinary-scroll-form-btn",
        compact: true,
      })}</td></tr>`;
      document.getElementById("disciplinary-scroll-form-btn")?.addEventListener("click", () => {
        $("disciplinary-case-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
        $("disciplinary-case-form")?.querySelector("input, select, textarea")?.focus();
      });
      return;
    }
    tbody.innerHTML = cases
      .map((row) => {
        const selected = selectedCaseId === row.id ? " grievance-case-row--selected" : "";
        return `<tr class="grievance-case-row${selected}" data-row-id="${row.id}">
          <td><strong>${escapeHtml(row.case_reference)}</strong><div class="muted">${escapeHtml((row.date_reported || "").slice(0, 10) || "")}</div></td>
          <td>${escapeHtml(row.employee_name || row.employee_id)}<div class="muted">${escapeHtml(row.employee_department || "")}</div></td>
          <td>${escapeHtml(misconductLabel(row))}</td>
          <td>${severityBadge(row.severity)}</td>
          <td>${statusBadge(row.status, row.status_label)}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".grievance-case-row").forEach((row) => {
      row.addEventListener("click", () => selectCase(Number(row.dataset.rowId)));
    });
  }

  async function loadCases() {
    try {
      const res = await apiFetch("/disciplinary/cases");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      cases = data.items || [];
      renderCasesTable();
      updateNextReferencePreview();
    } catch {
      cases = [];
      renderCasesTable();
    }
  }

  function updateNextReferencePreview() {
    const el = $("disciplinary-next-ref");
    if (!el) return;
    const year = new Date().getFullYear();
    const next = String((cases.filter((c) => (c.case_reference || "").startsWith(`DIS-${year}-`)).length || 0) + 1).padStart(3, "0");
    el.textContent = `Reference will be assigned automatically (e.g. DIS-${year}-${next})`;
  }

  async function loadInvestigators() {
    try {
      const res = await apiFetch("/disciplinary/investigators");
      if (!res.ok) return;
      const data = await res.json();
      investigators = data.items || [];
    } catch {
      investigators = [];
    }
  }

  function renderDetailPanel(caseData, notes) {
    const empty = $("disciplinary-case-detail-empty");
    const content = $("disciplinary-case-detail-content");
    if (!content) return;
    empty?.setAttribute("hidden", "");
    content.hidden = false;

    content.innerHTML = `
      <div class="grievance-detail-head">
        <div>
          <h3>${escapeHtml(caseData.case_reference)}</h3>
          ${statusBadge(caseData.status, caseData.status_label)}
        </div>
      </div>
      <dl class="grievance-detail-grid">
        <div><dt>Employee</dt><dd>${escapeHtml(caseData.employee_name || caseData.employee_id)} · ${escapeHtml(caseData.employee_department || "Not set")}</dd></div>
        <div><dt>Misconduct</dt><dd>${escapeHtml(misconductLabel(caseData))}</dd></div>
        <div><dt>Severity</dt><dd>${severityBadge(caseData.severity)}</dd></div>
        <div><dt>Date reported</dt><dd>${escapeHtml(caseData.date_reported || "Not set")}</dd></div>
        <div><dt>Investigator</dt><dd>${escapeHtml(caseData.assigned_investigator || "Not assigned")}</dd></div>
      </dl>
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
        <div id="disciplinary-note-form"></div>
        <div class="hr-table-wrap">
          <table class="data-table">
            <thead><tr><th>Type</th><th>Author</th><th>When</th><th>Note</th></tr></thead>
            <tbody id="disciplinary-notes-body"></tbody>
          </table>
        </div>
      </div>
      <div class="grievance-detail-foot">
        <button type="button" class="btn ghost" id="disciplinary-add-note-btn">Add note</button>
        <button type="button" class="btn" id="disciplinary-close-btn" ${caseData.status === "closed" ? "disabled" : ""}>Close case</button>
      </div>`;

    renderTableBody(content.querySelector("#disciplinary-notes-body"), {
      emptyMessage: "No encrypted notes yet.",
      columns: [
        { key: "note_type", render: (r) => escapeHtml(r.note_type) },
        { key: "created_by", render: (r) => escapeHtml(r.created_by) },
        { key: "created_at", render: (r) => escapeHtml((r.created_at || "").slice(0, 16)) },
        { key: "body", render: (r) => escapeHtml(r.body || "") },
      ],
      rows: notes,
    });

    mountNoteForm(content.querySelector("#disciplinary-note-form"));
    content.querySelector("#disciplinary-close-btn")?.addEventListener("click", () => closeCase(caseData.id));
    content.querySelector("#disciplinary-add-note-btn")?.addEventListener("click", () => {
      content.querySelector("#disciplinary-note-form textarea")?.focus();
    });
  }

  async function selectCase(caseId) {
    selectedCaseId = caseId;
    renderCasesTable();
    const content = $("disciplinary-case-detail-content");
    if (content) content.innerHTML = `<p class="muted">Loading case…</p>`;
    try {
      const [caseRes, notesRes] = await Promise.all([
        apiFetch(`/disciplinary/cases/${caseId}`),
        apiFetch(`/disciplinary/cases/${caseId}/notes`),
      ]);
      const caseData = await caseRes.json();
      const notesData = notesRes.ok ? await notesRes.json() : { items: [] };
      if (!caseRes.ok) throw new Error(caseData.detail || "Load failed");
      renderDetailPanel(caseData, notesData.items || []);
    } catch (error) {
      if (content) content.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load case.")}</p>`;
    }
  }

  async function closeCase(caseId) {
    const outcome = window.prompt(
      "Close outcome (no_action / written_warning / final_warning / dismissal / withdrawn):",
      "written_warning"
    );
    if (!outcome) return;
    const res = await apiFetch(`/disciplinary/cases/${caseId}/close`, {
      method: "POST",
      body: JSON.stringify({ close_outcome: outcome }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail || "Could not close case");
      return;
    }
    await loadCases();
    await selectCase(caseId);
  }

  function mountNoteForm(host) {
    if (!host || !selectedCaseId) return;
    mountEditForm(host, FORM_SCHEMAS.disciplinaryNote, {
      onSubmit: async (payload) => {
        const res = await apiFetch(`/disciplinary/cases/${selectedCaseId}/notes`, {
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
    const host = $("disciplinary-case-form");
    if (!host || host.dataset.mounted === "true") return;

    const misconductTypes = window.Admin.formOptions?.disciplinary_misconduct_types || [];
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
      <form id="disciplinary-open-case-form" class="edit-form edit-form--cols-2">
        <label class="edit-field"><span class="edit-label">Employee</span><select name="employee_id" required>${employeeOptions}</select></label>
        <label class="edit-field"><span class="edit-label">Date reported</span><input name="date_reported" type="date" required value="${today}" /></label>
        <label class="edit-field"><span class="edit-label">Misconduct type</span><select name="misconduct_type" required>${misconductTypes.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join("")}</select></label>
        <label class="edit-field" id="disciplinary-misconduct-other-wrap" hidden><span class="edit-label">Describe misconduct</span><input name="misconduct_type_other" type="text" placeholder="Brief description" /></label>
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
        <label class="edit-field" data-span="2"><span class="edit-label">Context (optional)</span><textarea name="linked_absence_context" rows="2" placeholder="Optional. Links to attendance or sponsor absence monitoring."></textarea></label>
        <label class="edit-field" data-span="2"><span class="edit-label">Initial investigation note (encrypted)</span><textarea name="initial_note" rows="4" placeholder="Capture the first account while details are fresh."></textarea></label>
        <div class="edit-field" data-span="2">
          <p class="employee-section-hint employee-section-hint--warn">Opening a case creates an encrypted record and audit trail.</p>
        </div>
        <div class="edit-form-actions" data-span="2">
          <button type="submit" class="btn">Open disciplinary case</button>
          <p class="edit-form-status muted" data-status></p>
        </div>
      </form>`;

    const form = host.querySelector("#disciplinary-open-case-form");
    bindSeverityButtons(form);

    const misconductField = form.querySelector('[name="misconduct_type"]');
    const otherWrap = form.querySelector("#disciplinary-misconduct-other-wrap");
    misconductField?.addEventListener("change", () => {
      if (otherWrap) otherWrap.hidden = misconductField.value !== "other";
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-status]");
      if (!window.confirm("This will create an encrypted disciplinary case record. Continue?")) {
        return;
      }
      if (status) status.textContent = "Opening case…";
      const payload = Object.fromEntries(new FormData(form).entries());
      const body = {
        employee_id: Number(payload.employee_id),
        misconduct_type: payload.misconduct_type,
        misconduct_type_other: payload.misconduct_type === "other" ? payload.misconduct_type_other || null : null,
        date_reported: payload.date_reported,
        severity: formState.severity,
        linked_absence_context: payload.linked_absence_context || null,
        assigned_investigator: payload.assigned_investigator || null,
        initial_note: payload.initial_note || null,
      };
      try {
        const res = await apiFetch("/disciplinary/cases", { method: "POST", body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Could not open case");
        form.reset();
        formState.severity = "medium";
        form.querySelector('[name="date_reported"]').value = today;
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
    const empty = $("disciplinary-case-detail-empty");
    if (!empty) return;
    empty.removeAttribute("hidden");
    empty.innerHTML = emptyStateHtml({
      icon: "clipboard",
      title: "No case selected",
      message: "Select a case from the register to view hearing details and encrypted notes.",
      actionLabel: "Open case form",
      actionId: "disciplinary-detail-scroll-form",
      compact: true,
    });
    document.getElementById("disciplinary-detail-scroll-form")?.addEventListener("click", () => {
      $("disciplinary-case-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("disciplinary-case-form")?.querySelector("input, select, textarea")?.focus();
    });
  }

  async function initDisciplinarySection() {
    await loadFormOptions();
    await loadEmployees();
    renderStatusWorkflow();
    renderDetailEmptyState();
    await loadInvestigators();
    mountCaseForm();
    await loadCases();
  }

  $("disciplinary-export-btn")?.addEventListener("click", async () => {
    try {
      await downloadAuthenticated(
        "/disciplinary/cases/export",
        `disciplinary-cases-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch {
      alert("Could not export cases.");
    }
  });

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "disciplinary" && !sectionReady) {
      sectionReady = true;
      initDisciplinarySection();
    }
  });

  if (parseHashBaseSection(window.location.hash) === "disciplinary") {
    sectionReady = true;
    initDisciplinarySection();
  }
})();
