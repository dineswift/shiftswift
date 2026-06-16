(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function revealAll(nodes) {
    nodes.forEach((node) => node.classList.add("is-visible"));
  }

  function initReveal() {
    const revealRoots = document.querySelectorAll(".reveal, .reveal-stagger");
    if (!revealRoots.length) return;

    if (reduced) {
      revealAll(revealRoots);
      return;
    }

    document.documentElement.classList.add("motion-ready");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { root: null, rootMargin: "0px 0px -4% 0px", threshold: 0 }
    );

    revealRoots.forEach((node) => observer.observe(node));
  }

  function initCounters() {
    const counter = document.querySelector("[data-count-up]");
    if (!counter) return;

    const target = Number(counter.dataset.countUp || counter.textContent);
    if (!Number.isFinite(target)) return;

    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          counterObserver.disconnect();
          const duration = 900;
          const start = performance.now();
          const tick = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            counter.textContent = String(Math.round(target * eased));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.5 }
    );
    counterObserver.observe(counter);
  }

  function initHeroParallax() {
    if (reduced) return;
    const visual = document.querySelector(".hero-visual");
    if (!visual) return;

    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          visual.style.transform = `translateY(${window.scrollY * 0.06}px)`;
          ticking = false;
        });
      },
      { passive: true }
    );
  }

  function initCtaShine() {
    if (reduced) return;
    document.querySelectorAll(".hero-actions .btn:not(.ghost)").forEach((btn) => {
      btn.classList.add("btn--shine");
    });
  }

  function boot() {
    initReveal();
    initCounters();
    initHeroParallax();
    initCtaShine();
  }

  if (document.body.classList.contains("is-loading")) {
    document.addEventListener("shiftswift:loader-done", boot, { once: true });
  } else {
    boot();
  }
})();
