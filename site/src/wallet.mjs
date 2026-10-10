// The wallet page (wallet.html): the shielded Safe that the main page builds, shown as a plain wallet.
// It sends, it shows who owns the Safe, and it changes the owners: add one (say, your own browser
// wallet), remove one, change how many must approve.
//
// It shares this site's storage with the main page: the passkey, which seat and Safe are yours
// ("sab.home"), and the console's ledger. So the guardrail is the same one: whichever page signs with
// key n, the other only ever sends that same approval again. Making a passkey and building the Safe
// stay on the main page.
//
// Every transaction, whoever approves it, is reviewed by the console: it works out the Safe
// transaction hash and says what the transaction does. Owners then vote:
//   the seat     one press (src/approve.mjs): a passkey tap, a one-time key, burned. A wallet pays gas.
//   a wallet     with its own curve key: approveHash, or running it with execTransaction. This is the
//                key a curve break would forge, and the page says so.
// The Safe runs a transaction once enough owners have voted. Votes are on chain (approvedHashes), so a
// transaction waiting for more is kept here, in "sab.proposal", until it runs.
//
// A seat can be an owner of other Safes too: another passkey's, say, in a 2 of 3 with two seats and a
// wallet. The page keeps the Safes this seat is in ("sab.safes") and votes on whichever is open. A
// transaction waiting for votes goes from one owner's device to another's as a link
// (sign-and-burn/proposal/v1, src/pay.mjs): the Safe and the fields, nothing signed, no hash.
import { getAddress, isAddress, parseEther, zeroAddress } from "viem";
import * as consoleCore from "./console.mjs";
import * as P from "./passkey.mjs";
import * as ch from "./chain.mjs";
import { approve } from "./approve.mjs";
import * as pay from "./pay.mjs";
import { $, addr, drawBlockie, el, eth, holdButton, plain, refuseFrames, reviewParts, rows, short, txLink, useChain } from "./ui.mjs";

refuseFrames();

const S = { busy: "", error: "", flash: "", send: { to: "", amount: "0.0001" }, add: "", addThreshold: "1", threshold: "", draft: null, acks: {} };

const log = $("#log");
consoleCore.onLine((dir, line) => {
  const tag = dir === "in" ? "page → console  " : dir === "out" ? "console → page  " : "console says    ";
  log.append(el("div", { class: dir === "out" && line.includes('"ok": false') ? "bad" : dir }, tag + line));
  while (log.childElementCount > 200) log.firstChild.remove();
});

// ----------------------------------------------------------------------------- where things are kept
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
const home = () => read("sab.home")[`${S.C.id}:${S.pk.id}`] || null;
const proposalKey = () => `${S.C.id}:${S.safe.address.toLowerCase()}`;
/** The Safes this seat is in, besides its own: the ones it was shown, by link or by hand. */
const safesKey = () => `${S.C.id}:${S.home.seat.toLowerCase()}`;
const safes = () => [S.home.safe, ...(read("sab.safes")[safesKey()] || [])];
function keepSafe(a) {
  if (safes().some((x) => x.toLowerCase() === a.toLowerCase())) return;
  const all = read("sab.safes");
  all[safesKey()] = [...(all[safesKey()] || []), getAddress(a)];
  try { localStorage.setItem("sab.safes", JSON.stringify(all)); } catch {}
}
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
function keepProposal(tx) {
  const all = read("sab.proposal");
  if (tx) all[proposalKey()] = tx; else delete all[proposalKey()];
  try { localStorage.setItem("sab.proposal", JSON.stringify(all)); } catch {}
}
const ledger = () => consoleCore.ask({ op: "ledger" }).entries || [];
const mine = () => ledger().filter((e) => e.chainId === S.C.id && e.seat === S.home.seat.toLowerCase());

// ----------------------------------------------------------------------------- boot, and the chain
async function boot() {
  try {
    S.info = await consoleCore.boot();
    S.cfg = ch.parseCfg(await (await fetch("console/cfg.py")).text());
    S.C = ch.connect(S.cfg);
    useChain(S.C);
  } catch (e) {
    S.error = `The console didn't start: ${e.message || e}`;
    return render();
  }
  $("#lamp").className = "lamp on";
  $("#stats").textContent = `The console: MicroPython ${S.info.micropython} in WebAssembly, fingerprint ${S.info.fingerprint.slice(0, 4)}·${S.info.fingerprint.slice(4, 8)}. ` +
    "It reviews every transaction here, and signs only for your seat.";
  if (!consoleCore.ledgerKept()) S.warn = "This browser won't keep the console's ledger (private browsing?). The guardrail then lasts only while this tab is open.";
  S.pk = P.stored();
  if (S.pk && S.pk.rpId !== location.hostname) S.pk = null;
  await reconnectWallet().catch(() => {});
  await guard("Reading your Safe from the chain…", find);
  window.addEventListener("hashchange", () => { if (pay.proposalFrom(location.hash, S.C)) guard("Reading the Safe from the chain…", openProposal); });
  // While a transaction waits for votes, another owner may vote or run it from elsewhere.
  setInterval(() => { if (!S.busy && S.current && document.visibilityState === "visible") refresh().then((changed) => changed && render(), () => {}); }, S.C.id === 31337 ? 1500 : 12000);
}

