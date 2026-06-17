(function () {
  const session = window.ShiftSwiftSession;
  const API_BASE = session.getApiBase();
  const loginUrl = session.EMPLOYEE_LOGIN_URL;

  if (!session.hasSession()) {
    window.location.replace("./employee-login.html");
    return;
  }

  function setModalStatus(message) {
    const status = document.getElementById("employee-gdpr-status");
    if (!status) return;
    if (message) {
      status.textContent = message;
      status.hidden = false;
    } else {
      status.textContent = "";
      status.hidden = true;
    }
  }

  function showGdprModal(employerName) {
    const modal = document.getElementById("employee-gdpr-modal");
    const employerEl = document.getElementById("employee-gdpr-employer");
    if (employerEl && employerName) {
      employerEl.textContent = employerName;
    }
    if (modal) modal.hidden = false;
    document.body.classList.add("employee-gdpr-locked");
  }

  function hideGdprModal() {
    const modal = document.getElementById("employee-gdpr-modal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("employee-gdpr-locked");
  }

  async function submitGdprConsent() {
    const checkbox = document.getElementById("employee-gdpr-checkbox");
    if (!checkbox?.checked) {
      setModalStatus(
        "Please confirm you understand your employer manages your data and agree to the privacy policy.",
      );
      return;
    }
    setModalStatus("");
    const button = document.getElementById("employee-gdpr-submit");
    if (button) button.disabled = true;
    try {
      const response = await session.fetchWithAuth(
        "/auth/employee/gdpr-consent",
        {
          method: "POST",
          body: JSON.stringify({ accept_employee_gdpr: true }),
        },
        { apiBase: API_BASE, loginUrl },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Could not save your consent.");
      }
      hideGdprModal();
    } catch (error) {
      setModalStatus(error.message || "Could not save your consent.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadProfile() {
    const welcome = document.getElementById("employee-welcome");
    const displayNameEl = document.getElementById("employee-display-name");
    const employerHeader = document.getElementById("topbar-employer-name");
    const employerSubtitle = document.getElementById("mobile-employer-subtitle");
    try {
      const response = await session.fetchWithAuth("/auth/verify", {}, { apiBase: API_BASE, loginUrl });
      if (!response.ok) {
        window.dispatchEvent(
          new CustomEvent("employee:profile-loaded", {
            detail: {
              user: {
                time_clock_enabled: localStorage.getItem("employeeTimeClockEnabled") === "true",
              },
            },
          }),
        );
        return;
      }
      const user = await response.json();
      if (user.tenant_id != null) {
        localStorage.setItem("tenantId", String(user.tenant_id));
      }
      if (user.role !== "employee") {
        window.location.replace("./admin.html");
        return;
      }
      applyEmployeeIdentity(user);
      const employerLabel = user.employer_name || "Your employer";
      if (employerHeader) employerHeader.textContent = employerLabel;
      if (employerSubtitle) employerSubtitle.textContent = employerLabel;
      const displayName = localStorage.getItem("employeeDisplayName") || "Employee";
      if (displayNameEl) displayNameEl.textContent = displayName;
      if (welcome) welcome.textContent = `${displayName} · ${employerLabel}`;
      window.EmployeeMobile?.refreshGreeting?.();
      if (user.gdpr_consent_required) {
        showGdprModal(user.employer_name);
      }
      window.dispatchEvent(new CustomEvent("employee:profile-loaded", { detail: { user } }));
    } catch {
      const fallback = "Could not load your account.";
      if (welcome) welcome.textContent = fallback;
      if (displayNameEl) displayNameEl.textContent = fallback;
      window.dispatchEvent(
        new CustomEvent("employee:profile-loaded", {
          detail: {
            user: {
              time_clock_enabled: localStorage.getItem("employeeTimeClockEnabled") === "true",
            },
          },
        }),
      );
    }
  }

  function usernameDisplayFallback(username) {
    const local = (username.split("@")[0] || username || "").trim();
    if (!local) return "Employee";
    const cleaned = local.replace(/\d+$/, "") || local;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  function applyEmployeeIdentity(user) {
    if (user.username) {
      localStorage.setItem("employeeUsername", user.username);
    }
    const displayName =
      (user.display_name || "").trim() ||
      usernameDisplayFallback(user.username || "");
    const firstName =
      (user.first_name || "").trim() ||
      displayName.split(/\s+/)[0] ||
      "there";
    localStorage.setItem("employeeDisplayName", displayName);
    localStorage.setItem("employeeFirstName", firstName);
  }

  function signOut(event) {
    event.preventDefault();
    session.clearSession();
    localStorage.removeItem("employeeUsername");
    localStorage.removeItem("employeeDisplayName");
    localStorage.removeItem("employeeFirstName");
    window.location.href = "./employee-login.html";
  }

  document.querySelectorAll("[data-sign-out]").forEach((el) => {
    el.addEventListener("click", signOut);
  });

  document.getElementById("employee-gdpr-submit")?.addEventListener("click", submitGdprConsent);

  if (window.MobileShell) {
    const sidebar = window.MobileShell.initSidebar();
    window.EmployeeMobile?.init?.();
    window.MobileShell.initHashSections({
      defaultSection: "overview",
      sectionEvent: "employee:section",
      sidebar,
    });
  } else {
    window.EmployeeMobile?.init?.();
  }

  loadProfile();
})();
