function getApiBase() {
  if (window.ShiftSwiftBrand?.getApiBase) {
    return window.ShiftSwiftBrand.getApiBase();
  }
  if (window.ShiftSwiftBrand?.resolveApiBase) {
    return window.ShiftSwiftBrand.resolveApiBase();
  }
  return localStorage.getItem("apiBaseUrl") || "http://localhost:3000";
}

const LOGIN_MODES = {
  business: {
    endpoint: "/auth/business-login",
    redirect: "./admin.html",
    lead: "Sign in to your ShiftSwift HR account.",
    submit: "Open HR dashboard",
    usernamePlaceholder: "hr@shiftswifthr.co.uk",
    bannerPill: "Business HR",
    bannerCopy:
      "You are signing in as an <strong>HR admin</strong> — manage employees, rotas, and compliance.",
  },
  employee: {
    endpoint: "/auth/employee-login",
    redirect: "./employee.html",
    lead: "Sign in to view payslips, documents, and your shift schedule.",
    submit: "Open employee portal",
    usernamePlaceholder: "employee@shiftswifthr.co.uk",
    bannerPill: "Employee",
    bannerCopy:
      "Sign in to clock in, view payslips, documents, and your shift schedule.",
  },
};

let pendingEnrollmentToken = null;
let pendingChallenge = null;
let pendingMfaUsername = "";
let pendingMfaMethod = "email";
let pendingMfaMeta = {
  passkeyAvailable: false,
  totpAvailable: false,
  emailAvailable: true,
  emailHint: "",
  emailSent: false,
};

function isNativeLoginApp() {
  try {
    return Boolean(
      document.documentElement.classList.contains("native-app") ||
        document.documentElement.classList.contains("iphone-app") ||
        window.Capacitor?.isNativePlatform?.(),
    );
  } catch {
    return false;
  }
}

function loginCardEl() {
  return document.getElementById("portal-login-card");
}

function setLoginStep(step) {
  const steps = ["login-step-signin", "login-step-mfa", "login-step-enroll"];
  const target = step === "mfa" ? "login-step-mfa" : step === "enroll" ? "login-step-enroll" : "login-step-signin";
  document.documentElement.classList.remove(...steps);
  document.body.classList.remove(...steps);
  loginCardEl()?.classList.remove(...steps);
  document.documentElement.classList.add(target);
  document.body.classList.add(target);
  loginCardEl()?.classList.add(target);
}

function blurLoginFocus() {
  try {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  } catch {
    /* ignore */
  }
}

function resetLoginScroll() {
  if (!isNativeLoginApp()) return;
  // Avoid fighting the soft keyboard — only reset when keyboard is closed
  try {
    const inset = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--native-keyboard-inset") || "0",
    );
    if (inset > 24) return;
  } catch {
    /* ignore */
  }
  const shell = document.querySelector(".portal-login-shell");
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  if (shell) shell.scrollTop = 0;
}

function focusLoginInput(element) {
  if (!element) return;
  window.setTimeout(() => {
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }, isNativeLoginApp() ? 120 : 0);
}

function setNativeStatusMessage(element, message) {
  if (!element) return;
  element.textContent = message || "";
  if (isNativeLoginApp()) {
    element.hidden = false;
    element.classList.toggle("is-empty", !message);
    element.setAttribute("aria-hidden", message ? "false" : "true");
    return;
  }
  element.hidden = !message;
  element.classList.remove("is-empty");
}

function syncLoginPanels(step) {
  const loginShell = document.getElementById("login-shell");
  const enrollmentPanel = document.getElementById("mfa-enrollment-panel");
  const mfaPanel = document.getElementById("mfa-panel");
  const loginTabs = document.getElementById("login-tabs");
  const loginFeatures = document.getElementById("login-features");

  blurLoginFocus();
  resetLoginScroll();

  if (isNativeLoginApp()) {
    if (loginShell) loginShell.hidden = step !== "signin";
    if (enrollmentPanel) enrollmentPanel.hidden = step !== "enroll";
    if (mfaPanel) mfaPanel.hidden = step !== "mfa";
    if (loginTabs) loginTabs.hidden = step !== "signin";
    if (loginFeatures) loginFeatures.hidden = step !== "signin";
    setLoginStep(step);
    window.requestAnimationFrame(resetLoginScroll);
    return;
  }

  if (loginShell) loginShell.hidden = step !== "signin";
  if (enrollmentPanel) enrollmentPanel.hidden = step !== "enroll";
  if (mfaPanel) mfaPanel.hidden = step !== "mfa";
  if (loginTabs) loginTabs.hidden = step !== "signin";
  if (loginFeatures) loginFeatures.hidden = step !== "signin";
  setLoginStep(step);
}