/** Which seat and Safe are this passkey's: the main page's record, or the newest seat on chain. */
async function find() {
  if (!S.pk) return;
  const signer = consoleCore.ask({ op: "signer", x: S.pk.x, y: S.pk.y }).signer;
  const onChain = (await ch.signerAddress(S.C, S.pk)).toLowerCase();
  if (onChain !== signer) throw new Error(`the signer factory names ${onChain} for this passkey, the console ${signer}`);
  let h = home();
  if (!h?.seat || !(await ch.hasCode(S.C, h.seat))) {
    const seats = await ch.seatsOf(S.C, signer);
    h = seats.length ? { seat: seats[seats.length - 1], safe: await ch.safeAddress(S.C, seats[seats.length - 1]), found: true } : null;
  }
  S.home = h;
  if (!h) return;
  S.at = h.safe;
  if (pay.proposalFrom(location.hash, S.C)) return openProposal();
  await refresh();
}

/** A link from another owner's device: a transaction for a Safe this seat (or the wallet here) is an
 * owner of. The console reviews it like any other; the link's word is taken for nothing else. */
async function openProposal() {
  const got = pay.proposalFrom(location.hash, S.C);
  history.replaceState(null, "", location.pathname + location.search);
  if (!got) return;
  if (got.refuse) throw new Error(got.refuse);
  if (!S.home) throw new Error("This browser has no seat yet. Open the link on the device whose seat is an owner of that Safe.");
  const safe = await ch.readSafe(S.C, got.req.safe);
  const owns = (a) => safe.exists && safe.owners.some((o) => same(o, a));
  if (!owns(S.home.seat) && !owns(S.wallet?.account)) throw new Error(`Neither your seat nor the wallet here is an owner of the Safe ${short(got.req.safe)}. Nothing to approve.`);
  if (Number(got.req.tx.nonce) < safe.nonce) throw new Error(`The Safe ${short(got.req.safe)} has run its transaction ${got.req.tx.nonce} already. Nothing to approve.`);
  if (owns(S.home.seat)) keepSafe(got.req.safe);
  S.at = getAddress(got.req.safe);
  S.draft = got.req.tx; S.acks = {}; S.flash = "";
  await refresh();
}

/** Open another Safe this seat is in. */
async function openSafe(a) {
  S.at = a; S.draft = null; S.acks = {}; S.flash = ""; S.error = "";
  await guard("Reading the Safe from the chain…", refresh);
}

async function addSafe() {
  const a = (S.addSafe || "").trim();
  await guard("Reading the Safe from the chain…", async () => {
    if (!isAddress(a)) throw new Error("That isn't an address.");
    const safe = await ch.readSafe(S.C, a);
    if (!safe.exists || !safe.owners.some((o) => same(o, S.home.seat))) throw new Error(`Your seat isn't an owner of ${short(a)}. Add it there first: on that Safe's own page, add ${S.home.seat} as an owner.`);
    keepSafe(a);
    S.addSafe = "";
    S.at = getAddress(a); S.draft = null; S.acks = {};
    await refresh();
  });
}

/** Read the seat, the Safe, its owners, and the transaction waiting for votes. -> whether anything
 * changed since the last read. */
async function refresh() {
  const H = S.home;
  if (!H || !(await ch.hasCode(S.C, H.seat))) return false;
  const [seat, safe] = await Promise.all([ch.readSeat(S.C, H.seat), ch.readSafe(S.C, S.at || H.safe)]);
  S.seat = seat; S.safe = safe;
  if (!safe.exists) return true;
  consoleCore.ask({ op: "chain", chainId: S.C.id, seat: H.seat, n: seat.n });
  S.owners = await Promise.all(safe.owners.map(async (a) => {
    const yours = same(a, H.seat);
    const [code, sent] = yours ? [true, 0] : await Promise.all([ch.hasCode(S.C, a), S.C.pc.getTransactionCount({ address: a })]);
    const isSeat = yours || (code && await ch.isSeat(S.C, a));
    return { address: a, yours, isSeat, contract: !isSeat && code, sent };
  }));
  S.seatOwns = S.owners.some((o) => o.yours);
  if (S.wallet) S.walletBalance = await S.C.pc.getBalance({ address: S.wallet.account }).catch(() => null);
  // The transaction on the approval card: one the seat signed and is waiting on (key n is bound to it),
  // else one that already has votes and hasn't run, else whatever the visitor is drafting.
  // Key n is bound to the approval it signed, whichever Safe that was for.
  const waiting = mine().find((e) => e.status !== "landed") || null;
  S.waiting = waiting && same(waiting.safe, safe.address) ? waiting : null;
  S.waitingElsewhere = waiting && !S.waiting ? waiting : null;
  let kept = read("sab.proposal")[proposalKey()] || null;
  if (S.draft && Number(S.draft.nonce) !== safe.nonce) S.draft = null;
  if (kept && Number(kept.nonce) < safe.nonce) { keepProposal(null); kept = null; }
  S.current = S.waiting ? { tx: S.waiting.tx, locked: true } : kept ? { tx: kept, kept: true } : S.draft ? { tx: S.draft } : null;
  S.review = S.current ? consoleCore.ask({ op: "review", chainId: S.C.id, safe: safe.address, tx: S.current.tx }) : null;
  S.votes = S.review?.ok ? await ch.votesFor(S.C, safe.address, safe.owners, S.review.safeTxHash) : [];
  const was = S.seen;
  S.seen = JSON.stringify([safe.address, seat.n, safe.nonce, String(safe.balance), safe.owners, safe.threshold, S.votes, S.waiting?.n, S.walletBalance === null ? "" : String(S.walletBalance)]);
  return was !== S.seen;
}

