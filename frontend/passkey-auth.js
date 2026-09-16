/** WebAuthn passkeys — Face ID / Touch ID auto sign-in (PWA + browser). */
(function initShiftSwiftPasskeyAuth() {
  const LAST_EMAIL_KEY = "sshrLastLoginEmail";
  const PASSKEY_OPT_IN_KEY = "sshrPasskeyOptIn";

  function getApiBase() {
    if (window.ShiftSwiftBrand?.getApiBase) return window.ShiftSwiftBrand.getApiBase();
    if (window.ShiftSwiftBrand?.resolveApiBase) return window.ShiftSwiftBrand.resolveApiBase();
    return localStorage.getItem("apiBaseUrl") || "https://api.shiftswifthr.co.uk";
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function bufferToBase64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64urlToBuffer(value) {
    const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob(base64 + pad);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  }

  function decodeOptions(options) {
    const raw = typeof options === "string" ? JSON.parse(options) : options || {};
    const copy = JSON.parse(JSON.stringify(raw));
    if (copy.challenge) copy.challenge = base64urlToBuffer(copy.challenge);
    if (copy.user?.id) copy.user.id = base64urlToBuffer(copy.user.id);
    if (Array.isArray(copy.excludeCredentials)) {
      copy.excludeCredentials = copy.excludeCredentials.map((item) => ({
        ...item,
        id: base64urlToBuffer(item.id),
      }));
    }
    if (Array.isArray(copy.allowCredentials)) {
      copy.allowCredentials = copy.allowCredentials.map((item) => ({
        ...item,
        id: base64urlToBuffer(item.id),
      }));
    }
    return copy;
  }

  function pageOrigin() {
    try {
      return String(window.location.origin || "").replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  function pageHostname() {
    try {
      return String(window.location.hostname || "").toLowerCase();
    } catch {
      return "";
    }
  }

  function publicKeyFromBegin(begin) {
    const copy = decodeOptions(begin?.options);
    const host = pageHostname();
    const fromServer = String(begin?.rp_id || copy.rp?.id || "")
      .trim()
      .toLowerCase();
    // Parent RP IDs (e.g. shiftswifthr.co.uk on app.shiftswifthr.co.uk) fail in Chrome
    // unless Related Origins are configured — prefer the exact page host.
    let rpId = fromServer;
    if (host && fromServer && host !== fromServer && host.endsWith("." + fromServer)) {
      rpId = host;
    } else if (!fromServer && host) {
      rpId = host;
    }
    if (rpId) {
      copy.rp = { ...(copy.rp || {}), id: rpId, name: copy.rp?.name || "ShiftSwift HR" };
    }
    return copy;
  }

  function credentialToJson(credential) {
    const response = credential.response || {};
    const out = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
      },
    };
    if (response.attestationObject) {
      out.response.attestationObject = bufferToBase64url(response.attestationObject);
    }
    if (response.authenticatorData) {
      out.response.authenticatorData = bufferToBase64url(response.authenticatorData);
    }
    if (response.signature) {
      out.response.signature = bufferToBase64url(response.signature);
    }
    if (response.userHandle) {
      out.response.userHandle = bufferToBase64url(response.userHandle);
    }
    if (credential.getClientExtensionResults) {
      out.clientExtensionResults = credential.getClientExtensionResults();
    }
    return out;
  }

  async function fetchJson(path, options = {}) {
    const origin = pageOrigin();
    const headers = {
      "Content-Type": "application/json",
      ...(origin ? { "X-Client-Origin": origin } : {}),
      ...(options.headers || {}),
    };
    window.ShiftSwiftNativeApiFetch?.boot?.();
    const url = `${getApiBase()}${path}`;
    let body = options.body;
    if (body && typeof body === "object" && !Array.isArray(body) && origin && body.client_origin == null) {
      body = { ...body, client_origin: origin };
    } else if (
      body == null &&
      origin &&
      options.method &&
      /^(POST|PUT|PATCH)$/i.test(String(options.method))
    ) {
      body = { client_origin: origin };
    }
    const reqInit = {
      ...options,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    };
    const response = window.ShiftSwiftNativeApiFetch?.nativeAwareFetch
      ? await window.ShiftSwiftNativeApiFetch.nativeAwareFetch(url, reqInit)
      : await fetch(url, reqInit);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : data.message || "Request failed";
      throw new Error(message);
    }
    return data;
  }

  function isDesktopLoginSurface() {
    try {
      if (window.Capacitor?.isNativePlatform?.()) return false;
      if (window.ShiftSwiftNativeApp?.isCapacitorNative?.()) return false;
    } catch {
      /* ignore */
    }
    const ua = String(navigator.userAgent || "");
    // Phones / tablets only — desktop (including Mac Touch ID browsers) stays password + email code.
    if (/iPhone|iPod|iPad|Android/i.test(ua)) return false;
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return false; // iPadOS desktop UA
    return true;
  }

  let backendPasskeysEnabled = null;
  let backendPasskeysProbe = null;

  async function refreshBackendPasskeysEnabled() {
    if (backendPasskeysProbe) return backendPasskeysProbe;
    backendPasskeysProbe = (async () => {
      try {
        const data = await fetchJson("/auth/passkey/status", { method: "GET" });
        backendPasskeysEnabled = Boolean(data.passkeys_enabled);
      } catch {
        backendPasskeysEnabled = false;
      }
      return backendPasskeysEnabled;
    })();
    try {
      return await backendPasskeysProbe;
    } finally {
      backendPasskeysProbe = null;
    }
  }

  function canUsePasskeys() {
    if (isDesktopLoginSurface()) return false;
    // Require an explicit server allow — never show Face ID while the flag is unknown/off.
    if (backendPasskeysEnabled !== true) return false;
    if (!window.PublicKeyCredential || !navigator.credentials?.create) return false;
    // Capacitor / Ionic WebViews expose WebAuthn APIs but RP ID / Associated Domains
    // usually fail — hide Face ID CTAs so authenticator codes stay the clear path.
    try {
      if (window.Capacitor?.isNativePlatform?.()) return false;
      const origin = String(window.location.origin || window.location.href || "");
      if (/^(capacitor|ionic|app):\/\//i.test(origin)) return false;
      if (/\/\/localhost\b/i.test(origin) && window.__SSHR_BUNDLED_NATIVE_BOOT) return false;
    } catch {
      /* ignore */
    }
    return true;
  }

  async function canUsePasskeysAsync() {
    if (isDesktopLoginSurface()) return false;
    const enabled = await refreshBackendPasskeysEnabled();
    if (!enabled) return false;
    return canUsePasskeys();
  }

  function isPasskeyOptIn() {
    try {
      const stored = localStorage.getItem(PASSKEY_OPT_IN_KEY);
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {
      /* ignore */
    }
    const el = document.getElementById("login-use-passkey");
    if (el) return Boolean(el.checked);
    return true;
  }

  function rememberLastEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    try {
      localStorage.setItem(LAST_EMAIL_KEY, normalized);
    } catch {
      /* ignore */
    }
  }

  function lastLoginEmail() {
    try {
      return normalizeEmail(localStorage.getItem(LAST_EMAIL_KEY) || "");
    } catch {
      return "";
    }
  }

  async function hasPasskeys(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    if (!(await canUsePasskeysAsync())) return false;
    try {
      const data = await fetchJson(
        `/auth/passkey/status?username=${encodeURIComponent(normalized)}`,
        { method: "GET" },
      );
      if (data.passkeys_enabled === false) {
        backendPasskeysEnabled = false;
        return false;
      }
      backendPasskeysEnabled = true;
      return Boolean(data.has_passkeys);
    } catch {
      return false;
    }
  }

  async function refreshPasskeyButton(email) {
    const button = document.getElementById("login-passkey-btn");
    const wrap = document.getElementById("login-passkey-wrap");
    const supported = await canUsePasskeysAsync();
    if (wrap) wrap.hidden = !supported;
    if (!button || !supported) {
      if (button) button.hidden = true;
      return;
    }
    const normalized = normalizeEmail(email) || lastLoginEmail();
    if (!normalized) {
      button.hidden = true;
      return;
    }
    button.hidden = !(await hasPasskeys(normalized));
  }

  function notePasskeysEnabledFromServer(value) {
    if (typeof value === "boolean") backendPasskeysEnabled = value;
  }

  function bindPasskeyUi() {
    const wrap = document.getElementById("login-passkey-wrap");
    const checkbox = document.getElementById("login-use-passkey");
    const button = document.getElementById("login-passkey-btn");
    const emailInput = document.getElementById("login-email");
    // Hide immediately on desktop; confirm backend flag async for mobile.
    if (wrap) wrap.hidden = !canUsePasskeys() || isDesktopLoginSurface();
    if (button) button.hidden = true;
    void (async () => {
      const supported = await canUsePasskeysAsync();
      if (wrap) wrap.hidden = !supported;
      if (!supported && button) button.hidden = true;
      if (supported) await refreshPasskeyButton(emailInput?.value || lastLoginEmail());
    })();
    if (button && !button.dataset.boundPasskey) {
      button.dataset.boundPasskey = "1";
      button.addEventListener("click", async () => {
        const email = normalizeEmail(emailInput?.value || lastLoginEmail());
        if (!email) {
          document.getElementById("login-status").textContent = "Enter your work email first.";
          return;
        }
        button.disabled = true;
        const status = document.getElementById("login-status");
        try {
          if (!(await hasPasskeys(email))) {
            if (status) {
              status.hidden = false;
              status.textContent =
                "Face ID is not set up on this account yet. Sign in with your password once — keep “Use Face ID next time” checked to register this device.";
            }
            return;
          }
          if (status) {
            status.hidden = false;
            status.textContent = "Waiting for Face ID…";
          }
          const data = await loginWithPasskey(email, { silent: false });
          if (!data?.access_token) throw new Error("Face ID sign-in failed");
          await finishPasskeyLogin(data, email);
        } catch (error) {
          if (status) {
            status.hidden = false;
            status.textContent = error.message || "Face ID sign-in failed";
          }
        } finally {
          button.disabled = false;
        }
      });
    }
    if (checkbox && !checkbox.dataset.boundPasskey) {
      checkbox.dataset.boundPasskey = "1";
      checkbox.addEventListener("change", () => {
        try {
          localStorage.setItem(PASSKEY_OPT_IN_KEY, checkbox.checked ? "1" : "0");
        } catch {
          /* ignore */
        }
      });
      try {
        const stored = localStorage.getItem(PASSKEY_OPT_IN_KEY);
        if (stored === "0") checkbox.checked = false;
        if (stored === "1") checkbox.checked = true;
      } catch {
        /* ignore */
      }
    }
    if (emailInput && !emailInput.dataset.boundPasskey) {
      emailInput.dataset.boundPasskey = "1";
      emailInput.addEventListener("blur", () => {
        void refreshPasskeyButton(emailInput.value);
      });
      emailInput.addEventListener("change", () => {
        void refreshPasskeyButton(emailInput.value);
      });
    }
  }

  async function registerPasskey(email) {
    if (!(await canUsePasskeysAsync()) || !isPasskeyOptIn()) return false;
    try {
      await registerPasskeyOnDevice({ enableMfa: false });
      return true;
    } catch {
      return false;
    }
  }

  async function registerPasskeyOnDevice({ enableMfa = false, deviceLabel } = {}) {
    if (!(await canUsePasskeysAsync())) {
      throw new Error("Face ID / Touch ID is not available in this browser");
    }
    const token = localStorage.getItem("token");
    if (!token) throw new Error("Sign in again to manage Face ID");
    const begin = await fetchJson("/auth/passkey/register/options", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: { client_origin: pageOrigin() },
    });
    const credential = await navigator.credentials.create({
      publicKey: publicKeyFromBegin(begin),
    });
    if (!credential) throw new Error("Face ID setup was cancelled");
    return fetchJson("/auth/passkey/register/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: {
        challenge_token: begin.challenge_token,
        credential: credentialToJson(credential),
        device_label: deviceLabel || window.ShiftSwiftTrustedDevice?.deviceLabel?.() || "Face ID / Touch ID",
        enable_mfa: Boolean(enableMfa),
        client_origin: pageOrigin(),
      },
    });
  }

  async function deletePasskey(passkeyId) {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("Sign in again to manage Face ID");
    return fetchJson(`/auth/passkey/${encodeURIComponent(passkeyId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async function loginWithPasskey(email, { silent = false } = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized || !(await canUsePasskeysAsync())) return null;
    try {
      const begin = await fetchJson("/auth/passkey/login/options", {
        method: "POST",
        body: { username: normalized, client_origin: pageOrigin() },
      });
      const credential = await navigator.credentials.get({
        publicKey: publicKeyFromBegin(begin),
        mediation: silent ? "silent" : "optional",
      });
      if (!credential) return null;
      const data = await fetchJson("/auth/passkey/login/verify", {
        method: "POST",
        body: {
          username: normalized,
          challenge_token: begin.challenge_token,
          credential: credentialToJson(credential),
          client_origin: pageOrigin(),
        },
      });
      rememberLastEmail(normalized);
      return data;
    } catch (error) {
      if (!silent) throw error;
      return null;
    }
  }

  async function verifyMfaWithPasskey(mfaChallengeToken, email) {
    const normalized = normalizeEmail(email);
    if (!normalized || !(await canUsePasskeysAsync()) || !mfaChallengeToken) {
      throw new Error("Face ID is not available on this device");
    }
    const begin = await fetchJson("/auth/mfa/passkey/options", {
      method: "POST",
      body: {
        challenge_token: mfaChallengeToken,
        username: normalized,
        client_origin: pageOrigin(),
      },
    });
    const credential = await navigator.credentials.get({
      publicKey: publicKeyFromBegin(begin),
      mediation: "required",
    });
    if (!credential) throw new Error("Face ID verification was cancelled");
    return fetchJson("/auth/mfa/passkey/verify", {
      method: "POST",
      body: {
        challenge_token: mfaChallengeToken,
        username: normalized,
        passkey_challenge_token: begin.challenge_token,
        credential: credentialToJson(credential),
        remember_device: Boolean(window.ShiftSwiftTrustedDevice?.shouldRememberDevice?.()),
        device_label: window.ShiftSwiftTrustedDevice?.deviceLabel?.() || undefined,
        client_origin: pageOrigin(),
      },
    });
  }

  async function enrollMfaWithPasskey(enrollmentToken) {
    if (!(await canUsePasskeysAsync()) || !enrollmentToken) {
      throw new Error("Face ID is not available on this device");
    }
    const begin = await fetchJson("/auth/mfa/passkey/enroll/options", {
      method: "POST",
      headers: { Authorization: `Bearer ${enrollmentToken}` },
      body: { client_origin: pageOrigin() },
    });
    const credential = await navigator.credentials.create({
      publicKey: publicKeyFromBegin(begin),
    });
    if (!credential) throw new Error("Face ID setup was cancelled");
    return fetchJson("/auth/mfa/passkey/enroll/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${enrollmentToken}` },
      body: {
        challenge_token: begin.challenge_token,
        credential: credentialToJson(credential),
        device_label: window.ShiftSwiftTrustedDevice?.deviceLabel?.() || "Face ID / Touch ID",
        remember_device: Boolean(window.ShiftSwiftTrustedDevice?.shouldRememberDevice?.()),
        client_origin: pageOrigin(),
      },
    });
  }

  async function tryAutoLogin(email) {
    if (isDesktopLoginSurface()) return false;
    if (!(await canUsePasskeysAsync()) || !isPasskeyOptIn()) return false;
    const target = normalizeEmail(email) || lastLoginEmail();
    if (!target) return false;
    if (!(await hasPasskeys(target))) return false;
    const data = await loginWithPasskey(target, { silent: true });
    if (!data?.access_token) {
      const retry = await loginWithPasskey(target, { silent: false });
      if (!retry?.access_token) return false;
      return finishPasskeyLogin(retry, target);
    }
    return finishPasskeyLogin(data, target);
  }

  async function finishPasskeyLogin(data, email) {
    if (window.ShiftSwiftSession?.storeSession) {
      window.ShiftSwiftSession.storeSession({ ...data, username: data.username || email });
    }
    if (window.ShiftSwiftSession?.confirmNativeSessionPersisted) {
      await window.ShiftSwiftSession.confirmNativeSessionPersisted();
    } else if (window.ShiftSwiftSession?.persistNativeSession) {
      await window.ShiftSwiftSession.persistNativeSession();
    }
    window.ShiftSwiftSession?.bridgeNativeSessionForNextPage?.();
    await window.ShiftSwiftTrustedDevice?.rememberDeviceFromResponse?.(email, data);
    try {
      sessionStorage.setItem("sshrPostLoginTransition", "1");
    } catch {
      /* ignore */
    }
    const role = data.role;
    let redirect = "./admin.html";
    if (role === "employee") redirect = "./employee.html";
    else if (role === "admin" && String(data.tenant_id) === String(localStorage.getItem("masterTenantId") || "999")) {
      redirect = "./master.html";
    }
    if (window.ShiftSwiftSession?.portalUrl) {
      redirect = window.ShiftSwiftSession.portalUrl(redirect.replace(/^\.\//, ""));
    }
    window.location.replace(redirect);
    return true;
  }

  window.ShiftSwiftPasskeyAuth = {
    canUsePasskeys,
    canUsePasskeysAsync,
    isDesktopLoginSurface,
    notePasskeysEnabledFromServer,
    isPasskeyOptIn,
    rememberLastEmail,
    lastLoginEmail,
    hasPasskeys,
    registerPasskey,
    registerPasskeyOnDevice,
    deletePasskey,
    loginWithPasskey,
    verifyMfaWithPasskey,
    enrollMfaWithPasskey,
    tryAutoLogin,
    refreshPasskeyButton,
    bindPasskeyUi,
  };
})();