function bindNativeKeyboardInset() {
  if (!isNativeLoginApp()) return;
  if (window.ShiftSwiftNativeKeyboard?.bind) {
    window.ShiftSwiftNativeKeyboard.bind({ scope: "login" });
    return;
  }
  if (window.__SSHR_LOGIN_KEYBOARD_BOUND__) return;
  window.__SSHR_LOGIN_KEYBOARD_BOUND__ = true;
  const viewport = window.visualViewport;
  if (!viewport) return;
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

function withNativeQuery(path) {
  try {
    const parsed = new URL(String(path || "./"), window.location.href);
    if (!parsed.searchParams.get("source")) parsed.searchParams.set("source", "native");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return String(path || "./");
  }
}

function bindForgotPasswordLink() {
  const forgotLink = document.getElementById("forgot-password-link");
  if (!forgotLink || forgotLink.dataset.boundForgot === "1") return;
  forgotLink.dataset.boundForgot = "1";
  forgotLink.addEventListener("click", (event) => {
    event.preventDefault();
    const target =
      activeLoginMode === "employee"
        ? "./employee-forgot-password.html"
        : "./forgot-password.html";
    const href = withNativeQuery(forgotLink.getAttribute("href") || target);
    window.location.assign(href);
  });
  // Keep href in sync for long-press / accessibility
  forgotLink.href = withNativeQuery(
    activeLoginMode === "employee" ? "./employee-forgot-password.html" : "./forgot-password.html",
  );
}

function initNativeLoginStability() {
  if (!isNativeLoginApp() || !document.querySelector(".portal-login-page")) return;
  document.body.classList.add("portal-login-page--native-stable");
  loginCardEl()?.classList.add("login-steps-host");
  syncLoginPanels("signin");
  bindNativeKeyboardInset();
  bindForgotPasswordLink();
}

async function postJsonAuth(path, body, bearerToken) {
  const headers = { "Content-Type": "application/json" };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  window.ShiftSwiftNativeApiFetch?.boot?.();
  const url = `${getApiBase()}${path}`;
  const reqInit = {
    method: "POST",
    headers,
    // Always send a JSON body — CapacitorHttp can mishandle POST with undefined body
    body: JSON.stringify(body == null ? {} : body),
  };
  let response;
  try {
    if (window.ShiftSwiftNativeApiFetch?.nativeAwareFetch) {
      response = await window.ShiftSwiftNativeApiFetch.nativeAwareFetch(url, reqInit);
    } else {
      response = await fetch(url, reqInit);
    }
  } catch {
    throw new Error("Failed to fetch");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
    if (response.status === 404 && String(path).includes("skip-enrollment")) {
      throw new Error(
        "Skip MFA needs a server update. Deploy the latest API, or enter a code from your authenticator app.",
      );
    }
    throw new Error(message || data.message || "Request failed");
  }
  return data;
}

function setEnrollmentStatus(message) {
  setNativeStatusMessage(document.getElementById("mfa-enrollment-status"), message);
}

async function startMfaEnrollment(data, redirectUrl) {
  pendingEnrollmentToken = data.enrollment_token;
  pendingRedirect = data.redirect_url || redirectUrl;

  syncLoginPanels("enroll");

  const userLabel = document.getElementById("mfa-enrollment-user");
  if (userLabel) userLabel.textContent = `Account: ${data.username || "master admin"}`;

  setEnrollmentStatus("Preparing authenticator…");
  const enrollPasskeyBtn = document.getElementById("mfa-enrollment-passkey-btn");
  const enrollPasskeyDivider = document.getElementById("mfa-enrollment-passkey-divider");
  if (typeof data.passkeys_enabled === "boolean") {
    window.ShiftSwiftPasskeyAuth?.notePasskeysEnabledFromServer?.(data.passkeys_enabled);
  }
  const enrollLead = document.querySelector("#mfa-enrollment-panel .portal-login-card-lead");
  const canPasskeySync = Boolean(window.ShiftSwiftPasskeyAuth?.canUsePasskeys?.());
  if (enrollPasskeyBtn) enrollPasskeyBtn.hidden = !canPasskeySync;
  if (enrollPasskeyDivider) enrollPasskeyDivider.hidden = !canPasskeySync;
  if (enrollLead) {
    enrollLead.textContent = canPasskeySync
      ? "Use Face ID / Touch ID or set up an authenticator app — optional; you can skip and enable it later in settings."
      : "Set up an authenticator app — optional; you can skip and enable it later in settings.";
  }
  void (async () => {
    const ok = Boolean(await window.ShiftSwiftPasskeyAuth?.canUsePasskeysAsync?.());
    if (enrollPasskeyBtn) enrollPasskeyBtn.hidden = !ok;
    if (enrollPasskeyDivider) enrollPasskeyDivider.hidden = !ok;
    if (enrollLead) {
      enrollLead.textContent = ok
        ? "Use Face ID / Touch ID or set up an authenticator app — optional; you can skip and enable it later in settings."
        : "Set up an authenticator app — optional; you can skip and enable it later in settings.";
    }
  })();
  try {
    const setup = await postJsonAuth("/auth/mfa/setup", {}, pendingEnrollmentToken);
    const secretEl = document.getElementById("mfa-enrollment-secret");
    const qrImg = document.getElementById("mfa-enrollment-qr");
    const qrWrap = document.getElementById("mfa-enrollment-qr-wrap");
    if (secretEl) secretEl.textContent = setup.manual_secret || "";
    if (qrImg && (setup.qr_data_uri || setup.otpauth_uri)) {
      const qrSize = isNativeLoginApp() ? 128 : 200;
      // Prefer server-generated data URI — native WebViews often block api.qrserver.com
      qrImg.src =
        setup.qr_data_uri ||
        `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(setup.otpauth_uri)}`;
      qrImg.width = qrSize;
      qrImg.height = qrSize;
      qrImg.onerror = () => {
        if (setup.otpauth_uri && !String(qrImg.src || "").startsWith("data:")) {
          setEnrollmentStatus("QR image blocked — use the manual key below, or Skip for now.");
        }
      };
    }
    if (qrWrap) qrWrap.hidden = !(setup.qr_data_uri || setup.otpauth_uri);
    const openAuth = document.getElementById("mfa-enrollment-open-app");
    if (openAuth && setup.otpauth_uri) {
      openAuth.hidden = false;
      openAuth.href = setup.otpauth_uri;
      if (!openAuth.dataset.bound) {
        openAuth.dataset.bound = "1";
        openAuth.addEventListener("click", (event) => {
          const href = openAuth.getAttribute("href") || setup.otpauth_uri;
          if (!href || href === "#") return;
          // Native WebViews often ignore otpauth:// — open via Capacitor Browser/App when available.
          if (window.Capacitor?.isNativePlatform?.()) {
            event.preventDefault();
            const browser = window.Capacitor?.Plugins?.Browser;
            if (browser?.open) {
              void browser.open({ url: href });
              return;
            }
            window.open(href, "_system");
          }
        });
      }
    }
    setEnrollmentStatus("");
    focusLoginInput(document.getElementById("mfa-enrollment-code"));
  } catch (error) {
    setEnrollmentStatus(error.message || "Could not start MFA setup");
  }
}

function bindMfaEnrollmentSubmit() {
  const btn = document.getElementById("mfa-enrollment-submit");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", async () => {
    if (!pendingEnrollmentToken) {
      setEnrollmentStatus("Session expired. Sign in again.");
      return;
    }
    const code = String(document.getElementById("mfa-enrollment-code")?.value || "")
      .trim()
      .replace(/\s+/g, "");
    if (!code) {
      setEnrollmentStatus("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setEnrollmentStatus("Enabling MFA…");
    btn.disabled = true;
    try {
      const data = await postJsonAuth("/auth/mfa/enable", { code }, pendingEnrollmentToken);
      await storeSessionAndGo(data, data.redirect_url || pendingRedirect || "./admin.html", pendingMfaUsername);
    } catch (error) {
      setEnrollmentStatus(error.message || "Invalid code — try again");
      btn.disabled = false;
    }
  });
}

function bindMfaEnrollmentSkip() {
  const btn = document.getElementById("mfa-enrollment-skip");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", async () => {
    if (!pendingEnrollmentToken) {
      setEnrollmentStatus("Session expired. Sign in again.");
      return;
    }
    setEnrollmentStatus("Continuing without MFA…");
    btn.disabled = true;
    const enableBtn = document.getElementById("mfa-enrollment-submit");
    if (enableBtn) enableBtn.disabled = true;
    try {
      const data = await postJsonAuth("/auth/mfa/skip-enrollment", {}, pendingEnrollmentToken);
      await storeSessionAndGo(data, data.redirect_url || pendingRedirect || "./admin.html", pendingMfaUsername);
    } catch (error) {
      setEnrollmentStatus(error.message || "Could not skip MFA setup");
      btn.disabled = false;
      if (enableBtn) enableBtn.disabled = false;
    }
  });
}