async function guard(what, f) {
  S.busy = what; S.error = ""; $("#lamp").className = "lamp busy"; render();
  try { await f(); } catch (e) { S.error = plain(e); }
  S.busy = ""; $("#lamp").className = "lamp on"; render();
}
const say = (t) => { S.busy = t; render(); };

// ----------------------------------------------------------------------------- the wallet
const walletId = (info) => info.rdns || info.uuid;
const isOwner = (a) => !!a && !!S.safe?.owners?.some((o) => o.toLowerCase() === a.toLowerCase());
const canPay = () => !!S.wallet && S.walletBalance !== 0n;

async function connectWallet() {
  await guard("Looking for wallets in this browser…", async () => {
    const found = await ch.findWallets();
    if (!found.length) throw new Error("No wallet found in this browser. The seat's approvals can still go out from the main page, as a link for a wallet on another device.");
    if (found.length > 1) { S.choosing = found; return; }
    await useWallet(found[0]);
  });
}
async function useWallet(w, got = null) {
  S.choosing = null;
  got ||= await ch.useWallet(S.C, w.provider);
  S.wallet = { ...got, name: w.info.name, provider: w.provider };
  try { localStorage.setItem("sab.wallet", walletId(w.info)); } catch {}
  if (w.provider.on && !w.followed) {
    w.followed = true;
    w.provider.on("accountsChanged", async (accounts) => {
      if (S.wallet?.provider !== w.provider) return;
      S.wallet = accounts?.length ? { ...S.wallet, account: accounts[0] } : null;
      await refresh().catch(() => {});
      if (accounts?.length && S.wallet?.account !== accounts[0]) return;   // switched again since: that one draws
      render();
    });
    w.provider.on("chainChanged", (id) => {
      if (S.wallet?.provider === w.provider && Number(id) !== S.C.id) { S.wallet = null; S.error = `The wallet moved to another network. Connect it again for ${S.C.chain.name}.`; render(); }
    });
  }
  await refresh().catch(() => {});
}
async function reconnectWallet() {
  let id = null;
  try { id = localStorage.getItem("sab.wallet"); } catch {}
  if (!id) return;
  const w = (await ch.findWallets()).find((x) => walletId(x.info) === id || x.info.uuid === id);
  const got = w && await ch.useWallet(S.C, w.provider, { quiet: true }).catch(() => null);
  if (got) await useWallet(w, got);
}

async function needGas() {
  S.walletBalance = await S.C.pc.getBalance({ address: S.wallet.account }).catch(() => null);
  if (S.walletBalance === 0n) throw new Error(`${S.wallet.name}'s account ${short(S.wallet.account)} has no ${S.C.chain.name} ETH to pay the gas. Nothing was sent.`);
}

// ----------------------------------------------------------------------------- drafts
function draft(tx) {
  S.error = ""; S.flash = ""; S.acks = {};
  S.draft = tx;
  refresh().then(() => { render(); $("#act").scrollIntoView({ block: "start", behavior: "smooth" }); }, (e) => { S.error = plain(e); render(); });
}

function draftSend() {
  const { to, amount } = S.send;
  if (!isAddress(to)) return fail("Send to: that isn't an address.");
  let value;
  try { value = parseEther(amount || ""); } catch { return fail("Amount: that isn't a number of ETH."); }
  if (value <= 0n) return fail("Amount: send more than nothing.");
  draft({ to: getAddress(to), value: value.toString(), data: "0x", operation: 0, nonce: String(S.safe.nonce) });
}

function draftAdd() {
  const a = S.add.trim(), t = Number(S.addThreshold);
  if (!isAddress(a)) return fail("New owner: that isn't an address.");
  if (isOwner(a)) return fail("That address is an owner already.");
  if ([zeroAddress, "0x0000000000000000000000000000000000000001", S.safe.address.toLowerCase()].includes(a.toLowerCase())) return fail("A Safe can't have that address as an owner.");
  draft(ch.ownerTx(S.safe.address, S.safe.nonce, { add: a, threshold: t }));
  S.add = "";
}

function draftRemove(o) {
  draft(ch.ownerTx(S.safe.address, S.safe.nonce, { remove: o, owners: S.safe.owners, threshold: Math.min(S.safe.threshold, S.safe.owners.length - 1) }));
}

