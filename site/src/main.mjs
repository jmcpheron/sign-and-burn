// The page: the console's screen and buttons, the passkey, the wallet, and the panels beside them.
// The console (MicroPython, console/) decides; this page asks it, shows what it said, and carries
// its answers to the passkey, the wallet and the chain. Anything from the chain, a wallet or a link
// is drawn as text (textContent), never as HTML.
import { formatEther, isAddress, parseEther, encodeFunctionData, zeroAddress } from "viem";
import * as consoleCore from "./console.mjs";
import * as P from "./passkey.mjs";
import * as ch from "./chain.mjs";
import * as wots from "./wots.mjs";
import { blockie, blockieSrc, rgb } from "./blockies.mjs";

const $ = (s) => document.querySelector(s);
function el(tag, props = {}, ...kids) {
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
const short = (h, a = 6, b = 4) => (h && h.length > a + b + 3 ? `${h.slice(0, a)}…${h.slice(-b)}` : h || "");
const S = { step: "boot", busy: "", error: "", tx: { preset: "send", to: "", amount: "0.0001" }, onchain: {}, last: null };

// ----------------------------------------------------------------------------- framing
// Pages can't send frame-ancestors, so the page refuses to run inside another page: a hostile site
// could frame it and steer a hold.
if (window.top !== window.self) {
  document.body.textContent = "Sign and Burn doesn't run inside another page. Open https://signandburn.app/ directly.";
  throw new Error("framed");
}

// ----------------------------------------------------------------------------- small parts
function addr(a, { link = true } = {}) {
  if (!a) return el("span", { class: "muted" }, "—");
  const kids = [el("img", { src: blockieSrc(a), alt: "" }), el("span", { title: a }, short(a, 8, 6))];
  const url = link && S.C?.explorer ? `${S.C.explorer}/address/${a}` : null;
  return url ? el("a", { class: "addr", href: url, target: "_blank", rel: "noopener noreferrer" }, ...kids) : el("span", { class: "addr" }, ...kids);
}
const txLink = (h) => (S.C?.explorer ? el("a", { href: `${S.C.explorer}/tx/${h}`, target: "_blank", rel: "noopener noreferrer", class: "mono" }, short(h, 10, 6)) : el("span", { class: "mono" }, short(h, 10, 6)));
const eth = (wei) => `${Number(formatEther(wei)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
const rows = (pairs) => el("dl", { class: "rows" }, ...pairs.filter(Boolean).map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))));

function drawBlockie(canvas, seed) {
  const { data, color, bg, spot } = blockie(seed.toLowerCase());
  const ctx = canvas.getContext("2d");
  data.forEach((v, i) => { ctx.fillStyle = `rgb(${rgb(v === 0 ? bg : v === 1 ? color : spot).join(",")})`; ctx.fillRect(i % 8, i >> 3, 1, 1); });
  return canvas;
}

/** Hold for `ms` to fire. Pointer or keyboard; letting go early cancels. */
function holdButton(label, onDone, { red = false, ms = 2000 } = {}) {
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

// ----------------------------------------------------------------------------- the serial log
const log = $("#log");
consoleCore.onLine((dir, line) => {
  const tag = dir === "in" ? "page → console  " : dir === "out" ? "console → page  " : "console says    ";
  const bad = dir === "out" && line.includes('"ok": false');
  log.append(el("div", { class: bad ? "bad" : dir }, tag + line));
  while (log.childElementCount > 200) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
});

// ----------------------------------------------------------------------------- where things are kept
const HOME = "sab.home";
const homes = () => { try { return JSON.parse(localStorage.getItem(HOME)) || {}; } catch { return {}; } };
const homeKey = () => `${S.C.id}:${S.pk.id}`;
function saveHome(h) {
  S.home = h;
  try { const all = homes(); all[homeKey()] = h; localStorage.setItem(HOME, JSON.stringify(all)); } catch {}
}

// ----------------------------------------------------------------------------- boot
async function boot() {
  render();
  try {
    S.info = await consoleCore.boot();
    S.cfg = ch.parseCfg(await (await fetch("console/cfg.py")).text());
    S.C = ch.connect(S.cfg);
  } catch (e) {
    S.error = `The console didn't start: ${e.message || e}`;
    return render();
  }
  $("#mpv").textContent = S.info.micropython;
  $("#stats").textContent = `${S.info.files} files · ${S.info.lines.toLocaleString("en-US")} lines of MicroPython · ` +
    `${Math.round(S.info.heap / 1024)} KB of heap once loaded · fingerprint ${S.info.fingerprint.slice(0, 4)}·${S.info.fingerprint.slice(4, 8)}`;
  $("#fp").textContent = S.info.fingerprint;
  drawBlockie($("#fp-blockie"), "0x" + S.info.fingerprint);
  $("#lamp").className = "lamp on";
  if (!consoleCore.ledgerKept()) S.warn = "This browser won't keep the console's ledger (private browsing?). The guardrail then lasts only while this tab is open.";
  S.pk = P.stored();
  if (S.pk && S.pk.rpId !== location.hostname) S.pk = null;
  await reconnectWallet();
  await settle();
}

