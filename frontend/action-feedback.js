/** Shared button + status feedback for PWA actions (save, publish, cancel, etc.). */
(function initActionFeedback() {
  const BUSY_CLASS = "btn--busy";
  const FLASH_CLASS = "btn--action-success";

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

  function beginButtonAction(button, { loadingLabel = "Working…" } = {}) {
    if (!button || button.disabled) return null;
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
    } = options;

    const state = beginButtonAction(button, { loadingLabel });
    if (!state) return { ok: false, reason: "busy" };

    setActionStatus(statusEl, loadingLabel, "info");

    try {
      const result = await onAction();
      if (result === false) {
        setActionStatus(statusEl, errorMessage, "error");
        endButtonAction(state);
        return { ok: false };
      }

      const message = typeof result === "string" ? result : successMessage;
      setActionStatus(statusEl, message, "ok");
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
      setActionStatus(statusEl, message, "error");
      endButtonAction(state);
      return { ok: false, error: message };
    }
  }

  async function runFormSubmit(form, statusEl, options = {}) {
    const submitBtn = form?.querySelector('button[type="submit"], input[type="submit"]');
    return runButtonAction(submitBtn, statusEl, options);
  }

  window.ShiftSwiftAction = {
    setActionStatus,
    beginButtonAction,
    endButtonAction,
    runButtonAction,
    runFormSubmit,
  };
})();