function draftThreshold() {
  const t = Number(S.threshold);
  if (!(t >= 1 && t <= S.safe.owners.length) || t === S.safe.threshold) return fail("Pick another number of approvals.");
  draft(ch.ownerTx(S.safe.address, S.safe.nonce, { threshold: t }));
}

function fail(why) { S.error = why; S.flash = ""; render(); }

function discard() {
  S.draft = null; S.acks = {}; S.error = "";
  if (S.current?.kept) keepProposal(null);
  refresh().finally(render);
}

// ----------------------------------------------------------------------------- votes
/** The seat votes: one press. Its approval carries the votes the Safe already holds, so the Safe
 * runs the transaction in the same block if that makes enough. */
async function voteSeat(tx) {
  await guard("Reading the seat and the Safe from the chain…", async () => {
    await refresh();
    if (!S.seatOwns) throw new Error("Your seat isn't an owner of this Safe. Nothing was signed.");
    const nonceBefore = S.safe.nonce;
    if (Number(tx.nonce) >= S.safe.nonce) keepProposal(tx);
    const others = S.votes.filter((v) => v.toLowerCase() !== S.seat.address.toLowerCase());
    const got = await approve({ C: S.C, pk: S.pk, seat: S.seat, safe: S.safe, tx, wallet: S.wallet, others, say });
    S.draft = null; S.acks = {};
    await refresh();
    const ran = S.safe.nonce > nonceBefore;
    S.flash = el("span", {}, `Key ${got.n}: signed, sent, burned. ` + (got.theirs ? "Someone copied the approval and sent it first: it can do only what you signed. " : "") +
      (ran ? "The Safe ran it. " : Number(tx.nonce) < nonceBefore ? "The Safe had moved past this transaction, so it ran nothing; the seat is at the next key now. " :
        `The seat's vote is on chain. The Safe runs it once ${S.safe.threshold} owners have approved. `), txLink(got.hash));
  });
}

/** A wallet that is an owner votes with its own key. run: it is the vote that makes enough, so it
 * runs the transaction as well (execTransaction, with the other votes the Safe holds). */
async function voteWallet(tx, run) {
  await guard(run ? "Your wallet runs it: its own key is its vote…" : "Your wallet approves it on chain, with its own key…", async () => {
    await refresh();
    if (!S.review?.ok || S.review.refuse) throw new Error("The console doesn't approve this transaction. Nothing was sent.");
    if (Number(tx.nonce) !== S.safe.nonce) throw new Error(`The Safe is at nonce ${S.safe.nonce}, and this is for ${tx.nonce}. Nothing was sent.`);
    if (!isOwner(S.wallet?.account)) throw new Error("This wallet's account isn't an owner of the Safe. Nothing was sent.");
    await needGas();
    keepProposal(tx);
    const data = run ? ch.execData(tx, [...S.votes, S.wallet.account]) : ch.approveHashData(S.review.safeTxHash);
    const hash = await ch.sendToSafe(S.C, S.wallet, S.safe.address, data);
    say("Waiting for the block…");
    const r = await ch.receipt(S.C, hash);
    if (r.status !== "success") throw new Error(`The transaction reverted (${short(hash, 10, 6)}). Nothing changed.`);
    S.draft = null; S.acks = {};
    await refresh();
    S.flash = el("span", {}, run ? "Your wallet ran it. " : `Your wallet's vote is on chain. The Safe runs it once ${S.safe.threshold} owners have approved. `, txLink(hash));
  });
}

/** Enough votes are on chain already, but nobody has run it (say, the Safe was short of ETH then).
 * Any wallet may run it: the votes are the Safe's own record. */
async function run(tx) {
  await guard("Your wallet runs it. It pays gas, and approves nothing…", async () => {
    await refresh();
    await needGas();
    const hash = await ch.sendToSafe(S.C, S.wallet, S.safe.address, ch.execData(tx, S.votes));
    say("Waiting for the block…");
    const r = await ch.receipt(S.C, hash);
    if (r.status !== "success") throw new Error(`The transaction reverted (${short(hash, 10, 6)}). Nothing changed.`);
    await refresh();
    S.flash = el("span", {}, "The Safe ran it. ", txLink(hash));
  });
}

// ----------------------------------------------------------------------------- drawing
function render() {
  const focus = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  drawAccount();
  const flash = $("#flash");
  flash.replaceChildren(...[S.warn && el("p", { class: "note" }, S.warn), S.busy && el("p", { class: "status" }, el("span", { class: "spin" }), S.busy),
    S.error && el("p", { class: "note error", role: "alert" }, S.error), S.flash && !S.busy && el("p", { class: "note" }, S.flash)].filter(Boolean));
  if (!S.safe?.exists) {
    for (const id of ["#act", "#send", "#safes", "#owners", "#activity"]) { $(id).replaceChildren(); $(id).hidden = true; }
    return;
  }
  $("#act").hidden = !S.current;
  $("#act").className = "card";
  $("#send").hidden = $("#safes").hidden = $("#owners").hidden = $("#activity").hidden = false;
  const fill = (id, parts) => $(id).replaceChildren(...parts.filter(Boolean));
  fill("#act", S.current ? approvalCard() : []);
  fill("#send", sendCard());
  fill("#safes", safesCard());
  fill("#owners", ownersCard());
  fill("#activity", activityCard());
  if (focus) { const again = document.getElementById(focus); again?.focus(); try { again?.setSelectionRange(pos, pos); } catch {} }
}

