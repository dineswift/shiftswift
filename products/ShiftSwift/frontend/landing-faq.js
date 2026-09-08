/** FAQ accordion — one open at a time; scrolls item clear of the cookie banner. */
(function () {
  function initFaq() {
    const items = document.querySelectorAll("#faq .faq-item");
    if (!items.length) return;

    function setOpen(details, open) {
      const summary = details.querySelector("summary");
      const answer = details.querySelector(".faq-item__answer");
      if (!summary || !answer) return;

      if (open) {
        details.setAttribute("open", "");
      } else {
        details.removeAttribute("open");
      }

      details.classList.toggle("is-open", open);
      answer.hidden = !open;
      summary.setAttribute("aria-expanded", open ? "true" : "false");

      if (open) {
        window.requestAnimationFrame(() => {
          const banner = document.getElementById("cookie-consent-banner");
          const bannerHeight = banner && !banner.hidden ? banner.offsetHeight : 0;
          const rect = details.getBoundingClientRect();
          const bottomLimit = window.innerHeight - bannerHeight - 16;
          if (rect.bottom > bottomLimit) {
            details.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        });
      }
    }

    items.forEach((details) => {
      const summary = details.querySelector("summary");
      if (!summary) return;

      summary.setAttribute("role", "button");
      summary.setAttribute("aria-expanded", "false");

      summary.addEventListener("click", (event) => {
        event.preventDefault();
        const willOpen = !details.hasAttribute("open");
        items.forEach((other) => {
          if (other !== details) setOpen(other, false);
        });
        setOpen(details, willOpen);
      });

      setOpen(details, false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFaq);
  } else {
    initFaq();
  }
})();
