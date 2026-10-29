/** Native keyboard inset — Capacitor Keyboard first, visualViewport fallback. */
(function initShiftSwiftNativeKeyboard() {
  const FOCUS_SCROLL_DELAY_MS = 90;

  function isNativeShell() {
    return Boolean(
      window.Capacitor?.isNativePlatform?.() ||
        document.documentElement.classList.contains("native-app") ||
        document.documentElement.classList.contains("capacitor-native"),
    );
  }

  function setInset(px) {
    const root = document.documentElement;
    const inset = Math.max(0, Math.round(Number(px) || 0));
    const stepped = inset < 40 ? 0 : Math.round(inset / 8) * 8;
    const prev = Number.parseFloat(root.style.getPropertyValue("--native-keyboard-inset") || "0") || 0;
    if (Math.abs(stepped - prev) < 8 && Boolean(stepped) === Boolean(prev)) return;
    root.style.setProperty("--native-keyboard-inset", `${stepped}px`);
    root.classList.toggle("native-keyboard-open", stepped > 0);
  }

  function scrollFocusedField(target) {
    if (!(target instanceof HTMLElement)) return;
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !target.isContentEditable) return;
    window.setTimeout(() => {
      try {
        target.scrollIntoView({ block: "center", behavior: "auto" });
      } catch {
        /* ignore */
      }
    }, FOCUS_SCROLL_DELAY_MS);
  }

  function bindFocusScroll() {
    if (window.__SSHR_NATIVE_KEYBOARD_FOCUS__) return;
    window.__SSHR_NATIVE_KEYBOARD_FOCUS__ = true;
    document.addEventListener("focusin", (event) => scrollFocusedField(event.target), true);
  }

  function bindCapacitorKeyboard() {
    const Keyboard = window.Capacitor?.Plugins?.Keyboard;
    if (!Keyboard?.addListener) return false;
    try {
      Keyboard.setResizeMode?.({ mode: "None" }).catch?.(() => null);
      Keyboard.setScroll?.({ isDisabled: false }).catch?.(() => null);
    } catch {
      /* older plugin builds */
    }
    Keyboard.addListener("keyboardWillShow", (info) => {
      setInset(info?.keyboardHeight || 0);
    });
    Keyboard.addListener("keyboardDidShow", (info) => {
      setInset(info?.keyboardHeight || 0);
    });
    Keyboard.addListener("keyboardWillHide", () => setInset(0));
    Keyboard.addListener("keyboardDidHide", () => setInset(0));
    return true;
  }

  function bindVisualViewportFallback() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let last = -1;
    let rafId = 0;
    const adjust = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const raw = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        const inset = raw < 48 ? 0 : Math.round(raw / 8) * 8;
        if (Math.abs(inset - last) < 8) return;
        last = inset;
        setInset(inset);
      });
    };
    viewport.addEventListener("resize", adjust, { passive: true });
    adjust();
  }

  function bind(options = {}) {
    if (!isNativeShell()) return false;
    const key = options.scope === "login" ? "__SSHR_LOGIN_KEYBOARD_BOUND__" : "__SSHR_PORTAL_KEYBOARD_BOUND__";
    if (window[key]) return true;
    window[key] = true;
    bindFocusScroll();
    const usedPlugin = bindCapacitorKeyboard();
    if (!usedPlugin) bindVisualViewportFallback();
    return true;
  }

  window.ShiftSwiftNativeKeyboard = {
    bind,
    setInset,
    isNativeShell,
  };
})();
