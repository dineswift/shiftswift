const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.classList.add("hidden");
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const data = await window.SwiftHelp.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    localStorage.setItem("swifthelpToken", data.token);
    localStorage.setItem("swifthelpUser", JSON.stringify(data.user));
    window.location.replace(data.user.role === "requester" ? "./request.html" : "./app.html");
  } catch (err) {
    errorEl.textContent = err.message || "Could not sign in";
    errorEl.classList.remove("hidden");
  }
});
