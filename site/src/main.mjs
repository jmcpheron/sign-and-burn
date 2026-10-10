// The page: the console's screen and buttons, the passkey, the wallet, and the panels beside them.
// The console (MicroPython, console/) decides; this page asks it, shows what it said, and carries
// its answers to the passkey, the wallet and the chain. Anything from the chain, a wallet or a link
// is drawn as text (textContent), never as HTML.
import { isAddress, parseEther, encodeFunctionData, zeroAddress } from "viem";
import * as consoleCore from "./console.mjs";
import * as P from "./passkey.mjs";
import * as ch from "./chain.mjs";
import * as pay from "./pay.mjs";
import * as wots from "./wots.mjs";
import { approve } from "./approve.mjs";
import { $, addr, drawBlockie, el, eth, holdButton, plain, qrToggle, refuseFrames, reviewParts, rows, short, txLink, useChain } from "./ui.mjs";

const S = { step: "boot", busy: "", error: "", tx: { preset: "send", to: "", amount: "0.0001" }, onchain: {}, last: null };

refuseFrames();

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
    useChain(S.C);
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
  $("#pay-request").addEventListener("submit", reviewRequest);
  $("#review-request").disabled = false;
  await reconnectWallet();
  window.addEventListener("hashchange", () => { if (pay.fromLink(location.hash, S.C)) openPayLink(); });
  // A link pasted into "Pay for a request" while the page was starting is open already: don't open it
  // again, just draw it with the wallet found since.
  if (S.step === "pay") return render();
  if (await openPayLink()) return;
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
      if (S.home?.firstKey && S.home.seatNumber === undefined) S.home = null;
      if (!S.home?.firstKey) {
        const used = (await recentSeats()).filter((s) => s.n > 0).pop();
        if (used) saveHome({ seat: used.address, seatNumber: used.seatNumber, safe: await ch.safeAddress(S.C, used.address), found: true });
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

// Anyone may add seats to seatsOf for any passkey (the baseline review's H-1), so a seat's place in
// the list proves nothing. A seat with n > 0 landed this passkey's signature over its own address:
// it is this passkey's. One with n = 0 is this passkey's only if its first key is, and only a tap
// tells. The page reads the newest few, so a long list costs a few reads, not one per seat.
const RECENT = 8;
const recentSeats = async () => ch.seatCounts(S.C, (await ch.seatsOf(S.C, S.signer)).slice(-RECENT));

async function firstKey() {
  await guard("One tap: your passkey's PRF makes the seed of key 0. The console keeps only its fingerprint…", async () => {
    const seats = await ch.seatsOf(S.C, S.signer);
    const seatNumber = seats.length;
    // The newest unused seat may be this passkey's own, built from another device: the same tap
    // answers for its seat number too, and its first key says whether it is.
    const unused = (await ch.seatCounts(S.C, seats.slice(-RECENT))).filter((s) => s.n === 0 && s.seatNumber !== seatNumber).pop();
    const nums = unused ? [seatNumber, unused.seatNumber] : [seatNumber];
    const salts = nums.map((num) => consoleCore.ask({ op: "keys", chainId: S.C.id, curveSigner: S.signer, seatNumber: num, n: 0 }).salts[0]);
    const t = await P.tap(S.pk, "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join(""), salts);
    const firsts = nums.map((num, i) => consoleCore.ask({ op: "first", chainId: S.C.id, curveSigner: S.signer, seatNumber: num, seed: t.seeds[i] }));
    for (const f of firsts) if (!f.ok) throw new Error(f.refuse);
    const listed = new Set(seats.map((a) => a.toLowerCase()));
    const found = unused && (await ch.seatAddress(S.C, S.signer, unused.seatNumber, firsts[1].firstKey));
    if (found && listed.has(found.toLowerCase())) {
      saveHome({ seat: found, seatNumber: unused.seatNumber, firstKey: firsts[1].firstKey, safe: await ch.safeAddress(S.C, found), found: true });
    } else {
      const seat = await ch.seatAddress(S.C, S.signer, seatNumber, firsts[0].firstKey);
      saveHome({ seat, seatNumber, firstKey: firsts[0].firstKey, safe: await ch.safeAddress(S.C, seat) });
    }
    await refresh();
    pickStep();
  });
}

// ----------------------------------------------------------------------------- the wallet
// Any wallet in this browser that speaks EIP-6963 or EIP-1193 can pay the gas. A hardware wallet
// (a Trezor, a Ledger) does it through a browser wallet that drives it, such as Rabby, MetaMask or
// Frame. A wallet is remembered by its rdns, which stays the same from visit to visit; its uuid
// doesn't.
const HARDWARE = "A Trezor or a Ledger pays the gas through a browser wallet that drives it, such as Rabby, MetaMask or Frame: connect it there, then pick that wallet here. The device will show a call to Multicall3 (0xcA11…CA11) on Base Sepolia. What that call approves is on this console's screen.";
const walletId = (info) => info.rdns || info.uuid;

/** Find the wallets in this browser; with more than one (or `choose`), let the visitor pick. */
async function connectWallet(choose = false) {
  await guard("Looking for wallets in this browser…", async () => {
    const found = await ch.findWallets();
    S.walletsHere = found.length;
    if (!found.length && S.step === "pay") throw new Error("No wallet found in this browser. Open this payment link in a browser with a wallet on Base Sepolia and test ETH for gas. You do not need the sender's passkey. Nothing was sent.");
    if (!found.length) throw new Error("No wallet found in this browser. You can still continue: copy the payment link and send it to someone with a wallet on Base Sepolia. They review the transaction here and pay the gas. Your passkey stays here.");
    if (found.length > 1 || (choose && S.wallet)) { S.choosing = found; return; }
    await useChosen(found[0]);
  });
}

async function chooseWallet(w) {
  S.choosing = null;
  await guard(`Asking ${w.info.name} for an account on ${S.C.chain.name}…`, () => useChosen(w));
}

async function useChosen(w, got = null) {
  got ||= await ch.useWallet(S.C, w.provider);
  S.wallet = { ...got, name: w.info.name, provider: w.provider };
  try { localStorage.setItem("sab.wallet", walletId(w.info)); } catch {}
  if (!S.tx.to) S.tx.to = S.wallet.account;
  follow(w.provider);
  await refresh();
}

/** Keep up with the wallet: another account (say, the Trezor's, picked in Rabby after connecting),
 * or another chain, which leaves the page without a wallet until it is connected again. */
const followed = new WeakSet();
function follow(provider) {
  if (followed.has(provider) || !provider.on) return;
  followed.add(provider);
  provider.on("accountsChanged", async (accounts) => {
    if (S.wallet?.provider !== provider) return;
    if (!accounts?.length) { S.wallet = null; return render(); }
    if (S.tx.to === S.wallet.account) S.tx.to = accounts[0];
    S.wallet = { ...S.wallet, account: accounts[0] };
    await refresh().catch(() => {});
    // Switched again since: that switch draws the screen. A late redraw from this one could land
    // while the visitor types, and take the field from under them.
    if (S.wallet?.account !== accounts[0]) return;
    render();
  });
  provider.on("chainChanged", (id) => {
    if (S.wallet?.provider === provider && Number(id) !== S.C.id) { S.wallet = null; S.error = `The wallet moved to another network. Connect it again for ${S.C.chain.name}.`; render(); }
  });
}

/** The wallet this page used last time, if it is still connected and on this chain: no prompt. */
async function reconnectWallet() {
  const found = await ch.findWallets();
  S.walletsHere = found.length;
  let id = null;
  try { id = localStorage.getItem("sab.wallet"); } catch {}
  if (!id) return;
  const w = found.find((x) => walletId(x.info) === id || x.info.uuid === id);
  const got = w && await ch.useWallet(S.C, w.provider, { quiet: true }).catch(() => null);
  if (got) await useChosen(w, got);
}

function chooser() {
  if (!S.choosing) return null;
  const icon = (info) => (/^data:image\//.test(info.icon || "") ? el("img", { src: info.icon, alt: "", width: 20, height: 20 }) : null);
  return el("div", { class: "chooser", role: "group", "aria-label": "Wallets in this browser" },
    el("p", {}, "Which wallet pays the gas?"),
    el("div", { class: "actions" }, ...S.choosing.map((w) => el("button", { type: "button", onclick: () => chooseWallet(w) }, icon(w.info), w.info.name || "A wallet")),
      el("button", { class: "link", type: "button", onclick: () => { S.choosing = null; render(); } }, "Cancel")),
    el("p", { class: "small" }, HARDWARE));
}

// With no wallet in this browser (a phone, say), the hardware note is noise: connectWallet says it
// again if the visitor asks for one anyway.
const connectButton = (disabled, label = "Connect a wallet", go = true) =>
  el("div", {}, el("div", { class: "actions" }, el("button", { class: go ? "go" : "", type: "button", disabled, onclick: () => connectWallet() }, label)),
    S.walletsHere ? el("p", { class: "small" }, HARDWARE) : null);

/** The build, paid by the wallet in this browser: the same request a link carries (src/pay.mjs),
 * rebuilt the same way, and checked against the addresses this page worked out at key 0. */
async function build() {
  await guard("Your wallet sends one transaction: signer, seat and Safe…", async () => {
    const what = await pay.resolve(S.C, pay.request(S.C, S.pk, S.home));
    if (what.signer.toLowerCase() !== S.signer.toLowerCase() || what.seat.toLowerCase() !== S.home.seat.toLowerCase() || what.safe.toLowerCase() !== S.home.safe.toLowerCase())
      throw new Error("The build would make other addresses than the ones worked out at key 0. Nothing was sent.");
    if (!what.built) {
      await needGas();
      const hash = await ch.send(S.C, S.wallet, what.calls);
      S.busy = "Waiting for the block…"; render();
      await ch.receipt(S.C, hash);
      S.home.built = hash; saveHome(S.home);
    }
    await refresh();
    pickStep();
  });
}

/** A wallet with no ETH can't pay gas: say so before anything is sent, not after its RPC error. */
async function needGas(atLeast = 0n) {
  S.walletBalance = await S.C.pc.getBalance({ address: S.wallet.account }).catch(() => null);
  if (S.walletBalance !== null && S.walletBalance <= atLeast)
    throw new Error(`${S.wallet.name}'s account ${short(S.wallet.account)} has ${eth(S.walletBalance)} on ${S.C.chain.name}: not enough${atLeast ? " to send 0.001 test ETH and" : ""} to pay the gas. ` +
      "Get some from a Base Sepolia faucet, or pay from another device with a link. Nothing was sent.");
}

const sendTestEth = async (to) => {
  await needGas(parseEther("0.001"));
  const hash = await S.wallet.w.sendTransaction({ account: S.wallet.account, to, value: parseEther("0.001"), chain: S.C.chain });
  await ch.receipt(S.C, hash);
  return hash;
};

async function fund() {
  await guard("Your wallet sends 0.001 test ETH to the Safe…", async () => {
    await sendTestEth(S.home.safe);
    await refresh();
    pickStep();
  });
}

// ----------------------------------------------------------------------------- another device pays
// The device with the passkey needn't have a wallet. It shares a link that holds the build request
// (src/pay.mjs); a wallet on any other device opens it and pays the gas. Meanwhile this page looks at
// the chain every few seconds and moves on when the Safe is built, and again when it has ETH.
const buildLink = () => pay.toLink(pay.request(S.C, S.pk, S.home), location.origin + location.pathname);

async function copyLink(link) {
  S.error = ""; S.shared = "";
  try {
    await navigator.clipboard.writeText(link);
    S.shared = "Link copied. Send it to whoever will pay.";
  } catch {
    S.error = "This browser wouldn't copy the link. Select the link shown here and copy it yourself.";
  }
  watch();
  render();
}

const linkField = (link) => el("input", { class: "mono share-link", readonly: true, value: link,
  "aria-label": "The link", onfocus: (e) => e.target.select() });

async function reviewRequest(e) {
  e.preventDefault();
  if (!S.C || S.busy) return;
  const status = $("#pay-request-status");
  try {
    const url = new URL($("#pay-request-link").value.trim());
    if (!["https:", "http:"].includes(url.protocol)) throw new Error();
    const got = pay.fromLink(url.hash, S.C);
    if (!got) throw new Error();
    if (got.refuse) { status.textContent = got.refuse; return; }
    status.textContent = "";
    // Read only the request. Stay on this page, even if the pasted link names another host.
    history.replaceState(null, "", location.pathname + location.search + url.hash);
    await guard("Reviewing the payment request…", openPayLink);
    $("#screen").scrollIntoView({ block: "start" });
  } catch {
    status.textContent = "Paste a complete Sign and Burn payment link. Nothing was sent.";
  }
}

async function checkBuilt() {
  await guard("Looking for your Safe on chain…", async () => {
    await refresh();
    pickStep();
    if (S.step === "build") S.shared = "Not on chain yet.";
  });
}

async function checkLanded() {
  const w = waiting()[0];
  await guard("Looking for the approval on chain…", async () => {
    if (w && (await seatN()) > w.n) return landedElsewhere(w);
    S.shared = "Not on chain yet.";
  });
}

const seatN = async () => Number(await S.C.pc.readContract({ address: S.home.seat, abi: ch.SEAT_ABI, functionName: "n" }));

/** Approval w.n landed, sent by a wallet somewhere else: record where, and say so. */
async function landedElsewhere(w) {
  const landed = await ch.approvalOnChain(S.C, S.home.seat, w.n).catch(() => null);
  if (landed?.txHash) consoleCore.ask({ op: "sent", chainId: S.C.id, seat: S.home.seat, n: w.n, txHash: landed.txHash });
  await refresh();
  const safe = w.safe.toLowerCase() === S.home.safe.toLowerCase() ? S.safe : await ch.readSafe(S.C, w.safe);
  S.last = { n: w.n, a: w.approval, hash: landed?.txHash, elsewhere: true, ran: safe.nonce > Number(w.tx.nonce), m: w.m, summary: w.summary };
  S.step = "done"; S.shared = "";
  render();
}

let watching = 0;
function watch() {
  if (watching) return;
  watching = setInterval(async () => {
    const w = S.step === "ready" && S.home?.seat ? S.waitFor : null;   // as the press screen last drew it
    if (!S.home || !(["build", "fund"].includes(S.step) || w)) { clearInterval(watching); watching = 0; return; }
    if (S.busy) return;
    if (w) {
      const n = await seatN().catch(() => w.n);
      if (n > w.n && !S.busy && S.step === "ready") await landedElsewhere(w);
      return;
    }
    const was = S.step;
    try { await refresh(); } catch { return; }
    if (S.busy || S.step !== was) return;
    pickStep();
    if (S.step !== was) { S.shared = ""; render(); }
  }, S.C.id === 31337 ? 1000 : 6000);
}

// ----------------------------------------------------------------------------- paying for another device
// This page opened such a link. It rebuilds the calls from the public values in it, shows what they
// make, and the wallet here pays the gas. It keeps nothing: no passkey, no home, no ledger entry.
async function openPayLink() {
  const got = pay.fromLink(location.hash, S.C);
  if (!got) return false;
  S.step = "pay"; S.pay = got; S.error = ""; S.choosing = null;
  render();
  if (got.req?.tag === pay.APPROVAL_TAG) {
    try {
      const what = await resolveApproval(got.req);
      if (S.pay === got) got.what = what;
    } catch (e) {
      S.error = plain(e);
    }
  } else if (got.req) {
    try {
      const what = await pay.resolve(S.C, got.req);
      // The console works out the passkey's signer address too, as it does for its own passkey.
      const signer = consoleCore.ask({ op: "signer", x: got.req.x, y: got.req.y }).signer;
      if (what.signer.toLowerCase() !== signer) throw new Error(`the signer factory names ${what.signer} for this passkey, the console ${signer}`);
      if (what.built) got.balance = await S.C.pc.getBalance({ address: what.safe });
      if (S.pay === got) got.what = what;
    } catch (e) {
      S.error = plain(e);
    }
  }
  render();
  return true;
}

async function payBuild() {
  const P = S.pay;
  await guard("Your wallet sends one transaction: signer, seat and Safe…", async () => {
    const what = await pay.resolve(S.C, P.req);
    if (what.seat !== P.what.seat || what.safe !== P.what.safe) throw new Error("The addresses changed since this page worked them out. Nothing was sent.");
    if (!what.built) {
      await needGas();
      P.hash = await ch.send(S.C, S.wallet, what.calls);
      S.busy = "Waiting for the block…"; render();
      await ch.receipt(S.C, P.hash);
    }
    P.what = await pay.resolve(S.C, P.req);
    if (!P.what.built) throw new Error("The transaction went through, but the Safe isn't on chain. Nothing was built.");
    P.balance = await S.C.pc.getBalance({ address: P.what.safe });
  });
}

async function payFund() {
  const P = S.pay;
  await guard("Your wallet sends 0.001 test ETH to the Safe…", async () => {
    P.funded = await sendTestEth(P.what.safe);
    P.balance = await S.C.pc.getBalance({ address: P.what.safe });
  });
}

/** An approval from a link, checked here: this page's console works out the Safe transaction hash and
 * what it does from the fields (it takes no hash from the link), and the seat is asked, by simulation,
 * whether it would take the approval. Or it landed already. */
async function resolveApproval(req) {
  const [seat, safe] = await Promise.all([ch.readSeat(S.C, req.seat), ch.readSafe(S.C, req.safe)]);
  const r = consoleCore.ask({ op: "review", chainId: S.C.id, safe: req.safe, tx: req.tx });
  if (!r.ok) throw new Error(r.refuse);
  const a = { seat: req.seat, safe: req.safe, safeTxHash: r.safeTxHash, nextKey: req.nextKey, oneTime: req.oneTime, curveSig: req.curveSig };
  const landed = seat.n > req.n ? await ch.approvalOnChain(S.C, req.seat, req.n) : null;
  const why = landed || r.refuse ? null : await ch.trySeat(S.C, req.seat, [a.safe, a.safeTxHash, a.nextKey, a.oneTime, a.curveSig], S.wallet?.account);
  return { seat, safe, r, a, landed, why, owner: !!safe.exists && safe.owners.some((o) => o.toLowerCase() === req.seat) };
}

async function payApproval() {
  const P = S.pay;
  await guard("Asking the seat, without sending anything…", async () => {
    const W = await resolveApproval(P.req);
    P.what = W;
    if (W.landed || W.r.refuse) return;
    if (W.why) throw new Error(`The seat would refuse this approval (${W.why}). Nothing was sent.`);
    await needGas();
    S.busy = "Your wallet sends it. It pays gas, and approves nothing…"; render();
    const hash = await ch.send(S.C, S.wallet, ch.approveCalls(W.a, P.req.tx));
    S.busy = "Waiting for the block…"; render();
    const rc = await ch.receipt(S.C, hash);
    // As after a press here: the seat says whether the approval landed, and in which transaction, as
    // of the receipt's block (chain.readAt).
    const landed = await ch.approvalOnChain(S.C, P.req.seat, P.req.n, rc.blockNumber);
    if (!landed) throw new Error(`The transaction went through (${short(hash, 10, 6)}), but approval ${P.req.n} didn't land: the seat is still at key ${P.req.n}.`);
    P.hash = landed.txHash || hash;
    P.ran = (await ch.nonceAt(S.C, P.req.safe, rc.blockNumber)) > W.safe.nonce;
    P.what = { ...W, landed };
  });
}

function leavePay() {
  history.replaceState(null, "", location.pathname + location.search);
  S.pay = null; S.step = "boot"; S.error = "";
  settle();
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

/** A wallet here that can pay the gas. One with no ETH can't: its press goes out as a link instead.
 * (A balance not read yet counts as able; the send says so if it isn't.) */
const canPay = () => !!S.wallet && S.walletBalance !== 0n;

/** One press (src/approve.mjs): read n from the chain, then the console, one tap, the seat, the
 * wallet, the block. With no wallet here that can pay, the approval waits in the ledger, and the
 * screen offers it as a link for a wallet elsewhere to send. */
async function press(tx) {
  S.step = "working";
  await guard("Reading the seat and the Safe from the chain…", async () => {
    await refresh();
    const nonceBefore = S.safe.nonce;
    let got;
    try {
      got = await approve({ C: S.C, pk: S.pk, seat: S.seat, safe: S.safe, tx, wallet: canPay() ? S.wallet : null, say: (t) => { S.busy = t; render(); } });
    } catch (e) {
      await refresh().catch(() => {});
      throw e;
    }
    if (!got.hash) { S.shared = ""; return; }
    await refresh();
    const ran = (await ch.nonceAt(S.C, S.safe.address, got.block)) > nonceBefore;
    S.last = { n: got.n, a: got.a, hash: got.hash, theirs: got.theirs, ran, m: got.signed?.m, summary: got.review.summary };
    S.step = "done";
  });
  if (S.error || S.step === "working") S.step = "ready";
  render();
}

// ----------------------------------------------------------------------------- drawing
const STEPS = [["nokey", "Passkey"], ["firstkey", "First key"], ["build", "Shielded Safe"], ["fund", "Fund it"], ["ready", "Press"]];
function stepsBar() {
  const at = { nowebauthn: 0, nokey: 0, firstkey: 1, build: 2, fund: 3, ready: 4, working: 4, done: 4 }[S.step] ?? -1;
  return el("ol", { class: "steps-bar", "aria-label": "Steps" }, ...STEPS.map(([, name], i) => el("li", { class: i < at ? "done" : i === at ? "now" : "" }, `${i + 1} · ${name}`)));
}

function render() {
  $("#review-request").disabled = !S.C || !!S.busy;
  const s = $("#screen");
  s.className = "screen";
  s.replaceChildren(...screen(s));
  drawSide();
  drawAttacks();
}

function screen(s) {
  const out = [];
  if (S.step !== "boot" && S.step !== "pay") out.push(stepsBar());
  if (S.choosing) out.push(chooser());
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
        el("p", {}, "Your passkey is the console's only key. It signs with its curve key, and its PRF extension makes the seeds of your one-time keys. Its private key and its PRF secret never leave it; the seeds pass through this page for one request."),
        el("p", { class: "small" }, "It is made for this site only. Touch ID, Windows Hello, a phone or a security key. It needs PRF: most current ones have it."),
        el("p", { class: "small" }, "No wallet on this device? You don't need one here. Building your Safe costs one transaction's gas, and a wallet on another device can pay it: this page will give you a link to open there."),
        el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: () => makePasskey(false) }, "Make a passkey"),
          el("button", { type: "button", disabled, onclick: () => makePasskey(true) }, "I already have one")));
      break;
    case "firstkey":
      out.push(el("h3", {}, "Your first one-time key"),
        el("p", {}, "This tap prepares your first key. It sends no transaction and costs no gas. Your passkey's PRF turns a label into a 32-byte seed, the console turns the seed into key 0, and keeps only its fingerprint: the one thing that goes on chain."),
        rows([["Passkey signer", addr(S.signer)], ["Its address", el("span", { class: "small" }, "worked out by the console, and checked against Safe's signer factory")]]),
        el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: firstKey }, "Tap to make key 0")));
      break;
    case "build": {
      const H = S.home;
      if (!S.wallet) watch();
      out.push(el("h3", {}, "Build your shielded Safe"),
        el("p", {}, "Your passkey and first key are ready. Your Safe still needs to be built. This page has prepared a transaction to deploy your passkey signer, seat and Safe. Connect a wallet to pay the gas, or give the payment link to someone else."),
        rows([["Passkey signer", addr(S.signer)], [`Seat #${H.seatNumber}`, addr(H.seat)], ["Key 0", el("span", { class: "mono" }, short(H.firstKey || "", 10, 8))],
          ["Safe, 1 of 1", addr(H.safe)]]),
        el("p", { class: "small" }, "The seat holds only key 0's fingerprint. The Safe's one owner is the seat. If nobody has deployed the SeatFactory on this chain yet, the same transaction deploys it, at the address it has on every chain."));
      // Build with a wallet here, or hand off the prepared link to whoever pays.
      if (canPay()) out.push(el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: build }, "Build it: one transaction")), shareBox(false, disabled));
      else if (S.wallet) out.push(el("p", { class: "note" }, `${S.wallet.name}'s account ${short(S.wallet.account)} has no ${S.C.chain.name} ETH for gas. Pay from another device, or fund that account and come back.`), shareBox(true, disabled));
      else if (S.walletsHere) out.push(connectButton(disabled), shareBox(false, disabled));
      else out.push(connectButton(disabled, "Connect a wallet", false), shareBox(true, disabled));
      break;
    }
    case "fund":
      // Funding comes after the build, never before: the steps follow the chain (pickStep). ETH sent
      // to the Safe's address early isn't lost, since the address is fixed; the page just moves on.
      if (!canPay()) watch();
      out.push(el("h3", {}, "Fund it"),
        el("p", {}, canPay() ? "Your Safe is built, and empty. Send it a little test ETH, from your wallet or a Base Sepolia faucet."
          : "Your Safe is built, and empty. It needs a little test ETH before its first press: from another device's wallet, or a faucet. This page moves on once it arrives."),
        rows([["Safe", addr(S.home.safe)], ["Balance", eth(S.safe.balance)]]),
        canPay() ? el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: fund }, "Send 0.001 test ETH from my wallet"), faucets()) : null,
        S.wallet && !canPay() ? el("p", { class: "note" }, `${S.wallet.name}'s account ${short(S.wallet.account)} has no ${S.C.chain.name} ETH: it can't fund the Safe or pay gas.`) : null,
        canPay() ? null : fundShareBox(disabled),
        S.wallet || canPay() ? null : el("div", { class: "actions" }, el("button", { class: "link", type: "button", disabled, onclick: () => connectWallet() }, "I have a wallet in this browser")));
      break;
    case "pay":
      out.push(...payScreen(s, disabled));
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