/** Work out where the visitor is: passkey, seat, Safe, funds. Then draw. */
async function settle() {
  S.error = "";
  try {
    if (!S.pk) { S.step = P.supported() ? "nokey" : "nowebauthn"; return render(); }
    if (!S.signer) {
      S.signer = consoleCore.ask({ op: "signer", x: S.pk.x, y: S.pk.y }).signer;
      const onChain = (await ch.signerAddress(S.C, S.pk)).toLowerCase();
      if (onChain !== S.signer) throw new Error(`the signer factory names ${onChain} for this passkey, the console ${S.signer}`);
    }
    S.home = homes()[homeKey()] || null;
    if (!S.home || !(await ch.hasCode(S.C, S.home.seat || zeroAddress))) {
      const seats = await ch.seatsOf(S.C, S.signer);
      if (S.home?.firstKey && S.home.seatNumber === undefined) S.home = null;
      if (!S.home?.firstKey && seats.length) {
        const seat = seats[seats.length - 1];
        const st = await ch.readSeat(S.C, seat);
        saveHome({ seat, seatNumber: st.seatNumber, safe: await ch.safeAddress(S.C, seat), found: true });
      }
    }
    await refresh();
  } catch (e) {
    S.error = plain(e);
  }
  pickStep();
  render();
}

async function refresh() {
  const H = S.home;
  if (S.wallet) S.walletBalance = await S.C.pc.getBalance({ address: S.wallet.account }).catch(() => null);
  if (!H?.seat || !(await ch.hasCode(S.C, H.seat))) { S.seat = null; S.safe = H?.safe ? await ch.readSafe(S.C, H.safe) : null; return; }
  [S.seat, S.safe] = await Promise.all([ch.readSeat(S.C, H.seat), ch.readSafe(S.C, H.safe)]);
  consoleCore.ask({ op: "chain", chainId: S.C.id, seat: H.seat, n: S.seat.n });
  for (let k = Math.max(0, S.seat.n - 6); k < S.seat.n; k++) {
    if (!S.onchain[`${H.seat}:${k}`]) S.onchain[`${H.seat}:${k}`] = await ch.approvalOnChain(S.C, H.seat, k).catch(() => null);
  }
}

function pickStep() {
  if (!S.pk) return;
  if (!S.home?.seat) S.step = "firstkey";
  else if (!S.seat || !S.safe?.exists) S.step = "build";
  else if (S.step === "done" || S.step === "working") return;
  else if (S.safe.balance === 0n && !waiting().length) S.step = "fund";
  else S.step = "ready";
}

const ledger = () => consoleCore.ask({ op: "ledger" }).entries || [];
const mine = () => ledger().filter((e) => S.home && e.chainId === S.C.id && e.seat === S.home.seat.toLowerCase());
const waiting = () => mine().filter((e) => e.status !== "landed");

function plain(e) {
  if (e?.name === "NotAllowedError") return "The passkey prompt closed before it finished. Nothing was signed.";
  if (e?.name === "InvalidStateError") return "That passkey is already on this device.";
  if (e?.code === 4001 || /rejected|denied/i.test(e?.message || "")) return "The wallet said no. Nothing was sent.";
  return e?.shortMessage || e?.message || String(e);
}
async function guard(what, f) {
  S.busy = what; S.error = ""; $("#lamp").className = "lamp busy"; render();
  try { await f(); } catch (e) { S.error = plain(e); }
  S.busy = ""; $("#lamp").className = "lamp on"; render();
}

// ----------------------------------------------------------------------------- the steps
async function makePasskey(existing) {
  await guard(existing ? "Asking your passkey twice: two signatures name its public key…" : "Your device is making a passkey for this site…", async () => {
    S.pk = existing ? await P.findExisting() : await P.make();
    S.signer = null;
    await settle();
  });
}

