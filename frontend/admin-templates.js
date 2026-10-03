/** HR process templates — optional AI drafting via subscription add-on. */
(async function initAdminTemplates() {
  const { apiFetch, escapeHtml, downloadAuthenticated, parseHashBaseSection, isAddonEnabled, showAdminToast } = window.Admin;

  function templatesToast(message, variant = "info") {
    if (showAdminToast) showAdminToast(message, { variant });
    else window.ShiftSwiftAction?.showActionToast?.(message, variant === "error" ? "error" : "ok");
  }

  let controlsBound = false;
  let selectedId = null;
  let aiStatus = null;
  let listCache = [];
  let categoryFilter = "";
  let searchFilter = "";
  let previewTimer = null;

  const CATEGORY_ORDER = [
    "onboarding",
    "probation",
    "recruitment",
    "contracts",
    "policy",
    "compliance",
    "disciplinary",
    "offboarding",
  ];

  function categoryLabel(cat) {
    return String(cat || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function isMobileTemplatesUi() {
    if (!document.getElementById("mobile-tab-bar")) return false;
    return window.isShiftSwiftMobileViewport?.() ?? window.matchMedia("(max-width: 860px)").matches;
  }

  function editorIsOpen() {
    return !document.getElementById("template-editor-panel")?.hidden;
  }

  function populateMobileCategoryFilter() {
    const select = document.getElementById("templates-mobile-category-filter");
    if (!select) return;
    const categories = [...new Set(listCache.map((item) => item.category).filter(Boolean))].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    select.innerHTML =
      `<option value="">All categories</option>` +
      categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(categoryLabel(c))}</option>`).join("");
    select.value = categoryFilter;
  }

  function renderMobileTemplatesList() {
    const host = document.getElementById("templates-mobile-list");
    if (!host) return;
    const rows = filteredTemplates();
    if (!listCache.length) {
      host.innerHTML = `<p class="leave-mobile-empty muted">No HR templates seeded. Run scripts/seed_hr_templates.py.</p>`;
      return;
    }
    if (!rows.length) {
      host.innerHTML = `<p class="leave-mobile-empty muted">No templates match your filter.</p>`;
      return;
    }
    host.innerHTML = rows
      .map((row) => {
        const selected = selectedId === row.id ? " docs-mobile-card--selected" : "";
        return `<article class="leave-mobile-request-card docs-mobile-card${selected}" data-template-id="${escapeHtml(row.id)}">
          <div class="leave-mobile-request-card__head">
            <div class="leave-mobile-request-card__who">
              <strong>${escapeHtml(row.display_title)}</strong>
              <span>${escapeHtml(categoryLabel(row.category))} · v${escapeHtml(row.platform_version)}</span>
            </div>
            ${syncStatusPill(row)}
          </div>
          <p class="docs-mobile-card__desc muted">${escapeHtml(row.description || "")}</p>
          <div class="leave-mobile-request-card__actions">
            <button type="button" class="leave-mobile-action leave-mobile-action--approve" data-template-open="${escapeHtml(row.id)}">Open</button>
            <button type="button" class="leave-mobile-action" data-template-download="${escapeHtml(row.id)}">Download</button>
          </div>
        </article>`;
      })
      .join("");

    host.querySelectorAll("[data-template-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-template-open");
        selectTemplate(id);
        openEditor(id);
      });
    });
    host.querySelectorAll("[data-template-download]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        const id = btn.getAttribute("data-template-download");
        const item = listCache.find((t) => t.id === id);
        downloadHrTemplate(id, item?.is_customised ? "effective" : "platform", event.currentTarget);
      });
    });
  }

  function renderMobileTemplatesShell() {
    const shell = document.getElementById("templates-mobile-shell");
    if (!shell) return;
    if (!isMobileTemplatesUi()) {
      shell.hidden = true;
      return;
    }
    shell.hidden = editorIsOpen();
    if (shell.hidden) return;
    populateMobileCategoryFilter();
    renderMobileTemplatesList();
  }

  function templateDownloadFormat() {
    return document.getElementById("template-download-format")?.value || "pdf";
  }

  function templateDownloadExt(format) {
    if (format === "pdf") return "pdf";
    if (format === "doc" || format === "docx") return "docx";
    return "md";
  }

  async function downloadHrTemplate(templateId, variant, sourceBtn) {
    const format = templateDownloadFormat();
    const ext = templateDownloadExt(format);
    const action = async () => {
      await downloadAuthenticated(
        `/hr-templates/${templateId}/download?variant=${variant}&format=${format}`,
        `${templateId}.${ext}`,
      );
      return "Download started.";
    };
    const run = window.ShiftSwiftAction?.runButtonActionAuto;
    if (run && sourceBtn) {
      await run(sourceBtn, action, {
        loadingLabel: "Downloading…",
        successMessage: "Download started.",
        successLabel: "Done",
      });
      return;
    }
    try {
      await action();
      window.ShiftSwiftAction?.showActionToast?.("Download started.", "ok");
    } catch (error) {
      window.ShiftSwiftAction?.showActionToast?.(
        error?.message || "Could not download template. Try again or choose another format.",
        "error",
      );
    }
  }

  function syncStatusPill(item) {
    if (item.update_available) {
      return `<span class="status-pill status-warning">Update v${escapeHtml(item.platform_version)}</span>`;
    }
    if (item.is_customised) {
      return `<span class="status-pill status-ok">Custom copy</span>`;
    }
    return `<span class="status-pill status-ok">Platform latest</span>`;
  }

  function markdownToPreviewHtml(markdown) {
    const lines = String(markdown || "").split("\n");
    const out = [];
    let inUl = false;
    for (const line of lines) {
      const stripped = line.trim();
      if (stripped.startsWith("### ")) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        out.push(`<h3>${escapeHtml(stripped.slice(4))}</h3>`);
      } else if (stripped.startsWith("## ")) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        out.push(`<h2>${escapeHtml(stripped.slice(3))}</h2>`);
      } else if (stripped.startsWith("# ")) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        out.push(`<h1>${escapeHtml(stripped.slice(2))}</h1>`);
      } else if (stripped.startsWith("- [ ] ") || stripped.startsWith("- [x] ")) {
        if (!inUl) {
          out.push("<ul class=\"template-doc-preview__checklist\">");
          inUl = true;
        }
        const checked = stripped.startsWith("- [x] ");
        const text = stripped.slice(6);
        out.push(
          `<li class="template-doc-preview__check${checked ? " template-doc-preview__check--done" : ""}">${escapeHtml(text)}</li>`
        );
      } else if (stripped.startsWith("- ")) {
        if (!inUl) {
          out.push("<ul>");
          inUl = true;
        }
        out.push(`<li>${escapeHtml(stripped.slice(2))}</li>`);
      } else if (stripped.startsWith("|") && stripped.includes("---")) {
        continue;
      } else if (stripped.startsWith("|")) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        const cells = stripped
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => escapeHtml(c.trim()));
        out.push(`<p class="template-doc-preview__table-row">${cells.join(" · ")}</p>`);
      } else if (stripped === "---") {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        out.push("<hr />");
      } else if (!stripped) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
      } else {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        let text = escapeHtml(stripped);
        text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        text = text.replace(/_(.+?)_/g, "<em>$1</em>");
        out.push(`<p>${text}</p>`);
      }
    }
    if (inUl) out.push("</ul>");
    return out.join("\n") || "<p class=\"muted\">Nothing to preview yet.</p>";
  }

  function syncLivePreview() {
    const body = document.getElementById("template-body-input");
    const preview = document.getElementById("template-preview-output");
    const countEl = document.getElementById("template-word-count");
    if (!preview) return;
    const text = body?.value || "";
    preview.innerHTML = markdownToPreviewHtml(text);
    if (countEl) {
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      countEl.textContent = `${words} words`;
    }
  }

  function schedulePreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(syncLivePreview, 120);
  }

  function filteredTemplates() {
    const q = searchFilter.trim().toLowerCase();
    return listCache.filter((row) => {
      if (categoryFilter && row.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = `${row.display_title || ""} ${row.description || ""} ${row.category || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function populateCategoryFilter() {
    const select = document.getElementById("hr-templates-category-filter");
    if (!select) return;
    const categories = [...new Set(listCache.map((t) => t.category).filter(Boolean))];
    categories.sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    select.innerHTML =
      `<option value="">All categories</option>` +
      categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(categoryLabel(c))}</option>`).join("");
    select.value = categoryFilter;
  }

  function setEditorOpen(open) {
    const workspace = document.getElementById("templates-workspace");
    const side = document.getElementById("templates-side-panel");
    workspace?.classList.toggle("templates-workspace--editor-open", open);
    if (side) side.hidden = open;
  }

  function closeEditor() {
    const panel = document.getElementById("template-editor-panel");
    if (panel) panel.hidden = true;
    setEditorOpen(false);
    const status = document.getElementById("template-save-status");
    if (status) status.textContent = "";
    renderMobileTemplatesShell();
  }

  function renderUpdatesBanner(data) {
    const banner = document.getElementById("hr-template-updates-banner");
    if (!banner) return;
    const pending = Number(data.updates_pending || 0);
    if (!pending) {
      banner.hidden = true;
      banner.innerHTML = "";
      return;
    }
    banner.hidden = false;
    banner.className = "promo-result promo-result-message";
    banner.innerHTML = `
      <p><strong>${pending} template${pending === 1 ? "" : "s"}</strong> have a newer platform version (UK law / guidance update).
      Open a template and choose <strong>Apply platform update</strong>, or download platform latest without changing your saved copy.</p>`;
  }

  async function syncAiAddonNotice() {
    const notice = document.getElementById("templates-ai-addon-notice");
    if (!notice) return;
    if (isAddonEnabled("ai-document")) {
      notice.hidden = true;
      notice.innerHTML = "";
      return;
    }
    notice.hidden = false;
    notice.innerHTML = `
      <p><strong>AI document assistant</strong> is a subscription add-on at <strong>£10/month ex VAT</strong>.
      Add it under <a href="#settings/billing">Settings → Billing &amp; plan</a>, or
      <a href="#" data-brand-support-mailto="AI document assistant add-on">contact support</a>.</p>`;
    window.ShiftSwiftBrand?.applyBrandDom?.(notice);
  }

  async function loadAiStatus() {
    aiStatus = { available: false, addon_enabled: isAddonEnabled("ai-document") };
    if (!aiStatus.addon_enabled) {
      const aiPanel = document.getElementById("ai-assist-panel");
      if (aiPanel) aiPanel.setAttribute("hidden", "");
      return;
    }
    try {
      const res = await apiFetch("/ai/status");
      aiStatus = await res.json();
      if (!res.ok) throw new Error("Status unavailable");
    } catch {
      aiStatus = { available: false, addon_enabled: true };
    }
    const aiPanel = document.getElementById("ai-assist-panel");
    if (aiPanel && !aiStatus.available) aiPanel.setAttribute("hidden", "");
  }

  function renderTemplateSidePanel(item) {
    const empty = document.getElementById("templates-side-empty");
    const content = document.getElementById("templates-side-content");
    if (!content) return;
    if (!item) {
      empty?.removeAttribute("hidden");
      content.hidden = true;
      return;
    }
    empty?.setAttribute("hidden", "");
    content.hidden = false;
    const versionLine = item.is_customised
      ? `Your copy · platform latest v${escapeHtml(item.platform_version)}`
      : `Platform v${escapeHtml(item.platform_version)}`;
    content.innerHTML = `
      <div class="hr-detail-head">
        <div>
          <h3>${escapeHtml(item.display_title)}</h3>
          ${syncStatusPill(item)}
        </div>
      </div>
      <p class="muted">${escapeHtml(item.description || "")}</p>
      <dl class="hr-detail-grid">
        <div><dt>Category</dt><dd>${escapeHtml(categoryLabel(item.category))}</dd></div>
        <div><dt>Version</dt><dd>${versionLine}</dd></div>
        ${item.legal_basis ? `<div><dt>Legal basis</dt><dd>${escapeHtml(item.legal_basis)}</dd></div>` : ""}
        ${item.change_summary && item.update_available ? `<div><dt>Update</dt><dd>${escapeHtml(item.change_summary)}</dd></div>` : ""}
      </dl>
      <div class="hr-detail-foot">
        <button type="button" class="btn" id="templates-side-edit-btn">Edit document</button>
        <button type="button" class="btn ghost" id="templates-side-dl-platform-btn">Download latest</button>
        ${item.is_customised ? `<button type="button" class="btn ghost" id="templates-side-dl-copy-btn">Download my copy</button>` : ""}
      </div>`;
    content.querySelector("#templates-side-edit-btn")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openEditor(item.id);
    });
    content.querySelector("#templates-side-dl-platform-btn")?.addEventListener("click", (event) =>
      downloadHrTemplate(item.id, "platform", event.currentTarget),
    );
    content.querySelector("#templates-side-dl-copy-btn")?.addEventListener("click", (event) =>
      downloadHrTemplate(item.id, "effective", event.currentTarget),
    );
  }

  function selectTemplate(templateId) {
    selectedId = templateId;
    renderTemplateTable();
    if (!document.getElementById("template-editor-panel")?.hidden) return;
    renderTemplateSidePanel(listCache.find((t) => t.id === templateId));
  }

  function renderTemplateTable() {
    const tbody = document.getElementById("hr-templates-body");
    if (!tbody) return;
    const rows = filteredTemplates();
    if (!listCache.length) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="muted">No HR templates seeded. Run scripts/seed_hr_templates.py.</td></tr>';
      renderTemplateSidePanel(null);
      return;
    }
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">No templates match your filter.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((row) => {
        const selected = selectedId === row.id ? " hr-register-row--selected" : "";
        return `<tr class="hr-register-row${selected}" data-template-id="${escapeHtml(row.id)}">
          <td><strong>${escapeHtml(row.display_title)}</strong><div class="muted">${escapeHtml(row.description || "")}</div></td>
          <td>${escapeHtml(categoryLabel(row.category))}</td>
          <td>v${escapeHtml(row.platform_version)}</td>
          <td>${syncStatusPill(row)}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll(".hr-register-row").forEach((row) => {
      row.addEventListener("click", () => selectTemplate(row.dataset.templateId));
      row.addEventListener("dblclick", () => openEditor(row.dataset.templateId));
    });
    if (selectedId && !document.getElementById("template-editor-panel")?.hidden) return;
    if (selectedId) {
      renderTemplateSidePanel(listCache.find((t) => t.id === selectedId));
    }
    renderMobileTemplatesShell();
  }

  async function loadTemplateList() {
    const tbody = document.getElementById("hr-templates-body");
    if (!tbody) return;
    try {
      const res = await apiFetch("/hr-templates");
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      listCache = data.items || [];
      renderUpdatesBanner(data);
      populateCategoryFilter();
      renderTemplateTable();
      renderMobileTemplatesShell();
    } catch {
      listCache = [];
      tbody.innerHTML = '<tr><td colspan="4" class="muted">Could not load templates.</td></tr>';
      renderTemplateSidePanel(null);
      renderMobileTemplatesShell();
    }
  }

  function renderEditorMeta(tpl) {
    const meta = document.getElementById("template-editor-meta");
    const legal = document.getElementById("template-legal-meta");
    const notice = document.getElementById("template-update-notice");
    const applyBtn = document.getElementById("template-apply-update-btn");
    const dlMy = document.getElementById("template-download-btn");
    const dlPlatform = document.getElementById("template-download-platform-btn");
    const badges = document.getElementById("template-editor-badges");

    if (badges) {
      badges.innerHTML = `${syncStatusPill(tpl)} <span class="status-pill">${escapeHtml(categoryLabel(tpl.category))}</span>`;
    }

    if (meta) {
      if (tpl.is_customised) {
        meta.textContent = `Your customised copy · based on platform v${tpl.based_on_platform_version || "?"} · platform latest is v${tpl.platform_version}`;
      } else {
        meta.textContent = `Platform latest v${tpl.platform_version}${tpl.published_at ? ` · published ${tpl.published_at.slice(0, 10)}` : ""}`;
      }
    }

    if (legal) {
      const parts = [];
      if (tpl.legal_basis) parts.push(`<strong>Legal / guidance:</strong> ${escapeHtml(tpl.legal_basis)}`);
      if (tpl.change_summary) parts.push(`<strong>Latest change:</strong> ${escapeHtml(tpl.change_summary)}`);
      legal.innerHTML = parts.join("<br />") || "";
      legal.hidden = !parts.length;
    }

    if (notice && applyBtn) {
      if (tpl.update_available) {
        notice.hidden = false;
        notice.className = "promo-result promo-result-message template-editor__notice";
        notice.innerHTML = `<p>Platform update <strong>v${escapeHtml(tpl.platform_version)}</strong> is available. ${escapeHtml(tpl.change_summary || "Review platform latest before applying.")}</p>`;
        applyBtn.hidden = false;
      } else {
        notice.hidden = true;
        notice.innerHTML = "";
        applyBtn.hidden = true;
      }
    }

    if (dlMy) dlMy.hidden = !tpl.is_customised;
    if (dlPlatform) dlPlatform.hidden = false;

    const revPanel = document.getElementById("template-revisions-panel");
    const revList = document.getElementById("template-revisions-list");
    const revisions = tpl.revisions || [];
    if (revPanel && revList) {
      if (revisions.length) {
        revPanel.hidden = false;
        revList.innerHTML = revisions
          .map(
            (rev) =>
              `<li><strong>v${escapeHtml(rev.version)}</strong>${rev.published_at ? ` · ${escapeHtml(rev.published_at.slice(0, 10))}` : ""}${rev.change_summary ? ` — ${escapeHtml(rev.change_summary)}` : ""}</li>`
          )
          .join("");
      } else {
        revPanel.hidden = true;
        revList.innerHTML = "";
      }
    }
  }

  async function openEditor(templateId) {
    selectedId = templateId;
    renderTemplateTable();
    const panel = document.getElementById("template-editor-panel");
    if (!panel) return;

    panel.hidden = false;
    setEditorOpen(true);
    renderMobileTemplatesShell();
    panel.scrollIntoView({ behavior: "smooth", block: "start" });

    const titleEl = document.getElementById("template-editor-title");
    const status = document.getElementById("template-save-status");
    if (titleEl) titleEl.textContent = "Loading document…";
    if (status) status.textContent = "Loading…";

    try {
      const res = await apiFetch(`/hr-templates/${templateId}`);
      const tpl = await res.json();
      if (!res.ok) throw new Error(tpl.detail || "Could not load template");
      document.getElementById("template-editor-title").textContent = tpl.title;
      document.getElementById("template-title-input").value = tpl.title;
      document.getElementById("template-body-input").value = tpl.content_markdown || "";
      document.getElementById("ai-template-id").value = templateId;
      renderEditorMeta(tpl);
      const aiPanel = document.getElementById("ai-assist-panel");
      if (aiPanel && aiStatus?.available) aiPanel.removeAttribute("hidden");
      syncLivePreview();
      if (status) status.textContent = "Changes are saved to your business copy only — platform templates update on deploy.";
    } catch (error) {
      if (status) status.textContent = error.message || "Could not load template";
    }
  }

  async function saveTemplate() {
    if (!selectedId) return;
    const title = document.getElementById("template-title-input").value;
    const content = document.getElementById("template-body-input").value;
    const status = document.getElementById("template-save-status");
    if (status) status.textContent = "Saving…";
    const res = await apiFetch(`/hr-templates/${selectedId}`, {
      method: "PUT",
      body: JSON.stringify({ title, content_markdown: content }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (status) status.textContent = data.detail || "Save failed";
      return;
    }
    if (status) status.textContent = "Saved — your customised copy is active.";
    await loadTemplateList();
    await openEditor(selectedId);
  }

  async function applyPlatformUpdate() {
    if (!selectedId) return;
    if (
      !window.confirm(
        "Replace your custom text with the latest platform template? You can still reset or edit afterwards."
      )
    ) {
      return;
    }
    const res = await apiFetch(`/hr-templates/${selectedId}/apply-platform-update`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      templatesToast(data.detail || "Update failed", "error");
      return;
    }
    await loadTemplateList();
    await openEditor(selectedId);
  }

  async function resetTemplate() {
    if (!selectedId || !window.confirm("Reset to platform default? Your custom text will be removed.")) return;
    const res = await apiFetch(`/hr-templates/${selectedId}/reset`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      templatesToast(err.detail || "Reset failed", "error");
      return;
    }
    await loadTemplateList();
    await openEditor(selectedId);
  }

  async function runAiDraft() {
    const prompt = document.getElementById("ai-prompt-input").value.trim();
    const context = document.getElementById("ai-context-input").value.trim();
    const existing = document.getElementById("template-body-input").value;
    const status = document.getElementById("ai-draft-status");
    if (!prompt) {
      if (status) status.textContent = "Enter a brief for the AI.";
      return;
    }
    if (status) status.textContent = "Generating…";
    const res = await apiFetch("/ai/draft-document", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        template_id: selectedId || document.getElementById("ai-template-id").value || null,
        business_context: context || null,
        existing_draft: existing || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (status) status.textContent = data.detail || "AI request failed";
      return;
    }
    document.getElementById("template-body-input").value = data.content_markdown;
    syncLivePreview();
    if (status) status.textContent = `${data.disclaimer} (${data.provider}/${data.model}) — review before saving.`;
  }

  function bindControls() {
    if (controlsBound) return;
    controlsBound = true;

    document.getElementById("hr-templates-category-filter")?.addEventListener("change", (e) => {
      categoryFilter = e.target.value;
      const mobileFilter = document.getElementById("templates-mobile-category-filter");
      if (mobileFilter) mobileFilter.value = categoryFilter;
      renderTemplateTable();
    });

    document.getElementById("hr-templates-search")?.addEventListener("input", (e) => {
      searchFilter = e.target.value;
      const mobileSearch = document.getElementById("templates-mobile-search");
      if (mobileSearch) mobileSearch.value = searchFilter;
      renderTemplateTable();
    });

    document.getElementById("templates-mobile-category-filter")?.addEventListener("change", (e) => {
      categoryFilter = e.target.value;
      const desktopFilter = document.getElementById("hr-templates-category-filter");
      if (desktopFilter) desktopFilter.value = categoryFilter;
      renderTemplateTable();
    });

    document.getElementById("templates-mobile-search")?.addEventListener("input", (e) => {
      searchFilter = e.target.value;
      const desktopSearch = document.getElementById("hr-templates-search");
      if (desktopSearch) desktopSearch.value = searchFilter;
      renderTemplateTable();
    });

    window.addEventListener("resize", () => {
      if (!controlsBound) return;
      renderMobileTemplatesShell();
    });

    document.getElementById("template-body-input")?.addEventListener("input", schedulePreview);
    document.getElementById("template-title-input")?.addEventListener("input", () => {
      const title = document.getElementById("template-title-input")?.value;
      const head = document.getElementById("template-editor-title");
      if (head && title) head.textContent = title;
    });

    document.getElementById("template-save-btn")?.addEventListener("click", () => saveTemplate());
    document.getElementById("template-reset-btn")?.addEventListener("click", () => resetTemplate());
    document.getElementById("template-apply-update-btn")?.addEventListener("click", () => applyPlatformUpdate());
    document.getElementById("template-download-btn")?.addEventListener("click", (event) => {
      if (selectedId) downloadHrTemplate(selectedId, "effective", event.currentTarget);
    });
    document.getElementById("template-download-platform-btn")?.addEventListener("click", (event) => {
      if (selectedId) downloadHrTemplate(selectedId, "platform", event.currentTarget);
    });
    document.getElementById("ai-draft-btn")?.addEventListener("click", () => runAiDraft());
    document.getElementById("template-editor-close")?.addEventListener("click", () => closeEditor());
  }

  async function initTemplatesSection() {
    bindControls();
    await window.Admin.loadTenantFeatures?.();
    await syncAiAddonNotice();
    await loadAiStatus();
    await loadTemplateList();
    renderMobileTemplatesShell();
    const pendingId = sessionStorage.getItem("templatesOpenId");
    if (pendingId) {
      sessionStorage.removeItem("templatesOpenId");
      selectTemplate(pendingId);
      await openEditor(pendingId);
    }
  }

  window.__openHrTemplateEditor = openEditor;

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "templates") initTemplatesSection();
  });

  if (parseHashBaseSection(window.location.hash) === "templates") initTemplatesSection();
})();
