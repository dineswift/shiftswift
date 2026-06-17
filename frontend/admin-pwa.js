/** Keep HR admin pages on the admin service worker — not the employee shell. */
(function () {
  const SW_URL = "./admin-sw.js?v=2";
  const BLOCKED_SW = ["employee-sw.js", "punch-sw.js", "app-sw.js"];

  function registerAdminSw() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker
      .getRegistrations()
      .then((regs) =>
        Promise.all(
          regs.map((reg) => {
            const script =
              reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || "";
            if (BLOCKED_SW.some((name) => script.includes(name))) {
              return reg.unregister();
            }
            return Promise.resolve(false);
          }),
        ),
      )
      .then(() => navigator.serviceWorker.register(SW_URL, { scope: "./" }))
      .catch(() => null);
  }

  window.ShiftSwiftAdminPwa = { registerAdminSw };
})();
