(function () {
  if (!window.ShiftSwiftSession?.hasSession?.()) {
    window.location.replace("./business-login.html");
  }
})();

function signOut() {
  window.ShiftSwiftSession?.clearSession?.();
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("tenantId");
  localStorage.removeItem("userRole");
  window.location.href = "./business-login.html";
}

document.querySelectorAll("[data-sign-out]").forEach((el) => {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    signOut();
  });
});
