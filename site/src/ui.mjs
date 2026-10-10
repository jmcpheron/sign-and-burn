// Small parts both pages draw with: elements, addresses, the hold button, the console's review.
// Anything from the chain, a wallet or a link is drawn as text (textContent), never as HTML.
import { formatEther } from "viem";
import { blockie, blockieSrc, rgb } from "./blockies.mjs";
import * as qr from "./qr.mjs";
import { nameOf } from "./names.mjs";

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

/** An address: its blockie, your name for it if you gave one (src/names.mjs), and the address itself,
 * always: a name is a label you chose, never instead of the address. */
export function addr(a, { link = true, copy = false } = {}) {
  if (!a) return el("span", { class: "muted" }, "—");
  const url = link && C?.explorer ? `${C.explorer}/address/${a}` : null;
  const node = url ? el("a", { class: "addr", href: url, target: "_blank", rel: "noopener noreferrer" }, ...addrParts(a)) : el("span", { class: "addr" }, ...addrParts(a));
  return copy ? el("span", { class: "addr-copy" }, node, copyButton(a)) : node;
}
const addrParts = (a) => {
  const name = nameOf(a);
  return [el("img", { src: blockieSrc(a), alt: "" }), name ? el("b", { class: "name", title: "Your name for it, kept in this browser" }, name) : null,
    el("span", { title: a }, short(a, 8, 6))];
};
/** An address as a label, not a link: for menus. */
export const label = (a) => el("span", { class: "addr" }, ...addrParts(a));

// ----------------------------------------------------------------------------- icons
// Drawn as SVG elements (no markup strings), stroked in the text's own colour.
const SVG = "http://www.w3.org/2000/svg";
function icon(paths) {
  const s = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", fill: "none", stroke: "currentColor",
    "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" })) s.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(SVG, "path"); p.setAttribute("d", d); s.append(p); }
  return s;
}
export const copyIcon = () => icon(["M6 5.5h6.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z", "M11 3.5V3a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1H4"]);
const checkIcon = () => icon(["M3 8.5l3.2 3.2L13 4.8"]);
export const caretIcon = () => icon(["M4 6l4 4 4-4"]);

/** One press copies `text`; the icon turns to a check for a moment. */
export function copyButton(text, what = "address") {
  const b = el("button", { type: "button", class: "icon copy", title: `Copy the ${what}`, "aria-label": `Copy the ${what}`, onclick: async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.replaceChildren(checkIcon()); b.classList.add("done"); b.title = "Copied";
      setTimeout(() => { b.replaceChildren(copyIcon()); b.classList.remove("done"); b.title = `Copy the ${what}`; }, 1500);
    } catch {
      b.title = "This browser wouldn't copy. Select the address and copy it yourself.";
    }
  } }, copyIcon());
  return b;
}

// ----------------------------------------------------------------------------- pickers
// A small drop-down: a caret that opens a menu of choices, each an address with its blockie and your
// name for it. Whether it is open outlives a redraw; a click anywhere else closes it.
const pickerOpen = new Set();
export function picker(id, title, items, onPick, { footer = null } = {}) {
  const d = el("details", { class: "picker", "data-picker": id, open: pickerOpen.has(id), ontoggle: (e) => { if (e.target.open) pickerOpen.add(id); else pickerOpen.delete(id); } },
    el("summary", { title, "aria-label": title }, caretIcon()),
    el("ul", { class: "menu", role: "list" }, ...items.map((it) => el("li", {},
      el("button", { type: "button", class: it.on ? "on" : "", onclick: () => { pickerOpen.delete(id); d.open = false; onPick(it.address); } },
        label(it.address), it.note ? el("span", { class: "small" }, it.note) : null))),
      items.length ? null : el("li", { class: "small muted" }, "Nothing here yet."),
      footer ? el("li", {}, footer) : null));
  return d;
}
try {
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("details.picker")) return;
    for (const d of document.querySelectorAll("details.picker[open]")) { d.open = false; pickerOpen.delete(d.dataset.picker); }
  });
} catch {}
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

// ----------------------------------------------------------------------------- QR codes
// A link shown as a QR code, for another device's camera, behind a button. Which ones are open, and
// the codes already worked out, outlive a redraw of the screen.
const qrOpen = new Set(), qrMade = new Map();

/** "Show QR code" for `what`: a text (byte mode), QR segments (src/qr.mjs), or null for one too long
 * for a QR code. Black on white whatever the theme, with the four-module quiet zone around it. */
export function qrToggle(what) {
  const segs = typeof what === "string" ? [{ mode: "byte", text: what }] : what;
  const text = segs ? segs.map((g) => g.text).join("") : "";
  const key = text || "(too long)", open = qrOpen.has(key);
  const box = el("div", { class: "qr" });
  if (open && !segs) box.append(el("p", { class: "small" }, "Too long for a QR code. Copy the link instead."));
  else if (open) {
    let q = qrMade.get(text);
    if (!q) { q = qr.encode(segs); if (qrMade.size > 8) qrMade.clear(); qrMade.set(text, q); }
    if (!q) box.append(el("p", { class: "small" }, "Too long for a QR code. Copy the link instead."));
    else {
      const scale = q.size > 100 ? 4 : 8, n = (q.size + 8) * scale;
      const c = el("canvas", { width: n, height: n, class: q.size > 100 ? "qr-code dense" : "qr-code", role: "img", "aria-label": "A QR code of the link", "data-text": text });
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, n, n); ctx.fillStyle = "#000";
      q.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale); }));
      box.append(c, el("p", { class: "small" }, q.size > 100
        ? `A dense code (version ${q.version}, ${q.size} × ${q.size}). Show it large, on a computer's screen say, and hold the camera steady.`
        : "Point the other device's camera at it."));
    }
  }
  const btn = el("button", { type: "button", class: "link", "aria-expanded": String(open), onclick: () => {
    if (qrOpen.has(key)) qrOpen.delete(key); else qrOpen.add(key);
    wrap.replaceWith(qrToggle(what));
  } }, open ? "Hide QR code" : "Show QR code");
  const wrap = el("div", { class: "qr-wrap" }, btn, box);
  return wrap;
}
