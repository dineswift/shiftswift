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

  function resolvePasswordPortal() {
    const portal = document.body?.dataset?.passwordPortal;
    if (portal === "employee" || portal === "hr") return portal;
    if (document.body?.dataset?.loginPage === "employee") return "employee";
    const role = new URLSearchParams(window.location.search).get("role");
    if (role === "employee") return "employee";
    return "hr";
  }

  function loginUrlForPortal(portal) {
    // Unified sign-in handles email OTP after password for all portals.
    return "./sign-in.html";
  }

  function forgotUrlForPortal(portal) {
    return portal === "employee" ? "./employee-forgot-password.html" : "./forgot-password.html";
  }

  function applyEmployeeResetChrome(portal) {
    if (portal !== "employee") return;
    document.body.classList.add("portal-login-page--employee");
    document.body.dataset.passwordPortal = "employee";

    const brandLink = document.querySelector(".portal-login-brand a");
    const brandLogo = document.querySelector(".portal-login-brand-logo");
    const brandCopy = document.querySelector(".portal-login-brand-copy");
    if (brandLink) {
      brandLink.href = "./employee-login.html";
      brandLink.setAttribute("aria-label", "Employee sign in");
    }
    if (brandLogo) {
      brandLogo.src = "./assets/shiftswift-employee-app-icon-192.png?v=brandkit-v6";
      brandLogo.alt = "ShiftSwift Employee";
      brandLogo.classList.add("app-mark", "app-mark--login");
    }
    if (brandCopy) brandCopy.textContent = "Employee portal";

    const card = document.querySelector(".portal-login-card");
    if (card) card.classList.add("portal-login-card--employee");

    const expiredLink = document.getElementById("reset-expired-link");
    if (expiredLink) expiredLink.href = forgotUrlForPortal("employee");
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
    window.ShiftSwiftNativeApiFetch?.boot?.();
    const url = `${apiBase()}${path}`;
    const response = window.ShiftSwiftNativeApiFetch?.nativeAwareFetch
      ? await window.ShiftSwiftNativeApiFetch.nativeAwareFetch(url, {})
      : await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
      throw new Error(message || "Request failed");
    }
    return data;
  }

  async function postJson(path, body) {
    window.ShiftSwiftNativeApiFetch?.boot?.();
    const url = `${apiBase()}${path}`;
    const reqInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
    const response = window.ShiftSwiftNativeApiFetch?.nativeAwareFetch
      ? await window.ShiftSwiftNativeApiFetch.nativeAwareFetch(url, reqInit)
      : await fetch(url, reqInit);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
      throw new Error(message || "Request failed");
    }
    return data;
  }

  function initForgotPage() {
    const form = document.getElementById("forgot-password-form");
    if (!form) return;

    const portal = resolvePasswordPortal();
    const resetRole = portal === "employee" ? "employee" : "hr";
    applyEmployeeResetChrome(portal);

    const backLink = document.getElementById("forgot-back-link");
    if (backLink) backLink.href = loginUrlForPortal(portal);

    document.querySelectorAll("[data-reset-tab]").forEach((tab) => {
      tab.hidden = true;
      tab.setAttribute("aria-hidden", "true");
    });
    const tabs = document.getElementById("reset-tabs");
    if (tabs) tabs.hidden = true;

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
    let resetPortal = resolvePasswordPortal();

    if (!token) {
      setStatus(status, "Missing reset token. Request a new link from the forgot password page.", false);
      return;
    }

    getJson(`/auth/reset-password/context?token=${encodeURIComponent(token)}`)
      .then((context) => {
        if (context.role === "employee") {
          resetPortal = "employee";
          applyEmployeeResetChrome("employee");
        }
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
        setStatus(
          status,
          result.message ||
            "Password updated. Next sign-in will email you a 6-digit code unless Face ID or an authenticator app is set up.",
          true,
        );
        setTimeout(() => {
          const next = `${loginUrlForPortal(resetPortal)}?passwordReset=1`;
          window.location.href = next;
        }, 1800);
      } catch (error) {
        setStatus(status, friendlyError(error.message), false);
      }
    });
  }

  initForgotPage();
  initResetPage();
})();