function drawAccount() {
  const box = $("#account");
  if (!S.C) return box.replaceChildren(el("p", { class: S.error ? "note error" : "muted" }, S.error || "Starting the console…"));
  const main = el("p", {}, el("a", { href: "./" }, "Go to the main page"), ": it makes a passkey, your first one-time key, and builds your shielded Safe.");
  if (!S.pk) return box.replaceChildren(el("h1", {}, "No passkey here yet"), main);
  if (!S.safe && S.busy) return box.replaceChildren(el("p", { class: "muted" }, "Reading your Safe from the chain…"));
  if (!S.safe?.exists) return box.replaceChildren(el("h1", {}, "Your Safe isn't built yet"), main);
  const c = drawBlockie(el("canvas", { width: 8, height: 8, class: "wallet-blockie", "aria-hidden": "true" }), S.safe.address);
  box.replaceChildren(c, el("div", {},
    el("p", { class: "eyebrow" }, same(S.safe.address, S.home.safe) ? "Your shielded Safe" : S.seatOwns ? "A Safe your seat is in" : "A Safe your wallet is in"),
    el("div", { class: "balance" }, eth(S.safe.balance)),
    el("div", { class: "wallet-sub" }, addr(S.safe.address),
      el("span", { class: "chip" }, `${S.safe.threshold} of ${S.safe.owners.length} to approve`),
      el("span", { class: "chip" }, `seat at key ${S.seat.n}`),
      el("span", { class: "chip" }, `nonce ${S.safe.nonce}`))),
    el("div", { class: "wallet-who" }, S.wallet
      ? el("span", {}, el("span", { class: "small" }, `${S.wallet.name}: `), addr(S.wallet.account),
        el("span", { class: "small" }, ` ${S.walletBalance != null ? eth(S.walletBalance) : ""} · ${isOwner(S.wallet.account) ? "an owner" : "pays gas only"}`))
      : el("button", { type: "button", disabled: !!S.busy, onclick: connectWallet }, "Connect a wallet"),
    S.choosing ? el("div", { class: "chooser" }, el("p", {}, "Which wallet?"), el("div", { class: "actions" },
      ...S.choosing.map((w) => el("button", { type: "button", onclick: () => guard(`Asking ${w.info.name} for an account…`, () => useWallet(w)) }, w.info.name || "A wallet")),
      el("button", { class: "link", type: "button", onclick: () => { S.choosing = null; render(); } }, "Cancel"))) : null));
}

const KIND = {
  seat: ["seat", "Sign and Burn seat", "A passkey and a one-time key. The key changes after every approval, so a broken curve isn't enough."],
  other: ["seat", "Sign and Burn seat", "Another passkey's seat, made by the SeatFactory. It changes its key after every approval too. Its device holds its own ledger."],
  contract: ["contract", "A contract", "Not a seat the SeatFactory made: a smart account, perhaps. This page can't tell what it checks."],
  exposed: ["exposed", "Ordinary key", "Its public key is on chain: it has signed transactions. Anyone who can forge curve signatures could sign as it."],
  fresh: ["fresh", "Ordinary key", "It has sent no transactions, so only its address, a hash of its key, is on chain. Its first signature shows its public key."],
};
const kindOf = (o) => KIND[o.yours ? "seat" : o.isSeat ? "other" : o.contract ? "contract" : o.sent ? "exposed" : "fresh"];

