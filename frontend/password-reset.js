(function () {
  function apiBase() {
    if (window.ShiftSwiftBrand?.resolveApiBase) {
      return window.ShiftSwiftBrand.resolveApiBase();
    }
    const stored = localStorage.getItem("apiBaseUrl");
    if (stored && !/localhost|127\.0\.0\.1/.test(stored)) {
      return stored;
    }
    return "http://localhost:3000";
  }

  function setStatus(el, message, isSuccess) {
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.hidden = false;
      el.classList.toggle("form-success-message", Boolean(isSuccess));
    } else {
      el.textContent = "";
      el.hidden = true;
      el.classList.remove("form-success-message");
    }
  }

  function friendlyError(message) {
    if (message === "Failed to fetch" || message === "Load failed") {
      return "Cannot reach the server. Check your connection and try again.";
    }
    return message || "Request failed";
  }

  async function getJson(path) {
    const response = await fetch(`${apiBase()}${path}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
      throw new Error(message || "Request failed");
    }
    return data;
  }

  async function postJson(path, body) {
    const response = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
      throw new Error(message || "Request failed");
    }
    return data;
  }

  let resetRole = "hr";

  function initForgotPage() {
    const form = document.getElementById("forgot-password-form");
    if (!form) return;

    const params = new URLSearchParams(window.location.search);
    const backLink = document.getElementById("forgot-back-link");
    const syncBackLink = () => {
      if (!backLink) return;
      backLink.href = resetRole === "employee" ? "./employee-login.html" : "./business-login.html";
    };

    if (params.get("role") === "employee") {
      resetRole = "employee";
      document.querySelectorAll("[data-reset-tab]").forEach((tab) => {
        const active = tab.dataset.resetTab === "employee";
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      });
    }
    syncBackLink();

    document.querySelectorAll("[data-reset-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        resetRole = tab.dataset.resetTab || "hr";
        document.querySelectorAll("[data-reset-tab]").forEach((item) => {
          const active = item === tab;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", active ? "true" : "false");
        });
        syncBackLink();
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.getElementById("forgot-status");
      const email = new FormData(form).get("email");
      setStatus(status, "Sending reset link…", false);
      try {
        const data = await postJson("/auth/forgot-password", { email, role: resetRole });
        setStatus(status, data.message || "Check your email for a reset link.", true);
        form.querySelector('button[type="submit"]')?.setAttribute("disabled", "disabled");
      } catch (error) {
        setStatus(status, friendlyError(error.message), false);
      }
    });
  }

  function initResetPage() {
    const form = document.getElementById("reset-password-form");
    if (!form) return;

    const token = new URLSearchParams(window.location.search).get("token");
    const status = document.getElementById("reset-status");
    const gdprNotice = document.getElementById("employee-gdpr-notice");
    const gdprCheckbox = form.querySelector('input[name="accept_employee_gdpr"]');
    let requiresGdprConsent = false;

    if (!token) {
      setStatus(status, "Missing reset token. Request a new link from the forgot password page.", false);
      return;
    }

    getJson(`/auth/reset-password/context?token=${encodeURIComponent(token)}`)
      .then((context) => {
        if (context.role === "employee" && context.requires_gdpr_consent) {
          requiresGdprConsent = true;
          if (gdprNotice) gdprNotice.hidden = false;
          const employerEl = document.getElementById("employee-gdpr-employer");
          if (employerEl && context.employer_name) {
            employerEl.textContent = context.employer_name;
          }
          if (gdprCheckbox) gdprCheckbox.required = true;
          const lead = document.querySelector(".portal-login-card-lead");
          if (lead) {
            lead.textContent = "Choose a password and confirm the privacy notice to finish setting up your account.";
          }
        }
      })
      .catch((error) => {
        setStatus(status, friendlyError(error.message), false);
        form.querySelector('button[type="submit"]')?.setAttribute("disabled", "disabled");
      });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if (data.new_password.length < 8) {
        setStatus(status, "Password must be at least 8 characters.", false);
        return;
      }
      if (data.new_password !== data.confirm_password) {
        setStatus(status, "Passwords do not match.", false);
        return;
      }
      if (requiresGdprConsent && !data.accept_employee_gdpr) {
        setStatus(
          status,
          "Please confirm you understand your employer manages your data and agree to the privacy policy.",
          false,
        );
        return;
      }
      setStatus(status, "Updating password…", false);
      try {
        const result = await postJson("/auth/reset-password", {
          token,
          new_password: data.new_password,
          accept_employee_gdpr: Boolean(data.accept_employee_gdpr),
        });
        setStatus(status, result.message || "Password updated.", true);
        setTimeout(() => {
          window.location.href = "./employee-login.html";
        }, 1500);
      } catch (error) {
        setStatus(status, friendlyError(error.message), false);
      }
    });
  }

  initForgotPage();
  initResetPage();
})();
