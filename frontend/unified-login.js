/** Unified email-first sign-in — PWA + native app (single portal resolution). */
(function initShiftSwiftUnifiedLogin() {
  const DEFAULT_FORGOT = "./employee-forgot-password.html";

  let pendingChallenge = null;
  let pendingRedirect = "./admin.html";
  let pendingEnrollmentToken = null;
  let pendingEmail = "";
  let pendingMfaMethod = "email";
  let pendingMfaMeta = {
    totpAvailable: false,
    emailAvailable: true,
    emailHint: "",
    emailSent: false,
  };

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
    for (const id of ["login-status", "mfa-status"]) {
      const status = document.getElementById(id);
      if (!status) continue;
      status.textContent = message || "";
      status.hidden = !message;
    }
  }

  function escapeLoginHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
      const url = `${getApiBase()}${path}`;
      const reqInit = {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      };
      if (window.ShiftSwiftNativeApiFetch?.nativeAwareFetch) {
        response = await window.ShiftSwiftNativeApiFetch.nativeAwareFetch(url, reqInit);
      } else {
        response = await fetch(url, reqInit);
      }
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
    if (String(data.portal || "") === "master" || (data.role === "admin" && isMasterTenantId(data.tenant_id))) {
      return portalUrl("master.html");
    }
    if (data.role === "hr" || data.role === "admin") return portalUrl("admin.html");
    const fb = String(fallback || "admin.html");
    if (/^https?:\/\//i.test(fb)) return withNativeSource(fb);
    return portalUrl(fb.replace(/^\.\//, ""));
  }

  function isMasterTenantId(tenantId) {
    if (tenantId == null) return false;
    const masterId = localStorage.getItem("masterTenantId") || "999";
    return String(tenantId) === String(masterId);
  }

  function applyPortalLead(portalInfo) {
    const lead = document.getElementById("login-lead");
    if (!lead || !portalInfo?.lead) return;
    lead.textContent = portalInfo.lead;
  }

  async function resolvePortalForEmail(email) {
    try {
      const info = await postJson("/auth/resolve-login-portal", { username: email });
      if (info?.portal && info.portal !== "unknown") {
        return {
          ...info,
          useAutoPortal: false,
        };
      }
    } catch {
      /* fall back to unified auto-detect */
    }
    return defaultPortalInfo();
  }

  function friendlyLoginError(message) {
    if (message === "Failed to fetch" || message === "Load failed") {
      if (window.ShiftSwiftBrand?.isLocalDevHost?.()) {
        return "Cannot reach the API. Start it with: bash scripts/start_local.sh";
      }
      return "Cannot reach the API. Check your connection and try again.";
    }
    if (String(message || "").includes("Master console not available from this network")) {
      return "Platform master sign-in is not allowed from this network. Use approved Wi‑Fi or VPN.";
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

  function markPostLoginTransition() {
    try {
      sessionStorage.setItem("sshrPostLoginTransition", "1");
    } catch {
      /* ignore */
    }
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
    markPostLoginTransition();
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

    const masterHint = /platform master|separate sign-in page/i.test(String(lastError?.message || ""));
    if (masterHint) {
      try {
        const data = await postJson("/auth/master-login", payload);
        return { data, redirect: redirectForRole(data, portalUrl("master.html")) };
      } catch (error) {
        throw error;
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

  function setLoginStep(step) {
    document.body.classList.remove("login-step-mfa", "login-step-enroll");
    if (step === "mfa") document.body.classList.add("login-step-mfa");
    if (step === "enroll") document.body.classList.add("login-step-enroll");
  }

  function showLoginForm() {
    const loginShell = document.getElementById("login-shell");
    const mfaPanel = document.getElementById("mfa-panel");
    const enrollmentPanel = document.getElementById("mfa-enrollment-panel");
    if (loginShell) loginShell.hidden = false;
    if (mfaPanel) mfaPanel.hidden = true;
    if (enrollmentPanel) enrollmentPanel.hidden = true;
    setLoginStep("signin");
    const lead = document.getElementById("login-lead");
    if (lead) lead.textContent = "Enter your work email and password.";
    setStatus("");
  }

  function captureMfaMeta(data, username) {
    pendingEmail = username || data?.username || pendingEmail || "";
    const methods = Array.isArray(data?.mfa_methods) ? data.mfa_methods : [];
    const emailAvailable = Boolean(
      data?.email_mfa_available ?? (methods.includes("email") || data?.email_sent || data?.email_hint),
    );
    const totpAvailable = Boolean(data?.totp_available ?? methods.includes("totp"));
    pendingMfaMeta = {
      totpAvailable,
      emailAvailable: emailAvailable || !totpAvailable,
      emailHint: data?.email_hint || pendingEmail,
      emailSent: Boolean(data?.email_sent),
    };
    const defaultMethod = String(data?.default_mfa_method || "").toLowerCase();
    if (defaultMethod === "totp" && totpAvailable && !emailAvailable) pendingMfaMethod = "totp";
    else if (pendingMfaMeta.emailAvailable) pendingMfaMethod = "email";
    else pendingMfaMethod = "totp";
  }

  function applyMfaMethodUi() {
    const mfaPanel = document.getElementById("mfa-panel");
    if (!mfaPanel) return;
    const { totpAvailable, emailAvailable, emailHint, emailSent } = pendingMfaMeta;
    const resolved =
      pendingMfaMethod === "totp" && totpAvailable
        ? "totp"
        : emailAvailable || !totpAvailable
          ? "email"
          : "totp";
    pendingMfaMethod = resolved;
    const lead = document.getElementById("mfa-lead") || mfaPanel.querySelector(".portal-login-card-lead");
    const heading = mfaPanel.querySelector("h1");
    if (resolved === "email") {
      if (heading) heading.textContent = "Check your email";
      if (lead) {
        const hint = escapeLoginHtml(emailHint || pendingEmail);
        lead.innerHTML = emailSent
          ? `We emailed a 6-digit code to <strong data-mfa-user>${hint}</strong>. Check inbox and spam.`
          : `Enter the 6-digit code we email to <strong data-mfa-user>${hint}</strong>.`;
      }
    } else {
      if (heading) heading.textContent = "Two-factor authentication";
      if (lead) {
        lead.innerHTML = `Enter the 6-digit code from your authenticator app for <strong data-mfa-user>${escapeLoginHtml(pendingEmail)}</strong>.`;
      }
    }
    const labelText = document.getElementById("mfa-code-label-text");
    if (labelText) labelText.textContent = resolved === "email" ? "Email code" : "Authenticator code";
    const codeInput = mfaPanel.querySelector('input[name="code"]');
    if (codeInput) codeInput.value = "";
    const resendWrap = document.getElementById("mfa-resend-wrap");
    if (resendWrap) resendWrap.hidden = resolved !== "email";
    const altWrap = document.getElementById("mfa-alt-methods");
    const totpBtn = document.getElementById("mfa-use-totp-btn");
    if (altWrap) altWrap.hidden = !(totpAvailable && resolved === "email");
    if (totpBtn) totpBtn.hidden = !(totpAvailable && resolved === "email");
    if (codeInput) codeInput.focus();
  }

  async function resendEmailMfaCode() {
    if (!pendingChallenge) {
      setStatus("Session expired. Sign in again.");
      showLoginForm();
      return;
    }
    setStatus("Sending a new code…");
    try {
      const data = await postJson("/auth/mfa/send-email-code", {
        challenge_token: pendingChallenge,
      });
      if (data.email_hint) pendingMfaMeta.emailHint = data.email_hint;
      pendingMfaMeta.emailSent = true;
      pendingMfaMethod = "email";
      applyMfaMethodUi();
      setStatus(data.message || "We emailed a 6-digit code. Check your inbox and spam folder.");
    } catch (error) {
      setStatus(error.message || "Could not email your sign-in code. Tap Resend to try again.");
    }
  }

  function showMfaStep(username, data) {
    captureMfaMeta(data, username);
    const loginShell = document.getElementById("login-shell");
    const mfaPanel = document.getElementById("mfa-panel");
    const enrollmentPanel = document.getElementById("mfa-enrollment-panel");
    if (loginShell) loginShell.hidden = true;
    if (enrollmentPanel) enrollmentPanel.hidden = true;
    setLoginStep("mfa");
    if (mfaPanel) {
      mfaPanel.hidden = false;
      applyMfaMethodUi();
    }
    if (pendingMfaMethod === "email" && !pendingMfaMeta.emailSent) {
      void resendEmailMfaCode();
    } else if (data?.message && data.email_sent) {
      setStatus("");
    } else if (data?.message) {
      setStatus(data.message);
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
    if (portalInfo?.portal === "master") return "/auth/master-login";
    if (portalInfo?.portal === "employee") return "/auth/employee-login";
    if (portalInfo?.portal === "hr") return "/auth/business-login";
    return "/auth/unified-login";
  }

  function loginRedirect(portalInfo) {
    if (portalInfo?.redirect_path) return portalUrl(portalInfo.redirect_path);
    if (portalInfo?.portal === "master") return portalUrl("master.html");
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
    setLoginStep("enroll");
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
      document.getElementById("mfa-resend-btn")?.addEventListener("click", () => {
        void resendEmailMfaCode();
      });
      document.getElementById("mfa-use-totp-btn")?.addEventListener("click", () => {
        pendingMfaMethod = "totp";
        applyMfaMethodUi();
        setStatus("");
      });
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
            method: pendingMfaMethod === "totp" ? "totp" : "email",
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

  function showMasterLoginNotice() {
    try {
      const notice = sessionStorage.getItem("masterLoginNotice");
      if (!notice) return;
      sessionStorage.removeItem("masterLoginNotice");
      setStatus(notice);
    } catch {
      /* ignore */
    }
  }

  function revealLoginShell() {
    document.documentElement.classList.remove("native-startup-active");
    document.body?.classList.remove("native-startup-active");
    const loader = document.getElementById("native-startup-loader");
    if (loader) {
      loader.classList.add("is-done");
      loader.setAttribute("aria-hidden", "true");
      window.setTimeout(() => loader.remove(), 320);
    }
    window.ShiftSwiftNativeStartup?.finish?.();
    window.ShiftSwiftNativeApp?.hideSplash?.();
    window.dispatchEvent(new CustomEvent("shiftswift:startup-loader-done"));
  }

  async function init() {
    if (document.body.dataset.loginPage !== "unified") return;
    showMasterLoginNotice();
    bindKeyboardScroll();
    bindUnifiedLogin();
    if (await window.ShiftSwiftTrustedDevice?.tryQuickUnlock?.()) return;
    if (await window.ShiftSwiftSession?.redirectIfLoggedIn?.()) return;
    revealLoginShell();
    showLoginForm();
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

      setStatus("Signing in…");
      const submitBtn = document.getElementById("login-submit");
      if (submitBtn) submitBtn.disabled = true;

      try {
        const portalInfo = await resolvePortalForEmail(email);
        applyPortalLead(portalInfo);
        pendingRedirect = loginRedirect(portalInfo);
        const result = await submitLogin(email, password, portalInfo);
        const { data, redirect } = result;
        pendingRedirect = redirect;
        if (data.mfa_required && data.challenge_token) {
          pendingChallenge = data.challenge_token;
          pendingEmail = email;
          showMfaStep(data.username || email, data);
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
