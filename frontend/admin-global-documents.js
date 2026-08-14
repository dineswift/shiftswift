/** Platform global documents — Word & Excel downloads for all tenants. */
(function initGlobalDocuments() {
  const { apiFetch, escapeHtml, downloadAuthenticated } = window.Admin;

  let listCache = [];
  let categoryFilter = "";
  let searchFilter = "";
  let controlsBound = false;

  function formatBadge(item) {
    const label = item.format_label || String(item.file_format || "").toUpperCase();
    const tone = item.file_format === "csv" ? "status-info" : "status-ok";
    return `<span class="status-pill ${tone}">${escapeHtml(label)}</span>`;
  }

  function filteredItems() {
    const q = searchFilter.trim().toLowerCase();
    return listCache.filter((item) => {
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = `${item.title} ${item.description} ${item.category_label}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderGrid() {
    const host = document.getElementById("global-documents-grid");
    if (!host) return;
    const items = filteredItems();
    if (!items.length) {
      host.innerHTML = listCache.length
        ? '<p class="leave-mobile-empty muted">No downloads match your filters.</p>'
        : '<p class="leave-mobile-empty muted">No global downloads available yet.</p>';
      return;
    }
    host.innerHTML = items
      .map(
        (item) => `<article class="global-document-card" data-global-doc-id="${escapeHtml(item.id)}">
        <div class="global-document-card__head">
          <h3 class="global-document-card__title">${escapeHtml(item.title)}</h3>
          ${formatBadge(item)}
        </div>
        <p class="global-document-card__desc muted">${escapeHtml(item.description)}</p>
        <div class="global-document-card__meta">
          <span class="global-document-card__category">${escapeHtml(item.category_label)}</span>
        </div>
        <button type="button" class="btn primary btn--sm global-document-card__download" data-download-global-doc="${escapeHtml(item.id)}">
          Download
        </button>
      </article>`,
      )
      .join("");

    host.querySelectorAll("[data-download-global-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const docId = btn.getAttribute("data-download-global-doc");
        const item = listCache.find((row) => row.id === docId);
        const filename = item?.filename || `${docId}.bin`;
        const run = window.ShiftSwiftAction?.runButtonActionAuto;
        const action = async () => {
          await downloadAuthenticated(`/global-documents/${docId}/download`, filename);
          return "Download started.";
        };
        if (run) {
          await run(btn, action, {
            loadingLabel: "Downloading…",
            successMessage: "Download started.",
            successLabel: "Downloaded",
          });
          return;
        }
        btn.disabled = true;
        try {
          await action();
        } catch (error) {
          window.ShiftSwiftAction?.showActionToast?.(
            error?.message || "Could not download file. Try again.",
            "error",
          );
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function populateCategoryFilter(categories) {
    const select = document.getElementById("global-documents-category-filter");
    if (!select || select.dataset.ready === "1") return;
    const options = (categories || [])
      .map((cat) => `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</option>`)
      .join("");
    select.innerHTML = `<option value="">All categories</option>${options}`;
    select.dataset.ready = "1";
  }

  async function loadGlobalDocuments() {
    const host = document.getElementById("global-documents-grid");
    if (host) host.innerHTML = '<p class="muted">Loading downloads…</p>';
    try {
      const data = await apiFetch("/global-documents");
      listCache = data.items || [];
      populateCategoryFilter(data.categories || []);
      renderGrid();
    } catch (error) {
      if (host) {
        host.innerHTML = `<p class="muted">${escapeHtml(error?.message || "Could not load global downloads.")}</p>`;
      }
    }
  }

  function bindControls() {
    if (controlsBound) return;
    controlsBound = true;
    document.getElementById("global-documents-category-filter")?.addEventListener("change", (event) => {
      categoryFilter = event.target.value;
      renderGrid();
    });
    document.getElementById("global-documents-search")?.addEventListener("input", (event) => {
      searchFilter = event.target.value;
      renderGrid();
    });
  }

  async function initGlobalDocumentsSection() {
    bindControls();
    await loadGlobalDocuments();
  }

  window.addEventListener("admin:section", (event) => {
    if (event.detail?.section === "global-documents") initGlobalDocumentsSection();
  });

  if (window.Admin?.parseHashBaseSection?.(window.location.hash) === "global-documents") {
    initGlobalDocumentsSection();
  }
})();