function ownersCard() {
  const disabled = !!S.busy || !!S.current;
  const t = S.safe.threshold;
  const out = [el("h2", {}, "Owners"), el("p", { class: "small" }, `${t} of ${S.owners.length} must approve each transaction.`)];
  out.push(el("ul", { class: "owners" }, ...S.owners.map((o) => {
    const [cls, name, what] = kindOf(o);
    return el("li", { class: `owner ${cls}` },
      el("div", { class: "h" }, addr(o.address), el("span", { class: "badge" }, name),
        o.yours ? el("span", { class: "badge you" }, "your seat") : null,
        S.wallet && same(o.address, S.wallet.account) ? el("span", { class: "badge you" }, "this wallet") : null),
      el("div", { class: "small" }, o.yours ? `Key ${S.seat.n} now. ${what}` : !o.isSeat && !o.contract && o.sent ? `Sent ${o.sent} transaction${o.sent === 1 ? "" : "s"}. ${what}` : what),
      o.yours ? null : el("div", { class: "actions" }, el("button", { class: "link", type: "button", disabled, onclick: () => draftRemove(o.address) }, "Remove")));
  })));
  // A seat protects a Safe only if no set of ordinary owners reaches the threshold (research.md,
  // question 5). A backup for a lost passkey is the other owners reaching it without your seat. With
  // one seat those two can't both hold; with two seats they can (2 of 3: two seats and a wallet).
  const ordinary = S.owners.filter((o) => !o.isSeat), others = S.owners.filter((o) => !o.yours);
  const exposed = ordinary.length >= t, backup = S.seatOwns && others.length >= t;
  out.push(el("div", { class: `verdict ${exposed ? "bad" : "ok"}` },
    el("b", {}, exposed ? "Ordinary keys can approve without a seat" : "Every approval needs a seat"),
    el("p", { class: "small" }, exposed
      ? `${ordinary.length === 1 ? "One ordinary owner" : `${t} of the ${ordinary.length} ordinary owners`} can approve with no seat at all. ` +
        "Someone who can forge curve signatures could sign as them and take the Safe."
      : ordinary.length
        ? `The ordinary owners can't reach ${t} without a seat, so a broken curve isn't enough to take the Safe.`
        : "Every owner is a seat. A broken curve isn't enough to take the Safe.")));
  if (S.seatOwns) out.push(el("div", { class: `verdict ${backup ? "ok" : "warn"}` },
    el("b", {}, backup ? "A backup if your passkey is lost" : "No backup if your passkey is lost"),
    el("p", { class: "small" }, backup ? `The other owners can reach ${t} without your seat, and run the Safe or replace your seat.`
      : `The other owners can't reach ${t} without your seat. If your passkey is lost, the Safe is stuck.`)));
  out.push(el("details", { class: "small" }, el("summary", {}, "1 of 2, 2 of 2, or 2 of 3?"),
    el("p", {}, el("b", {}, "Your seat and your wallet, 1 of 2"), ": either can approve alone. Your wallet is a backup, and a way to get used to a multisig. " +
      "But your wallet's key rests on a curve, and once it has signed anything its public key is public. If curves break, the seats no longer protect this Safe."),
    el("p", {}, el("b", {}, "2 of 2"), ": both must approve. A broken curve can forge your wallet's vote, never the seat's, so the protection holds. " +
      "There is no backup: lose either key and the Safe is stuck."),
    el("p", {}, el("b", {}, "Two seats and your wallet, 2 of 3"), ": any two. Your wallet can never approve alone, so every approval needs a one-time key, " +
      "and if one passkey is lost the other seat and your wallet still reach 2. The other seat is another passkey's, made on the main page of another browser or device. " +
      "Add its seat address here as an owner, then share each transaction with its device as a link.")));
  const sel = (id, value, max, on) => el("select", { id, onchange: (e) => on(e.target.value) }, ...Array.from({ length: max }, (_, i) => el("option", { value: String(i + 1), selected: String(i + 1) === value }, String(i + 1))));
  out.push(el("h3", {}, "Add an owner"),
    el("div", { class: "form owner-form owner-add" },
      el("label", {}, "Address", el("input", { id: "add-owner", class: "mono", value: S.add, placeholder: "0x…", spellcheck: "false", autocomplete: "off", oninput: (e) => { S.add = e.target.value; } })),
      el("label", {}, "Then approvals needed", sel("add-threshold", S.addThreshold, S.owners.length + 1, (v) => { S.addThreshold = v; }))),
    el("div", { class: "actions owner-add" },
      S.wallet && !isOwner(S.wallet.account) ? el("button", { type: "button", disabled, onclick: () => { S.add = S.wallet.account; S.addThreshold = String(t); render(); } }, "Use my wallet's address") : null,
      el("button", { class: "go", type: "button", disabled, onclick: draftAdd }, "Review")));
  if (S.owners.length > 1) {
    S.threshold ||= String(t);
    out.push(el("h3", {}, "Approvals needed"), el("div", { class: "actions threshold-row" },
      sel("threshold", S.threshold, S.owners.length, (v) => { S.threshold = v; }), el("span", { class: "small" }, `of ${S.owners.length}`),
      el("button", { type: "button", disabled, onclick: draftThreshold }, "Review")));
  }
  if (S.current) out.push(el("p", { class: "small" }, "One transaction at a time: finish or reject the one above first."));
  return out;
}

/** The Safes this seat is in, and the seat's own address, for adding it to another Safe. */
function safesCard() {
  const list = safes();
  if (!list.some((a) => same(a, S.safe.address))) list.push(S.safe.address);
  return [el("h2", {}, "Safes"),
    el("ul", { class: "safes" }, ...list.map((a) => el("li", {}, addr(a),
      same(a, S.home.safe) ? el("span", { class: "badge" }, "yours") : null,
      same(a, S.safe.address) ? el("span", { class: "badge you" }, "open") : el("button", { class: "link", type: "button", disabled: !!S.busy, onclick: () => openSafe(a) }, "Open")))),
    el("p", { class: "small" }, "Your seat's address. Another Safe adds this as an owner, and then your passkey can approve for it too:"),
    el("input", { class: "mono share-link", readonly: true, value: S.home.seat, "aria-label": "Your seat's address", onfocus: (e) => e.target.select() }),
    el("div", { class: "actions" }, el("button", { type: "button", onclick: () => copy(S.home.seat, "Copied your seat's address.") }, "Copy your seat's address")),
    el("details", {}, el("summary", { class: "small" }, "Open another Safe your seat is in"),
      el("div", { class: "actions" },
        el("input", { id: "add-safe", class: "mono", value: S.addSafe || "", placeholder: "0x…", spellcheck: "false", autocomplete: "off", "aria-label": "The Safe's address", oninput: (e) => { S.addSafe = e.target.value; } }),
        el("button", { type: "button", disabled: !!S.busy, onclick: addSafe }, "Open it")),
      el("p", { class: "small" }, "A link from another owner's device opens its Safe here by itself."))];
}