function bindMfaEnrollmentPasskey() {
  const btn = document.getElementById("mfa-enrollment-passkey-btn");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", async () => {
    if (!pendingEnrollmentToken) {
      setEnrollmentStatus("Session expired. Sign in again.");
      return;
    }
    if (!window.ShiftSwiftPasskeyAuth?.enrollMfaWithPasskey) {
      setEnrollmentStatus("Device unlock is not available in this build.");
      return;
    }
    setEnrollmentStatus("Waiting for device unlock…");
    btn.disabled = true;
    try {
      const data = await window.ShiftSwiftPasskeyAuth.enrollMfaWithPasskey(pendingEnrollmentToken);
      window.ShiftSwiftPasskeyAuth.rememberLastEmail?.(pendingMfaUsername || data.username);
      await storeSessionAndGo(data, data.redirect_url || pendingRedirect || "./admin.html", pendingMfaUsername);
    } catch (error) {
      const raw = String(error?.message || "").trim();
      if (/^(Load failed|Failed to fetch)$/i.test(raw) || /rpid did not match|related origins/i.test(raw)) {
        setEnrollmentStatus(
          "Face ID could not start on this device. Scan the QR code and enter the 6-digit code to continue — you can enable Face ID later in Settings.",
        );
      } else {
        setEnrollmentStatus(raw || "Could not enable device unlock — try the authenticator code instead");
      }
      btn.disabled = false;
    }
  });
}

function bindMfaEnrollmentHandlers() {
  bindMfaEnrollmentSubmit();
  bindMfaEnrollmentSkip();
  bindMfaEnrollmentPasskey();
}

let pendingRedirect = "./admin.html";
let activeLoginMode = "business";

function secureHostLabel() {
  const fromBrand = window.ShiftSwiftBrand?.domain;
  if (fromBrand) return fromBrand;
  if (typeof window !== "undefined" && window.location.hostname) {
    return String(window.location.hostname).replace(/^www\./i, "");
  }
  return "shiftswifthr.co.uk";
}

function activeLoginStep() {
  if (document.body.classList.contains("login-step-enroll")) return "enroll";
  if (document.body.classList.contains("login-step-mfa")) return "mfa";
  return "signin";
}

