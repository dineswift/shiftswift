/** Unified email-first sign-in — PWA + native app (single portal resolution). */
(function initShiftSwiftUnifiedLogin() {
  const DEFAULT_FORGOT = "./employee-forgot-password.html";

  let pendingChallenge = null;
  let pendingRedirect = "./admin.html";
  let pendingEnrollmentToken = null;
  let pendingEmail = "";
  let pendingMfaMethod = "email";
  let pendingMfaMeta = {
    passkeyAvailable: false,
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

  function setStatusMessage(el, message) {
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
  }

  function ensureMfaVerifyStatus() {
    let status = document.getElementById("mfa-verify-status");
    if (status) return status;
    const form = document.getElementById("mfa-form");
    if (!form) return null;
    status = document.createElement("p");
    status.id = "mfa-verify-status";
    status.className = "form-error-message";
    status.hidden = true;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) form.insertBefore(status, submit);
    else form.appendChild(status);
    return status;
  }

  function setStatus(message) {
    if (document.body.classList.contains("login-step-mfa")) {
      setStatusMessage(ensureMfaVerifyStatus(), message);
      return;
    }
    if (document.body.classList.contains("login-step-enroll")) {
      setEnrollmentStatus(message);
      return;
    }
    setStatusMessage(document.getElementById("login-status"), message);
  }

  function setEnrollmentStatus(message) {
    setStatusMessage(document.getElementById("mfa-enrollment-status"), message);
  }

  function normalizeMfaCode(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, "");
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
        body: JSON.stringify(body == null ? {} : body),
        signal: controller?.signal,
      };
      if (window.ShiftSwiftNativeApiFetch?.isCapacitorHttpEnabled?.()) {
        response = await fetch(url, reqInit);
      } else if (window.ShiftSwiftNativeApiFetch?.nativeAwareFetch) {
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
      if (response.status === 404 && String(path).includes("skip-enrollment")) {
        throw new Error(
          "Skip MFA is not available on this server yet. Enter a code from your authenticator app, or deploy the latest API.",
        );
      }
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
    if (data.workspace_role) localStorage.setItem("workspaceRole", data.workspace_role);
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
    if (email) {
      try {
        localStorage.setItem("employeeUsername", email);
      } catch {
        /* ignore */
      }
    }
    if (window.ShiftSwiftSession?.storeSession) {
      window.ShiftSwiftSession.storeSession({ ...data, username: data?.username || email });
    } else {
      storeSession({ ...data, username: data?.username || email });
    }
    if (window.ShiftSwiftSession?.confirmNativeSessionPersisted) {
      await window.ShiftSwiftSession.confirmNativeSessionPersisted();
    } else if (window.ShiftSwiftSession?.persistNativeSession) {
      await window.ShiftSwiftSession.persistNativeSession();
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    window.ShiftSwiftSession?.bridgeNativeSessionForNextPage?.();

    if (isNativeShell()) {
      const leaf = (() => {
        try {
          const parsed = new URL(String(redirect), window.location.href);
          const name = parsed.pathname.split("/").filter(Boolean).pop();
          return name && /\.html$/i.test(name) ? name : "admin.html";
        } catch {
          return "admin.html";
        }
      })();
      redirect =
        window.ShiftSwiftSession?.buildNativePortalRedirectUrl?.(leaf) ||
        window.ShiftSwiftSession?.nativePortalRedirectAfterLogin?.(data, redirect) ||
        redirect;
    }

    await window.ShiftSwiftTrustedDevice?.rememberDeviceFromResponse?.(email, data);
    window.ShiftSwiftPasskeyAuth?.rememberLastEmail?.(email);
    if (window.ShiftSwiftPasskeyAuth?.isPasskeyOptIn?.()) {
      try {
        await window.ShiftSwiftPasskeyAuth.registerPasskey(email);
      } catch {
        /* optional — password login still succeeded */
      }
    }
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
    const mfaRemember = document.getElementById("login-remember-device-mfa");
    if (mfaRemember) delete mfaRemember.dataset.synced;
    const lead = document.getElementById("login-lead");
    if (lead) lead.textContent = "Enter your work email and password.";
    setStatus("");
  }

  function showMfaStep(username, meta = {}) {
    pendingEmail = username || pendingEmail || normalizeEmail(getEmailInput()?.value);
    const passkeyAvailable = Boolean(meta.passkeyAvailable ?? meta.passkey_available);
    const totpAvailable = Boolean(meta.totpAvailable ?? meta.totp_available);
    const emailFlag = meta.emailAvailable ?? meta.email_mfa_available;
    const emailAvailable = emailFlag !== false;
    const emailHint = meta.emailHint || meta.email_hint || username || pendingEmail;
    const emailSent = Boolean(meta.emailSent ?? meta.email_sent);
    const serverMessage = String(meta.message || "");
    const defaultMethod = String(meta.defaultMethod || meta.default_mfa_method || "").toLowerCase();
    pendingMfaMeta = {
      passkeyAvailable,
      totpAvailable,
      emailAvailable,
      emailHint,
      emailSent,
    };
    if (defaultMethod === "totp" && totpAvailable && !emailAvailable) pendingMfaMethod = "totp";
    else if (emailAvailable) pendingMfaMethod = "email";
    else if (totpAvailable) pendingMfaMethod = "totp";
    else pendingMfaMethod = "email";

    const loginShell = document.getElementById("login-shell");
    const mfaPanel = document.getElementById("mfa-panel");
    const enrollmentPanel = document.getElementById("mfa-enrollment-panel");
    if (loginShell) loginShell.hidden = true;
    if (enrollmentPanel) enrollmentPanel.hidden = true;
    setLoginStep("mfa");
    if (mfaPanel) {
      mfaPanel.hidden = false;
      applyMfaMethodUi();
      if (serverMessage) setStatus(serverMessage);
      else if (pendingMfaMethod === "email" && emailSent) {
        setStatus("Check your inbox and spam folder for the 6-digit code.");
      } else if (pendingMfaMethod === "email" && !emailSent) {
        setStatus("Sending email code…");
        void ensureEmailCodeSent();
      }
      mfaPanel.querySelector('input[name="code"]')?.focus();
    }
  }

  async function ensureEmailCodeSent() {
    if (!pendingChallenge) return;
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

  function applyMfaMethodUi() {
    const mfaPanel = document.getElementById("mfa-panel");
    if (!mfaPanel) return;
    const { passkeyAvailable, totpAvailable, emailAvailable, emailHint, emailSent } = pendingMfaMeta;
    const canPasskey = passkeyAvailable && Boolean(window.ShiftSwiftPasskeyAuth?.canUsePasskeys?.());
    const method =
      pendingMfaMethod === "totp" && totpAvailable
        ? "totp"
        : emailAvailable || !totpAvailable
          ? "email"
          : "totp";
    pendingMfaMethod = method;

    const title = document.getElementById("mfa-panel-title");
    if (title) title.textContent = method === "email" ? "Check your email" : "Authenticator code";

    const lead = document.getElementById("mfa-panel-lead") || mfaPanel.querySelector(".portal-login-card-lead");
    if (lead) {
      if (method === "email") {
        const hint = escapeHtml(emailHint || pendingEmail);
        lead.innerHTML = emailSent
          ? `We emailed a 6-digit code to <strong data-mfa-user>${hint}</strong>. Check inbox and spam.`
          : `Enter the 6-digit code we email to <strong data-mfa-user>${hint}</strong>.`;
      } else {
        lead.innerHTML = `Enter the 6-digit code from your authenticator app for <strong data-mfa-user>${escapeHtml(pendingEmail)}</strong>.`;
      }
    }

    const labelText = document.getElementById("mfa-code-label-text");
    if (labelText) {
      labelText.textContent = method === "email" ? "Email code" : "Authenticator code";
    }
    const codeInput = mfaPanel.querySelector('input[name="code"]');
    if (codeInput) codeInput.value = "";

    const passkeyBtn = document.getElementById("mfa-passkey-btn");
    if (passkeyBtn) passkeyBtn.hidden = !canPasskey;
    const divider = document.getElementById("mfa-passkey-divider");
    if (divider) divider.hidden = !canPasskey;

    const resendWrap = document.getElementById("mfa-resend-wrap");
    if (resendWrap) resendWrap.hidden = method !== "email" || !emailAvailable;

    const alt = document.getElementById("mfa-alt-methods");
    const useEmailBtn = document.getElementById("mfa-use-email-btn");
    const useTotpBtn = document.getElementById("mfa-use-totp-btn");
    if (alt) alt.hidden = !(emailAvailable && totpAvailable);
    if (useEmailBtn) useEmailBtn.hidden = !(emailAvailable && method !== "email");
    if (useTotpBtn) useTotpBtn.hidden = !(totpAvailable && method !== "totp");

    const signInRemember = document.getElementById("login-remember-device");
    const mfaRemember = document.getElementById("login-remember-device-mfa");
    if (signInRemember && mfaRemember && !mfaRemember.dataset.synced) {
      mfaRemember.checked = signInRemember.checked;
      mfaRemember.dataset.synced = "1";
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindKeyboardScroll() {
    if (window.ShiftSwiftNativeKeyboard?.bind) {
      window.ShiftSwiftNativeKeyboard.bind({ scope: "login" });
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport || window.__SSHR_UNIFIED_KEYBOARD_BOUND__) return;
    window.__SSHR_UNIFIED_KEYBOARD_BOUND__ = true;
    const root = document.documentElement;
    let lastInset = -1;
    let rafId = 0;
    const adjust = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const raw = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        const inset = raw < 48 ? 0 : Math.round(raw / 8) * 8;
        if (Math.abs(inset - lastInset) < 8) return;
        lastInset = inset;
        root.style.setProperty("--native-keyboard-inset", `${inset}px`);
        root.classList.toggle("native-keyboard-open", inset > 0);
      });
    };
    viewport.addEventListener("resize", adjust, { passive: true });
    adjust();
  }

  function scrollLoginControlIntoView(element) {
    if (!element || !isNativeShell()) return;
    // Instant scroll — smooth + keyboard inset fighting causes shake on iOS
    window.setTimeout(() => {
      try {
        element.scrollIntoView({ block: "nearest", behavior: "auto" });
      } catch {
        /* ignore */
      }
    }, 120);
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
    const passkeyBtn = document.getElementById("mfa-enrollment-passkey-btn");
    if (passkeyBtn) {
      passkeyBtn.hidden = !window.ShiftSwiftPasskeyAuth?.canUsePasskeys?.();
    }
    try {
      const setup = await postJson("/auth/mfa/setup", null, pendingEnrollmentToken);
      const secretEl = document.getElementById("mfa-enrollment-secret");
      const qrImg = document.getElementById("mfa-enrollment-qr");
      const qrWrap = document.getElementById("mfa-enrollment-qr-wrap");
      if (secretEl) secretEl.textContent = setup.manual_secret || "";
      if (qrImg && (setup.qr_data_uri || setup.otpauth_uri)) {
        qrImg.src =
          setup.qr_data_uri ||
          `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setup.otpauth_uri)}`;
      }
      if (qrWrap) qrWrap.hidden = !(setup.qr_data_uri || setup.otpauth_uri);
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
        const code = normalizeMfaCode(new FormData(mfaForm).get("code"));
        if (!code || code.length < 6) {
          setStatus(
            pendingMfaMethod === "email"
              ? "Enter the 6-digit code from your email."
              : "Enter the 6-digit code from your authenticator app.",
          );
          return;
        }
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

    const resendBtn = document.getElementById("mfa-resend-btn");
    if (resendBtn && !resendBtn.dataset.boundUnified) {
      resendBtn.dataset.boundUnified = "1";
      resendBtn.addEventListener("click", async () => {
        if (!pendingChallenge) {
          setStatus("Session expired. Sign in again.");
          showLoginForm();
          return;
        }
        setStatus("Sending a new code…");
        resendBtn.disabled = true;
        try {
          const data = await postJson("/auth/mfa/send-email-code", {
            challenge_token: pendingChallenge,
          });
          if (data.email_hint) pendingMfaMeta.emailHint = data.email_hint;
          pendingMfaMethod = "email";
          applyMfaMethodUi();
          setStatus(data.message || "We sent a new code to your email.");
        } catch (error) {
          setStatus(error.message || "Could not resend code");
        } finally {
          window.setTimeout(() => {
            resendBtn.disabled = false;
          }, 2000);
        }
      });
    }

    const useEmailBtn = document.getElementById("mfa-use-email-btn");
    if (useEmailBtn && !useEmailBtn.dataset.boundUnified) {
      useEmailBtn.dataset.boundUnified = "1";
      useEmailBtn.addEventListener("click", async () => {
        pendingMfaMethod = "email";
        applyMfaMethodUi();
        setStatus("Sending email code…");
        try {
          const data = await postJson("/auth/mfa/send-email-code", {
            challenge_token: pendingChallenge,
          });
          if (data.email_hint) pendingMfaMeta.emailHint = data.email_hint;
          applyMfaMethodUi();
          setStatus(data.message || "We sent a code to your email.");
          document.querySelector('#mfa-form input[name="code"]')?.focus();
        } catch (error) {
          setStatus(error.message || "Could not send email code");
        }
      });
    }

    const useTotpBtn = document.getElementById("mfa-use-totp-btn");
    if (useTotpBtn && !useTotpBtn.dataset.boundUnified) {
      useTotpBtn.dataset.boundUnified = "1";
      useTotpBtn.addEventListener("click", () => {
        pendingMfaMethod = "totp";
        applyMfaMethodUi();
        setStatus("");
        document.querySelector('#mfa-form input[name="code"]')?.focus();
      });
    }

    const backBtn = document.getElementById("mfa-back-signin");
    if (backBtn && !backBtn.dataset.boundUnified) {
      backBtn.dataset.boundUnified = "1";
      backBtn.addEventListener("click", () => {
        pendingChallenge = null;
        pendingMfaMethod = "email";
        const mfaRemember = document.getElementById("login-remember-device-mfa");
        if (mfaRemember) delete mfaRemember.dataset.synced;
        showLoginForm();
      });
    }

    const mfaPasskeyBtn = document.getElementById("mfa-passkey-btn");
    if (mfaPasskeyBtn && !mfaPasskeyBtn.dataset.boundUnified) {
      mfaPasskeyBtn.dataset.boundUnified = "1";
      mfaPasskeyBtn.addEventListener("click", async () => {
        if (!pendingChallenge) {
          setStatus("Session expired. Sign in again.");
          showLoginForm();
          return;
        }
        setStatus("Waiting for Face ID…");
        mfaPasskeyBtn.disabled = true;
        try {
          const data = await window.ShiftSwiftPasskeyAuth.verifyMfaWithPasskey(
            pendingChallenge,
            pendingEmail || normalizeEmail(getEmailInput()?.value),
          );
          await finishAuthSuccess(data, pendingEmail, redirectForRole(data, pendingRedirect));
        } catch (error) {
          setStatus(error.message || "Face ID verification failed");
        } finally {
          mfaPasskeyBtn.disabled = false;
        }
      });
    }

    const enrollPasskeyBtn = document.getElementById("mfa-enrollment-passkey-btn");
    if (enrollPasskeyBtn && !enrollPasskeyBtn.dataset.boundUnified) {
      enrollPasskeyBtn.dataset.boundUnified = "1";
      enrollPasskeyBtn.addEventListener("click", async () => {
        if (!pendingEnrollmentToken) {
          setEnrollmentStatus("Session expired. Sign in again.");
          showLoginForm();
          return;
        }
        setEnrollmentStatus("Setting up Face ID…");
        enrollPasskeyBtn.disabled = true;
        try {
          const data = await window.ShiftSwiftPasskeyAuth.enrollMfaWithPasskey(pendingEnrollmentToken);
          await finishAuthSuccess(
            data,
            pendingEmail || data.username || "",
            portalUrl(data.redirect_url || pendingRedirect),
          );
        } catch (error) {
          const raw = String(error?.message || "").trim();
          if (/^(Load failed|Failed to fetch)$/i.test(raw) || /rpid did not match|related origins/i.test(raw)) {
            setEnrollmentStatus(
              "Face ID could not start on this device. Scan the QR code and enter the 6-digit code to continue — you can enable Face ID later in Settings.",
            );
          } else {
            setEnrollmentStatus(raw || "Could not enable Face ID — try the authenticator app instead");
          }
          enrollPasskeyBtn.disabled = false;
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
        const code = normalizeMfaCode(document.getElementById("mfa-enrollment-code")?.value);
        if (!code || code.length < 6) {
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

    const skipBtn = document.getElementById("mfa-enrollment-skip");
    if (skipBtn && !skipBtn.dataset.boundUnified) {
      skipBtn.dataset.boundUnified = "1";
      skipBtn.addEventListener("click", async () => {
        if (!pendingEnrollmentToken) {
          setEnrollmentStatus("Session expired. Sign in again.");
          showLoginForm();
          return;
        }
        setEnrollmentStatus("Continuing without MFA…");
        skipBtn.disabled = true;
        const enableBtn = document.getElementById("mfa-enrollment-submit");
        if (enableBtn) enableBtn.disabled = true;
        try {
          const data = await postJson("/auth/mfa/skip-enrollment", null, pendingEnrollmentToken);
          await finishAuthSuccess(
            data,
            pendingEmail || data.username || "",
            portalUrl(data.redirect_url || pendingRedirect),
          );
        } catch (error) {
          setEnrollmentStatus(error.message || "Could not skip MFA setup");
          skipBtn.disabled = false;
          if (enableBtn) enableBtn.disabled = false;
        }
      });
    }
  }

  function showMasterLoginNotice() {
    try {
      const notice = sessionStorage.getItem("masterLoginNotice");
      if (notice) {
        sessionStorage.removeItem("masterLoginNotice");
        setStatus(notice);
        return;
      }
    } catch {
      /* ignore */
    }
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("passwordReset") === "1") {
        setStatus(
          "Password updated. Sign in with your new password — we will email a 6-digit code next.",
        );
        params.delete("passwordReset");
        const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash || ""}`;
        window.history.replaceState({}, "", clean);
      }
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
    window.ShiftSwiftPasskeyAuth?.bindPasskeyUi?.();
    let bouncedFromPortal = false;
    try {
      bouncedFromPortal = sessionStorage.getItem("sshrAuthBouncedToLogin") === "1";
      if (bouncedFromPortal) sessionStorage.removeItem("sshrAuthBouncedToLogin");
    } catch {
      /* ignore */
    }
    if (!bouncedFromPortal && (await window.ShiftSwiftTrustedDevice?.tryQuickUnlock?.())) return;
    if (!bouncedFromPortal && (await window.ShiftSwiftPasskeyAuth?.tryAutoLogin?.())) return;
    if (!bouncedFromPortal && (await window.ShiftSwiftSession?.redirectIfLoggedIn?.())) return;
    revealLoginShell();
    showLoginForm();
  }

  function bindUnifiedLogin() {
    const form = document.getElementById("portal-login-form");
    if (!form || form.dataset.boundUnified) return;
    form.dataset.boundUnified = "1";

    bindMfaForms();

    const forgotLink = document.getElementById("forgot-password-link");
    if (forgotLink) {
      const href = portalUrl(DEFAULT_FORGOT);
      forgotLink.href = href;
      if (!forgotLink.dataset.boundForgot) {
        forgotLink.dataset.boundForgot = "1";
        forgotLink.addEventListener("click", (event) => {
          event.preventDefault();
          window.location.assign(forgotLink.href || href);
        });
      }
    }

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