async function copy(text, said) {
  try { await navigator.clipboard.writeText(text); S.flash = said; S.error = ""; }
  catch { S.error = "This browser wouldn't copy. Select the text shown and copy it yourself."; }
  render();
}

function sendCard() {
  const disabled = !!S.busy || !!S.current;
  return [el("h2", {}, "Send"),
    el("div", { class: "form send-form" },
      el("label", {}, "To", el("input", { id: "send-to", class: "mono", value: S.send.to, placeholder: "0x…", spellcheck: "false", autocomplete: "off", oninput: (e) => { S.send.to = e.target.value.trim(); } })),
      el("label", {}, "Amount (ETH)", el("input", { id: "send-amount", value: S.send.amount, inputmode: "decimal", oninput: (e) => { S.send.amount = e.target.value.trim(); } }))),
    el("div", { class: "actions" }, el("button", { class: "go", type: "button", disabled, onclick: draftSend }, "Review")),
    S.current ? el("p", { class: "small" }, "One transaction at a time: finish or reject the one above first.") : null];
}

/** The transaction the owners are voting on: what the console says it does, who has voted, and what
 * each owner here can do about it. */
function approvalCard() {
  const tx = S.current.tx, r = S.review, n = S.seat.n, w = S.waiting;
  const card = $("#act");
  card.className = "card approval";
  if (!r.ok) return [el("h2", {}, "Approve"), el("p", { class: "refuse" }, r.refuse), rejectButton()];
  const red = r.level === "red";
  if (red) card.className = "card approval red";
  const out = [el("h2", {}, `Approve: ${r.summary}`)];
  out.push(...reviewParts(r, S.safe.address, tx, "Safe transaction hash, worked out by the console"));
  if (r.refuse) { out.push(el("p", { class: "refuse" }, "The console refuses: " + r.refuse), rejectButton()); return out; }
  const overtaken = Number(tx.nonce) < S.safe.nonce;
  const seatVoted = S.votes.some((v) => v.toLowerCase() === S.seat.address.toLowerCase());
  const t = S.safe.threshold, count = S.votes.length;
  out.push(el("h3", {}, overtaken ? "Overtaken" : `Votes: ${count} of ${t}`),
    el("ul", { class: "votes" }, ...S.owners.map((o) => {
      const voted = S.votes.some((v) => v.toLowerCase() === o.address.toLowerCase());
      const said = voted ? "approved" : o.yours && w ? `key ${w.n} signed it; not on chain yet` : "not yet";
      return el("li", { class: voted ? "yes" : "" }, el("span", { class: "mark", "aria-hidden": "true" }, voted ? "✓" : "○"), addr(o.address), el("span", { class: "small" }, ` ${kindOf(o)[1]} · ${said}`));
    })));
  if (overtaken) {
    out.push(el("p", { class: "note" }, `The Safe ran another transaction at nonce ${tx.nonce}, so it will never run this one. But key ${w.n} signed it, and a key signs once, ever: ` +
      `this approval is the only thing key ${w.n} will ever send. Send it to move the seat on to key ${w.n + 1}; it runs nothing.`));
  }
  const acks = S.acks, gates = [];
  const tooMuch = !w && BigInt(tx.value || 0) > S.safe.balance;
  if (tooMuch) out.push(el("p", { class: "note" }, `The Safe has ${eth(S.safe.balance)}, and this sends ${eth(BigInt(tx.value))}. Approving it now would spend a vote, and for the seat a key, on a transaction the Safe can't run.`));
  // A browser that found the seat on chain, whose console has signed nothing for it: another device's
  // console holds the ledger (as on the main page).
  const elsewhere = S.home.found && !mine().length;
  const wElse = S.waitingElsewhere;
  if (wElse && !seatVoted && S.seatOwns) out.push(el("p", { class: "note" }, `Key ${n} signed an approval for another Safe (${short(wElse.safe)}), and it hasn't landed. ` +
    `One signature per key, ever: send that one first, then key ${n + 1} can approve this. `, el("button", { class: "link", type: "button", disabled: !!S.busy, onclick: () => openSafe(getAddress(wElse.safe)) }, "Open that Safe")));
  const ack = (k, text) => el("label", { class: "small ack" }, el("input", { type: "checkbox", checked: !!acks[k], onchange: (e) => { acks[k] = e.target.checked; gates.forEach((g) => g()); } }), text);
  const buttons = [];
  const gated = (b, needs) => { const g = () => { b.disabled = !!S.busy || tooMuch || needs.some((k) => !acks[k]); }; g(); gates.push(g); return b; };
  const needRed = red ? ["red"] : [];
  if ((!seatVoted || overtaken) && S.seatOwns && !wElse) {
    const label = w ? `Hold to send approval ${w.n} again` : `Hold to approve with key ${n}`;
    if (!S.wallet) buttons.push(el("span", { class: "small" }, "Connect a wallet to pay the seat's gas, or send it from ", el("a", { href: "./" }, "the main page"), " by link."));
    else if (!canPay()) buttons.push(el("span", { class: "small" }, `${S.wallet.name}'s account has no ETH for the seat's gas.`));
    else buttons.push(gated(holdButton(label, () => voteSeat(tx), { red }), [...needRed, ...(elsewhere && !w ? ["elsewhere"] : [])]));
  }
  const mineToo = S.wallet && isOwner(S.wallet.account) && !S.votes.some((v) => v.toLowerCase() === S.wallet.account.toLowerCase());
  if (mineToo && !overtaken && !w && count < t) {
    const runs = count + 1 >= t;
    buttons.push(gated(el("button", { type: "button", onclick: () => voteWallet(tx, runs) }, runs ? "Run it with my wallet" : "Approve with my wallet"), needRed));
  }
  if (count >= t && !overtaken && S.wallet) buttons.push(gated(el("button", { class: "go", type: "button", onclick: () => run(tx) }, "Run it"), []));
  out.push(el("div", { class: "actions" }, ...buttons,
    red ? ack("red", "I read the red page") : null,
    elsewhere && !w && !seatVoted ? ack("elsewhere", `Nothing signed with key ${n} is waiting on another device`) : null,
    rejectButton()));
  if (elsewhere && !w && !seatVoted) out.push(el("p", { class: "note" }, `Another device made this seat, and this browser has no record of what its keys signed. If that device signed with key ${n} ` +
    `and its transaction is still pending, signing here would be key ${n}'s second signature: enough to forge a third. Check there first, and use one device per seat.`));
  if (!overtaken && count < t) {
    const link = pay.proposalLink(S.C, S.safe.address, tx, location.origin + location.pathname);
    out.push(el("div", { class: "share" },
      el("h4", {}, "Ask another owner"),
      el("p", { class: "small" }, `Send this link to another owner's device: a seat's, or a wallet's. Its console works out the hash itself, and its code should read ${r.verify}. ` +
        "It sees the votes cast so far on chain. The link holds the transaction, and nothing signed."),
      el("input", { class: "mono share-link", readonly: true, value: link, "aria-label": "The link", onfocus: (e) => e.target.select() }),
      el("div", { class: "actions" }, el("button", { type: "button", disabled: !!S.busy, onclick: () => copy(link, "Link copied. This page shows the new votes as they land.") }, "Copy link"))));
  }
  if (w && !overtaken) out.push(el("p", { class: "small" }, `Key ${w.n} already signed this approval. One signature per key, ever: the console will only send this same one again. No tap needed.`));
  else if (!seatVoted && !overtaken) out.push(el("p", { class: "small" }, `Holding asks your passkey once. The console signs with key ${n}, burns it and names key ${n + 1}. Your wallet pays the gas.`));
  if (mineToo && !overtaken && !w && count < t) out.push(el("p", { class: "small" }, "Your wallet votes with its own key, the curve key a broken curve would forge. It shows that key's public half on chain, if it wasn't already."));
  return out;
}

