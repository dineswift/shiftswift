/** Disciplinary case management — encrypted notes and hearing outcomes. */
(function () {
  const { apiFetch, loadFormOptions, loadEmployees, mountEditForm, renderTableBody, FORM_SCHEMAS, escapeHtml, downloadAuthenticated, parseHashBaseSection, emptyStateHtml, showAdminToast } = window.Admin;

  function disciplinaryToast(message, variant = "info") {
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

  function isMobileDisciplinaryUi() {
    if (!document.getElementById("mobile-tab-bar")) return false;
    return window.isShiftSwiftMobileViewport?.() ?? window.matchMedia("(max-width: 860px)").matches;
  }

  function syncDisciplinaryMobileDetailLayout() {
    const section = $("disciplinary");
    if (!section) return;
    const showDetail = isMobileDisciplinaryUi() && Boolean(selectedCaseId);
    section.classList.toggle("disciplinary-mobile-detail-open", showDetail);
    renderMobileDisciplinaryShell();
  }

  function renderMobileDisciplinaryShell() {
    const shell = $("disciplinary-mobile-shell");
    if (!shell) return;
    const detailOpen = $("disciplinary")?.classList.contains("disciplinary-mobile-detail-open");
    if (!isMobileDisciplinaryUi() || detailOpen) {
      shell.hidden = true;
      return;
    }
    shell.hidden = false;
    renderMobileDisciplinaryCards();
  }

  function renderMobileDisciplinaryCards() {
    const host = $("disciplinary-mobile-cards");
    const heading = $("disciplinary-mobile-cases-heading");
    if (!host) return;

    const openCases = cases.filter((row) => row.status !== "closed");
    if (heading) heading.textContent = `Open cases (${openCases.length})`;

    if (!openCases.length) {
      host.innerHTML = `<p class="leave-mobile-empty muted">No open disciplinary cases.</p>`;
      return;
    }

    host.innerHTML = openCases
      .map((row) => {
        const canClose = row.status !== "closed";
        return `<article class="leave-mobile-request-card" data-disciplinary-id="${row.id}">
          <div class="leave-mobile-request-card__head admin-mobile-case-card__tap" data-disciplinary-open="${row.id}" role="button" tabindex="0">
            <div class="leave-mobile-request-card__who">
              <strong>${escapeHtml(row.case_reference)}</strong>
              <span>${escapeHtml(row.employee_name || row.employee_id)} · ${escapeHtml(misconductLabel(row))}</span>
            </div>
            ${statusBadge(row.status, row.status_label)}
          </div>
          <div class="leave-mobile-request-card__meta">
            <span>${severityBadge(row.severity)}</span>
            <span>${escapeHtml((row.date_reported || "").slice(0, 10) || "—")}</span>
          </div>
          <div class="leave-mobile-request-card__actions">
            <button type="button" class="leave-mobile-action leave-mobile-action--approve" data-disciplinary-open-btn="${row.id}">Open</button>
            ${canClose ? `<button type="button" class="leave-mobile-action leave-mobile-action--decline" data-disciplinary-close="${row.id}">Close case</button>` : ""}
          </div>
        </article>`;
      })
      .join("");

    host.querySelectorAll("[data-disciplinary-open]").forEach((el) => {
      const open = () => void selectCase(Number(el.dataset.disciplinaryOpen));
      el.addEventListener("click", open);
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
    host.querySelectorAll("[data-disciplinary-open-btn]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        void selectCase(Number(btn.dataset.disciplinaryOpenBtn));
      });
    });
    host.querySelectorAll("[data-disciplinary-close]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        void closeCase(Number(btn.dataset.disciplinaryClose));
      });
    });
  }

  function renderStatusWorkflow(caseData) {
    const host = $("disciplinary-status-workflow");
    if (!host) return;
    const steps = window.Admin.formOptions?.disciplinary_status_workflow || [
      { label: "Investigation" },
      { label: "Disciplinary hearing" },
      { label: "Appeal" },
      { label: "Closed" },
    ];
    const timeline = caseData?.timeline || [];
    host.innerHTML = `<div class="disciplinary-workflow-pipeline">${steps
      .map((step, index) => {
        const tl = timeline[index];
        const state =
          tl?.state === "done" ? "done" : tl?.state === "current" ? "active" : "pending";
        const stepClass =
          state === "pending"
            ? "disciplinary-workflow-step"
            : `disciplinary-workflow-step disciplinary-workflow-step--${state}`;
        const connector =
          index < steps.length - 1 ? '<span class="disciplinary-workflow-connector" aria-hidden="true"></span>' : "";
        return `<div class="${stepClass}">
          <span class="disciplinary-workflow-step__num">${index + 1}</span>
          <span class="disciplinary-workflow-step__label">${escapeHtml(step.label)}</span>
        </div>${connector}`;
      })
      .join("")}</div>`;
  }

  function caseStats() {
    const open = cases.filter((c) => c.status !== "closed").length;
    const investigation = cases.filter((c) => c.status === "investigation").length;
    const hearing = cases.filter((c) => c.status === "hearing" || c.status === "appeal").length;
    const closed = cases.filter((c) => c.status === "closed").length;
    const critical = cases.filter((c) => c.severity === "critical" && c.status !== "closed").length;
    return { open, investigation, hearing, closed, critical, total: cases.length };
  }

  function renderStats() {
    const grid = $("disciplinary-stats-grid");
    if (!grid) return;
    const stats = caseStats();
    grid.hidden = false;
    $("disciplinary-stat-open").textContent = String(stats.open);
    $("disciplinary-stat-investigation").textContent = String(stats.investigation);
    $("disciplinary-stat-hearing").textContent = String(stats.hearing);
    $("disciplinary-stat-closed").textContent = String(stats.closed);
    const openSub = $("disciplinary-stat-open-sub");
    if (openSub) {
      openSub.textContent = stats.open ? "Need attention or closure" : "No open cases";
    }
    const invSub = $("disciplinary-stat-investigation-sub");
    if (invSub) {
      invSub.textContent = stats.investigation ? "Gathering evidence" : "None in investigation";
    }
    const hearSub = $("disciplinary-stat-hearing-sub");
    if (hearSub) {
      hearSub.textContent = stats.hearing ? "Hearing or appeal stage" : "None at hearing";
    }
    const closedSub = $("disciplinary-stat-closed-sub");
    if (closedSub) {
      closedSub.textContent = stats.closed ? "Outcome recorded" : "None closed yet";
    }
    $("disciplinary-stat-investigation-card")?.classList.toggle("hr-stat-card--warn", stats.critical > 0);
    if (stats.critical > 0 && invSub) {
      invSub.textContent = stats.investigation
        ? `${stats.investigation} in investigation · ${stats.critical} critical`
        : `${stats.critical} critical severity open`;
    }
  }

  function updateRegisterSub() {
    const sub = $("disciplinary-register-sub");
    if (!sub) return;
    if (!cases.length) {
      sub.textContent = "No cases yet — open one using the form above.";
      return;
    }
    const stats = caseStats();
    sub.textContent = `${stats.total} case${stats.total === 1 ? "" : "s"} · ${stats.open} open · ${stats.closed} closed`;
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
        $("disciplinary-open-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    renderMobileDisciplinaryShell();
  }

  async function loadCases() {
    try {
      const res = await apiFetch("/disciplinary/cases");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      cases = data.items || [];
      renderCasesTable();
      renderStats();
      updateRegisterSub();
      updateNextReferencePreview();
      renderMobileDisciplinaryShell();
    } catch {
      cases = [];
      renderCasesTable();
      renderStats();
      updateRegisterSub();
      renderMobileDisciplinaryShell();
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
      <header class="disciplinary-detail-hero">
        <div class="disciplinary-detail-hero__badge" aria-hidden="true">⚖</div>
        <div class="disciplinary-detail-hero__body">
          <h3 class="disciplinary-detail-hero__title">${escapeHtml(caseData.case_reference)}</h3>
          <div class="disciplinary-detail-hero__meta">
            ${statusBadge(caseData.status, caseData.status_label)}
            ${severityBadge(caseData.severity)}
          </div>
        </div>
      </header>
      <div class="disciplinary-detail-metrics">
        <div class="disciplinary-detail-metric">
          <span class="disciplinary-detail-metric__label">Employee</span>
          <span class="disciplinary-detail-metric__value">${escapeHtml(caseData.employee_name || String(caseData.employee_id))}</span>
        </div>
        <div class="disciplinary-detail-metric">
          <span class="disciplinary-detail-metric__label">Reported</span>
          <span class="disciplinary-detail-metric__value">${escapeHtml((caseData.date_reported || "").slice(0, 10) || "—")}</span>
        </div>
        <div class="disciplinary-detail-metric">
          <span class="disciplinary-detail-metric__label">Investigator</span>
          <span class="disciplinary-detail-metric__value">${escapeHtml(caseData.assigned_investigator || "Not set")}</span>
        </div>
      </div>
      <dl class="disciplinary-detail-grid">
        <div><dt>Department</dt><dd>${escapeHtml(caseData.employee_department || "Not set")}</dd></div>
        <div><dt>Misconduct</dt><dd>${escapeHtml(misconductLabel(caseData))}</dd></div>
      </dl>
      <div class="disciplinary-timeline-wrap">
        <h5 class="disciplinary-section-label">Procedure timeline</h5>
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
      </div>
      <div class="hr-surface-panel disciplinary-notes-panel">
        <h4 class="hr-section-title">Encrypted notes</h4>
        <div id="disciplinary-note-form"></div>
        <div class="hr-table-wrap">
          <table class="data-table data-table--compact">
            <thead><tr><th>Type</th><th>Author</th><th>When</th><th>Note</th></tr></thead>
            <tbody id="disciplinary-notes-body"></tbody>
          </table>
        </div>
      </div>
      <div class="grievance-detail-foot disciplinary-detail-foot">
        <button type="button" class="btn ghost" id="disciplinary-add-note-btn">Add note</button>
        <button type="button" class="btn primary" id="disciplinary-close-btn" ${caseData.status === "closed" ? "disabled" : ""}>Close case</button>
      </div>`;

    renderStatusWorkflow(caseData);

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
    syncDisciplinaryMobileDetailLayout();
    const content = $("disciplinary-case-detail-content");
    const empty = $("disciplinary-case-detail-empty");
    if (empty) empty.setAttribute("hidden", "");
    if (content) {
      content.hidden = false;
      content.innerHTML = `<p class="muted">Loading case…</p>`;
    }
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
      disciplinaryToast(err.detail || "Could not close case", "error");
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
          <p class="disciplinary-form-hint">Opening a case creates an encrypted record and audit trail.</p>
        </div>
        <div class="edit-form-actions" data-span="2">
          <button type="submit" class="btn primary">Open disciplinary case</button>
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
    const content = $("disciplinary-case-detail-content");
    if (content) content.hidden = true;
    if (!empty) return;
    empty.removeAttribute("hidden");
    renderStatusWorkflow(null);
    empty.innerHTML = emptyStateHtml({
      icon: "clipboard",
      title: "No case selected",
      message: "Select a case from the register to view investigation details and encrypted notes.",
      actionLabel: "Open case form",
      actionId: "disciplinary-detail-scroll-form",
      compact: true,
    });
    document.getElementById("disciplinary-detail-scroll-form")?.addEventListener("click", () => {
      $("disciplinary-open-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    renderMobileDisciplinaryShell();

    window.addEventListener("resize", () => {
      if (!sectionReady) return;
      syncDisciplinaryMobileDetailLayout();
    });
  }

  $("disciplinary-export-btn")?.addEventListener("click", async () => {
    try {
      await downloadAuthenticated(
        "/disciplinary/cases/export",
        `disciplinary-cases-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch {
      disciplinaryToast("Could not export cases.", "error");
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
