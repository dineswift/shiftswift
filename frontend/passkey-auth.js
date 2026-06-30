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
    const copy = JSON.parse(JSON.stringify(options || {}));
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
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const response = await fetch(`${getApiBase()}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : data.message || "Request failed";
      throw new Error(message);
    }
    return data;
  }

  function canUsePasskeys() {
    return Boolean(window.PublicKeyCredential && navigator.credentials?.create);
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
    if (!normalized || !canUsePasskeys()) return false;
    try {
      const data = await fetchJson(
        `/auth/passkey/status?username=${encodeURIComponent(normalized)}`,
        { method: "GET" },
      );
      return Boolean(data.has_passkeys);
    } catch {
      return false;
    }
  }

  async function registerPasskey(email) {
    if (!canUsePasskeys() || !isPasskeyOptIn()) return false;
    const token = localStorage.getItem("token");
    if (!token) return false;
    try {
      const begin = await fetchJson("/auth/passkey/register/options", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const credential = await navigator.credentials.create({
        publicKey: decodeOptions(begin.options),
      });
      if (!credential) return false;
      await fetchJson("/auth/passkey/register/verify", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          challenge_token: begin.challenge_token,
          credential: credentialToJson(credential),
          device_label: window.ShiftSwiftTrustedDevice?.deviceLabel?.() || "This device",
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async function loginWithPasskey(email, { silent = false } = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized || !canUsePasskeys()) return null;
    try {
      const begin = await fetchJson("/auth/passkey/login/options", {
        method: "POST",
        body: { username: normalized },
      });
      const credential = await navigator.credentials.get({
        publicKey: decodeOptions(begin.options),
        mediation: silent ? "silent" : "optional",
      });
      if (!credential) return null;
      const data = await fetchJson("/auth/passkey/login/verify", {
        method: "POST",
        body: {
          username: normalized,
          challenge_token: begin.challenge_token,
          credential: credentialToJson(credential),
        },
      });
      rememberLastEmail(normalized);
      return data;
    } catch {
      return null;
    }
  }

  async function tryAutoLogin(email) {
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

  function bindPasskeyUi() {
    const wrap = document.getElementById("login-passkey-wrap");
    const checkbox = document.getElementById("login-use-passkey");
    const button = document.getElementById("login-passkey-btn");
    const supported = canUsePasskeys();
    if (wrap) wrap.hidden = !supported;
    if (button) {
      button.hidden = !supported;
      button.addEventListener("click", async () => {
        const email = normalizeEmail(document.getElementById("login-email")?.value || lastLoginEmail());
        if (!email) {
          document.getElementById("login-status").textContent = "Enter your work email first.";
          return;
        }
        button.disabled = true;
        try {
          const ok = await tryAutoLogin(email);
          if (!ok) {
            document.getElementById("login-status").textContent =
              "Face ID sign-in is not available. Use your password or set up Face ID after signing in once.";
          }
        } finally {
          button.disabled = false;
        }
      });
    }
    if (checkbox) {
      checkbox.addEventListener("change", () => {
        try {
          localStorage.setItem(PASSKEY_OPT_IN_KEY, checkbox.checked ? "1" : "0");
        } catch {
          /* ignore */
        }
      });
      try {
        const stored = localStorage.getItem(PASSKEY_OPT_IN_KEY);
        if (stored === "0" || stored === "1") checkbox.checked = stored === "1";
      } catch {
        /* ignore */
      }
    }
  }

  window.ShiftSwiftPasskeyAuth = {
    canUsePasskeys,
    isPasskeyOptIn,
    rememberLastEmail,
    lastLoginEmail,
    hasPasskeys,
    registerPasskey,
    loginWithPasskey,
    tryAutoLogin,
    bindPasskeyUi,
  };
})();