const faucets = () => el("a", { href: "https://docs.base.org/base-chain/tools/network-faucets", target: "_blank", rel: "noopener noreferrer" }, "Base Sepolia faucets");

/** Fund the Safe from elsewhere: the build link again (its page sees the Safe built and offers to fund
 * it), or the Safe's address, for a faucet or any wallet. */
function fundShareBox(disabled) {
  return el("div", { class: "share" },
    el("h4", {}, "Fund it from another device"),
    el("ol", { class: "small" },
      el("li", {}, `Copy the link to a device with a wallet on Base Sepolia: the one that paid for the build, or any other. Open it there; it sees the Safe is built and offers to send it 0.001 test ETH.`),
      el("li", {}, "Or copy the Safe's address into a faucet, or any wallet's send screen."),
      el("li", {}, "This page moves on once the ETH arrives.")),
    linkField(buildLink()),
    el("div", { class: "actions" },
      el("button", { class: "go", type: "button", disabled, onclick: () => copyLink(buildLink()) }, "Copy link"),
      el("button", { type: "button", disabled, onclick: copySafe }, "Copy the Safe's address"), faucets()),
    qrToggle(buildLink()),
    S.shared ? el("p", { class: "small", role: "status" }, `${S.shared} This page looks at the chain every few seconds.`) : null);
}

