/** QR code + copy-link helpers for PWA install landing pages. */
(function initPwaInstallQr() {
  const script = document.currentScript;
  const fallbackPath = script?.dataset.installPath || "./install-employee.html";
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  const installUrl = canonical || new URL(fallbackPath, window.location.href).href;

  const qrImg = document.getElementById("pwa-install-qr");
  const urlLink = document.getElementById("pwa-install-qr-url");
  const copyBtn = document.getElementById("pwa-install-copy-link");
  const copyStatus = document.getElementById("pwa-install-copy-status");

  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(installUrl)}`;
  }

  if (urlLink) {
    urlLink.href = installUrl;
    urlLink.textContent = installUrl.replace(/^https?:\/\//, "");
  }

  async function copyInstallLink() {
    try {
      await navigator.clipboard.writeText(installUrl);
      if (copyStatus) {
        copyStatus.textContent = "Link copied";
        copyStatus.hidden = false;
        window.setTimeout(() => {
          copyStatus.hidden = true;
        }, 2200);
      } else if (copyBtn) {
        const original = copyBtn.textContent;
        copyBtn.textContent = "Copied";
        window.setTimeout(() => {
          copyBtn.textContent = original;
        }, 2200);
      }
    } catch {
      if (copyStatus) {
        copyStatus.textContent = "Copy the link above manually";
        copyStatus.hidden = false;
      }
    }
  }

  copyBtn?.addEventListener("click", copyInstallLink);

  window.ShiftSwiftPwaInstallQr = { installUrl, copyInstallLink };
})();