/** Reject is one easy press, except for a transaction key n has signed: that one is the only thing
 * key n will ever send, so it stays until it lands. */
function rejectButton() {
  if (S.current?.locked) return null;
  return el("button", { class: "reject", type: "button", disabled: !!S.busy, onclick: discard }, S.current?.kept ? "Reject: forget it here" : "Reject");
}

function activityCard() {
  const es = mine().slice().reverse();
  return [el("h2", {}, "Your seat's approvals"),
    rows([["Seat", addr(S.home.seat)], ["Key now", el("span", { class: "mono", title: S.seat.current }, `${S.seat.n}: ${short(S.seat.current, 10, 6)}`)]]),
    es.length ? el("ul", { class: "history" }, ...es.map((e) => el("li", {},
      el("div", { class: "h" }, el("span", {}, `#${e.n} · ${e.summary}${same(e.safe, S.safe.address) ? "" : ` · Safe ${short(e.safe)}`}`), el("span", { class: `badge ${e.status}` }, e.status)),
      el("div", { class: "s" }, `verify ${e.verify} · `, e.txHash ? txLink(e.txHash) : "not sent yet"))))
      : el("p", { class: "muted" }, "This browser's console hasn't approved anything for this seat yet."),
    el("p", { class: "small" }, "Votes by other owners aren't listed here: the Safe's own history on the explorer has them.")];
}

boot();