async function copySafe() {
  try { await navigator.clipboard.writeText(S.home.safe); S.shared = `Copied ${short(S.home.safe)}.`; }
  catch { S.error = `This browser wouldn't copy. The Safe's address: ${S.home.safe}`; }
  render();
}

/** The link, and how to use it. `first`: there is no wallet in this browser, so it leads. */
function shareBox(first, disabled) {
  const link = buildLink();
  return el("div", { class: "share" },
    el("h4", {}, first ? "No wallet here? Pay from another device" : "Or pay from another device"),
    el("ol", { class: "small" },
      el("li", {}, "Copy this payment link and send it to whoever will pay. They need a wallet on Base Sepolia with test ETH for gas."),
      el("li", {}, "They open the link, or paste it into “Pay for a request” on this site. They review what will be built, connect a wallet and press Pay. They pay the gas and own none of it. They do not need your passkey."),
      el("li", {}, "Come back to this page. It moves on by itself once the Safe is on chain.")),
    linkField(link),
    el("div", { class: "actions" },
      el("button", { class: first ? "go" : "", type: "button", disabled, onclick: () => copyLink(buildLink()) }, "Copy link"),
      S.shared ? el("button", { type: "button", disabled, onclick: checkBuilt }, "Check again") : null),
    qrToggle(link),
    S.shared ? el("p", { class: "small", role: "status" }, `${S.shared} This page looks at the chain every few seconds.`) : null,
    el("details", {}, el("summary", { class: "small" }, "What the link holds"),
      el("p", { class: "small" }, "Three values, all of which go on chain in the build anyway:"),
      el("ul", { class: "small" },
        el("li", {}, el("b", {}, "Your passkey's curve public key"), " (P-256). Its signer contract holds it, so Safe can check the passkey's curve signature. That half is public from the start."),
        el("li", {}, el("b", {}, "The seat number.")),
        el("li", {}, el("b", {}, "Key 0's fingerprint"), ": a hash of your first one-time key, not the key. The seat, the Safe's owner, holds only this. Key 0 itself stays secret until its one approval reveals it, and by then it is spent.")),
      el("p", { class: "small" }, "No seeds, no addresses, no calls. The page that opens it works out the signer, the seat and the Safe from these itself, and shows them before it pays. " +
        "A wrong link builds a seat nobody can sign for; this page would never see it.")));
}