async function firstKey() {
  await guard("One tap: your passkey's PRF makes the seed of key 0. The console keeps only its fingerprint…", async () => {
    const seatNumber = (await ch.seatsOf(S.C, S.signer)).length;
    const k = consoleCore.ask({ op: "keys", chainId: S.C.id, curveSigner: S.signer, seatNumber, n: 0 });
    const t = await P.tap(S.pk, "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join(""), [k.salts[0]]);
    const f = consoleCore.ask({ op: "first", chainId: S.C.id, curveSigner: S.signer, seatNumber, seed: t.seeds[0] });
    if (!f.ok) throw new Error(f.refuse);
    const seat = await ch.seatAddress(S.C, S.signer, seatNumber, f.firstKey);
    saveHome({ seat, seatNumber, firstKey: f.firstKey, safe: await ch.safeAddress(S.C, seat) });
    await refresh();
    pickStep();
  });
}

async function connectWallet() {
  await guard("Looking for a wallet in this browser…", async () => {
    const found = await ch.findWallets();
    if (!found.length) throw new Error("No wallet in this browser. Any wallet that can switch to Base Sepolia works; it only pays gas.");
    S.wallet = await ch.useWallet(S.C, found[0].provider);
    S.wallet.name = found[0].info.name;
    try { localStorage.setItem("sab.wallet", found[0].info.uuid); } catch {}
    if (!S.tx.to) S.tx.to = S.wallet.account;
    await refresh();
  });
}

/** The wallet this page used last time, if it is still connected and on this chain: no prompt. */
async function reconnectWallet() {
  let uuid = null;
  try { uuid = localStorage.getItem("sab.wallet"); } catch {}
  if (!uuid) return;
  const w = (await ch.findWallets()).find((x) => x.info.uuid === uuid);
  const got = w && await ch.useWallet(S.C, w.provider, { quiet: true }).catch(() => null);
  if (got) { S.wallet = { ...got, name: w.info.name }; if (!S.tx.to) S.tx.to = got.account; }
}

async function build() {
  await guard("Your wallet sends one transaction: signer, seat and Safe…", async () => {
    const calls = await ch.buildCalls(S.C, { pk: S.pk, signer: S.signer, seatNumber: S.home.seatNumber, firstKey: S.home.firstKey, seat: S.home.seat });
    const hash = await ch.send(S.C, S.wallet, calls);
    S.busy = "Waiting for the block…"; render();
    await ch.receipt(S.C, hash);
    S.home.built = hash; saveHome(S.home);
    await refresh();
    pickStep();
  });
}

async function fund() {
  await guard("Your wallet sends 0.001 test ETH to the Safe…", async () => {
    const hash = await S.wallet.w.sendTransaction({ account: S.wallet.account, to: S.home.safe, value: parseEther("0.001"), chain: S.C.chain });
    await ch.receipt(S.C, hash);
    await refresh();
    pickStep();
  });
}

/** The transaction on the screen, from the form: what the console is asked about. */
function currentTx() {
  const t = S.tx, to = isAddress(t.to) ? t.to : "0x000000000000000000000000000000000000dEaD";
  const nonce = String(S.safe?.nonce ?? 0);
  let value = "0";
  try { value = parseEther(t.amount || "0").toString(); } catch {}
  if (t.preset === "owner") return { to: S.home.safe, value: "0", operation: 0, nonce,
    data: encodeFunctionData({ abi: [{ type: "function", name: "addOwnerWithThreshold", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }], args: [to, 1n] }) };
  if (t.preset === "unknown") return { to: S.cfg.multicall, value: "0", data: "0x12345678", operation: 0, nonce };
  if (t.preset === "delegate") return { to, value: "0", data: "0x", operation: 1, nonce };
  return { to, value, data: "0x", operation: 0, nonce };
}

/** One press, as the console rules it (KICKOFF.md, "The guardrail"):
 * read n from the chain → the console builds c and the salts (or hands back an approval already
 * signed for key n) → one tap → the console signs with key n and records it → the seat is asked,
 * by simulation → the wallet sends → the block. */
async function press(tx) {
  S.step = "working";
  await guard("Reading the seat and the Safe from the chain…", async () => {
    await refresh();
    const req = { chainId: S.C.id, seat: { address: S.seat.address, curveSigner: S.seat.curveSigner, seatNumber: S.seat.seatNumber, n: S.seat.n, current: S.seat.current },
      safe: S.home.safe, tx };
    const begin = consoleCore.ask({ op: "begin", ...req });
    if (!begin.ok) throw new Error(begin.refuse);
    let a = begin.resend, signed = null;
    if (!a) {
      S.busy = `One tap: your passkey signs c, and its PRF makes the seeds of keys ${S.seat.n} and ${S.seat.n + 1}…`; render();
      const t = await P.tap(S.pk, begin.c, begin.salts);
      S.busy = `The console signs with key ${S.seat.n}, and names key ${S.seat.n + 1}…`; render();
      signed = consoleCore.ask({ op: "sign", ...req, passkey: t.passkey, seeds: t.seeds });
      t.seeds.length = 0;
      if (!signed.ok) throw new Error(signed.refuse);
      a = signed.approval;
    }
    S.busy = "Asking the seat, without sending anything…"; render();
    const why = await ch.trySeat(S.C, a.seat, [a.safe, a.safeTxHash, a.nextKey, a.oneTime, a.curveSig], S.wallet.account);
    if (why) throw new Error(`The seat would refuse this approval (${why}). The console keeps it, and will only ever send this one for key ${S.seat.n}.`);
    S.busy = "Your wallet sends it. It pays gas, and approves nothing…"; render();
    const nonceBefore = S.safe.nonce;
    const hash = await ch.send(S.C, S.wallet, ch.approveCalls(a, tx));
    consoleCore.ask({ op: "sent", chainId: S.C.id, seat: a.seat, n: S.seat.n, txHash: hash });
    S.busy = "Waiting for the block…"; render();
    const r = await ch.receipt(S.C, hash);
    const n = S.seat.n;
    await refresh();
    S.last = { n, a, hash, ran: S.safe.nonce > nonceBefore, ok: r.status === "success", m: signed?.m, summary: begin.review.summary };
    S.step = "done";
  });
  if (S.error) S.step = "ready";
  render();
}

// ----------------------------------------------------------------------------- drawing
const STEPS = [["nokey", "Passkey"], ["firstkey", "First key"], ["build", "Shielded Safe"], ["fund", "Fund it"], ["ready", "Press"]];
function stepsBar() {
  const at = { nowebauthn: 0, nokey: 0, firstkey: 1, build: 2, fund: 3, ready: 4, working: 4, done: 4 }[S.step] ?? -1;
  return el("ol", { class: "steps-bar", "aria-label": "Steps" }, ...STEPS.map(([, name], i) => el("li", { class: i < at ? "done" : i === at ? "now" : "" }, `${i + 1} · ${name}`)));
}

function render() {
  const s = $("#screen");
  s.className = "screen";
  s.replaceChildren(...screen(s));
  drawSide();
  drawAttacks();
}

function screen(s) {
  const out = [];
  if (S.step !== "boot") out.push(stepsBar());
  if (S.warn) out.push(el("p", { class: "note" }, S.warn));
  const status = S.busy ? el("p", { class: "status" }, el("span", { class: "spin" }), S.busy) : null;
  const err = S.error ? el("p", { class: "note error", role: "alert" }, S.error) : null;
  const disabled = !!S.busy;
  switch (S.step) {
    case "boot":
      out.push(el("h3", {}, "Starting the console"), el("p", { class: "muted" }, "MicroPython 1.26 for WebAssembly is loading the console's files: the same files a board would run."));
      break;
    case "nowebauthn":
      out.push(el("h3", {}, "This browser has no passkeys"), el("p", {}, "Sign and Burn needs WebAuthn with the PRF extension: a current Safari, Chrome or Edge, with Touch ID, Windows Hello, a phone or a security key."));
      break;
    case "nokey":
      out.push(el("h3", {}, "Make a passkey"),
        el("p", {}, "Your passkey is the console's only key. It signs with its curve key, and its PRF extension makes the seeds of your one-time keys. Neither secret ever leaves it."),
        el("p", { class: "small" }, "It is made for this site only. Touch ID, Windows Hello, a phone or a security key. It needs PRF: most current ones have it."),
        el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: () => makePasskey(false) }, "Make a passkey"),
          el("button", { type: "button", disabled, onclick: () => makePasskey(true) }, "I already have one")));
      break;
    case "firstkey":
      out.push(el("h3", {}, "Your first one-time key"),
        el("p", {}, "One more tap. Your passkey's PRF turns a label into a 32-byte seed, the console turns the seed into key 0, and keeps only its fingerprint: the one thing that goes on chain."),
        rows([["Passkey signer", addr(S.signer)], ["Its address", el("span", { class: "small" }, "worked out by the console, and checked against Safe's signer factory")]]),
        el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: firstKey }, "Tap to make key 0")));
      break;
    case "build": {
      const H = S.home;
      out.push(el("h3", {}, "Build your shielded Safe"),
        el("p", {}, "One wallet transaction makes three things. The wallet pays the gas and owns none of them."),
        rows([["Passkey signer", addr(S.signer)], [`Seat #${H.seatNumber}`, addr(H.seat)], ["Key 0", el("span", { class: "mono" }, short(H.firstKey || "", 10, 8))],
          ["Safe, 1 of 1", addr(H.safe)]]),
        el("p", { class: "small" }, "The seat holds only key 0's fingerprint. The Safe's one owner is the seat. If nobody has deployed the SeatFactory on this chain yet, the same transaction deploys it, at the address it has on every chain."),
        el("div", { class: "actions" }, S.wallet ? el("button", { class: "go", type: "button", disabled, onclick: build }, "Build it: one transaction")
          : el("button", { class: "go", type: "button", disabled, onclick: connectWallet }, "Connect a wallet")));
      break;
    }
    case "fund":
      out.push(el("h3", {}, "Fund it"),
        el("p", {}, "Your Safe is empty. Send it a little test ETH, from your wallet or a Base Sepolia faucet."),
        rows([["Safe", addr(S.home.safe)], ["Balance", eth(S.safe.balance)]]),
        el("div", { class: "actions" }, S.wallet ? el("button", { class: "go", type: "button", disabled, onclick: fund }, "Send 0.001 test ETH from my wallet")
          : el("button", { class: "go", type: "button", disabled, onclick: connectWallet }, "Connect a wallet"),
        el("a", { href: "https://docs.base.org/base-chain/tools/network-faucets", target: "_blank", rel: "noopener noreferrer" }, "Base Sepolia faucets")));
      break;
    case "ready":
    case "working":
      out.push(...pressScreen(s, disabled));
      break;
    case "done":
      out.push(...doneScreen());
      break;
  }
  if (status) out.push(status);
  if (err) out.push(err);
  return out;
}

