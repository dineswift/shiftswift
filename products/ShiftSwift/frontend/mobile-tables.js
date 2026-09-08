/** Mobile — stack table rows as cards; keep wide tables in scroll wrappers. */
(function () {
  "use strict";

  const WRAP_SELECTOR =
    ".hr-table-wrap, .table-wrap, .rtw-table-wrap, .absence-table-wrap, .settings-notify-table-wrap";
  const SKIP_SELECTOR = ".keep-table-scroll, .rota-shifts-table-wrap, .employee-desktop-table-wrap";

  function isMobile() {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function shouldSkipWrap(wrap) {
    if (!wrap) return true;
    if (wrap.matches(SKIP_SELECTOR)) return true;
    if (wrap.closest(SKIP_SELECTOR)) return true;
    if (wrap.closest(".admin-section[hidden]")) return true;
    return false;
  }

  function clearWrap(wrap) {
    wrap.classList.remove("mobile-table-cards");
    wrap.querySelectorAll("td[data-label]").forEach((cell) => {
      cell.removeAttribute("data-label");
    });
  }

  function enhanceWrap(wrap) {
    if (shouldSkipWrap(wrap)) {
      clearWrap(wrap);
      return;
    }

    const table = wrap.querySelector("table.data-table, table.hr-table");
    if (!table) {
      clearWrap(wrap);
      return;
    }

    const headers = [...table.querySelectorAll("thead th")].map((th) =>
      th.textContent.replace(/\s+/g, " ").trim(),
    );
    if (!headers.length) {
      clearWrap(wrap);
      return;
    }

    table.querySelectorAll("tbody tr").forEach((row) => {
      const cells = [...row.children].filter((cell) => cell.tagName === "TD");
      cells.forEach((cell, index) => {
        const label = headers[index] || headers[headers.length - 1] || "";
        if (label) cell.setAttribute("data-label", label);
      });
    });

    wrap.classList.add("mobile-table-cards");
  }

  function enhanceTables(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (!document.getElementById("mobile-tab-bar")) return;

    scope.querySelectorAll(WRAP_SELECTOR).forEach((wrap) => {
      if (!isMobile()) {
        clearWrap(wrap);
        return;
      }
      enhanceWrap(wrap);
    });
  }

  function init() {
    if (!document.getElementById("mobile-tab-bar")) return;

    enhanceTables(document);

    ["admin:section", "employee:section"].forEach((eventName) => {
      window.addEventListener(eventName, () => {
        window.requestAnimationFrame(() => enhanceTables(document));
      });
    });

    window.addEventListener("hashchange", () => {
      window.requestAnimationFrame(() => enhanceTables(document));
    });

    window.addEventListener("resize", () => enhanceTables(document));

    const content = document.querySelector("main.content");
    if (content) {
      const observer = new MutationObserver(() => {
        window.requestAnimationFrame(() => enhanceTables(document));
      });
      observer.observe(content, { childList: true, subtree: true });
    }
  }

  window.MobileTables = { init, enhanceTables, isMobile };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