/** This page opened another device's link (src/pay.mjs): pay the gas for its build, or send its
 * approval. */
function payScreen(s, disabled) {
  const P = S.pay;
  if (P.refuse) return [el("h3", {}, "Pay the gas"), el("p", { class: "refuse" }, P.refuse),
    el("div", { class: "actions" }, el("button", { class: "link", type: "button", disabled, onclick: leavePay }, "Go to the page"))];
  return P.req.tag === pay.APPROVAL_TAG ? payApprovalScreen(s, disabled) : payBuildScreen(disabled);
}

function payApprovalScreen(s, disabled) {
  const P = S.pay, W = P.what, n = P.req.n;
  const out = [el("h3", {}, `Send approval ${n} for a shielded Safe`)];
  const leave = (label, go = false) => el("button", { class: go ? "go" : "link", type: "button", disabled, onclick: leavePay }, label);
  out.push(el("p", {}, `A link from another device: its passkey and console signed this approval there, with one-time key ${n}. ` +
    "A wallet here sends it. It pays the gas and approves nothing: anyone may send an approval, and it can do only what was signed."));
  if (!W) { out.push(S.error ? el("div", { class: "actions" }, leave("Go to the page")) : el("p", { class: "muted" }, "Checking the approval against the chain…")); return out; }
  out.push(rows([["Safe", addr(P.req.safe)], ["Seat", addr(P.req.seat)], ["Key", `${n}: the seat is at key ${W.seat.n}`]]));
  if (W.r.level === "red") s.className = "screen red";
  out.push(...reviewParts(W.r, P.req.safe, P.req.tx, "Safe transaction hash, worked out here. The device that signed shows the same code."));
  if (W.landed) {
    out.push(el("p", { class: "note" }, P.hash ? `Sent. Approval ${n} landed, and key ${n} is burned. ${P.ran ? "The Safe ran the transaction." : "The Safe couldn't run it yet (has it the ETH?); its vote is kept, and anyone can run it later."}`
        : `Approval ${n} has landed already. There's nothing to pay for.`),
      W.landed.txHash ? rows([["Transaction", txLink(W.landed.txHash)]]) : null,
      el("p", {}, "Go back to the device that signed it: its page sees the approval and moves on."),
      el("div", { class: "actions" }, leave("Done", true)));
    return out;
  }
  if (W.r.refuse) { out.push(el("p", { class: "refuse" }, "This page's console refuses: " + W.r.refuse), el("div", { class: "actions" }, leave("Go to the page"))); return out; }
  if (!W.owner) { out.push(el("p", { class: "refuse" }, "The seat isn't an owner of this Safe. Nothing to send."), el("div", { class: "actions" }, leave("Go to the page"))); return out; }
  if (W.why) {
    out.push(el("p", { class: "refuse" }, `The seat would refuse this approval (${W.why}). ` + (W.seat.n < n ? `It is at key ${W.seat.n}: an earlier approval hasn't landed yet.` : "The link isn't the approval the console signed.")),
      el("div", { class: "actions" }, leave("Go to the page")));
    return out;
  }
  if (Number(P.req.tx.nonce) !== W.safe.nonce) out.push(el("p", { class: "note" }, `The Safe is at nonce ${W.safe.nonce}, and this transaction is for nonce ${P.req.tx.nonce}. The approval would land, but the Safe couldn't run it now.`));
  out.push(el("p", { class: "small" }, "The seat accepts it: asked just now, by simulation. Your wallet will show a call to Multicall3 that approves and runs this, and sends no ETH of its own."));
  if (S.wallet) out.push(el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: payApproval }, "Send it: one transaction"), leave("Cancel")));
  else out.push(connectButton(disabled), el("div", { class: "actions" }, leave("Cancel")));
  return out;
}

