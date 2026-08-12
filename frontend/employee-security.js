/** Employee portal — security: email codes (default) + optional authenticator. */
(function () {
  "use strict";

  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();

  async function mfaAuthFetch(path, options = {}) {
    const response = await session.fetchWithAuth(path, options, { apiBase: API_BASE });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : data.message || "Request failed");
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadSecurityPanel() {
    const host = document.getElementById("employee-security-content");
    if (!host || host.dataset.ready === "true") return;

    let status;
    try {
      status = await mfaAuthFetch("/auth/mfa/status");
    } catch (error) {
      host.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not load security settings.")}</p>`;
      return;
    }

    const enabled = Boolean(status.mfa_enabled);
    const totpEnabled =
      status.totp_enabled != null ? Boolean(status.totp_enabled) : Boolean(enabled);
    const required = Boolean(status.policy_required);
    const emailDefault = Boolean(status.email_mfa_default);
    const passkeys = Array.isArray(status.passkeys) ? status.passkeys : [];

    const summary = [];
    if (emailDefault) {
      summary.push("After your password, we email you a 6-digit code by default.");
    }
    if (required) {
      summary.push("Your employer also requires an authenticator app.");
    } else {
      summary.push("You can optionally add an authenticator app as an alternative.");
    }

    host.innerHTML = `
      <div class="settings-security-summary">
        <p><strong>Email codes:</strong> ${emailDefault ? "On (default at sign-in)" : "Off on this server"}</p>
        <p><strong>Authenticator app:</strong> ${totpEnabled ? "On" : "Not set"}</p>
        ${passkeys.length ? `<p><strong>Face ID / Touch ID:</strong> ${passkeys.length} device${passkeys.length === 1 ? "" : "s"}</p>` : ""}
        <p class="muted">${escapeHtml(summary.join(" "))}</p>
      </div>
      <div id="employee-mfa-setup-block" ${totpEnabled ? "hidden" : ""}>
        <h4>Authenticator app (optional)</h4>
        <p class="muted">Use Google Authenticator, Authy, or Microsoft Authenticator as an alternative to email codes.</p>
        <button type="button" class="btn outline" id="employee-mfa-start">Generate QR code</button>
        <div id="employee-mfa-qr-area" hidden>
          <div class="mfa-enrollment-qr-wrap"><img id="employee-mfa-qr" alt="Authenticator QR code" width="180" height="180" /></div>
          <p class="muted">Manual key: <code id="employee-mfa-secret"></code></p>
          <label class="edit-field">Verification code<input type="text" id="employee-mfa-code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="123456" /></label>
          <button type="button" class="btn" id="employee-mfa-enable">Enable authenticator app</button>
        </div>
      </div>
      <div id="employee-mfa-disable-block" ${enabled ? "" : "hidden"}>
        <h4>Turn off authenticator app</h4>
        <p class="muted">${
          emailDefault
            ? "Email sign-in codes remain required after this."
            : "Removes authenticator MFA from this account."
        }</p>
        ${required ? '<p class="muted">Required by policy — contact HR if you need an exception.</p>' : ""}
        <label class="edit-field">Password<input type="password" id="employee-mfa-disable-password" autocomplete="current-password" /></label>
        <label class="edit-field">Authenticator code<input type="text" id="employee-mfa-disable-code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" /></label>
        <button type="button" class="btn ghost" id="employee-mfa-disable" ${required ? "disabled" : ""}>Disable authenticator</button>
      </div>
      <p class="muted" id="employee-mfa-status-line" aria-live="polite"></p>`;

    host.dataset.ready = "true";
    const statusLine = document.getElementById("employee-mfa-status-line");

    document.getElementById("employee-mfa-start")?.addEventListener("click", async () => {
      try {
        const setup = await mfaAuthFetch("/auth/mfa/setup", { method: "POST", body: "{}" });
        const qrArea = document.getElementById("employee-mfa-qr-area");
        const qrImg = document.getElementById("employee-mfa-qr");
        const secretEl = document.getElementById("employee-mfa-secret");
        if (secretEl) secretEl.textContent = setup.manual_secret || setup.secret || "";
        if (qrImg && (setup.qr_data_uri || setup.otpauth_uri)) {
          qrImg.src =
            setup.qr_data_uri ||
            `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setup.otpauth_uri)}`;
        }
        if (qrArea) qrArea.hidden = false;
      } catch (error) {
        if (statusLine) statusLine.textContent = error.message;
      }
    });

    document.getElementById("employee-mfa-enable")?.addEventListener("click", async () => {
      const code = document.getElementById("employee-mfa-code")?.value?.trim();
      if (!code) return;
      try {
        await mfaAuthFetch("/auth/mfa/enable", { method: "POST", body: JSON.stringify({ code }) });
        host.dataset.ready = "false";
        await loadSecurityPanel();
      } catch (error) {
        if (statusLine) statusLine.textContent = error.message;
      }
    });

    document.getElementById("employee-mfa-disable")?.addEventListener("click", async () => {
      const password = document.getElementById("employee-mfa-disable-password")?.value || "";
      const code = document.getElementById("employee-mfa-disable-code")?.value?.trim() || "";
      try {
        await mfaAuthFetch("/auth/mfa/disable", {
          method: "POST",
          body: JSON.stringify({ password, code }),
        });
        host.dataset.ready = "false";
        await loadSecurityPanel();
      } catch (error) {
        if (statusLine) statusLine.textContent = error.message;
      }
    });
  }

  window.addEventListener("employee:section", (event) => {
    if (event.detail?.section === "security") {
      const host = document.getElementById("employee-security-content");
      if (host) delete host.dataset.ready;
      void loadSecurityPanel();
    }
  });

  window.addEventListener("hashchange", () => {
    if (window.location.hash.replace("#", "").split("/")[0] === "security") {
      const host = document.getElementById("employee-security-content");
      if (host) delete host.dataset.ready;
      void loadSecurityPanel();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (window.location.hash.replace("#", "").split("/")[0] === "security") {
        void loadSecurityPanel();
      }
    });
  } else if (window.location.hash.replace("#", "").split("/")[0] === "security") {
    void loadSecurityPanel();
  }
})();
