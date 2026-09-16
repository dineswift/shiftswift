/** Open authenticated files on iPad/Safari/PWA without relying on <a download>. */
(function (root) {
  function navLike(nav) {
    return nav || root.navigator || {};
  }

  function isIosLike(nav) {
    const n = navLike(nav);
    const ua = String(n.userAgent || "");
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    const platform = String(n.platform || "");
    const maxTouch = Number(n.maxTouchPoints || 0);
    return platform === "MacIntel" && maxTouch > 1;
  }

  function isStandaloneShell(nav, win) {
    const n = navLike(nav);
    const w = win || root;
    try {
      if (w.Capacitor?.isNativePlatform?.()) return true;
    } catch {
      /* ignore */
    }
    if (n.standalone) return true;
    try {
      if (w.matchMedia?.("(display-mode: standalone)")?.matches) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function prefersInAppViewer(nav, win) {
    return isIosLike(nav) || isStandaloneShell(nav, win);
  }

  function blobKind(blob, filename) {
    const type = String(blob?.type || "").toLowerCase();
    const name = String(filename || "").toLowerCase();
    if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
    if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) return "image";
    return "file";
  }

  function triggerAnchorDownload(blob, filename, doc) {
    const documentRef = doc || root.document;
    const url = URL.createObjectURL(blob);
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = filename || "download";
    link.rel = "noopener";
    documentRef.body.appendChild(link);
    link.click();
    link.remove();
    root.setTimeout?.(() => URL.revokeObjectURL(url), 1500);
    return { method: "anchor-download", url };
  }

  async function shareBlob(blob, filename, nav) {
    const n = navLike(nav);
    if (typeof File !== "function" || typeof n.share !== "function") return false;
    const file = new File([blob], filename || "download", {
      type: blob.type || "application/octet-stream",
    });
    try {
      if (typeof n.canShare === "function" && !n.canShare({ files: [file] })) return false;
      await n.share({ files: [file], title: filename || "ShiftSwift file" });
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return true;
      return false;
    }
  }

  function openBlobTab(url, win) {
    const w = win || root;
    try {
      const opened = w.open?.(url, "_blank");
      if (opened && !opened.closed) return opened;
    } catch {
      /* pop-ups blocked */
    }
    return null;
  }

  function closeViewer(shell, url) {
    shell?.remove();
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  }

  function openInAppViewer(blob, filename, options) {
    const opts = options || {};
    const documentRef = opts.document || root.document;
    if (!documentRef?.body) return triggerAnchorDownload(blob, filename, documentRef);
    const url = URL.createObjectURL(blob);
    const kind = blobKind(blob, filename);
    documentRef.getElementById("sshr-file-viewer")?.remove();
    const shell = documentRef.createElement("div");
    shell.id = "sshr-file-viewer";
    shell.className = "sshr-file-viewer admin-blob-preview";
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "true");
    shell.setAttribute("aria-label", filename || "File preview");

    const bar = documentRef.createElement("div");
    bar.className = "sshr-file-viewer__bar admin-blob-preview__bar";
    const title = documentRef.createElement("strong");
    title.className = "sshr-file-viewer__title admin-blob-preview__title";
    title.textContent = filename || "File";
    const actions = documentRef.createElement("div");
    actions.className = "sshr-file-viewer__actions admin-blob-preview__actions";

    function addBtn(label, className, onClick) {
      const btn = documentRef.createElement("button");
      btn.type = "button";
      btn.className = className;
      btn.textContent = label;
      btn.addEventListener("click", onClick);
      actions.appendChild(btn);
      return btn;
    }

    addBtn("Share", "btn outline", () => {
      void shareBlob(blob, filename, opts.navigator).then((shared) => {
        if (!shared) triggerAnchorDownload(blob, filename, documentRef);
      });
    });
    addBtn(kind === "pdf" ? "Open tab" : "Open", "btn outline", () => {
      const opened = openBlobTab(url, opts.window || root);
      if (!opened) triggerAnchorDownload(blob, filename, documentRef);
    });
    if (kind === "pdf") {
      addBtn("Print", "btn outline", () => {
        const frame = shell.querySelector("iframe");
        try {
          frame?.contentWindow?.focus?.();
          frame?.contentWindow?.print?.();
        } catch {
          triggerAnchorDownload(blob, filename, documentRef);
        }
      });
    }
    addBtn("Save", "btn ghost", () => triggerAnchorDownload(blob, filename, documentRef));
    addBtn("Close", "btn ghost", () => closeViewer(shell, url));

    bar.appendChild(title);
    bar.appendChild(actions);
    const preview = documentRef.createElement("div");
    preview.className = "sshr-file-viewer__preview admin-blob-preview__body";
    if (kind === "pdf") {
      const frame = documentRef.createElement("iframe");
      frame.title = filename || "PDF";
      frame.src = url;
      preview.appendChild(frame);
    } else if (kind === "image") {
      const img = documentRef.createElement("img");
      img.alt = filename || "Image";
      img.src = url;
      preview.appendChild(img);
    } else {
      const note = documentRef.createElement("p");
      note.className = "sshr-file-viewer__note admin-blob-preview__empty muted";
      note.textContent = "This file is ready. Use Share or Save if your browser blocked the download.";
      preview.appendChild(note);
    }
    shell.appendChild(bar);
    shell.appendChild(preview);
    documentRef.body.appendChild(shell);
    return { method: "in-app-viewer", url, kind, shell };
  }

  async function deliverBlob(blob, filename, options) {
    const opts = options || {};
    const nav = opts.navigator || root.navigator;
    const win = opts.window || root;
    if (opts.forceViewer || prefersInAppViewer(nav, win)) {
      return openInAppViewer(blob, filename, opts);
    }
    return triggerAnchorDownload(blob, filename, opts.document || root.document);
  }

  root.ShiftSwiftFileOpen = {
    isIosLike,
    isStandaloneShell,
    prefersInAppViewer,
    blobKind,
    triggerAnchorDownload,
    shareBlob,
    openBlobTab,
    openInAppViewer,
    deliverBlob,
  };
})(typeof window !== "undefined" ? window : globalThis);
