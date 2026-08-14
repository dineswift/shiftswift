/** Employee portal — self-service two-factor authentication. */
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
    const required = Boolean(status.policy_required);
    host.innerHTML = `
      <div class="settings-security-summary">
        <p><strong>Status:</strong> ${enabled ? "Two-factor authentication is ON" : "Not enabled yet"}</p>
        <p class="muted">${required ? "Your employer requires authenticator app codes at sign-in." : "You can optionally enable an authenticator app for extra account security."}</p>
      </div>
      <div id="employee-mfa-setup-block" ${enabled ? "hidden" : ""}>
        <h4>Set up authenticator</h4>
        <p class="muted">Use Google Authenticator, Authy, or Microsoft Authenticator.</p>
        <button type="button" class="btn outline" id="employee-mfa-start">Generate QR code</button>
        <div id="employee-mfa-qr-area" hidden>
          <div class="mfa-enrollment-qr-wrap"><img id="employee-mfa-qr" alt="Authenticator QR code" width="180" height="180" /></div>
          <p class="muted">Manual key: <code id="employee-mfa-secret"></code></p>
          <label class="edit-field">Verification code<input type="text" id="employee-mfa-code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="123456" /></label>
          <button type="button" class="btn" id="employee-mfa-enable">Enable two-factor authentication</button>
        </div>
      </div>
      <div id="employee-mfa-disable-block" ${enabled ? "" : "hidden"}>
        <h4>Turn off two-factor authentication</h4>
        ${required ? '<p class="muted">Required by policy — contact HR if you need an exception.</p>' : ""}
        <label class="edit-field">Password<input type="password" id="employee-mfa-disable-password" autocomplete="current-password" /></label>
        <label class="edit-field">Authenticator code<input type="text" id="employee-mfa-disable-code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" /></label>
        <button type="button" class="btn ghost" id="employee-mfa-disable" ${required ? "disabled" : ""}>Disable two-factor authentication</button>
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
        if (secretEl) secretEl.textContent = setup.manual_secret || "";
        if (qrImg && setup.otpauth_uri) {
          qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setup.otpauth_uri)}`;
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
      void loadSecurityPanel();
    }
  });

  if (window.location.hash.replace("#", "").split("/")[0] === "security") {
    void loadSecurityPanel();
  }

  window.EmployeeSecurity = { loadSecurityPanel };
})();
