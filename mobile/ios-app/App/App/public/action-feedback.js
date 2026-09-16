/** Shared button + status feedback for PWA and native app actions. */
(function initActionFeedback() {
  const BUSY_CLASS = "btn--busy";
  const FLASH_CLASS = "btn--action-success";

  function isNativeShell() {
    return Boolean(
      window.Capacitor?.isNativePlatform?.() ||
        document.documentElement.classList.contains("native-app") ||
        document.documentElement.classList.contains("capacitor-native"),
    );
  }

  function toneClasses(tone) {
    if (tone === "ok" || tone === "success") {
      return ["action-status--success", "edit-form-status--success"];
    }
    if (tone === "error" || tone === "danger") {
      return ["action-status--error", "edit-form-status--error"];
    }
    if (tone === "warn") {
      return ["action-status--warn", "edit-form-status--warn"];
    }
    return ["action-status--info"];
  }

  function clearStatusClasses(el) {
    el.classList.remove(
      "action-status--success",
      "action-status--error",
      "action-status--warn",
      "action-status--info",
      "edit-form-status--success",
      "edit-form-status--error",
      "edit-form-status--warn",
    );
  }

  function setActionStatus(el, message, tone = "info") {
    if (!el) return;
    clearStatusClasses(el);
    el.textContent = message || "";
    if (!message) return;
    toneClasses(tone).forEach((cls) => el.classList.add(cls));
  }

  let toastHost = null;

  function ensureToastHost() {
    if (toastHost) return toastHost;
    toastHost = document.getElementById("sshr-action-toast-host");
    if (!toastHost) {
      toastHost = document.createElement("div");
      toastHost.id = "sshr-action-toast-host";
      toastHost.className = "sshr-action-toast-host";
      toastHost.setAttribute("aria-live", "polite");
      toastHost.setAttribute("aria-atomic", "true");
      document.body.appendChild(toastHost);
    }
    return toastHost;
  }

  function showActionToast(message, tone = "ok", { durationMs = 2800 } = {}) {
    if (!message) return;
    const host = ensureToastHost();
    const toast = document.createElement("div");
    const toneClass =
      tone === "error" || tone === "danger" ? "error" : tone === "warn" ? "warn" : "success";
    toast.className = `sshr-action-toast sshr-action-toast--${toneClass}`;
    toast.textContent = message;
    host.appendChild(toast);
    window.requestAnimationFrame(() => toast.classList.add("sshr-action-toast--visible"));
    window.setTimeout(() => {
      toast.classList.remove("sshr-action-toast--visible");
      window.setTimeout(() => toast.remove(), 240);
    }, durationMs);
  }

  function resolveStatusEl(button) {
    if (!button) return null;
    const form = button.closest("form");
    if (form) {
      const inForm = form.querySelector(
        ".edit-form-status, [data-status], [data-upload-status], [data-note-status], [aria-live='polite']",
      );
      if (inForm) return inForm;
    }
    const actions = button.closest(
      ".edit-form-actions, .section-actions, .hr-detail-foot, .employment-detail-foot, .punch-table-head__actions, .punch-accountant-actions",
    );
    if (actions) {
      const sibling = actions.querySelector(
        ".edit-form-status, [data-status], [aria-live='polite']",
      );
      if (sibling) return sibling;
    }
    const panel = button.closest(".hr-surface-panel, .card, article, aside");
    if (panel) {
      const panelStatus = panel.querySelector(
        ".edit-form-status, [data-status], .employment-action-status, .employment-generate-status, .punch-admin-message, [aria-live='polite']",
      );
      if (panelStatus) return panelStatus;
    }
    return null;
  }

  function notifyAction(message, tone, statusEl, { toastOnNative = true, toast = false } = {}) {
    if (statusEl) setActionStatus(statusEl, message, tone);
    const shouldToast = toast || (toastOnNative && isNativeShell() && message && tone !== "info");
    if (shouldToast) showActionToast(message, tone);
  }

  function tapHaptic(kind = "light") {
    try {
      if (typeof navigator.vibrate === "function") {
        navigator.vibrate(kind === "success" ? 10 : 6);
      }
    } catch (_) {
      /* ignore */
    }
  }

  function beginButtonAction(button, { loadingLabel = "Working…", haptic = true } = {}) {
    if (!button || button.disabled) return null;
    if (haptic) tapHaptic("light");
    const state = {
      button,
      originalHtml: button.innerHTML,
      originalLabel: button.tagName === "BUTTON" ? button.textContent : "",
      originalAriaBusy: button.getAttribute("aria-busy"),
      originalMinWidth: button.style.minWidth,
      originalMinHeight: button.style.minHeight,
    };
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.classList.add(BUSY_CLASS);
    if (button.offsetWidth > 0) button.style.minWidth = `${button.offsetWidth}px`;
    if (button.offsetHeight > 0) button.style.minHeight = `${button.offsetHeight}px`;
    if (button.tagName === "BUTTON") {
      button.textContent = loadingLabel;
    }
    return state;
  }

  function endButtonAction(state, { successLabel, flashSuccess = false, resetAfterMs = 1800 } = {}) {
    if (!state?.button) return;
    const { button, originalHtml, originalAriaBusy, originalMinWidth, originalMinHeight } = state;
    button.disabled = false;
    button.classList.remove(BUSY_CLASS);
    button.style.minWidth = originalMinWidth || "";
    button.style.minHeight = originalMinHeight || "";
    if (originalAriaBusy == null) button.removeAttribute("aria-busy");
    else button.setAttribute("aria-busy", originalAriaBusy);
    if (button.tagName === "BUTTON") {
      button.innerHTML = originalHtml;
    }
    if (flashSuccess && successLabel && button.tagName === "BUTTON") {
      tapHaptic("success");
      button.classList.add(FLASH_CLASS);
      button.textContent = successLabel;
      window.setTimeout(() => {
        button.classList.remove(FLASH_CLASS);
        button.innerHTML = originalHtml;
      }, resetAfterMs);
    }
  }

  /**
   * Run an async action with button busy state + status line feedback.
   * onAction may return false to signal failure, or a string as success message.
   */
  async function runButtonAction(button, statusEl, options = {}) {
    const {
      loadingLabel = "Working…",
      successMessage = "Saved.",
      errorMessage = "Something went wrong.",
      successLabel,
      onAction,
      clearStatusAfterMs = 6000,
      toastOnSuccess = true,
    } = options;

    const state = beginButtonAction(button, { loadingLabel });
    if (!state) return { ok: false, reason: "busy" };

    notifyAction(loadingLabel, "info", statusEl, { toastOnNative: false });

    try {
      const result = await onAction();
      if (result === false) {
        notifyAction(errorMessage, "error", statusEl, { toast: true });
        endButtonAction(state);
        return { ok: false };
      }

      const message = typeof result === "string" ? result : successMessage;
      notifyAction(message, "ok", statusEl, { toast: toastOnSuccess });
      endButtonAction(state, {
        successLabel,
        flashSuccess: Boolean(successLabel),
      });

      if (clearStatusAfterMs > 0 && statusEl) {
        window.setTimeout(() => {
          if (statusEl.textContent === message) setActionStatus(statusEl, "", "info");
        }, clearStatusAfterMs);
      }

      return { ok: true, message };
    } catch (error) {
      const message = error?.message || errorMessage;
      notifyAction(message, "error", statusEl, { toast: true });
      endButtonAction(state);
      return { ok: false, error: message };
    }
  }

  async function runButtonActionAuto(button, onAction, options = {}) {
    const statusEl = options.statusEl || resolveStatusEl(button);
    return runButtonAction(button, statusEl, { ...options, onAction });
  }

  async function runFormSubmit(form, statusEl, options = {}) {
    const submitBtn = form?.querySelector('button[type="submit"], input[type="submit"]');
    const resolvedStatus = statusEl || resolveStatusEl(submitBtn);
    return runButtonAction(submitBtn, resolvedStatus, options);
  }

  function bootNativeActionFeedback() {
    ensureToastHost();
    document.documentElement.classList.add("sshr-action-feedback-ready");
  }

  window.ShiftSwiftAction = {
    isNativeShell,
    setActionStatus,
    notifyAction,
    showActionToast,
    resolveStatusEl,
    beginButtonAction,
    endButtonAction,
    runButtonAction,
    runButtonActionAuto,
    runFormSubmit,
    bootNativeActionFeedback,
    bootNativePortal: bootNativeActionFeedback,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootNativeActionFeedback, { once: true });
  } else {
    bootNativeActionFeedback();
  }

  window.addEventListener("shiftswift:portal-ready", bootNativeActionFeedback, { once: true });
})();