function pressScreen(s, disabled) {
  const out = [el("h3", {}, "Press the button")];
  const w = waiting()[0];
  const form = el("div", { class: "form" },
    el("label", {}, "Send to", el("input", { class: "mono", value: S.tx.to, placeholder: "0x…", spellcheck: "false", oninput: (e) => { S.tx.to = e.target.value.trim(); redraw(); } })),
    el("label", {}, "Amount (ETH)", el("input", { value: S.tx.amount, inputmode: "decimal", oninput: (e) => { S.tx.amount = e.target.value.trim(); redraw(); } })),
    el("label", {}, "Or show the console", (() => {
      const sel = el("select", { onchange: (e) => { S.tx.preset = e.target.value; redraw(); } },
        ...[["send", "Send test ETH"], ["owner", "Something red: add an owner"], ["unknown", "A call it can't read"], ["delegate", "A delegatecall"]]
          .map(([v, t]) => el("option", { value: v, selected: S.tx.preset === v }, t)));
      return sel;
    })()));
  if (!w) out.push(form);
  const tx = w ? w.tx : currentTx();
  const r = consoleCore.ask({ op: "review", chainId: S.C.id, safe: S.home.safe, tx });
  if (!r.ok) { out.push(el("p", { class: "refuse" }, r.refuse)); return out; }
  if (r.level === "red") s.className = "screen red";
  if (w) out.push(el("p", { class: "note" }, `Key ${w.n} already signed this approval. One signature per key, ever: the console will only send this same one again. No tap needed.`));
  out.push(el("div", { class: "review" }, ...r.items.map((it) => el("div", { class: `item ${it.level}` },
    el("div", { class: "t" }, it.title), el("div", { class: "w" }, it.what),
    it.to ? el("div", {}, el("span", { class: "small" }, (it.label || "to") + " "), addr(it.to)) : null,
    it.text ? el("p", { class: "small" }, it.text) : null))));
  out.push(el("details", {}, el("summary", { class: "small" }, "Every field the console hashed"), el("table", { class: "fields" }, el("tbody", {},
    ...[["chain", `${S.C.id} (${S.C.chain.name})`], ["Safe", S.home.safe], ["to", tx.to], ["value", `${tx.value} wei`], ["data", tx.data || "0x"],
      ["operation", tx.operation ? "1 (delegatecall)" : "0 (call)"], ["safeTxGas, baseGas, gasPrice", "0, 0, 0"], ["gasToken, refundReceiver", "none"], ["nonce", tx.nonce]]
      .map(([k, v]) => el("tr", {}, el("td", {}, k), el("td", {}, String(v))))))));
  const vc = el("canvas", { width: 8, height: 8, "aria-hidden": "true" });
  drawBlockie(vc, r.safeTxHash);
  out.push(el("div", { class: "verify" }, vc, el("div", {}, el("div", { class: "small" }, "Safe transaction hash, worked out by the console"),
    el("div", { class: "code" }, r.verify), el("div", { class: "mono small" }, r.safeTxHash))));
  if (r.refuse) { out.push(el("p", { class: "refuse" }, "The console refuses: " + r.refuse)); return out; }
  if (!S.wallet) { out.push(el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: connectWallet }, "Connect a wallet to send"))); return out; }
  let ack = r.level !== "red";
  const hold = holdButton(w ? `Hold to send approval ${w.n} again` : `Hold to approve with key ${S.seat.n}`, () => press(tx), { red: r.level === "red" });
  hold.disabled = disabled || !ack;
  out.push(el("div", { class: "actions" }, hold,
    r.level === "red" ? el("label", { class: "small" }, el("input", { type: "checkbox", onchange: (e) => { ack = e.target.checked; hold.disabled = disabled || !ack; } }), "I read the red page") : null,
    el("button", { class: "reject", type: "button", disabled, onclick: () => { S.tx = { preset: "send", to: S.wallet?.account || "", amount: "0.0001" }; S.error = ""; redraw(); } }, "Reject")));
  out.push(el("p", { class: "small" }, `Holding asks your passkey once. The console signs with key ${S.seat.n}, burns it and names key ${S.seat.n + 1}; your wallet sends it all in one transaction.`));
  return out;
}