/** Pay the gas for another device's build. */
function payBuildScreen(disabled) {
  const P = S.pay, W = P.what;
  const out = [el("h3", {}, "Pay the gas for a shielded Safe")];
  const leave = (label) => el("button", { class: W?.built ? "go" : "link", type: "button", disabled, onclick: leavePay }, label);
  out.push(el("p", {}, "A link from another device: it made a passkey and key 0 there, and asks a wallet here to pay for the build. Your wallet sends one transaction, sends no ETH, and owns none of what it makes."));
  if (!W) { out.push(S.error ? el("div", { class: "actions" }, leave("Go to the page")) : el("p", { class: "muted" }, "Working out what the link builds, from the chain…")); return out; }
  out.push(rows([["Passkey signer", addr(W.signer)], [`Seat #${P.req.seatNumber}`, addr(W.seat)], ["Key 0", el("span", { class: "mono" }, short(P.req.firstKey, 10, 8))], ["Safe, 1 of 1", addr(W.safe)]]));
  if (W.built) {
    out.push(el("p", { class: "note" }, P.hash ? "Built. The Safe's one owner is the seat, and only the passkey on the other device can sign for it." : "This Safe is built already. There's nothing to pay for."),
      P.hash ? rows([["Transaction", txLink(P.hash)]]) : null,
      P.funded ? rows([["Funded", txLink(P.funded)]]) : null,
      el("p", {}, "Go back to the device that made the link: its page sees the Safe and moves on."));
    const empty = P.balance === 0n && !P.funded;
    if (empty) out.push(el("p", { class: "small" }, `The Safe is empty. It needs a little test ETH before its first press: ${S.wallet ? "this wallet can send it" : "a wallet here can send it"}.`));
    if (empty && !S.wallet) out.push(connectButton(disabled), el("div", { class: "actions" }, leave("Done")));
    else out.push(el("div", { class: "actions" }, empty ? el("button", { class: "go", type: "button", disabled, onclick: payFund }, "Send it 0.001 test ETH") : null, leave("Done")));
    return out;
  }
  out.push(el("p", { class: "small" }, "Worked out here, from the public values in the link and the chain: the link names no addresses and no calls. " +
    "This page keeps nothing. Pay only for a link you expect: a wrong one builds a seat nobody can sign for, and costs you the gas."));
  if (S.wallet) out.push(el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: payBuild }, "Pay: one transaction"), leave("Cancel")));
  else out.push(connectButton(disabled), el("div", { class: "actions" }, leave("Cancel")));
  return out;
}

