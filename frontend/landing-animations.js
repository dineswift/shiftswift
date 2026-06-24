(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const luxuryEase = "cubic-bezier(0.16, 1, 0.3, 1)";
  let revealObserver = null;
  let scrollTicking = false;
  let parallaxLayers = [];
  let parallaxReady = false;

  function revealAll(nodes) {
    nodes.forEach((node) => {
      node.classList.add("is-visible");
      node.dataset.revealFrom = "below";
    });
  }

  function setRevealDirection(node) {
    const rect = node.getBoundingClientRect();
    node.dataset.revealFrom = rect.top > window.innerHeight * 0.55 ? "below" : "above";
  }

  function collectRevealRoots() {
    return Array.from(document.querySelectorAll(".reveal, .reveal-stagger"));
  }

  function isInViewport(node) {
    const rect = node.getBoundingClientRect();
    return rect.top < window.innerHeight * 0.92 && rect.bottom > window.innerHeight * 0.08;
  }

  function initReveal() {
    const revealRoots = collectRevealRoots();
    if (!revealRoots.length) return;

    if (reduced) {
      revealAll(revealRoots);
      return;
    }

    document.documentElement.classList.add("motion-ready");

    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const node = entry.target;
          if (node.classList.contains("is-visible")) return;
          setRevealDirection(node);
          node.classList.add("is-visible");
          revealObserver.unobserve(node);
        });
      },
      { root: null, rootMargin: "0px 0px -5% 0px", threshold: 0.08 }
    );

    revealRoots.forEach((node) => {
      node.__luxuryObserved = true;
      if (isInViewport(node)) {
        setRevealDirection(node);
        node.classList.add("is-visible");
        revealObserver.unobserve(node);
        return;
      }
      revealObserver.observe(node);
    });
  }

  function refreshReveal() {
    if (reduced || !revealObserver) return;
    collectRevealRoots().forEach((node) => {
      if (node.__luxuryObserved) return;
      node.__luxuryObserved = true;
      if (isInViewport(node)) {
        setRevealDirection(node);
        node.classList.add("is-visible");
        return;
      }
      revealObserver.observe(node);
    });
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
          if (reduced) {
            counter.textContent = String(target);
            return;
          }
          const duration = 1100;
          const start = performance.now();
          const tick = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4);
            counter.textContent = String(Math.round(target * eased));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.45 }
    );
    counterObserver.observe(counter);
  }

  function updateParallax() {
    if (!parallaxReady || !parallaxLayers.length) return;
    const viewport = window.innerHeight;
    parallaxLayers.forEach((layer) => {
      const speed = Number(layer.dataset.scrollParallax) || 0.04;
      const rect = layer.getBoundingClientRect();
      const centerOffset = rect.top + rect.height * 0.5 - viewport * 0.5;
      layer.style.transform = `translate3d(0, ${centerOffset * speed}px, 0)`;
    });
  }

  function onScrollFrame() {
    scrollTicking = false;
    updateParallax();
  }

  function scheduleScrollWork() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(onScrollFrame);
  }

  function initScrollParallax() {
    if (reduced) return;
    if (window.matchMedia("(max-width: 900px)").matches) return;

    parallaxLayers = Array.from(document.querySelectorAll("[data-scroll-parallax]"));
    if (!parallaxLayers.length) return;

    const start = () => {
      parallaxReady = true;
      updateParallax();
      window.addEventListener("scroll", scheduleScrollWork, { passive: true });
    };

    const hero = document.querySelector(".hero-visual[data-scroll-parallax].hero-in");
    if (hero) {
      hero.addEventListener("animationend", start, { once: true });
      window.setTimeout(start, 1400);
      return;
    }
    start();
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
    initScrollParallax();
    initCtaShine();
    document.addEventListener("shiftswift:pricing-rendered", refreshReveal, { passive: true });
  }

  window.ShiftSwiftLandingMotion = {
    refresh: refreshReveal,
    ease: luxuryEase,
  };

  if (document.body.classList.contains("is-loading")) {
    document.addEventListener("shiftswift:loader-done", boot, { once: true });
  } else {
    boot();
  }
})();
