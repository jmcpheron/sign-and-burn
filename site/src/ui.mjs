// Small parts both pages draw with: elements, addresses, the hold button, the console's review.
// Anything from the chain, a wallet or a link is drawn as text (textContent), never as HTML.
import { formatEther } from "viem";
import { blockie, blockieSrc, rgb } from "./blockies.mjs";

let C = null;
/** The chain the page is on, for explorer links and the review's fields. */
export const useChain = (c) => { C = c; };

export const $ = (s) => document.querySelector(s);
export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
export const short = (h, a = 6, b = 4) => (h && h.length > a + b + 3 ? `${h.slice(0, a)}…${h.slice(-b)}` : h || "");
export const eth = (wei) => `${Number(formatEther(wei)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
export const rows = (pairs) => el("dl", { class: "rows" }, ...pairs.filter(Boolean).map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))));

/** Pages can't send frame-ancestors, so a page refuses to run inside another page: a hostile site
 * could frame it and steer a hold. */
export function refuseFrames() {
  if (window.top === window.self) return;
  document.body.textContent = "Sign and Burn doesn't run inside another page. Open https://signandburn.app/ directly.";
  throw new Error("framed");
}

export function addr(a, { link = true } = {}) {
  if (!a) return el("span", { class: "muted" }, "—");
  const kids = [el("img", { src: blockieSrc(a), alt: "" }), el("span", { title: a }, short(a, 8, 6))];
  const url = link && C?.explorer ? `${C.explorer}/address/${a}` : null;
  return url ? el("a", { class: "addr", href: url, target: "_blank", rel: "noopener noreferrer" }, ...kids) : el("span", { class: "addr" }, ...kids);
}
export const txLink = (h) => (C?.explorer ? el("a", { href: `${C.explorer}/tx/${h}`, target: "_blank", rel: "noopener noreferrer", class: "mono" }, short(h, 10, 6)) : el("span", { class: "mono" }, short(h, 10, 6)));

export function drawBlockie(canvas, seed) {
  const { data, color, bg, spot } = blockie(seed.toLowerCase());
  const ctx = canvas.getContext("2d");
  data.forEach((v, i) => { ctx.fillStyle = `rgb(${rgb(v === 0 ? bg : v === 1 ? color : spot).join(",")})`; ctx.fillRect(i % 8, i >> 3, 1, 1); });
  return canvas;
}

/** Hold for `ms` to fire. Pointer or keyboard; letting go early cancels. */
export function holdButton(label, onDone, { red = false, ms = 2000 } = {}) {
  const fill = el("span", { class: "fill" });
  const b = el("button", { class: "hold" + (red ? " red" : ""), type: "button" }, fill, el("span", {}, label));
  let t0 = 0, raf = 0;
  const stop = () => { cancelAnimationFrame(raf); t0 = 0; fill.style.width = "0"; };
  const tick = () => {
    if (!t0) return;
    const p = Math.min(1, (performance.now() - t0) / ms);
    fill.style.width = `${p * 100}%`;
    if (p >= 1) { stop(); onDone(); } else raf = requestAnimationFrame(tick);
  };
  const start = (e) => { if (b.disabled || t0) return; e.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(tick); };
  b.addEventListener("pointerdown", (e) => { b.setPointerCapture?.(e.pointerId); start(e); });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, stop);
  b.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e); });
  b.addEventListener("keyup", stop);
  b.addEventListener("blur", stop);
  b.addEventListener("click", (e) => e.preventDefault());
  return b;
}

export function plain(e) {
  if (e?.name === "NotAllowedError") return "The passkey prompt closed before it finished. Nothing was signed.";
  if (e?.name === "InvalidStateError") return "That passkey is already on this device.";
  if (e?.code === 4001 || /rejected|denied/i.test(e?.message || "")) return "The wallet said no. Nothing was sent.";
  return e?.shortMessage || e?.message || String(e);
}

/** What the console says a Safe transaction does, every field it hashed, and the hash's check code. */
export function reviewParts(r, safe, tx, label) {
  const vc = el("canvas", { width: 8, height: 8, "aria-hidden": "true" });
  drawBlockie(vc, r.safeTxHash);
  return [
    el("div", { class: "review" }, ...r.items.map((it) => el("div", { class: `item ${it.level}` },
      el("div", { class: "t" }, it.title), el("div", { class: "w" }, it.what),
      it.to ? el("div", {}, el("span", { class: "small" }, (it.label || "to") + " "), addr(it.to)) : null,
      it.text ? el("p", { class: "small" }, it.text) : null))),
    el("details", {}, el("summary", { class: "small" }, "Every field the console hashed"), el("table", { class: "fields" }, el("tbody", {},
      ...[["chain", `${C.id} (${C.chain.name})`], ["Safe", safe], ["to", tx.to], ["value", `${tx.value} wei`], ["data", tx.data || "0x"],
        ["operation", tx.operation ? "1 (delegatecall)" : "0 (call)"], ["safeTxGas, baseGas, gasPrice", "0, 0, 0"], ["gasToken, refundReceiver", "none"], ["nonce", tx.nonce]]
        .map(([k, v]) => el("tr", {}, el("td", {}, k), el("td", {}, String(v))))))),
    el("div", { class: "verify" }, vc, el("div", {}, el("div", { class: "small" }, label),
      el("div", { class: "code" }, r.verify), el("div", { class: "mono small" }, r.safeTxHash))),
  ];
}
