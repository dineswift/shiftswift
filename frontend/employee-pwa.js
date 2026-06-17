/** Keep employee pages on the employee service worker — not the shared admin SW. */
(function () {
  const SW_URL = "./employee-sw.js?v=4";
  const BLOCKED_SW = ["app-sw.js", "punch-sw.js"];

  function registerEmployeeSw() {
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

  window.ShiftSwiftEmployeePwa = { registerEmployeeSw };
})();
