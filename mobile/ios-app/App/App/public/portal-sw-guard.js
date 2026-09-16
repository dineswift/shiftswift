/** Keep portal login pages on the correct shell — unregister conflicting service workers. */
(function () {
  const ADMIN_SW = /admin-sw\.js/i;
  const EMPLOYEE_SW = /employee-sw\.js/i;
  const LEGACY_SW = /app-sw\.js|punch-sw\.js/i;

  function swScriptUrl(reg) {
    return reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || "";
  }

  async function unregisterMatching(patterns) {
    if (!("serviceWorker" in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs.map((reg) => {
        const url = swScriptUrl(reg);
        return patterns.some((pattern) => pattern.test(url)) ? reg.unregister() : Promise.resolve(false);
      }),
    );
  }

  async function preparePortal(target) {
    if (target === "employee") {
      await unregisterMatching([ADMIN_SW, LEGACY_SW]);
      return;
    }
    if (target === "master") {
      await unregisterMatching([EMPLOYEE_SW, LEGACY_SW]);
      return;
    }
    if (target === "business") {
      await unregisterMatching([EMPLOYEE_SW, LEGACY_SW]);
    }
  }

  function portalFromHref(href) {
    const path = String(href || "").split("#")[0].split("?")[0];
    if (/employee(-login|-forgot-password)?\.html$/i.test(path) || /\/employee\.html$/i.test(path)) {
      return "employee";
    }
    if (/ops-9x7k2|master(-tenant|-login)?\.html$/i.test(path)) {
      return "master";
    }
    if (/business-login|forgot-password|admin\.html$/i.test(path)) {
      return "business";
    }
    return null;
  }

  const pagePortal =
    document.body?.dataset?.loginPage === "employee"
      ? "employee"
      : document.getElementById("ops-master-login-form")
        ? "master"
        : document.body?.dataset?.loginPage === "business"
          ? "business"
          : null;

  if (pagePortal) {
    void preparePortal(pagePortal);
  }

  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest("a[href]");
      if (!link || link.target === "_blank") return;
      const href = link.getAttribute("href") || "";
      if (!href || href.startsWith("mailto:") || href.startsWith("http")) return;
      const targetPortal = portalFromHref(href);
      if (!targetPortal || targetPortal === pagePortal) return;
      event.preventDefault();
      void preparePortal(targetPortal).then(() => {
        window.location.href = link.href;
      });
    },
    true,
  );

  try {
    const role = localStorage.getItem("userRole");
    const hasToken = localStorage.getItem("token") || localStorage.getItem("refreshToken");
    if (role === "employee" && !hasToken) {
      localStorage.removeItem("userRole");
    }
  } catch {
    /* ignore storage errors */
  }
})();
