/** Unified email-first sign-in — PWA + native app (single portal resolution). */
(function initShiftSwiftUnifiedLogin() {
  const DEFAULT_FORGOT = "./employee-forgot-password.html";

  let pendingChallenge = null;
  let pendingRedirect = "./admin.html";
  let pendingEnrollmentToken = null;
  let pendingEmail = "";

  function getApiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    return localStorage.getItem("apiBaseUrl") || "https://api.shiftswifthr.co.uk";
  }

  function isNativeShell() {
    return Boolean(window.ShiftSwiftNativeApp?.isCapacitorNative?.());
  }

  function portalUrl(path) {
    if (window.ShiftSwiftSession?.portalUrl) {
      return window.ShiftSwiftSession.portalUrl(path);
    }
    const clean = String(path || "").trim().replace(/^\.\//, "");
    if (!clean) return "./admin.html";
    if (/^https?:\/\//i.test(clean)) return clean;
    return `./${clean}`;
  }

  function withNativeSource(url) {
    if (window.ShiftSwiftSession?.withNativeSource) {
      return window.ShiftSwiftSession.withNativeSource(url);
    }
    return url;
  }

  function setStatus(message) {
    const status = document.getElementById("login-status");
    if (!status) return;
    status.textContent = message || "";
    status.hidden = !message;
  }

  function setEnrollmentStatus(message) {
    const status = document.getElementById("mfa-enrollment-status");
    if (!status) return;
    status.textContent = message || "";
    status.hidden = !message;
  }

  async function postJson(path, body, bearerToken, options = {}) {
    const headers = { "Content-Type": "application/json" };
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
    const timeoutMs = Number(options.timeoutMs) || 0;
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeoutId =
      controller &&
      window.setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    let response;
    try {
      response = await fetch(`${getApiBase()}${path}`, {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Request timed out");
      }
      throw new Error("Failed to fetch");
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
      throw new Error(message || data.message || "Request failed");
    }
    return data;
  }

  function storeSession(data) {
    if (window.ShiftSwiftSession?.storeSession) {
      window.ShiftSwiftSession.storeSession(data);
      return;
    }
    if (data.access_token) localStorage.setItem("token", data.access_token);
    if (data.refresh_token) localStorage.setItem("refreshToken", data.refresh_token);
    if (data.role) localStorage.setItem("userRole", data.role);
    if (data.tenant_id) {
      localStorage.setItem("masterTenantId", data.tenant_id);
      localStorage.setItem("tenantId", data.tenant_id);
    }
    try {
      localStorage.setItem("sshrNativeApp", "1");
      if (isNativeShell()) localStorage.setItem("sshrUnifiedNativeApp", "1");
    } catch {
      /* ignore */
    }
  }

  function redirectForRole(data, fallback) {
    if (data.role === "employee") return portalUrl("employee.html");
    if (data.role === "admin" && String(data.portal || "") === "master") return portalUrl("master.html");
    if (data.role === "hr" || data.role === "admin") return portalUrl("admin.html");
    const fb = String(fallback || "admin.html");
    if (/^https?:\/\//i.test(fb)) return withNativeSource(fb);
    return portalUrl(fb.replace(/^\.\//, ""));
  }

  function friendlyLoginError(message) {
    if (message === "Failed to fetch" || message === "Load failed") {
      if (window.ShiftSwiftBrand?.isLocalDevHost?.()) {
        return "Cannot reach the API. Start it with: bash scripts/start_local.sh";
      }
      return "Cannot reach the API. Check your connection and try again.";
    }
    return message || "Login failed";
  }

  const PORTAL_MISMATCH_HINTS = [
    "employee sign-in page",
    "HR admin account",
    "business sign-in page",
    "Invalid credentials for this login type",
  ];

  function isPortalMismatch(message) {
    const text = String(message || "");
    return PORTAL_MISMATCH_HINTS.some((hint) => text.includes(hint));
  }

  async function buildLoginPayload(email, password) {
    const payload = { username: email, password };
    const deviceToken = await window.ShiftSwiftTrustedDevice?.getTrustedToken?.(email);
    if (deviceToken) payload.device_token = deviceToken;
    return payload;
  }

  async function maybeEnableBiometricUnlock() {
    if (!isNativeShell()) return;
    if (window.ShiftSwiftTrustedDevice?.isBiometricUnlockEnabled?.()) return;
    const canUse = await window.ShiftSwiftTrustedDevice?.canUseBiometricUnlock?.();
    if (!canUse) return;
    window.ShiftSwiftTrustedDevice?.setBiometricUnlockEnabled?.(true);
  }

  async function finishAuthSuccess(data, email, redirect) {
    if (window.ShiftSwiftSession?.storeSession) {
      window.ShiftSwiftSession.storeSession(data);
    } else {
      storeSession(data);
    }
    if (window.ShiftSwiftSession?.persistNativeSession) {
      await window.ShiftSwiftSession.persistNativeSession();
    }
    await window.ShiftSwiftTrustedDevice?.rememberDeviceFromResponse?.(email, data);
    await maybeEnableBiometricUnlock();
    window.location.replace(redirect);
  }

  function mfaRememberPayload() {
    return {
      remember_device: Boolean(window.ShiftSwiftTrustedDevice?.shouldRememberDevice?.()),
      device_label: window.ShiftSwiftTrustedDevice?.deviceLabel?.() || undefined,
    };
  }
  async function loginWithAutoPortal(email, password) {
    const payload = await buildLoginPayload(email, password);
    const modes = [
      { endpoint: "/auth/business-login", redirect: "admin.html" },
      { endpoint: "/auth/employee-login", redirect: "employee.html" },
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

  async function submitLogin(email, password, portalInfo) {
    const payload = await buildLoginPayload(email, password);
    const endpoint = loginEndpoint(portalInfo);

    if (portalInfo?.useAutoPortal || endpoint === "/auth/unified-login") {
      try {
        const data = await postJson(endpoint, payload);
        return { data, redirect: redirectForRole(data, loginRedirect(portalInfo)) };
      } catch (error) {
        if (endpoint !== "/auth/unified-login") throw error;
        return loginWithAutoPortal(email, password);
      }
    }

    const data = await postJson(endpoint, payload);
    return { data, redirect: redirectForRole(data, loginRedirect(portalInfo)) };
  }

  function getEmailInput() {
    return document.querySelector('#portal-login-form input[name="username"]');
  }

  function getPasswordInput() {
    return document.querySelector('#portal-login-form input[name="password"]');
  }

  function normalizeEmail(value) {
    return String(value || "").trim();
  }

  function showLoginForm() {
    const loginShell = document.getElementById("login-shell");
    const mfaPanel = document.getElementById("mfa-panel");
    const enrollmentPanel = document.getElementById("mfa-enrollment-panel");
    if (loginShell) loginShell.hidden = false;
    if (mfaPanel) mfaPanel.hidden = true;
    if (enrollmentPanel) enrollmentPanel.hidden = true;
    const lead = document.getElementById("login-lead");
    if (lead) lead.textContent = "Enter your work email and password.";
    setStatus("");
  }

  function showMfaStep(username) {
    pendingEmail = username || pendingEmail || normalizeEmail(getEmailInput()?.value);
    const loginShell = document.getElementById("login-shell");
    const mfaPanel = document.getElementById("mfa-panel");
    const enrollmentPanel = document.getElementById("mfa-enrollment-panel");
    if (loginShell) loginShell.hidden = true;
    if (enrollmentPanel) enrollmentPanel.hidden = true;
    if (mfaPanel) {
      mfaPanel.hidden = false;
      const userLabel = mfaPanel.querySelector("[data-mfa-user]");
      if (userLabel) userLabel.textContent = username;
      mfaPanel.querySelector('input[name="code"]')?.focus();
    }
  }

  function bindKeyboardScroll() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const adjust = () => {
      const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.style.setProperty("--native-keyboard-inset", `${keyboardInset}px`);
    };
    viewport.addEventListener("resize", adjust);
    viewport.addEventListener("scroll", adjust);
    adjust();
  }

  function scrollLoginControlIntoView(element) {
    if (!element) return;
    window.setTimeout(() => {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 280);
  }

  function defaultPortalInfo() {
    return {
      portal: "unknown",
      endpoint: "/auth/unified-login",
      redirect_path: "",
      forgot_path: DEFAULT_FORGOT,
      useAutoPortal: true,
    };
  }

  function loginEndpoint(portalInfo) {
    if (portalInfo?.endpoint) return portalInfo.endpoint;
    if (portalInfo?.portal === "employee") return "/auth/employee-login";
    if (portalInfo?.portal === "hr") return "/auth/business-login";
    return "/auth/unified-login";
  }

  function loginRedirect(portalInfo) {
    if (portalInfo?.redirect_path) return portalUrl(portalInfo.redirect_path);
    if (portalInfo?.portal === "employee") return portalUrl("employee.html");
    return portalUrl("admin.html");
  }

  async function startMfaEnrollment(data, redirectUrl) {
    pendingEnrollmentToken = data.enrollment_token;
    pendingRedirect = redirectUrl;

    const loginShell = document.getElementById("login-shell");
    const enrollmentPanel = document.getElementById("mfa-enrollment-panel");
    const mfaPanel = document.getElementById("mfa-panel");
    if (loginShell) loginShell.hidden = true;
    if (mfaPanel) mfaPanel.hidden = true;
    if (enrollmentPanel) enrollmentPanel.hidden = false;

    const userLabel = document.getElementById("mfa-enrollment-user");
    if (userLabel) userLabel.textContent = `Account: ${data.username || "your account"}`;

    setEnrollmentStatus("Preparing authenticator…");
    try {
      const setup = await postJson("/auth/mfa/setup", null, pendingEnrollmentToken);
      const secretEl = document.getElementById("mfa-enrollment-secret");
      const qrImg = document.getElementById("mfa-enrollment-qr");
      const qrWrap = document.getElementById("mfa-enrollment-qr-wrap");
      if (secretEl) secretEl.textContent = setup.manual_secret || "";
      if (qrImg && setup.otpauth_uri) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setup.otpauth_uri)}`;
      }
      if (qrWrap) qrWrap.hidden = !setup.otpauth_uri;
      setEnrollmentStatus("");
      document.getElementById("mfa-enrollment-code")?.focus();
    } catch (error) {
      setEnrollmentStatus(error.message || "Could not start MFA setup");
    }
  }

  function bindMfaForms() {
    const mfaForm = document.getElementById("mfa-form");
    if (mfaForm && !mfaForm.dataset.boundUnified) {
      mfaForm.dataset.boundUnified = "1";
      mfaForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!pendingChallenge) {
          setStatus("Session expired. Sign in again.");
          showLoginForm();
          return;
        }
        setStatus("Verifying code…");
        const code = new FormData(mfaForm).get("code");
        try {
          const data = await postJson("/auth/mfa/verify", {
            challenge_token: pendingChallenge,
            code,
            ...mfaRememberPayload(),
          });
          await finishAuthSuccess(data, pendingEmail, redirectForRole(data, pendingRedirect));
        } catch (error) {
          setStatus(error.message || "Verification failed");
        }
      });
    }

    const enrollBtn = document.getElementById("mfa-enrollment-submit");
    if (enrollBtn && !enrollBtn.dataset.boundUnified) {
      enrollBtn.dataset.boundUnified = "1";
      enrollBtn.addEventListener("click", async () => {
        if (!pendingEnrollmentToken) {
          setEnrollmentStatus("Session expired. Sign in again.");
          showLoginForm();
          return;
        }
        const code = document.getElementById("mfa-enrollment-code")?.value?.trim();
        if (!code) {
          setEnrollmentStatus("Enter the 6-digit code from your authenticator app.");
          return;
        }
        setEnrollmentStatus("Enabling MFA…");
        enrollBtn.disabled = true;
        try {
          const data = await postJson(
            "/auth/mfa/enable",
            { code, ...mfaRememberPayload() },
            pendingEnrollmentToken,
          );
          await finishAuthSuccess(
            data,
            pendingEmail || data.username || "",
            portalUrl(data.redirect_url || pendingRedirect),
          );
        } catch (error) {
          setEnrollmentStatus(error.message || "Invalid code — try again");
          enrollBtn.disabled = false;
        }
      });
    }
  }

  async function init() {
    if (document.body.dataset.loginPage !== "unified") return;
    showLoginForm();
    bindKeyboardScroll();
    bindUnifiedLogin();
    if (await window.ShiftSwiftTrustedDevice?.tryQuickUnlock?.()) return;
    if (await window.ShiftSwiftSession?.redirectIfLoggedIn?.()) return;
  }

  function bindUnifiedLogin() {
    const form = document.getElementById("portal-login-form");
    if (!form || form.dataset.boundUnified) return;
    form.dataset.boundUnified = "1";

    bindMfaForms();

    const forgotLink = document.getElementById("forgot-password-link");
    if (forgotLink) forgotLink.href = portalUrl(DEFAULT_FORGOT);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const email = normalizeEmail(getEmailInput()?.value);
      const password = getPasswordInput()?.value || "";
      if (!email || !email.includes("@")) {
        setStatus("Enter a valid work email address.");
        getEmailInput()?.focus();
        return;
      }
      if (!password) {
        setStatus("Enter your password.");
        getPasswordInput()?.focus();
        return;
      }
      pendingEmail = email;

      const portalInfo = defaultPortalInfo();
      pendingRedirect = loginRedirect(portalInfo);
      setStatus("Signing in…");
      const submitBtn = document.getElementById("login-submit");
      if (submitBtn) submitBtn.disabled = true;

      try {
        const result = await submitLogin(email, password, portalInfo);
        const { data, redirect } = result;
        pendingRedirect = redirect;
        if (data.mfa_required && data.challenge_token) {
          pendingChallenge = data.challenge_token;
          pendingEmail = email;
          setStatus("");
          showMfaStep(data.username || email);
          return;
        }
        if (data.mfa_enrollment_required && data.enrollment_token) {
          pendingEmail = email;
          setStatus("");
          await startMfaEnrollment(data, redirect);
          return;
        }
        await finishAuthSuccess(data, email, redirect);
      } catch (error) {
        setStatus(friendlyLoginError(error.message));
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    getPasswordInput()?.addEventListener("focus", () => {
      scrollLoginControlIntoView(document.getElementById("login-submit"));
    });
  }

  window.ShiftSwiftUnifiedLogin = {
    init,
    portalUrl,
    showLoginForm,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init(), { once: true });
  } else {
    void init();
  }
})();