function setStatus(message) {
  if (activeLoginStep() === "mfa") {
    let status = document.getElementById("mfa-verify-status");
    if (!status) {
      const mfaPanel = document.getElementById("mfa-panel");
      status = document.createElement("p");
      status.id = "mfa-verify-status";
      status.className = "form-error-message";
      mfaPanel?.querySelector(".portal-login-form, form")?.prepend(status);
    }
    setNativeStatusMessage(status, message);
    return;
  }
  if (activeLoginStep() === "enroll") {
    setEnrollmentStatus(message);
    return;
  }
  setNativeStatusMessage(document.getElementById("login-status"), message);
}

function isEmployeeOnBusinessLoginError(message) {
  return /employee account|employee sign-in page/i.test(String(message || ""));
}

function isHrOnEmployeeLoginError(message) {
  return /HR admin account|business sign-in page/i.test(String(message || ""));
}

function employeeLoginUrl(username) {
  const params = new URLSearchParams();
  const email = String(username || "").trim();
  if (email) params.set("username", email);
  const native = /(?:\?|&)source=native(?:&|$)/i.test(window.location.search) || /source=native/i.test(window.location.href);
  if (native) params.set("source", "native");
  const qs = params.toString();
  return qs ? `./employee-login.html?${qs}` : "./employee-login.html";
}

function businessLoginUrl(username) {
  const params = new URLSearchParams();
  const email = String(username || "").trim();
  if (email) params.set("username", email);
  const native = /(?:\?|&)source=native(?:&|$)/i.test(window.location.search) || /source=native/i.test(window.location.href);
  if (native) params.set("source", "native");
  const qs = params.toString();
  return qs ? `./business-login.html?${qs}` : "./business-login.html";
}

function maybeRedirectWrongPortal(message, endpoint, username) {
  if (endpoint.includes("business") && isEmployeeOnBusinessLoginError(message)) {
    setStatus("Employee account detected — opening employee sign-in…");
    window.setTimeout(() => {
      window.location.replace(employeeLoginUrl(username));
    }, 600);
    return true;
  }
  if (endpoint.includes("employee") && isHrOnEmployeeLoginError(message)) {
    setStatus("HR admin account detected — opening business sign-in…");
    window.setTimeout(() => {
      window.location.replace(businessLoginUrl(username));
    }, 600);
    return true;
  }
  return false;
}

function prefillUsernameFromQuery() {
  const email = new URLSearchParams(window.location.search).get("username");
  if (!email) return;
  const input = document.querySelector('#portal-login-form input[name="username"]');
  if (input && !input.value) input.value = email;
}

function friendlyLoginError(message, endpoint, username) {
  if (message === "Failed to fetch" || message === "Load failed") {
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (isLocal) {
      return "Cannot reach the API. Start it with: bash scripts/start_local.sh";
    }
    return "Cannot reach the API. The service may be restarting — try again in a minute, or contact support if this continues.";
  }
  if (message === "Invalid credentials for this login type") {
    if (endpoint.includes("master")) {
      return "Use your platform master account here (admin@shiftswifthr.co.uk). Business HR and employees sign in via Business sign in.";
    }
    if (endpoint.includes("employee")) {
      return "Use your employee username and password. HR admins should use the business sign-in page.";
    }
    return "Check your username and password. HR admins use business sign-in; employees use employee sign-in.";
  }
  if (message === "Invalid username or password" || message === "Login failed") {
    return message;
  }
  return message || "Login failed";
}

async function postJson(path, body) {
  const url = `${getApiBase()}${path}`;
  window.ShiftSwiftNativeApiFetch?.boot?.();
  const reqInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body == null ? {} : body),
  };
  let response;
  try {
    if (window.ShiftSwiftNativeApiFetch?.nativeAwareFetch) {
      response = await window.ShiftSwiftNativeApiFetch.nativeAwareFetch(url, reqInit);
    } else {
      response = await fetch(url, reqInit);
    }
  } catch {
    throw new Error("Failed to fetch");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
    throw new Error(message || data.message || "Login failed");
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
}

async function storeSessionAndGo(data, url, username) {
  storeSession(data);
  const email =
    normalizeEmailForTrust(username) ||
    normalizeEmailForTrust(data?.username) ||
    normalizeEmailForTrust(pendingMfaUsername);
  try {
    await window.ShiftSwiftTrustedDevice?.rememberDeviceFromResponse?.(email, data);
  } catch {
    /* optional */
  }
  try {
    if (window.ShiftSwiftTrustedDevice?.maybeEnableBiometricUnlock) {
      await window.ShiftSwiftTrustedDevice.maybeEnableBiometricUnlock();
    } else if (isNativeLoginApp()) {
      const canUse = await window.ShiftSwiftTrustedDevice?.canUseBiometricUnlock?.();
      if (canUse) window.ShiftSwiftTrustedDevice?.setBiometricUnlockEnabled?.(true);
    }
  } catch {
    /* optional — password login still succeeded */
  }
  try {
    sessionStorage.setItem("sshrPostLoginTransition", "1");
  } catch {
    /* ignore */
  }
  try {
    window.Capacitor?.Plugins?.SplashScreen?.hide?.();
    window.ShiftSwiftNativeApp?.hideSplash?.();
    window.ShiftSwiftNativeApp?.dismissStartupLoader?.();
    document.getElementById("native-startup-loader")?.remove();
    document.documentElement.classList.remove("native-startup-active");
    document.body?.classList.remove("native-startup-active");
  } catch {
    /* ignore */
  }
  if (window.ShiftSwiftSession?.persistNativeSession) {
    await Promise.race([
      window.ShiftSwiftSession.persistNativeSession(),
      new Promise((resolve) => window.setTimeout(resolve, 2000)),
    ]);
  }
  window.location.replace(withNativeSource(url || "./admin.html"));
}