function pressScreen(s, disabled) {
  const out = [el("h3", {}, "Press the button")];
  const w = S.waitFor = waiting()[0] || null;
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
  // Key n may have signed for another Safe the seat is in, on the wallet page: it is bound to that one.
  const safe = w ? w.safe : S.home.safe, other = safe.toLowerCase() !== S.home.safe.toLowerCase();
  const r = consoleCore.ask({ op: "review", chainId: S.C.id, safe, tx });
  if (!r.ok) { out.push(el("p", { class: "refuse" }, r.refuse)); return out; }
  if (r.level === "red") s.className = "screen red";
  if (w) out.push(el("p", { class: "note" }, `Key ${w.n} already signed this approval. One signature per key, ever: the console will only send this same one again. No tap needed.`));
  out.push(...reviewParts(r, safe, tx, "Safe transaction hash, worked out by the console"));
  if (r.refuse) { out.push(el("p", { class: "refuse" }, "The console refuses: " + r.refuse)); return out; }
  if (other) {
    watch();
    out.push(el("p", { class: "note" }, `This approval is for another Safe your seat is in (${short(safe)}), not yours. `,
      el("a", { href: "wallet.html" }, "Send it from the wallet page"), `, or as a link. Until it lands, key ${w.n} sends nothing else.`), approvalShareBox(w, !canPay(), disabled));
    return out;
  }
  // Approval n is signed and waiting. With no wallet here it goes out as a link (src/pay.mjs), the same
  // approval every time; with one, the link is offered beside "send it again".
  if (S.wallet && !canPay()) out.push(el("p", { class: "note" }, `${S.wallet.name}'s account ${short(S.wallet.account)} has no ${S.C.chain.name} ETH for gas. ` +
    (w ? "Send this approval from another device, or fund that account and come back." : "Holding still signs here; then the approval goes out as a link for a wallet elsewhere. Or fund that account first.")));
  if (w && !canPay()) {
    watch();
    out.push(approvalShareBox(w, true, disabled),
      S.wallet ? null : el("div", { class: "actions" }, el("button", { class: "link", type: "button", disabled, onclick: () => connectWallet() }, "I have a wallet in this browser")));
    return out;
  }
  // The Safe must hold what it sends, or the approval lands and burns the key while the Safe can't run
  // it. Sending approval n again stays open: that key is spent already.
  const tooMuch = !w && BigInt(tx.value || 0) > S.safe.balance;
  if (tooMuch) out.push(el("p", { class: "note" }, `The Safe has ${eth(S.safe.balance)}, and this sends ${eth(BigInt(tx.value))}. ` +
    `Approving now would burn key ${S.seat.n} on an approval the Safe can't run. Send it less, or fund it first.`));
  // This browser found the seat on chain and its console has signed nothing for it: another device's
  // console holds the ledger. If that device signed with key n and its transaction is still pending, or
  // was dropped, signing here would be key n's second signature (the danger case). The visitor has to
  // say that nothing is waiting there before this console signs.
  const elsewhere = S.home.found && !mine().length && !w;
  if (elsewhere) out.push(el("p", { class: "note" }, `Another device made this seat. This browser has no record of what its keys signed. ` +
    `If that device signed with key ${S.seat.n} and the transaction is still pending, or was dropped, signing here would be key ${S.seat.n}'s ` +
    `second signature: enough to forge a third. Check there that its last approval landed, and use one device per seat.`));
  const acks = { red: r.level !== "red", elsewhere: !elsewhere };
  const hold = holdButton(w ? `Hold to send approval ${w.n} again` : `Hold to approve with key ${S.seat.n}`, () => press(tx), { red: r.level === "red" });
  const gate = () => { hold.disabled = disabled || tooMuch || !acks.red || !acks.elsewhere; };
  const ack = (k, text) => el("label", { class: "small" }, el("input", { type: "checkbox", onchange: (e) => { acks[k] = e.target.checked; gate(); } }), text);
  gate();
  out.push(el("div", { class: "actions" }, hold,
    r.level === "red" ? ack("red", "I read the red page") : null,
    elsewhere ? ack("elsewhere", `Nothing signed with key ${S.seat.n} is waiting on another device`) : null,
    el("button", { class: "reject", type: "button", disabled, onclick: () => { S.tx = { preset: "send", to: S.wallet?.account || "", amount: "0.0001" }; S.error = ""; redraw(); } }, "Reject")));
  if (w) out.push(approvalShareBox(w, false, disabled));
  else if (tooMuch) out.push(fundShareBox(disabled));
  else if (canPay()) out.push(el("p", { class: "small" }, `Holding asks your passkey once. The console signs with key ${S.seat.n}, burns it and names key ${S.seat.n + 1}; your wallet sends it all in one transaction.`));
  else out.push(el("p", { class: "small" }, `Holding asks your passkey once. The console signs with key ${S.seat.n}, burns it and names key ${S.seat.n + 1}. ` +
      `${S.wallet ? "No gas in that wallet" : "No wallet here"}: you then share the approval as a link, and a wallet on another device sends it. It pays the gas and approves nothing.`),
    S.wallet ? null : el("div", { class: "actions" }, el("button", { class: "link", type: "button", disabled, onclick: () => connectWallet() }, "I have a wallet in this browser")));
  return out;
}

