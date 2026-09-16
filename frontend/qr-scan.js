/** Premises QR scanning for Safari / iPad / Capacitor (BarcodeDetector + jsQR fallback). */
(function (root) {
  const JSQR_SRC = "./vendor/jsqr.min.js?v=1.4.0";
  let jsqrPromise = null;

  function setStatus(onStatus, message) {
    if (typeof onStatus === "function" && message) onStatus(message);
  }

  function loadJsQR() {
    if (typeof root.jsQR === "function") return Promise.resolve(root.jsQR);
    if (jsqrPromise) return jsqrPromise;
    jsqrPromise = new Promise((resolve, reject) => {
      const documentRef = root.document;
      if (!documentRef?.createElement) {
        reject(new Error("QR decoder is not available in this browser."));
        return;
      }
      const existing = documentRef.querySelector('script[data-sshr-jsqr="1"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(root.jsQR));
        existing.addEventListener("error", () => reject(new Error("Could not load the QR decoder.")));
        return;
      }
      const script = documentRef.createElement("script");
      script.src = JSQR_SRC;
      script.async = true;
      script.dataset.sshrJsqr = "1";
      script.onload = () => {
        if (typeof root.jsQR === "function") resolve(root.jsQR);
        else reject(new Error("QR decoder failed to start."));
      };
      script.onerror = () => reject(new Error("Could not load the QR decoder."));
      documentRef.head.appendChild(script);
    });
    return jsqrPromise;
  }

  function prepareVideo(video) {
    if (!video) return;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
  }

  async function openCamera(video) {
    if (!video) throw new Error("Camera preview is missing.");
    if (!root.navigator?.mediaDevices?.getUserMedia) {
      throw new Error("Camera is not available in this browser.");
    }
    prepareVideo(video);
    const attempts = [
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: { facingMode: "environment" }, audio: false },
      { video: true, audio: false },
    ];
    let lastError = null;
    for (const constraints of attempts) {
      try {
        const stream = await root.navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        await video.play();
        return stream;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Could not open the camera.");
  }

  function stopStream(stream, video) {
    stream?.getTracks?.().forEach((track) => track.stop());
    if (video) video.srcObject = null;
  }

  async function detectWithBarcodeDetector(video) {
    if (!("BarcodeDetector" in root)) return null;
    const detector = new root.BarcodeDetector({ formats: ["qr_code"] });
    const codes = await detector.detect(video);
    return codes?.[0]?.rawValue || null;
  }

  async function detectWithJsQR(video) {
    const decode = await loadJsQR();
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const canvas = root.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const result = decode(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
    return result?.data || null;
  }

  async function detectFromVideo(video) {
    try {
      const native = await detectWithBarcodeDetector(video);
      if (native) return native;
    } catch {
      /* keep scanning with jsQR */
    }
    try {
      return await detectWithJsQR(video);
    } catch {
      return null;
    }
  }

  function decodeImageData(imageData) {
    if (!imageData || typeof root.jsQR !== "function") return Promise.resolve(null);
    const result = root.jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
    return Promise.resolve(result?.data || null);
  }

  async function decodeImageFile(file) {
    if (!file) return null;
    const decode = await loadJsQR();
    const bitmapUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new root.Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not read that photo."));
        img.src = bitmapUrl;
      });
      const canvas = root.document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx || !canvas.width || !canvas.height) return null;
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = decode(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
      return result?.data || null;
    } finally {
      URL.revokeObjectURL(bitmapUrl);
    }
  }

  function start(options) {
    const opts = options || {};
    const video = opts.video;
    const onCode = opts.onCode;
    const onStatus = opts.onStatus;
    const state = { stopped: false, stream: null, frame: null };

    const stop = () => {
      state.stopped = true;
      if (state.frame && root.cancelAnimationFrame) root.cancelAnimationFrame(state.frame);
      state.frame = null;
      stopStream(state.stream, video);
      state.stream = null;
    };

    const tick = async () => {
      if (state.stopped) return;
      if (video?.srcObject && video.videoWidth) {
        try {
          const raw = await detectFromVideo(video);
          if (raw && !state.stopped) {
            setStatus(onStatus, "Code detected — verifying…");
            await onCode?.(raw);
            stop();
            return;
          }
        } catch {
          /* keep scanning */
        }
      }
      state.frame = root.requestAnimationFrame(tick);
    };

    void (async () => {
      if (!("BarcodeDetector" in root)) {
        setStatus(onStatus, "Starting camera… Safari will decode the QR from the live preview.");
        try {
          await loadJsQR();
        } catch (error) {
          setStatus(
            onStatus,
            error.message || "Live decode is unavailable. Take a photo of the QR or paste the link below.",
          );
        }
      }
      try {
        state.stream = await openCamera(video);
        if (state.stopped) {
          stopStream(state.stream, video);
          return;
        }
        setStatus(onStatus, "Point the camera at the premises QR.");
        state.frame = root.requestAnimationFrame(tick);
      } catch (error) {
        setStatus(
          onStatus,
          `${error.message || "Could not open the camera."} You can take a photo of the QR or paste the link below.`,
        );
      }
    })();

    return { stop, state };
  }

  root.ShiftSwiftQrScan = {
    JSQR_SRC,
    loadJsQR,
    start,
    decodeImageFile,
    decodeImageData,
    detectFromVideo,
    openCamera,
  };
})(typeof window !== "undefined" ? window : globalThis);