let redrawing = 0;
function redraw() {
  cancelAnimationFrame(redrawing);
  redrawing = requestAnimationFrame(() => {
    const active = document.activeElement, pos = active?.selectionStart;
    const which = active && [...document.querySelectorAll("#screen input, #screen select")].indexOf(active);
    render();
    if (which >= 0) { const again = document.querySelectorAll("#screen input, #screen select")[which]; again?.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
  });
}

function doneScreen() {
  const L = S.last;
  const out = [el("h3", {}, `Key ${L.n}: signed, sent, burned`),
    el("p", {}, `${L.summary}. ${L.ran ? "The Safe ran it." : "The approval landed, but the Safe couldn't run it yet (has it the ETH?). Its vote is kept: anyone can run it later."}`),
    rows([["Transaction", txLink(L.hash)], ["Key now", el("span", { class: "mono" }, `${L.n + 1}: ${short(S.seat?.current || "", 10, 8)}`)]])];
  if (L.m) {
    out.push(el("p", { class: "small" }, `What key ${L.n} revealed: one value on each of its 67 chains. Below each, the secret steps nobody saw; above, steps anyone can now compute. Nobody can step down a chain, and key ${L.n} will never sign again.`));
    out.push(chainsCanvas(wots.digits(wots.bytes(L.m))));
    out.push(el("div", { class: "legend" }, el("span", {}, el("i", { class: "lg-secret" }), "never revealed"), el("span", {}, el("i", { class: "lg-shown" }), "revealed"), el("span", {}, el("i", { class: "lg-public" }), "anyone can compute")));
  }
  out.push(el("div", { class: "actions" }, el("button", { class: "go", type: "button", onclick: () => { S.step = "ready"; render(); } }, "Another one")));
  return out;
}

function chainsCanvas(d, low = null) {
  const cw = 9, chh = 7, c = el("canvas", { class: "chains", width: 67 * cw, height: 16 * chh, role: "img", "aria-label": "67 chains, and the position each one revealed" });
  const css = getComputedStyle(document.documentElement), col = (v) => css.getPropertyValue(v).trim();
  const ctx = c.getContext("2d");
  d.forEach((at, j) => {
    for (let s = 0; s <= 15; s++) {
      ctx.fillStyle = s < at ? col("--line") : s === at ? col("--flame-2") : col("--flame");
      ctx.globalAlpha = s > at ? 0.35 : 1;
      ctx.fillRect(j * cw + 1, (15 - s) * chh + 1, cw - 2, chh - 2);
    }
    if (low && low[j] !== undefined) { ctx.globalAlpha = 1; ctx.strokeStyle = col("--bad"); ctx.strokeRect(j * cw + 0.5, (15 - low[j]) * chh + 0.5, cw - 1, chh - 1); }
  });
  return c;
}

function drawSide() {
  const safeBox = $("#safe"), ladder = $("#ladder"), hist = $("#history");
  if (!S.pk) return;
  const H = S.home;
  safeBox.replaceChildren(rows([
    H?.safe && ["Safe", addr(H.safe)],
    S.safe?.exists && ["Balance", eth(S.safe.balance)],
    S.safe?.exists && ["Owners", `${S.safe.threshold} of ${S.safe.owners.length}: ${S.safe.owners.length === 1 && S.seat && S.safe.owners[0].toLowerCase() === S.seat.address.toLowerCase() ? "your seat" : S.safe.owners.map((o) => short(o)).join(", ")}`],
    S.safe?.exists && ["Safe nonce", String(S.safe.nonce)],
    H?.seat && [`Seat #${H.seatNumber ?? "?"}`, addr(H.seat)],
    ["Passkey signer", addr(S.signer)],
    ["Your passkey", `made ${S.pk.made}${S.pk.attachment ? ` · ${S.pk.attachment === "platform" ? "this device" : "another device"}` : ""}`],
    ["Wallet", S.wallet ? el("span", {}, addr(S.wallet.account), el("span", { class: "small" }, S.walletBalance != null ? ` ${eth(S.walletBalance)} · pays gas only` : " pays gas only"))
      : el("button", { class: "link", type: "button", onclick: connectWallet }, "Connect a wallet")],
  ]));
  if (!S.seat) return;
  const n = S.seat.n, items = [];
  for (let k = Math.max(0, n - 6); k < n; k++) {
    const o = S.onchain[`${H.seat}:${k}`];
    items.push(el("li", {}, el("span", { class: "k" }, `key ${k}`), el("span", { class: "burned" }, "burned"),
      el("span", { class: "x" }, o?.txHash ? txLink(o.txHash) : "signature public")));
  }
  items.push(el("li", {}, el("span", { class: "k" }, `key ${n}`), el("span", { class: "current" }, "current"), el("span", { class: "x", title: S.seat.current }, `fingerprint ${short(S.seat.current, 10, 6)}`)));
  items.push(el("li", {}, el("span", { class: "k" }, `key ${n + 1}…`), el("span", { class: "unseen" }, "unseen"), el("span", { class: "x" }, "not even a fingerprint yet")));
  ladder.replaceChildren(el("ul", { class: "ladder" }, ...items), el("div", { class: "sees" },
    el("div", {}, el("b", {}, "What an attacker sees"), `Your passkey's curve public key, in its signer. Every burned key's signature. Key ${n}'s fingerprint. Your wallet's key, which holds only gas money.`),
    el("div", {}, el("b", {}, "What they would need"), `A signature by key ${n} for a message naming their own next key. That takes key ${n}'s seed, which only your passkey can make. A broken curve gives them curve signatures, and nothing else.`)));
  const es = mine().slice().reverse();
  if (es.length) hist.replaceChildren(el("ul", { class: "history" }, ...es.map((e) => el("li", {},
    el("div", { class: "h" }, el("span", {}, `#${e.n} · ${e.summary}`), el("span", { class: `badge ${e.status}` }, e.status)),
    el("div", { class: "s" }, `verify ${e.verify} · `, e.txHash ? txLink(e.txHash) : "not sent yet")))));
}

// ----------------------------------------------------------------------------- the attack room
const WHY = {
  BadNextKey: "The next key it names is the one the seat already holds. A replay can only name a key that is already current.",
  BadOneTimeSignature: "The one-time signature doesn't lead to the key the seat holds now. The key that made it is spent, and the next one has never signed.",
  BadCurveSignature: "The passkey's curve signature doesn't check out for this approval.",
};
const ATTACKS = [
  ["Replay the last approval", "Send it again, exactly as it went on chain.", (a) => a],
  ["Name your own next key", "Keep the revealed signatures, and put your own key in as the seat's next one.", (a) => [a[0], a[1], rand32(), a[3], a[4]]],
  ["Point it at another Safe", "Use the approval for a Safe of your choosing.", (a) => ["0x" + "51".repeat(20), a[1], rand32(), a[3], a[4]]],
  ["Approve another transaction", "Reuse the spent key's signature for a different Safe transaction.", (a) => [a[0], rand32(), rand32(), a[3], a[4]]],
  ["A curve signature alone", "As if P-256 were broken: the passkey's signature, and no one-time signature at all.", (a) => [a[0], a[1], rand32(), Array(67).fill("0x" + "00".repeat(32)), a[4]]],
];
const rand32 = () => "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

function drawAttacks() {
  const box = $("#attack-list");
  const last = S.seat && S.seat.n > 0 ? S.onchain[`${S.home.seat}:${S.seat.n - 1}`] : null;
  if (!last?.args) { drawDanger(); return; }
  if (box.dataset.for === `${S.home.seat}:${S.seat.n}`) return drawDanger();
  box.dataset.for = `${S.home.seat}:${S.seat.n}`;
  box.replaceChildren(el("p", { class: "small" }, `They use approval ${last.k}, which anyone can read from `, txLink(last.txHash), `. The seat is at key ${S.seat.n}.`),
    el("div", { class: "attacks" }, ...ATTACKS.map(([name, what, make]) => {
      const out = el("div", { class: "result" }, "");
      const go = el("button", { type: "button", onclick: async () => {
        go.disabled = true; out.textContent = "asking the seat…"; out.className = "result";
        const why = await ch.trySeat(S.C, S.home.seat, make(last.args), S.wallet?.account);
        out.className = "result " + (why ? "refused" : "accepted");
        out.textContent = why ? `Refused: ${why}. ${WHY[why] || ""}` : "ACCEPTED. The seat would take this: that is a bug, please report it.";
        go.disabled = false;
      } }, "Try it");
      return el("div", { class: "attack" }, el("b", {}, name), el("p", {}, what), go, out);
    })));
  drawDanger();
}

function drawDanger() {
  const box = $("#danger");
  if (box.childElementCount) return;
  const out = el("div", {});
  box.append(el("h3", {}, "The danger case: one key, several signatures"),
    el("p", { class: "muted" }, "The seat makes sure a spent key is dead. It can't make sure a key signs only once. Here a throwaway key, made in this page and never on chain, signs several messages, as a careless signer might. Then a forger with no secret at all signs one more."),
    el("div", { class: "actions" }, el("button", { type: "button", onclick: () => setTimeout(() => danger(out), 30) }, "Run it with a throwaway key")), out);
}

function danger(out) {
  const enc = new TextEncoder(), seed = crypto.getRandomValues(new Uint8Array(32));
  const pub = wots.pubSeed(84532, "0x" + "de".repeat(20), 0), n = 0n, key = wots.keyFingerprint(pub, n, seed);
  // A careless signer keeps signing with one key. Each signature shows lower positions on some chains.
  // Stop once a forger's odds per try are about 1 in 50,000: a second's work here.
  const ms = [], sigs = [];
  let low;
  do {
    ms.push(wots.h(enc.encode(`an honest message ${ms.length + 1} `), seed.slice(0, 4)));
    sigs.push(wots.sign(pub, n, seed, ms[ms.length - 1]));
    low = wots.lowest(sigs, ms);
  } while (ms.length < 12 && (ms.length < 3 || wots.chance(low) < 2e-5));
  const t0 = performance.now();
  const got = wots.forge(pub, n, low, (t) => wots.h(enc.encode(`forged: pay the attacker, next key ${t}`)), 3e6);
  const took = Math.round(performance.now() - t0);
  const ok = got && wots.hex(wots.recover(pub, n, got.m, got.sig)) === wots.hex(key);
  const two = wots.chance(wots.lowest(sigs.slice(0, 2), ms.slice(0, 2)));
  out.replaceChildren(
    el("p", { class: "small" }, `The throwaway key signed ${ms.length} messages. Red outlines: the lowest position any of them revealed on each chain. Anything at or above it, anyone can compute.`),
    chainsCanvas(got ? wots.digits(got.m) : wots.digits(ms[0]), low.map((l) => l.at)),
    el("p", { class: ok ? "note error" : "note" }, ok
      ? `Forged. After ${got.tries.toLocaleString("en-US")} tries (${took} ms here), the forger found a message whose every digit sits at or above those red marks, and signed it with values the ${ms.length} signatures had already shown. It checks out against the key's fingerprint. From the first two signatures alone it would take about ${Math.round(1 / two).toExponential(0).replace("e+", " × 10^")} tries: a GPU's work, not a browser's.`
      : "No forgery in three million tries this time. Run it again."),
    el("p", { class: "small" }, "That's why the console signs each key once, ever, and sends the same approval again rather than make a second one."));
}

boot();