/** Approval w.n, signed and waiting in the ledger, as a link. `first`: there is no wallet here. */
function approvalShareBox(w, first, disabled) {
  const link = pay.approvalLink(S.C, w.n, w.approval, w.tx, location.origin + location.pathname);
  return el("div", { class: "share" },
    el("h4", {}, first ? `Approval ${w.n} is signed. Send it from another device` : "Or send it from another device"),
    el("ol", { class: "small" },
      el("li", {}, `Copy this link to a device with a wallet on Base Sepolia and a little test ETH for gas: a computer with a browser wallet, or a phone wallet's own browser.`),
      el("li", {}, `Open it there, or paste it into “Pay for a request” on this site. That page works out the Safe transaction hash itself (its code should read ${w.verify}), asks the seat, and sends it. Its wallet pays the gas and approves nothing.`),
      el("li", {}, `Come back to this page. It moves on by itself once approval ${w.n} lands.`)),
    linkField(link),
    el("div", { class: "actions" },
      el("button", { class: first ? "go" : "", type: "button", disabled, onclick: () => copyLink(link) }, "Copy link"),
      S.shared ? el("button", { type: "button", disabled, onclick: checkLanded }, "Check again") : null),
    // The link is too long for a QR code; the code carries the same approval in its compact form.
    qrToggle(pay.approvalQr(S.C, w.n, w.approval, w.tx, location.origin + location.pathname)?.segments ?? null),
    S.shared ? el("p", { class: "small", role: "status" }, `${S.shared} This page looks at the chain every few seconds.`) : null,
    el("details", {}, el("summary", { class: "small" }, "What the link holds"),
      el("p", { class: "small" }, `Approval ${w.n}, exactly as the console signed it:`),
      el("ul", { class: "small" },
        el("li", {}, el("b", {}, `Key ${w.n}'s one-time signature.`), ` It reveals key ${w.n}, which is spent: it signed this once and will never sign again.`),
        el("li", {}, el("b", {}, "Your passkey's curve signature"), " over the approval."),
        el("li", {}, el("b", {}, `Key ${w.n + 1}'s fingerprint`), `: a hash, not the key. Key ${w.n + 1} stays secret until its own approval.`),
        el("li", {}, el("b", {}, "The Safe transaction's fields"), ": what it calls, the value, the data, the nonce.")),
      el("p", { class: "small" }, "No seeds and no hash: the page that opens it works out the Safe transaction hash itself, and the seat checks both signatures. " +
        "Treat the link as public once shared: anyone with it can send this approval, and it can do only what you approved. " +
        `Until it lands, this console shares or sends only this same approval for key ${w.n}.`)));
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
  const out = [el("h3", {}, `Key ${L.n}: signed, sent, burned`)];
  if (L.elsewhere) out.push(el("p", { class: "note" }, `A wallet on another device sent approval ${L.n}, from the link. It paid the gas; key ${L.n}'s signature is the one this console made.`));
  if (L.theirs) out.push(el("p", { class: "note" }, `Your transaction reverted: approval ${L.n} had already landed in another transaction. Someone copied it ` +
    `from the mempool and sent it first. It can only do exactly what you signed, and key ${L.n} is burned either way.`));
  out.push(el("p", {}, `${L.summary}. ${L.ran ? "The Safe ran it." : L.theirs ? "That transaction only approved; the Safe hasn't run it. Its vote is kept: anyone can run it."
      : "The approval landed, but the Safe couldn't run it yet (has it the ETH?). Its vote is kept: anyone can run it later."}`),
    rows([L.hash && [L.theirs ? "Their transaction" : "Transaction", txLink(L.hash)], ["Key now", el("span", { class: "mono" }, `${L.n + 1}: ${short(S.seat?.current || "", 10, 8)}`)]]));
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
    ["Wallet", S.wallet ? el("span", {}, addr(S.wallet.account), el("span", { class: "small" }, ` ${S.wallet.name}${S.walletBalance != null ? ` · ${eth(S.walletBalance)}` : ""} · pays gas only · `),
      el("button", { class: "link", type: "button", onclick: () => connectWallet(true) }, "change"))
      : el("button", { class: "link", type: "button", onclick: () => connectWallet() }, "Connect a wallet")],
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
    el("div", { class: "s" }, `verify ${e.verify} · `, e.txHash ? txLink(e.txHash) : e.status === "landed" ? "sent from another device" : "not sent yet")))));
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