function normalizeEmailForTrust(value) {
  return String(value || "").trim().toLowerCase();
}

async function buildLoginPayload(form) {
  const raw = Object.fromEntries(new FormData(form).entries());
  const username = String(raw.username || "").trim();
  const payload = {
    username,
    password: raw.password,
  };
  try {
    const deviceToken = await window.ShiftSwiftTrustedDevice?.getTrustedToken?.(username);
    if (deviceToken) payload.device_token = deviceToken;
  } catch {
    /* optional */
  }
  return payload;
}

function withNativeSource(path) {
  try {
    const parsed = new URL(String(path || "./admin.html"), window.location.href);
    if (!parsed.searchParams.get("source")) parsed.searchParams.set("source", "native");
    return `${parsed.pathname}?${parsed.searchParams.toString()}${parsed.hash}`;
  } catch {
    return String(path || "./admin.html?source=native");
  }
}

function redirectForRole(data, fallback) {
  if (data.role === "employee") return "./employee.html";
  return fallback;
}

function showMfaStep(username, meta = {}) {
  pendingMfaUsername = String(username || "");
  if (typeof meta === "object" && meta && typeof meta.passkeys_enabled === "boolean") {
    window.ShiftSwiftPasskeyAuth?.notePasskeysEnabledFromServer?.(meta.passkeys_enabled);
  }
  const featureOn =
    typeof meta !== "object" || meta == null || meta.passkeys_enabled !== false;
  const passkeyAvailable =
    featureOn &&
    Boolean(typeof meta === "boolean" ? meta : meta.passkeyAvailable ?? meta.passkey_available);
  const totpAvailable = Boolean(typeof meta === "object" && (meta.totpAvailable ?? meta.totp_available));
  const emailFlag =
    typeof meta === "object" ? meta.emailAvailable ?? meta.email_mfa_available : undefined;
  const emailAvailable = emailFlag !== false;
  const emailHint =
    (typeof meta === "object" && (meta.emailHint || meta.email_hint)) || pendingMfaUsername;
  const emailSent = Boolean(typeof meta === "object" && (meta.emailSent ?? meta.email_sent));
  const serverMessage = typeof meta === "object" ? String(meta.message || "") : "";
  const defaultMethod = String(
    (typeof meta === "object" && (meta.defaultMethod || meta.default_mfa_method)) || "",
  ).toLowerCase();
  pendingMfaMeta = {
    passkeyAvailable,
    totpAvailable,
    emailAvailable,
    emailHint,
    emailSent,
  };
  // Prefer email whenever authenticator is not the only/default path.
  if (defaultMethod === "totp" && totpAvailable && !emailAvailable) pendingMfaMethod = "totp";
  else if (emailAvailable) pendingMfaMethod = "email";
  else if (totpAvailable) pendingMfaMethod = "totp";
  else pendingMfaMethod = "email";

  syncLoginPanels("mfa");
  applyMfaMethodUi();
  if (serverMessage) setStatus(serverMessage);
  else if (pendingMfaMethod === "email" && emailSent) {
    setStatus("Check your inbox and spam folder for the 6-digit code.");
  } else if (pendingMfaMethod === "email" && !emailSent) {
    setStatus("Sending email code…");
    void ensureEmailCodeSent();
  }
  const mfaPanel = document.getElementById("mfa-panel");
  focusLoginInput(mfaPanel?.querySelector('input[name="code"]'));
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
  const canPasskey =
    passkeyAvailable &&
    Boolean(window.ShiftSwiftPasskeyAuth?.canUsePasskeys?.()) &&
    !window.ShiftSwiftPasskeyAuth?.isDesktopLoginSurface?.();
  const resolved =
    pendingMfaMethod === "totp" && totpAvailable
      ? "totp"
      : emailAvailable || !totpAvailable
        ? "email"
        : "totp";
  pendingMfaMethod = resolved;

  const title = document.getElementById("mfa-panel-title");
  if (title) title.textContent = resolved === "email" ? "Check your email" : "Authenticator code";

  const passkeyBtn = document.getElementById("mfa-passkey-btn");
  const divider = document.getElementById("mfa-passkey-divider");
  if (passkeyBtn) passkeyBtn.hidden = !canPasskey;
  if (divider) divider.hidden = !canPasskey;
  if (passkeyAvailable && !window.ShiftSwiftPasskeyAuth?.isDesktopLoginSurface?.()) {
    void (async () => {
      const ok =
        passkeyAvailable && Boolean(await window.ShiftSwiftPasskeyAuth?.canUsePasskeysAsync?.());
      if (passkeyBtn) passkeyBtn.hidden = !ok;
      if (divider) divider.hidden = !ok;
    })();
  }

  const lead = document.getElementById("mfa-panel-lead") || mfaPanel.querySelector(".portal-login-card-lead");
  if (lead) {
    if (resolved === "email") {
      const hint = escapeLoginHtml(emailHint || pendingMfaUsername);
      lead.innerHTML = emailSent
        ? `We emailed a 6-digit code to <strong data-mfa-user>${hint}</strong>. Check inbox and spam.`
        : `Enter the 6-digit code we email to <strong data-mfa-user>${hint}</strong>.`;
    } else {
      lead.innerHTML = `Enter the 6-digit code from your authenticator app for <strong data-mfa-user>${escapeLoginHtml(pendingMfaUsername)}</strong>.`;
    }
  }

  const labelText = document.getElementById("mfa-code-label-text");
  if (labelText) labelText.textContent = resolved === "email" ? "Email code" : "Authenticator code";
  const codeInput = mfaPanel.querySelector('input[name="code"]');
  if (codeInput) codeInput.value = "";

  const resendWrap = document.getElementById("mfa-resend-wrap");
  if (resendWrap) resendWrap.hidden = resolved !== "email" || !emailAvailable;

  const alt = document.getElementById("mfa-alt-methods");
  const useEmailBtn = document.getElementById("mfa-use-email-btn");
  const useTotpBtn = document.getElementById("mfa-use-totp-btn");
  if (alt) alt.hidden = !(emailAvailable && totpAvailable);
  if (useEmailBtn) useEmailBtn.hidden = !(emailAvailable && resolved !== "email");
  if (useTotpBtn) useTotpBtn.hidden = !(totpAvailable && resolved !== "totp");

  const signInRemember = document.getElementById("login-remember-device");
  const mfaRemember = document.getElementById("login-remember-device-mfa");
  if (signInRemember && mfaRemember && !mfaRemember.dataset.synced) {
    mfaRemember.checked = signInRemember.checked;
    mfaRemember.dataset.synced = "1";
  }
}

function escapeLoginHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bindMfaForm() {
  const mfaForm = document.getElementById("mfa-form");
  if (!mfaForm || mfaForm.dataset.bound) return;
  mfaForm.dataset.bound = "1";

  mfaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!pendingChallenge) {
      setStatus("Session expired. Sign in again.");
      return;
    }
    setStatus("Verifying code…");
    const raw = new FormData(mfaForm).get("code");
    const code = String(raw || "")
      .trim()
      .replace(/\s+/g, "");
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
        remember_device: Boolean(window.ShiftSwiftTrustedDevice?.shouldRememberDevice?.()),
        device_label: window.ShiftSwiftTrustedDevice?.deviceLabel?.() || undefined,
      });
      await storeSessionAndGo(data, redirectForRole(data, pendingRedirect), pendingMfaUsername);
    } catch (error) {
      setStatus(error.message || "Invalid authentication code");
    }
  });

  const resendBtn = document.getElementById("mfa-resend-btn");
  if (resendBtn && !resendBtn.dataset.bound) {
    resendBtn.dataset.bound = "1";
    resendBtn.addEventListener("click", async () => {
      if (!pendingChallenge) {
        setStatus("Session expired. Sign in again.");
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
  if (useEmailBtn && !useEmailBtn.dataset.bound) {
    useEmailBtn.dataset.bound = "1";
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
        focusLoginInput(document.querySelector('#mfa-form input[name="code"]'));
      } catch (error) {
        setStatus(error.message || "Could not send email code");
      }
    });
  }

  const useTotpBtn = document.getElementById("mfa-use-totp-btn");
  if (useTotpBtn && !useTotpBtn.dataset.bound) {
    useTotpBtn.dataset.bound = "1";
    useTotpBtn.addEventListener("click", () => {
      pendingMfaMethod = "totp";
      applyMfaMethodUi();
      setStatus("");
      focusLoginInput(document.querySelector('#mfa-form input[name="code"]'));
    });
  }

  const backBtn = document.getElementById("mfa-back-signin");
  if (backBtn && !backBtn.dataset.bound) {
    backBtn.dataset.bound = "1";
    backBtn.addEventListener("click", () => {
      pendingChallenge = null;
      pendingMfaMethod = "email";
      const mfaRemember = document.getElementById("login-remember-device-mfa");
      if (mfaRemember) delete mfaRemember.dataset.synced;
      syncLoginPanels("signin");
      setStatus("");
    });
  }

  const passkeyBtn = document.getElementById("mfa-passkey-btn");
  if (passkeyBtn && !passkeyBtn.dataset.bound) {
    passkeyBtn.dataset.bound = "1";
    passkeyBtn.addEventListener("click", async () => {
      if (!pendingChallenge) {
        setStatus("Session expired. Sign in again.");
        return;
      }
      if (!window.ShiftSwiftPasskeyAuth?.verifyMfaWithPasskey) {
        setStatus("Face ID is not available in this build.");
        return;
      }
      setStatus("Waiting for Face ID…");
      passkeyBtn.disabled = true;
      try {
        const email =
          pendingMfaUsername ||
          document.querySelector('#portal-login-form input[name="username"]')?.value ||
          "";
        const data = await window.ShiftSwiftPasskeyAuth.verifyMfaWithPasskey(pendingChallenge, email);
        window.ShiftSwiftPasskeyAuth.rememberLastEmail?.(email);
        await storeSessionAndGo(data, redirectForRole(data, pendingRedirect), pendingMfaUsername);
      } catch (error) {
        setStatus(error.message || "Face ID verification failed");
        passkeyBtn.disabled = false;
      }
    });
  }
}

