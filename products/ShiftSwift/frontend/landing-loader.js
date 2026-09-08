/** Startup splash — animated logo while the home page loads. */
(function () {
  const loader = document.getElementById("startup-loader");
  if (!loader) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MIN_MS = reduced ? 200 : 1400;
  const MAX_MS = 3200;

  document.body.classList.add("is-loading");

  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    loader.classList.add("is-done");
    loader.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-loading");
    document.dispatchEvent(new CustomEvent("shiftswift:loader-done"));
    window.setTimeout(() => loader.remove(), 520);
  }

  const started = performance.now();

  function finishAfterMinimum() {
    const elapsed = performance.now() - started;
    const wait = Math.max(0, MIN_MS - elapsed);
    window.setTimeout(finish, wait);
  }

  if (document.readyState === "complete") {
    finishAfterMinimum();
  } else {
    window.addEventListener("load", finishAfterMinimum, { once: true });
  }

  window.setTimeout(finish, MAX_MS);
})();
