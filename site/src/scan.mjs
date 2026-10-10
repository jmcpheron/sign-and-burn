// "Scan a code": the camera, read by jsQR (jsqr 1.4.0, Apache-2.0, bundled into app.js; NOTICE). iPhones
// give pages no QR reader of their own (Safari ships BarcodeDetector disabled), so the page brings one.
// The camera's frames stay in this page: nothing is recorded or sent anywhere. Each text read is handed
// to onText, once per new text; what it means is the caller's to decide, and the caller treats it as
// untrusted, as it does a pasted link.
//   const stop = await startScan(box, onText)    box: an element to put the video in. stop() ends it.
import jsQR from "jsqr";
import { el } from "./ui.mjs";

export const canScan = () => !!navigator.mediaDevices?.getUserMedia;

export async function startScan(box, onText) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } });
  const video = el("video", { playsinline: true, muted: true, autoplay: true, class: "scan-video", "aria-label": "The camera" });
  video.srcObject = stream;
  box.replaceChildren(video);
  await video.play().catch(() => {});
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stopped = false, raf = 0, last = "", t0 = 0;
  const tick = (t) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (t - t0 < 120 || video.readyState < 2) return;   // about eight looks a second is plenty
    t0 = t;
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(video, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    if (code?.data && code.data !== last) { last = code.data; onText(code.data); }
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    for (const tr of stream.getTracks()) tr.stop();
    video.srcObject = null;
    box.replaceChildren();
  };
}