// ----------------------------------------------------------------------------- the explainers
// Two pictures in "How it works", drawn with src/wots.mjs and a throwaway key made here, never a
// passkey's: one chain up close, then what one, two or four signatures by one key let anyone compute.
let PIC;
function pic() {
  if (PIC) return PIC;
  const enc = new TextEncoder(), pub = wots.pubSeed(84532, "0x" + "de".repeat(20), 0), n = 0n;
  const seed = wots.h(enc.encode("a throwaway key for the pictures"));
  const ms = [1, 2, 3, 4].map((i) => wots.h(enc.encode(`an example message ${i}`)));
  const sigs = ms.map((m) => wots.sign(pub, n, seed, m)), key = wots.keyFingerprint(pub, n, seed);
  return (PIC = { pub, n, seed, ms, sigs, key, checks: wots.hex(wots.recover(pub, n, ms[0], sigs[0])) === wots.hex(key) });
}

function drawChainDemo(j = 0) {
  const P = pic(), box = $("#chain-demo"), d = wots.digits(P.ms[0]), at = d[j];
  const refocus = box.contains(document.activeElement) && document.activeElement.classList.contains("bar");
  const xs = [wots.secret(P.seed, j)];
  for (let s = 0; s < wots.STEPS; s++) xs.push(wots.step(P.pub, P.n, j, s, xs[s]));
  const which = j < 64 ? `Digit ${j} of the message m is ${d[j].toString(16)}` : `Checksum digit ${j - 63} of 3 is ${d[j].toString(16)}`;
  const band = (cls, count, text) => { const b = el("span", { class: cls }, text); b.style.flex = `${count} 1 0`; if (!count) b.hidden = true; return b; };
  const bars = d.map((x, i) => {
    const b = el("button", { type: "button", class: "bar" + (i >= 64 ? " ck" : "") + (i === j ? " on" : ""), "aria-pressed": String(i === j),
      "aria-label": `Chain ${i}: reveals position ${x}`, onclick: () => drawChainDemo(i) });
    b.style.height = `${((x + 1) / 16) * 100}%`;
    return b;
  });
  const steps = d.reduce((a, x) => a + wots.STEPS - x, 0);
  box.replaceChildren(
    el("p", {}, "A chain starts from a secret and hashes it 15 times. Anyone can walk up a chain: hash a value and you get the next. Nobody can walk down: that would mean undoing a hash. A key has 67 chains, and each digit of what it signs reveals one position on one chain."),
    el("p", { class: "small" }, `Chain ${j} of 67. ${which}, so the signature reveals position ${at}: the value `, el("span", { class: "mono" }, wots.hex(xs[at]).slice(0, 10) + "…"), "."),
    el("ol", { class: "chain", "aria-label": `Chain ${j}, positions 0 to 15` }, ...xs.map((x, s) => el("li", { class: s < at ? "secret" : s === at ? "shown" : "public" },
      el("span", { class: "pos" }, s === 0 ? "secret" : s === 15 ? "end" : String(s)),
      el("span", { class: "mono" }, s < at ? "····" : wots.hex(x).slice(2, 6))))),
    el("div", { class: "bands", "aria-hidden": "true" }, band("", at, "still secret"), band("", 1, ""), band("up", 15 - at, `anyone can hash up ${15 - at} times`)),
    el("div", { class: "bars" }, ...bars),
    el("div", { class: "legend" }, el("span", {}, el("i", { class: "lg-public" }), "64 chains for m"), el("span", {}, el("i", { class: "lg-shown" }), "3 for the checksum"),
      el("span", {}, "Bar height: the position revealed. Pick a chain.")),
    el("p", { class: "small" }, `To check a signature, the seat walks every revealed value the rest of the way up, ${steps} SHA-256 steps for this one, and hashes the 67 ends. ` +
      (P.checks ? `Here they give ${short(wots.hex(P.key), 10, 6)}, the key's fingerprint, so the signature is good.` : "Here they don't give the key's fingerprint: that is a bug.")));
  if (refocus) box.querySelectorAll(".bar")[j].focus();
}

function drawOnceDemo(k = 2) {
  const P = pic(), box = $("#once-demo"), low = wots.lowest(P.sigs.slice(0, k), P.ms.slice(0, k));
  const refocus = box.contains(document.activeElement);
  const known = low.reduce((a, l) => a + 16 - l.at, 0), share = Math.round((known / (16 * wots.CHAINS)) * 100);
  const p = wots.chance(low), tries = 1 / p;
  const big = tries < 1e7 ? `1 in ${Number(tries.toPrecision(2)).toLocaleString("en-US")}` : `1 in ${tries.toExponential(1).replace(/e\+(\d+)/, " × 10^$1")}`;
  const say = {
    1: ["ok", "None", "One signature can't be stretched into another. Pushing any digit up pulls a checksum digit down, and that would mean walking down a chain."],
    2: ["warn", big, "per message tried. The forger picks the next key named in the message, so they can try as many messages as they like: a GPU's work."],
    4: ["bad", big, "per message tried: well under a second in this browser. The attack room's danger case does exactly this."],
  }[k];
  box.replaceChildren(
    el("p", {}, "One signature shows one position on each chain. Two signatures by the same key show, on each chain, the lower of two, and everything above it is free for anyone to compute. A forger needs a message whose every digit sits at or above what was shown."),
    el("div", { class: "choices", role: "group", "aria-label": "Signatures by one key" }, el("span", { class: "small" }, "Signatures by one key:"),
      ...[1, 2, 4].map((v) => el("button", { type: "button", "aria-pressed": String(v === k), onclick: () => drawOnceDemo(v) }, v === 1 ? "1, as meant" : String(v)))),
    chainsCanvas(low.map((l) => l.at)),
    el("div", { class: "legend" }, el("span", {}, el("i", { class: "lg-secret" }), "still secret"), el("span", {}, el("i", { class: "lg-shown" }), "lowest position shown"),
      el("span", {}, el("i", { class: "lg-public" }), `anyone can compute: ${share}% of the key`)),
    el("p", { class: `odds ${say[0]}` }, say[1]),
    el("p", { class: "small" }, `${say[2]} ${k > 1 ? "Worked out for these signatures, from the 64 message digits only." : ""}`),
    el("p", { class: "small" }, "The seat can't stop this: it only sees signatures that reach it. That's why the console keeps a ledger."));
  if (refocus) box.querySelector(`.choices button[aria-pressed="true"]`).focus();
}

boot();
drawChainDemo();
drawOnceDemo();