function bindPortalLogin() {
  const form = document.getElementById("portal-login-form");
  if (!form) return;

  bindMfaForm();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = LOGIN_MODES[activeLoginMode] || LOGIN_MODES.business;
    pendingRedirect = mode.redirect;
    setStatus("Signing in…");
    const payload = await buildLoginPayload(form);
    try {
      const data = await postJson(mode.endpoint, payload);
      if (data.mfa_required && data.challenge_token) {
        pendingChallenge = data.challenge_token;
        pendingMfaUsername = data.username || payload.username || "";
        pendingRedirect = redirectForRole(data, mode.redirect);
        setStatus("");
        showMfaStep(pendingMfaUsername, data);
        return;
      }
      if (data.mfa_enrollment_required && data.enrollment_token) {
        pendingMfaUsername = data.username || payload.username || "";
        setStatus("");
        await startMfaEnrollment(data, redirectForRole(data, mode.redirect));
        return;
      }
      await storeSessionAndGo(data, redirectForRole(data, mode.redirect), payload.username);
    } catch (error) {
      const friendly = friendlyLoginError(error.message, mode.endpoint, payload.username);
      if (maybeRedirectWrongPortal(error.message, mode.endpoint, payload.username)) return;
      setStatus(friendly);
    }
  });
}

function switchLoginMode(nextMode) {
  if (!LOGIN_MODES[nextMode]) return;
  activeLoginMode = nextMode;
  const mode = LOGIN_MODES[nextMode];

  const lead = document.getElementById("login-lead");
  const submit = document.getElementById("login-submit");
  const usernameInput = document.querySelector('#portal-login-form input[name="username"]');
  const card = document.getElementById("portal-login-card");
  const bannerPill = document.getElementById("login-role-banner-pill");
  const bannerCopy = document.getElementById("login-role-banner-copy");

  if (lead) lead.textContent = mode.lead;
  if (submit) submit.textContent = mode.submit;
  if (usernameInput) usernameInput.placeholder = mode.usernamePlaceholder;
  if (card) {
    card.classList.remove("portal-login-card--business", "portal-login-card--employee");
    card.classList.add(`portal-login-card--${nextMode}`);
  }
  if (bannerPill) bannerPill.textContent = mode.bannerPill;
  if (bannerCopy) bannerCopy.innerHTML = mode.bannerCopy;
  const forgotLink = document.getElementById("forgot-password-link");
  if (forgotLink) {
    forgotLink.href = withNativeQuery(
      activeLoginMode === "employee" ? "./employee-forgot-password.html" : "./forgot-password.html",
    );
  }
  setStatus("");
}

function initDedicatedLogin(mode) {
  if (!LOGIN_MODES[mode]) return;
  activeLoginMode = mode;
  initNativeLoginStability();
  switchLoginMode(mode);
  prefillUsernameFromQuery();
  bindPortalLogin();
  bindMfaEnrollmentHandlers();
  bindForgotPasswordLink();
  void (async () => {
    let bounced = false;
    try {
      bounced = sessionStorage.getItem("sshrAuthBouncedToLogin") === "1";
      if (bounced) sessionStorage.removeItem("sshrAuthBouncedToLogin");
    } catch {
      /* ignore */
    }
    if (!bounced && (await window.ShiftSwiftTrustedDevice?.tryQuickUnlock?.())) return;
  })();
}

function initBusinessLoginTabs() {
  const tabs = document.querySelectorAll("[data-login-tab]");
  if (!tabs.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.loginTab;
      tabs.forEach((item) => {
        const active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      switchLoginMode(key);
    });
  });

  initNativeLoginStability();
  switchLoginMode("business");
  bindPortalLogin();
  bindMfaEnrollmentHandlers();
}

function redirectIfEmployeeSession() {
  if (document.body.dataset.loginPage !== "employee") return false;
  const role = localStorage.getItem("userRole");
  const hasSession = window.ShiftSwiftSession?.hasSession?.();
  if (!hasSession) {
    if (role && role !== "employee") {
      localStorage.removeItem("userRole");
    }
    return false;
  }
  if (role === "employee") {
    window.location.replace("./employee.html");
    return true;
  }
  return false;
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

async function loginWithAutoPortal(payload) {
  const modes = [
    { endpoint: "/auth/employee-login", redirect: "./employee.html" },
    { endpoint: "/auth/business-login", redirect: "./admin.html" },
  ];
  let lastError = null;
  for (const mode of modes) {
    try {
      const data = await postJson(mode.endpoint, payload);
      return { data, redirect: redirectForRole(data, mode.redirect), endpoint: mode.endpoint };
    } catch (error) {
      lastError = error;
      if (!isPortalMismatch(error.message)) {
        throw error;
      }
    }
  }
  throw lastError || new Error("Login failed");
}

function redirectIfUnifiedSession() {
  if (document.body.dataset.loginPage !== "unified") return false;
  const role = localStorage.getItem("userRole");
  const hasSession = window.ShiftSwiftSession?.hasSession?.();
  if (!hasSession) return false;
  if (role === "employee") {
    window.location.replace("./employee.html");
    return true;
  }
  if (role && role !== "employee") {
    window.location.replace("./admin.html");
    return true;
  }
  return false;
}

function bindUnifiedLogin() {
  const form = document.getElementById("portal-login-form");
  if (!form || form.dataset.boundUnified) return;
  form.dataset.boundUnified = "1";

  bindMfaForm();
  bindMfaEnrollmentHandlers();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Signing in…");
    const payload = await buildLoginPayload(form);
    try {
      const result = await loginWithAutoPortal(payload);
      const { data, redirect } = result;
      pendingRedirect = redirect;
      if (data.mfa_required && data.challenge_token) {
        pendingChallenge = data.challenge_token;
        pendingMfaUsername = data.username || payload.username || "";
        setStatus("");
        showMfaStep(pendingMfaUsername, data);
        return;
      }
      if (data.mfa_enrollment_required && data.enrollment_token) {
        setStatus("");
        await startMfaEnrollment(data, redirect);
        return;
      }
      await storeSessionAndGo(data, redirect, payload.username);
    } catch (error) {
      setStatus(
        friendlyLoginError(
          error.message,
          "/auth/employee-login",
          payload.username,
        ),
      );
    }
  });
}

