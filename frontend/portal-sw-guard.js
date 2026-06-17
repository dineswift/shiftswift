/** Drop employee/app service workers on HR auth pages so business login is never hijacked. */
(function () {
  const BLOCKED = /employee-sw\.js|app-sw\.js/i;

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) =>
      Promise.all(
        regs.map((reg) => {
          const url =
            reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || "";
          return BLOCKED.test(url) ? reg.unregister() : Promise.resolve(false);
        }),
      ),
    );
  }

  if (document.body?.dataset?.loginPage !== "business") return;

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
