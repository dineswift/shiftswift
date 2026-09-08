const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");

if (localStorage.getItem("swiftcrmToken")) {
  window.location.replace("./app.html");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.classList.add("hidden");
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const data = await window.SwiftCRM.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    localStorage.setItem("swiftcrmToken", data.token);
    localStorage.setItem("swiftcrmUser", JSON.stringify(data.user));
    window.location.replace("./app.html");
  } catch (err) {
    errorEl.textContent = err.message || "Could not sign in";
    errorEl.classList.remove("hidden");
  }
});
