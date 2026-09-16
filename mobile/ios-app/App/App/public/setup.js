const statusEl = document.getElementById("setup-status");
const messageEl = document.getElementById("setup-message");
const form = document.getElementById("setup-form");
const API_BASE =
  localStorage.getItem("apiBaseUrl") ||
  (window.ShiftSwiftBrand?.resolveApiBase ? window.ShiftSwiftBrand.resolveApiBase() : "http://localhost:3000");

async function refreshStatus() {
  if (!statusEl) return;
  try {
    const response = await fetch(`${API_BASE}/setup/status`);
    const data = await response.json();
    statusEl.textContent = data.complete ? "Setup complete" : "Setup required";
  } catch {
    statusEl.textContent = "Backend not reachable";
  }
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  localStorage.setItem("apiBaseUrl", payload.api_base_url || API_BASE);
  if (messageEl) {
    messageEl.textContent = "Saved. Start the API with bash scripts/start_local.sh if it is not running.";
  }
});

refreshStatus();
