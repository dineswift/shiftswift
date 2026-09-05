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
  totpAvailable: false,
  emailAvailable: true,
  emailHint: "",
  emailSent: false,
};

async function postJsonAuth(path, body, bearerToken) {
  if (window.ShiftSwiftBrand?.postJson) {
    return window.ShiftSwiftBrand.postJson(path, body, { bearerToken });
  }
  const headers = { "Content-Type": "application/json" };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  let response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Failed to fetch");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
    throw new Error(message || data.message || "Request failed");
  }
  return data;
}

function setEnrollmentStatus(message) {
  const status = document.getElementById("mfa-enrollment-status");
  if (!status) return;
  if (message) {
    status.textContent = message;
    status.hidden = false;
  } else {
    status.textContent = "";
    status.hidden = true;
  }
}

async function startMfaEnrollment(data, redirectUrl) {
  pendingEnrollmentToken = data.enrollment_token;
  pendingRedirect = data.redirect_url || redirectUrl;

  const loginShell = document.getElementById("login-shell");
  const enrollmentPanel = document.getElementById("mfa-enrollment-panel");
  const mfaPanel = document.getElementById("mfa-panel");
  const loginTabs = document.getElementById("login-tabs");
  const loginFeatures = document.getElementById("login-features");
  if (loginShell) loginShell.hidden = true;
  if (mfaPanel) mfaPanel.hidden = true;
  if (loginTabs) loginTabs.hidden = true;
  if (loginFeatures) loginFeatures.hidden = true;
  if (enrollmentPanel) enrollmentPanel.hidden = false;

  const userLabel = document.getElementById("mfa-enrollment-user");
  if (userLabel) userLabel.textContent = `Account: ${data.username || "master admin"}`;

  setEnrollmentStatus("Preparing authenticator…");
  try {
    const setup = await postJsonAuth("/auth/mfa/setup", null, pendingEnrollmentToken);
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

function bindMfaEnrollmentSubmit() {
  const btn = document.getElementById("mfa-enrollment-submit");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", async () => {
    if (!pendingEnrollmentToken) {
      setEnrollmentStatus("Session expired. Sign in again.");
      return;
    }
    const code = document.getElementById("mfa-enrollment-code")?.value?.trim();
    if (!code) {
      setEnrollmentStatus("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setEnrollmentStatus("Enabling MFA…");
    btn.disabled = true;
    try {
      const data = await postJsonAuth("/auth/mfa/enable", { code }, pendingEnrollmentToken);
      await storeSessionAndGo(data, data.redirect_url || pendingRedirect || "./admin.html");
    } catch (error) {
      setEnrollmentStatus(error.message || "Invalid code — try again");
      btn.disabled = false;
    }
  });
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

function escapeLoginHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(message) {
  for (const id of ["login-status", "mfa-status"]) {
    const status = document.getElementById(id);
    if (!status) continue;
    if (message) {
      status.textContent = message;
      status.hidden = false;
    } else {
      status.textContent = "";
      status.hidden = true;
    }
  }
}

function friendlyLoginError(message, endpoint, username) {
  if (message === "Failed to fetch" || message === "Load failed" || message === "Request timed out") {
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (isLocal) {
      return "Cannot reach the API. Start it with: bash scripts/start_local.sh";
    }
    if (message === "Request timed out") {
      return "Sign-in timed out. Try again — if this keeps happening the API may be restarting.";
    }
    return "Cannot complete sign-in. Hard-refresh (Ctrl+Shift+R), pause any ad blocker on this site, and try again.";
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

async function postMfaVerify(body) {
  try {
    return await postJson("/auth/session/complete", body);
  } catch (error) {
    if (String(error.message || "").toLowerCase() === "not found") {
      return await postJson("/auth/mfa/verify", body);
    }
    throw error;
  }
}

async function postJson(path, body) {
  if (window.ShiftSwiftBrand?.postJson) {
    return window.ShiftSwiftBrand.postJson(path, body);
  }
  let response;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 20000);
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw new Error("Failed to fetch");
  } finally {
    window.clearTimeout(timeoutId);
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

async function storeSessionAndGo(data, url) {
  storeSession(data);
  try {
    if (window.ShiftSwiftSession?.persistNativeSession) {
      await window.ShiftSwiftSession.persistNativeSession();
    }
  } catch {
    /* Native persist must not block a successful web sign-in. */
  }
  window.location.replace(url);
}

function redirectForRole(data, fallback) {
  if (data.role === "employee") return "./employee.html";
  return fallback;
}

function captureMfaMeta(data, username) {
  pendingMfaUsername = username || data?.username || pendingMfaUsername || "";
  const methods = Array.isArray(data?.mfa_methods) ? data.mfa_methods : [];
  const emailAvailable = Boolean(
    data?.email_mfa_available ?? (methods.includes("email") || data?.email_sent || data?.email_hint),
  );
  const totpAvailable = Boolean(data?.totp_available ?? methods.includes("totp"));
  pendingMfaMeta = {
    totpAvailable,
    emailAvailable: emailAvailable || !totpAvailable,
    emailHint: data?.email_hint || pendingMfaUsername,
    emailSent: Boolean(data?.email_sent),
    message: data?.message || "",
  };
  const defaultMethod = String(data?.default_mfa_method || "").toLowerCase();
  if (String(data?.portal || "") === "master") {
    pendingMfaMeta.emailAvailable = false;
    pendingMfaMethod = "totp";
    return;
  }
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
      const hint = escapeLoginHtml(emailHint || pendingMfaUsername);
      lead.innerHTML = emailSent
        ? `We emailed a 6-digit code to <strong data-mfa-user>${hint}</strong>. Check inbox and spam.`
        : `Enter the 6-digit code we email to <strong data-mfa-user>${hint}</strong>.`;
    }
  } else if (heading) {
    heading.textContent = "Two-factor authentication";
    if (lead) {
      lead.innerHTML = `Enter the 6-digit code from your authenticator app for <strong data-mfa-user>${escapeLoginHtml(pendingMfaUsername)}</strong>.`;
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
  const loginTabs = document.getElementById("login-tabs");
  const loginShell = document.getElementById("login-shell");
  const loginFeatures = document.getElementById("login-features");
  const mfaPanel = document.getElementById("mfa-panel");
  const enrollmentPanel = document.getElementById("mfa-enrollment-panel");

  captureMfaMeta(data, username);
  if (loginTabs) loginTabs.hidden = true;
  if (loginShell) loginShell.hidden = true;
  if (loginFeatures) loginFeatures.hidden = true;
  if (enrollmentPanel) enrollmentPanel.hidden = true;
  if (mfaPanel) {
    mfaPanel.hidden = false;
    applyMfaMethodUi();
  }
  const isMaster = String(data?.portal || "") === "master";
  if (!isMaster && pendingMfaMethod === "email" && !pendingMfaMeta.emailSent) {
    void resendEmailMfaCode();
  } else if (data?.message && !data.email_sent) {
    setStatus(data.message);
  }
}

function bindMfaForm() {
  const mfaForm = document.getElementById("mfa-form");
  if (!mfaForm || mfaForm.dataset.bound) return;
  mfaForm.dataset.bound = "1";

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
      return;
    }
    setStatus("Verifying code…");
    const code = new FormData(mfaForm).get("code");
    try {
      const data = await postMfaVerify({
        challenge_token: pendingChallenge,
        code,
        method: pendingMfaMethod === "totp" ? "totp" : "email",
      });
      await storeSessionAndGo(data, redirectForRole(data, pendingRedirect));
    } catch (error) {
      setStatus(friendlyLoginError(error.message, "/auth/mfa/verify", pendingMfaUsername));
    }
  });
}

function loginPayload(form) {
  const raw = Object.fromEntries(new FormData(form).entries());
  return {
    username: raw.username,
    password: raw.password,
  };
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
    const payload = loginPayload(form);
    try {
      const data = await postJson(mode.endpoint, payload);
      if (data.mfa_required && data.challenge_token) {
        pendingChallenge = data.challenge_token;
        pendingRedirect = redirectForRole(data, mode.redirect);
        showMfaStep(data.username || payload.username, data);
        return;
      }
      if (data.mfa_enrollment_required && data.enrollment_token) {
        setStatus("");
        await startMfaEnrollment(data, redirectForRole(data, mode.redirect));
        return;
      }
      await storeSessionAndGo(data, redirectForRole(data, mode.redirect));
    } catch (error) {
      setStatus(friendlyLoginError(error.message, mode.endpoint, payload.username));
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
    forgotLink.href =
      activeLoginMode === "employee" ? "./employee-forgot-password.html" : "./forgot-password.html";
  }
  setStatus("");
}

function initDedicatedLogin(mode) {
  if (!LOGIN_MODES[mode]) return;
  activeLoginMode = mode;
  switchLoginMode(mode);
  bindPortalLogin();
  bindMfaEnrollmentSubmit();
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

  switchLoginMode("business");
  bindPortalLogin();
  bindMfaEnrollmentSubmit();
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
  bindMfaEnrollmentSubmit();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Signing in…");
    const payload = loginPayload(form);
    try {
      const result = await loginWithAutoPortal(payload);
      const { data, redirect } = result;
      pendingRedirect = redirect;
      if (data.mfa_required && data.challenge_token) {
        pendingChallenge = data.challenge_token;
        showMfaStep(data.username || payload.username, data);
        return;
      }
      if (data.mfa_enrollment_required && data.enrollment_token) {
        setStatus("");
        await startMfaEnrollment(data, redirect);
        return;
      }
      await storeSessionAndGo(data, redirect);
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
  bindMfaEnrollmentSubmit();
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
    window.location.replace(window.ShiftSwiftNativeApp.unifiedNativeLoginUrl());
    return;
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

  bindMfaForm();
  bindMfaEnrollmentSubmit();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    pendingRedirect = redirectUrl;
    setStatus("Signing in…");
    const payload = loginPayload(form);
    try {
      const data = await postJson(endpoint, payload);
      if (data.mfa_required && data.challenge_token) {
        pendingChallenge = data.challenge_token;
        pendingRedirect = redirectUrl;
        showMfaStep(data.username || payload.username, data);
        return;
      }
      if (data.mfa_enrollment_required && data.enrollment_token) {
        setStatus("");
        await startMfaEnrollment(data, redirectUrl);
        return;
      }
      await storeSessionAndGo(data, redirectUrl);
    } catch (error) {
      setStatus(friendlyLoginError(error.message, endpoint, payload.username));
    }
  });
}

function showLocalDevHints() {
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
