/** Unified native sign-in — tries employee then HR admin based on credentials. */
(function initNativeUnifiedLogin() {
  const APP_ORIGIN = "https://app.shiftswifthr.co.uk";
  const PORTAL_MISMATCH_HINTS = [
    "employee sign-in page",
    "HR admin account",
    "business sign-in page",
    "Invalid credentials for this login type",
  ];

  let pendingChallenge = null;
  let pendingRedirect = null;

  function getApiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    return "https://api.shiftswifthr.co.uk";
  }

  function setStatus(message) {
    const status = document.getElementById("login-status");
    if (!status) return;
    status.textContent = message || "";
    status.hidden = !message;
  }

  function portalUrl(path) {
    return `${APP_ORIGIN}/${String(path).replace(/^\.\//, "")}`;
  }

  async function postJson(path, body) {
    const response = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
      throw new Error(message || data.message || "Login failed");
    }
    return data;
  }

  function storeSession(data) {
    if (data.access_token) localStorage.setItem("token", data.access_token);
    if (data.refresh_token) localStorage.setItem("refreshToken", data.refresh_token);
    if (data.role) localStorage.setItem("userRole", data.role);
    if (data.tenant_id) {
      localStorage.setItem("masterTenantId", data.tenant_id);
      localStorage.setItem("tenantId", data.tenant_id);
    }
    try {
      localStorage.setItem("sshrNativeApp", "1");
      localStorage.setItem("sshrUnifiedNativeApp", "1");
    } catch {
      /* ignore */
    }
  }

  function redirectForRole(data, fallback) {
    if (data.role === "employee") return portalUrl("employee.html");
    return portalUrl(fallback.replace(/^\.\//, ""));
  }

  function isPortalMismatch(message) {
    const text = String(message || "");
    return PORTAL_MISMATCH_HINTS.some((hint) => text.includes(hint));
  }

  async function loginWithAutoPortal(payload) {
    const modes = [
      { endpoint: "/auth/employee-login", redirect: "employee.html" },
      { endpoint: "/auth/business-login", redirect: "admin.html" },
    ];
    let lastError = null;
    for (const mode of modes) {
      try {
        const data = await postJson(mode.endpoint, payload);
        return { data, redirect: redirectForRole(data, mode.redirect) };
      } catch (error) {
        lastError = error;
        if (!isPortalMismatch(error.message)) throw error;
      }
    }
    throw lastError || new Error("Login failed");
  }

  function showMfaStep(username) {
    const loginShell = document.getElementById("login-shell");
    const mfaPanel = document.getElementById("mfa-panel");
    const enrollmentPanel = document.getElementById("mfa-enrollment-panel");
    if (loginShell) loginShell.hidden = true;
    if (enrollmentPanel) enrollmentPanel.hidden = true;
    if (mfaPanel) {
      mfaPanel.hidden = false;
      const userLabel = mfaPanel.querySelector("[data-mfa-user]");
      if (userLabel) userLabel.textContent = username;
      const codeInput = mfaPanel.querySelector('input[name="code"]');
      if (codeInput) codeInput.focus();
    }
  }

  function bindMfaForm() {
    const mfaForm = document.getElementById("mfa-form");
    if (!mfaForm || mfaForm.dataset.boundUnified) return;
    mfaForm.dataset.boundUnified = "1";
    mfaForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!pendingChallenge) {
        setStatus("Session expired. Sign in again.");
        return;
      }
      setStatus("Verifying code…");
      const code = new FormData(mfaForm).get("code");
      try {
        const data = await postJson("/auth/mfa/verify", {
          challenge_token: pendingChallenge,
          code,
        });
        storeSession(data);
        window.location.href = redirectForRole(data, pendingRedirect || "admin.html");
      } catch (error) {
        setStatus(error.message || "Verification failed");
      }
    });
  }

  function redirectIfSession() {
    const role = localStorage.getItem("userRole");
    const token = localStorage.getItem("token");
    if (!token) return false;
    if (role === "employee") {
      window.location.replace(portalUrl("employee.html"));
      return true;
    }
    if (role && role !== "employee") {
      window.location.replace(portalUrl("admin.html"));
      return true;
    }
    return false;
  }

  const form = document.getElementById("portal-login-form");
  if (!form || form.dataset.boundUnified) return;
  if (redirectIfSession()) return;
  form.dataset.boundUnified = "1";
  bindMfaForm();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Signing in…");
    const raw = Object.fromEntries(new FormData(form).entries());
    const payload = { username: raw.username, password: raw.password };
    try {
      const { data, redirect } = await loginWithAutoPortal(payload);
      pendingRedirect = redirect;
      if (data.mfa_required && data.challenge_token) {
        pendingChallenge = data.challenge_token;
        setStatus("");
        showMfaStep(data.username || payload.username);
        return;
      }
      if (data.mfa_enrollment_required && data.enrollment_token) {
        window.location.href = portalUrl("native-app-login.html?source=native&mfa=1");
        return;
      }
      storeSession(data);
      window.location.href = redirect;
    } catch (error) {
      setStatus(error.message || "Login failed");
    }
  });
})();
