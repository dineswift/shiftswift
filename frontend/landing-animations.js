(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const luxuryEase = "cubic-bezier(0.16, 1, 0.3, 1)";
  let scrollDirection = "down";
  let lastScrollY = window.scrollY;
  let revealObserver = null;

  function revealAll(nodes) {
    nodes.forEach((node) => {
      node.classList.add("is-visible");
      node.dataset.revealFrom = "below";
    });
  }

  function updateScrollDirection() {
    const y = window.scrollY;
    scrollDirection = y >= lastScrollY ? "down" : "up";
    lastScrollY = y;
  }

  function setRevealDirection(node) {
    const rect = node.getBoundingClientRect();
    const viewportMid = window.innerHeight * 0.42;
    if (rect.top > viewportMid) {
      node.dataset.revealFrom = "below";
      return;
    }
    if (rect.bottom < viewportMid) {
      node.dataset.revealFrom = "above";
      return;
    }
    node.dataset.revealFrom = scrollDirection === "down" ? "below" : "above";
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
          const node = entry.target;
          if (entry.isIntersecting) {
            setRevealDirection(node);
            node.classList.add("is-visible");
            return;
          }
          if (entry.intersectionRatio === 0) {
            node.classList.remove("is-visible");
          }
        });
      },
      { root: null, rootMargin: "0px 0px -5% 0px", threshold: [0, 0.06, 0.14] }
    );

    revealRoots.forEach((node) => {
      node.__luxuryObserved = true;
      if (isInViewport(node)) {
        setRevealDirection(node);
        node.classList.add("is-visible");
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

  function initHeroParallax() {
    if (reduced) return;
    const visual = document.querySelector(".hero-visual:not([data-scroll-parallax])");
    if (!visual) return;

    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          visual.style.transform = `translate3d(0, ${window.scrollY * 0.055}px, 0)`;
          ticking = false;
        });
      },
      { passive: true }
    );
  }

  function initScrollParallax() {
    if (reduced) return;
    const layers = document.querySelectorAll("[data-scroll-parallax]");
    if (!layers.length) return;

    let ticking = false;
    const update = () => {
      const viewport = window.innerHeight;
      layers.forEach((layer) => {
        const speed = Number(layer.dataset.scrollParallax) || 0.04;
        const rect = layer.getBoundingClientRect();
        const centerOffset = rect.top + rect.height * 0.5 - viewport * 0.5;
        layer.style.transform = `translate3d(0, ${centerOffset * speed}px, 0)`;
      });
    };

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          update();
          ticking = false;
        });
      },
      { passive: true }
    );
    update();
  }

  function initCtaShine() {
    if (reduced) return;
    document.querySelectorAll(".hero-actions .btn:not(.ghost)").forEach((btn) => {
      btn.classList.add("btn--shine");
    });
  }

  function boot() {
    window.addEventListener("scroll", updateScrollDirection, { passive: true });
    initReveal();
    initCounters();
    initHeroParallax();
    initScrollParallax();
    initCtaShine();

    document.addEventListener("shiftswift:pricing-rendered", refreshReveal, { passive: true });

    const pricingGrid = document.getElementById("pricing-plans");
    if (pricingGrid && !reduced && typeof MutationObserver !== "undefined") {
      const mo = new MutationObserver(() => refreshReveal());
      mo.observe(pricingGrid, { childList: true });
    }
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
