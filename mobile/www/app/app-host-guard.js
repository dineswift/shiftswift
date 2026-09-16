/** Send HR app pages to app.shiftswifthr.co.uk — marketing stays on www only. */
(function () {
  const host = window.location.hostname.toLowerCase();
  if (host !== "www.shiftswifthr.co.uk" && host !== "shiftswifthr.co.uk") return;
  const appBase = (window.ShiftSwiftBrand?.urls?.app || "https://app.shiftswifthr.co.uk").replace(/\/$/, "");
  const target = appBase + window.location.pathname + window.location.search + window.location.hash;
  window.location.replace(target);
})();