function initUnifiedNativeLogin() {
  if (window.ShiftSwiftUnifiedLogin?.init) {
    window.ShiftSwiftUnifiedLogin.init();
    return;
  }
  bindUnifiedLogin();
  bindMfaEnrollmentHandlers();
}

function redirectIfBusinessSession() {
  if (document.body.dataset.loginPage !== "business") return false;
  const role = localStorage.getItem("userRole");
  const hasSession = window.ShiftSwiftSession?.hasSession?.();
  if (!hasSession) {
    if (role === "employee") {
      localStorage.removeItem("userRole");
    }
    return false;
  }
  // Keep the business sign-in form available even if an employee session exists on this device.
  if (role === "employee") {
    return false;
  }
  if (role && role !== "employee") {
    window.location.replace("./admin.html");
    return true;
  }
  return false;
}

function initLoginPage() {
  if (window.ShiftSwiftNativeApp?.isUnifiedNativeApp?.()) {
    const onBundledLogin =
      /\/\/localhost\//i.test(window.location.href) &&
      /(index|business-login|employee-login)\.html$/i.test(window.location.pathname || "");
    const onProductionApp = /(^|\.)app\.shiftswifthr\.co\.uk$/i.test(window.location.hostname);
    if (!onBundledLogin && !onProductionApp) {
      window.location.replace(
        window.ShiftSwiftNativeApp?.capacitorAssetUrl?.("index.html?source=native") || "./index.html",
      );
      return;
    }
  }
  if (redirectIfUnifiedSession()) return;
  if (redirectIfEmployeeSession()) return;
  if (redirectIfBusinessSession()) return;

  const portalHint = new URLSearchParams(window.location.search).get("portal");
  if (portalHint === "employee") {
    window.location.replace("./employee-login.html");
    return;
  }

  const pageMode = document.body.dataset.loginPage;
  if (pageMode === "unified") {
    initUnifiedNativeLogin();
    return;
  }
  if (pageMode && LOGIN_MODES[pageMode]) {
    initDedicatedLogin(pageMode);
    return;
  }
  initBusinessLoginTabs();
}

function bindSimpleLogin(formId, endpoint, redirectUrl) {
  const form = document.getElementById(formId);
  if (!form) return;

  initNativeLoginStability();
  bindMfaForm();
  bindMfaEnrollmentHandlers();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    pendingRedirect = redirectUrl;
    setStatus("Signing in…");
    const payload = await buildLoginPayload(form);
    try {
      const data = await postJson(endpoint, payload);
      if (data.mfa_required && data.challenge_token) {
        pendingChallenge = data.challenge_token;
        pendingMfaUsername = data.username || payload.username || "";
        pendingRedirect = redirectUrl;
        setStatus("");
        showMfaStep(pendingMfaUsername, data);
        return;
      }
      if (data.mfa_enrollment_required && data.enrollment_token) {
        setStatus("");
        await startMfaEnrollment(data, redirectUrl);
        return;
      }
      await storeSessionAndGo(data, redirectUrl, payload.username);
    } catch (error) {
      const friendly = friendlyLoginError(error.message, endpoint, payload.username);
      if (maybeRedirectWrongPortal(error.message, endpoint, payload.username)) return;
      setStatus(friendly);
    }
  });
}

function showLocalDevHints() {
  if (isNativeLoginApp()) return;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return;

  const staleApi = localStorage.getItem("apiBaseUrl");
  if (staleApi && !/localhost|127\.0\.0\.1/.test(staleApi)) {
    localStorage.removeItem("apiBaseUrl");
  }

  const hint = document.createElement("p");
  hint.className = "portal-login-dev-hint";
  hint.innerHTML =
    "Local dev: master → <code>admin@shiftswifthr.co.uk</code> · HR → <code>hr@shiftswifthr.co.uk</code> · passwords in README.";
  document.querySelector(".portal-login-card")?.appendChild(hint);
}

document.querySelectorAll("[data-secure-host]").forEach((el) => {
  el.textContent = secureHostLabel();
});

if (window.ShiftSwiftBrand?.portals) {
  const byId = Object.fromEntries(window.ShiftSwiftBrand.portals().map((p) => [p.id, p.display]));
  document.querySelectorAll("[data-portal-display]").forEach((el) => {
    const key = el.getAttribute("data-portal-display");
    if (key && byId[key]) el.textContent = byId[key];
  });
}

showLocalDevHints();
initLoginPage();
bindSimpleLogin("ops-master-login-form", "/auth/master-login", "./master.html");

(function showMasterLoginNotice() {
  if (!document.getElementById("ops-master-login-form")) return;
  const notice = sessionStorage.getItem("masterLoginNotice");
  if (!notice) return;
  sessionStorage.removeItem("masterLoginNotice");
  setStatus(notice);
})();
