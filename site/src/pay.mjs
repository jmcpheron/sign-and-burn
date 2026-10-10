// Who pays the gas for the build. Building a shielded Safe takes one transaction, and nothing in it is
// approved by whoever sends it: anyone may deploy the SeatFactory, a passkey's signer, a seat and its
// Safe. So the device that holds the passkey doesn't need a wallet. It hands out a build request: the
// few public values the calls are made from (the passkey's curve public key, which its signer holds;
// the seat number; key 0's fingerprint, a hash, never the one-time key itself), all of which go on
// chain anyway. A payer rebuilds the calls from them, shows what they make, and sends them:
//   - a wallet in this browser (main.mjs, "Build it")
//   - a wallet on another device, which opens the request as a link (#pay=…)
//   - later, perhaps, a relay that pays the gas. It would take the same request and rebuild the same
//     calls. None exists yet, and the page makes no call to one.
// A request carries no seeds and no calldata: a link that could name calls could make a wallet send
// anything. A wrong request builds a seat nobody can sign for; the payer loses its gas, and the device
// that made the request never sees it (it looks only at the addresses it worked out itself).
//
// A press can be paid for the same way, with a second kind of link: an approval the console has
// already signed, and recorded in its ledger before the link was made. It holds both signatures, the
// next key's fingerprint, and the Safe transaction's fields, but no hash: the paying page works out
// the Safe transaction hash from the fields itself, and the seat checks everything else. An approval
// isn't secret once it leaves (anyone who sees it sent can copy it), and it can do only what was
// signed. Until it lands, the console shares only that same approval again (core.begin, "resend").
//
// The same approval also has a compact form, for a QR code (sign-and-burn/approval-qr/v1, in
// "#aq=…"): the approval link is about 3,600 characters, more than one QR code holds. The compact form
// packs the same fields as bytes, the curve signature as its four parts, and writes them in base 43:
// characters a QR code's alphanumeric mode stores in 5.5 bits each, and a URL fragment carries as they
// are. About 3,650 characters, in a version 37 code. The page that opens it reads exactly what the
// approval link would give it, and checks it the same way.
//
// A third kind, for the wallet page: a Safe transaction waiting for votes, from one owner's device to
// another's (sign-and-burn/proposal/v1, in "#propose=…"). It holds the Safe and the transaction's
// fields, nothing signed and no hash. The other device's console works out the hash and what it does;
// the votes already cast are on chain, where that page reads them.
import { bytesToHex, decodeAbiParameters, encodeAbiParameters, getAddress, hexToBytes, parseAbiParameters, sha256 } from "viem";
import * as ch from "./chain.mjs";

export const TAG = "sign-and-burn/build/v1";
export const APPROVAL_TAG = "sign-and-burn/approval/v1";
export const PROPOSAL_TAG = "sign-and-burn/proposal/v1";
export const APPROVAL_QR_TAG = "sign-and-burn/approval-qr/v1";
const HEX32 = /^[0-9a-f]{64}$/;
const ADDR = /^0x[0-9a-f]{40}$/;
const UINT = /^(0|[1-9]\d{0,77})$/;
const ONE_TIME = 67 * 32;

// Signatures ride as base64url, which is shorter than hex in a link.
const b64 = (hex) => btoa(String.fromCharCode(...hexToBytes(hex))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function unb64(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s || "")) return null;
  try { return bytesToHex(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))); }
  catch { return null; }
}

/** The build request for this passkey's seat. */
export const request = (C, pk, home) => ({ tag: TAG, chain: C.id, x: pk.x.toLowerCase(), y: pk.y.toLowerCase(),
  seatNumber: home.seatNumber, firstKey: home.firstKey.toLowerCase() });

/** The request as a link to this page. It rides in the fragment, which the browser never sends to
 * the server. */
export function toLink(req, base) {
  const q = new URLSearchParams({ pay: req.tag, chain: String(req.chain), x: req.x, y: req.y, seat: String(req.seatNumber), key: req.firstKey });
  return `${base}#${q}`;
}

/** An approval the console signed (core.sign's answer, or its ledger entry), as a link: approval n
 * for the Safe transaction tx. */
export function approvalLink(C, n, a, tx, base) {
  const q = new URLSearchParams({ pay: APPROVAL_TAG, chain: String(C.id), seat: a.seat.toLowerCase(), safe: a.safe.toLowerCase(), n: String(n),
    to: tx.to.toLowerCase(), value: String(tx.value), data: (tx.data || "0x").toLowerCase(), op: String(tx.operation), nonce: String(tx.nonce),
    next: a.nextKey.toLowerCase(), ot: b64("0x" + a.oneTime.map((v) => v.slice(2)).join("")), sig: b64(a.curveSig) });
  return `${base}#${q}`;
}

/** A link's fragment -> null if it isn't a request to pay for something, else { req } or { refuse }.
 * Every field is checked for its exact shape; nothing in it is drawn as HTML. */
export function fromLink(hash, C) {
  if (/^#?aq=/.test(String(hash || ""))) return approvalQrFrom(String(hash).replace(/^#?aq=/, ""), C);
  const q = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (!q.has("pay")) return null;
  const tag = q.get("pay");
  if (tag !== TAG && tag !== APPROVAL_TAG) return { refuse: `This link asks for "${tag.slice(0, 40)}", which this page doesn't know. It knows ${TAG} and ${APPROVAL_TAG}.` };
  const chain = Number(q.get("chain"));
  if (chain !== C.id) return { refuse: `This link is for chain ${String(q.get("chain")).slice(0, 12)}. This page works on ${C.chain.name} (${C.id}) only.` };
  return tag === TAG ? buildFrom(q, chain) : approvalFrom(q, chain);
}

// ----------------------------------------------------------------------------- the compact approval
// Base 43: the QR alphanumeric set without space and "%", which a URL would escape. Two bytes make
// three characters (43^3 > 2^16), a last single byte two.
const B43 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:";
export function base43(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    let v = i + 1 < bytes.length ? bytes[i] * 256 + bytes[i + 1] : bytes[i];
    const n = i + 1 < bytes.length ? 3 : 2;
    for (let k = 0; k < n; k++) { out += B43[v % 43]; v = Math.floor(v / 43); }
  }
  return out;
}
export function unbase43(s) {
  if (s.length % 3 === 1) return null;
  const out = [];
  for (let i = 0; i < s.length; i += 3) {
    const part = s.slice(i, i + 3), digits = [...part].map((c) => B43.indexOf(c));
    if (digits.some((d) => d < 0)) return null;
    const v = digits.reduceRight((a, d) => a * 43 + d, 0);
    if (part.length === 3) { if (v > 0xffff) return null; out.push(v >> 8, v & 0xff); }
    else { if (v > 0xff) return null; out.push(v); }
  }
  return Uint8Array.from(out);
}

const CURVE = parseAbiParameters("bytes authenticatorData, string clientDataFields, uint256 r, uint256 s");

/** Approval n as a compact link for a QR code: { link, segments } (the link's start in byte mode, the
 * base-43 rest in alphanumeric mode), or null if the curve signature isn't in its canonical form. */
export function approvalQr(C, n, a, tx, base) {
  const bytes = packApproval(C, n, a, tx);
  if (!bytes) return null;
  const prefix = `${base}#aq=`, rest = base43(bytes);
  return { link: prefix + rest, segments: [{ mode: "byte", text: prefix }, { mode: "alnum", text: rest }] };
}

/** The approval's bytes: format 1 (approval-qr/v1, the fields alone), or format 2 (approval-qr/v2:
 * then the owners' own signatures of the Safe transaction, [{ owner, signature }], at most 10, each
 * 20 + 65 bytes). null if the curve signature isn't in its canonical form. */
function packApproval(C, n, a, tx, sigs = null) {
  let parts;
  try { parts = decodeAbiParameters(CURVE, a.curveSig); } catch { return null; }
  if (encodeAbiParameters(CURVE, parts).toLowerCase() !== a.curveSig.toLowerCase()) return null;
  const [ad, fields, r, s] = parts;
  const out = [];
  const put = (hex) => out.push(...hexToBytes(hex));
  const int = (v, len) => { const h = BigInt(v).toString(16).padStart(len * 2, "0"); if (h.length > len * 2) throw new Error("too big"); put("0x" + h); };
  const bytes = (b, lenBytes) => { int(b.length, lenBytes); out.push(...b); };
  const num = (v) => { const h = BigInt(v).toString(16), b = BigInt(v) ? hexToBytes("0x" + (h.length % 2 ? "0" : "") + h) : new Uint8Array(); bytes(b, 1); };
  out.push(sigs ? 2 : 1);
  int(C.id, 4); put(a.seat); put(a.safe); int(n, 8); put(a.nextKey);
  for (const v of a.oneTime) put(v);
  put(tx.to); num(tx.value); out.push(Number(tx.operation)); num(tx.nonce); bytes(hexToBytes(tx.data || "0x"), 2);
  bytes(hexToBytes(ad), 2); bytes(new TextEncoder().encode(fields), 2); int(r, 32); int(s, 32);
  if (sigs) {
    if (sigs.length > 10) throw new Error("at most 10 signatures");
    out.push(sigs.length);
    for (const g of sigs) { put(g.owner); put(g.signature); }
  }
  return Uint8Array.from(out);
}

/** The compact approval -> the same { req } the approval link gives, or { refuse }. */
function approvalQrFrom(s, C) {
  return unpackApproval(unbase43(decodeURIComponent(s.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"))), C, 1);
}

/** Bytes of format `format` (packApproval) -> { req } (with req.sigs for format 2), or { refuse }. */
function unpackApproval(b, C, format) {
  const again = " Ask for the code again.";
  if (!b || b[0] !== format) return { refuse: `This code isn't a ${format === 1 ? APPROVAL_QR_TAG : APPROVAL_PARTS_TAG} approval.` + again };
  let i = 1;
  const take = (n) => { if (i + n > b.length) throw new Error("short"); const x = b.slice(i, i + n); i += n; return x; };
  const hex = (n) => bytesToHex(take(n));
  const int = (n) => BigInt(hex(n));
  const lenThen = (lenBytes, max) => { const n = Number(int(lenBytes)); if (n > max) throw new Error("long"); return take(n); };
  const num = () => { const x = lenThen(1, 32); return x.length ? BigInt(bytesToHex(x)).toString() : "0"; };
  try {
    const chain = Number(int(4));
    if (chain !== C.id) return { refuse: `This code is for chain ${chain}. This page works on ${C.chain.name} (${C.id}) only.` };
    const seat = hex(20), safe = hex(20), n = int(8), nextKey = hex(32);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("n");
    const oneTime = Array.from({ length: 67 }, () => hex(32));
    const to = hex(20), value = num(), operation = take(1)[0], nonce = num(), data = bytesToHex(lenThen(2, 8192));
    if (operation > 1) return { refuse: "This code's operation is neither a call nor a delegatecall." + again };
    const ad = bytesToHex(lenThen(2, 1024)), fields = new TextDecoder("utf-8", { fatal: true }).decode(lenThen(2, 2048)), r = int(32), sv = int(32);
    let sigs = null;
    if (format === 2) {
      const k = take(1)[0];
      if (k > 10) throw new Error("too many signatures");
      sigs = Array.from({ length: k }, () => ({ owner: hex(20), signature: hex(65) }));
    }
    if (i !== b.length) throw new Error("trailing bytes");
    const curveSig = encodeAbiParameters(CURVE, [ad, fields, r, sv]);
    return { req: { tag: APPROVAL_TAG, chain, seat, safe, n: Number(n), nextKey, oneTime, curveSig,
      tx: { to, value, data, operation, nonce }, ...(sigs ? { sigs } : {}) } };
  } catch {
    return { refuse: "This code's approval isn't whole, or has bytes it shouldn't." + again };
  }
}

// ----------------------------------------------------------------------------- the approval in parts
// For the page's own scanner ("Scan a code" on the main page), the approval goes as several medium QR
// codes that cycle on screen, easier to read one by one than one dense code: format 2 above, with any
// Safe{Wallet} signatures, in base 43, cut into parts. Each part is QR alphanumeric text:
//   SAB2/<part>/<parts>/<id>/<base 43>
// id is the first 8 hex digits (in capitals) of the whole payload's SHA-256: parts of different
// approvals never mix, and the whole is checked once it is put together. A phone's own camera reads a
// part as plain text; only this page's scanner puts them together.
export const APPROVAL_PARTS_TAG = "sign-and-burn/approval-qr/v2";
const PART = /^SAB2\/(\d{1,2})\/(\d{1,2})\/([0-9A-F]{8})\/([0-9A-Z$*+\-./:]+)$/;
const partsId = (bytes) => sha256(bytes).slice(2, 10).toUpperCase();

/** The owners' signatures kept with a transaction waiting for votes (the wallet page's "sab.proposal",
 * imported from Safe{Wallet}), if they are for this same transaction. */
export function keptSigs(chainId, safe, tx) {
  let k = null;
  try { k = JSON.parse(localStorage.getItem("sab.proposal"))?.[`${chainId}:${safe.toLowerCase()}`]; } catch {}
  const same = k && ["to", "value", "data", "operation", "nonce"].every((f) => String(k[f] ?? "").toLowerCase() === String(tx[f] ?? "").toLowerCase());
  return same && Array.isArray(k.sigs) ? k.sigs.slice(0, 10) : [];
}

/** Approval n, with the owners' signatures that ride with it, as the texts of its parts. null if the
 * curve signature isn't canonical. */
export function approvalParts(C, n, a, tx, sigs = [], size = 800) {
  const bytes = packApproval(C, n, a, tx, sigs);
  if (!bytes) return null;
  const text = base43(bytes), id = partsId(bytes);
  const cut = Math.ceil(text.length / Math.ceil(text.length / size) / 3) * 3;   // whole 3-character groups, parts of even size
  const chunks = [];
  for (let i = 0; i < text.length; i += cut) chunks.push(text.slice(i, i + cut));
  return chunks.map((c, i) => `SAB2/${i + 1}/${chunks.length}/${id}/${c}`);
}

/** Puts scanned parts together. add(text) -> { part, parts } for a part, { done: { req } | { refuse } }
 * once the last one is in, or null for text that isn't a part. */
export function partCollector(C) {
  let id = null, total = 0;
  const got = new Map();
  return {
    get have() { return got.size; },
    get total() { return total; },
    add(text) {
      const m = PART.exec(String(text || "").trim());
      if (!m) return null;
      const [, i, n, pid, chunk] = m, k = Number(i), all = Number(n);
      if (!(all >= 1 && all <= 20 && k >= 1 && k <= all)) return null;
      if (pid !== id) { id = pid; total = all; got.clear(); }   // another approval's parts start over
      got.set(k, chunk);
      if (got.size < total) return { part: k, parts: total };
      const bytes = unbase43(Array.from({ length: total }, (_, j) => got.get(j + 1)).join(""));
      if (!bytes || partsId(bytes) !== id) return { done: { refuse: "The parts didn't put together into the approval they name. Scan them again." } };
      return { done: unpackApproval(bytes, C, 2) };
    },
  };
}

// ----------------------------------------------------------------------------- from Safe{Wallet}
// A transaction proposed in Safe{Wallet} lives on Safe's transaction service, with the owners' off-chain
// signatures, not on chain. The page doesn't fetch from it: its policy lets it reach the RPC only. You
// open the service's URL yourself (safeWalletUrl), and paste what it answers. That text is untrusted:
// each field is checked for its shape here; the console works out the hash from the fields and the
// page compares it with the one pasted; each signature must recover to an owner (chain.signerOf).
export const SAFE_SERVICE = "https://api.safe.global/tx-service/basesep/api/v1";
export const safeWalletUrl = (safe) => `${SAFE_SERVICE}/safes/${getAddress(safe)}/multisig-transactions/?executed=false`;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/** The service's answer (its list, or one transaction) -> [{ tx, safeTxHash, sigs }] for this Safe,
 * lowest nonce first. Throws, in plain words, if it isn't that. Transactions that pay a gas refund
 * are refused: this page makes and runs only those without one, as Safe{Wallet} makes them. */
export function fromSafeWallet(text, safe) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error("That isn't JSON. Copy the whole page the link shows."); }
  const list = Array.isArray(o?.results) ? o.results : o && typeof o === "object" ? [o] : [];
  if (!list.length) throw new Error("That has no transactions in it: nothing is waiting in Safe{Wallet}.");
  if (list.length > 50) throw new Error("That has more than 50 transactions.");
  const out = [];
  for (const t of list) {
    const str = (k) => (t[k] === null || t[k] === undefined ? "" : String(t[k])).toLowerCase();
    const uint = (k) => UINT.test(str(k));
    if (t.safe !== undefined && str("safe") !== safe.toLowerCase()) throw new Error(`That is for another Safe (${String(t.safe).slice(0, 42)}).`);
    if (t.isExecuted === true) continue;
    if (!ADDR.test(str("to"))) throw new Error("A transaction's recipient isn't an address. Nothing was imported.");
    if (!uint("value") || !uint("nonce") || Number(str("nonce")) > Number.MAX_SAFE_INTEGER) throw new Error("A transaction's value or nonce isn't a number. Nothing was imported.");
    const data = str("data") || "0x";
    if (!/^0x([0-9a-f]{2}){0,8192}$/.test(data)) throw new Error("A transaction's data isn't hex bytes. Nothing was imported.");
    if (str("operation") !== "0" && str("operation") !== "1") throw new Error("A transaction's operation is neither a call nor a delegatecall. Nothing was imported.");
    for (const k of ["safeTxGas", "baseGas", "gasPrice"]) if (str(k) && str(k) !== "0") throw new Error(`A transaction sets ${k}: it pays a gas refund, which this page doesn't run. Nothing was imported.`);
    for (const k of ["gasToken", "refundReceiver"]) if (str(k) && str(k) !== ZERO_ADDR) throw new Error(`A transaction sets ${k}: it pays a gas refund, which this page doesn't run. Nothing was imported.`);
    if (!HEX32.test(str("safeTxHash").replace(/^0x/, "")) || !str("safeTxHash").startsWith("0x")) throw new Error("A transaction has no Safe transaction hash. Nothing was imported.");
    const sigs = [];
    for (const c of (Array.isArray(t.confirmations) ? t.confirmations : []).slice(0, 20)) {
      const owner = String(c?.owner || "").toLowerCase(), signature = String(c?.signature || "").toLowerCase();
      if (ADDR.test(owner) && /^0x[0-9a-f]{130}$/.test(signature)) sigs.push({ owner, signature });
    }
    out.push({ tx: { to: str("to"), value: str("value"), data, operation: Number(str("operation")), nonce: str("nonce") }, safeTxHash: str("safeTxHash"), sigs });
  }
  if (!out.length) throw new Error("Every transaction in that has run already.");
  return out.sort((x, y) => Number(x.tx.nonce) - Number(y.tx.nonce));
}

/** A Safe transaction waiting for votes, as a link to the wallet page. */
export function proposalLink(C, safe, tx, base) {
  const q = new URLSearchParams({ propose: PROPOSAL_TAG, chain: String(C.id), safe: safe.toLowerCase(), to: tx.to.toLowerCase(), value: String(tx.value),
    data: (tx.data || "0x").toLowerCase(), op: String(tx.operation), nonce: String(tx.nonce) });
  return `${base}#${q}`;
}

/** A link's fragment -> null if it isn't a proposal, else { req: { safe, tx } } or { refuse }. */
export function proposalFrom(hash, C) {
  const q = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (!q.has("propose")) return null;
  const tag = q.get("propose");
  if (tag !== PROPOSAL_TAG) return { refuse: `This link asks for "${tag.slice(0, 40)}", which this page doesn't know. It knows ${PROPOSAL_TAG}.` };
  if (Number(q.get("chain")) !== C.id) return { refuse: `This link is for chain ${String(q.get("chain")).slice(0, 12)}. This page works on ${C.chain.name} (${C.id}) only.` };
  const get = (k) => (q.get(k) || "").toLowerCase();
  const again = " Ask for the link again.";
  if (!ADDR.test(get("safe"))) return { refuse: "This link's Safe isn't an address." + again };
  const bad = txFields(get, again);
  if (bad) return { refuse: bad };
  return { req: { tag: PROPOSAL_TAG, chain: C.id, safe: get("safe"), tx: { to: get("to"), value: get("value"), data: get("data"), operation: Number(get("op")), nonce: get("nonce") } } };
}

/** The Safe transaction's fields in a link, each checked for its exact shape. -> why not, or "". */
function txFields(get, again) {
  if (!ADDR.test(get("to"))) return "This link's recipient isn't an address." + again;
  if (!UINT.test(get("value")) || !UINT.test(get("nonce"))) return "This link's value or nonce isn't a number." + again;
  if (!/^0x([0-9a-f]{2}){0,8192}$/.test(get("data"))) return "This link's call data isn't hex bytes." + again;
  if (get("op") !== "0" && get("op") !== "1") return "This link's operation is neither a call nor a delegatecall." + again;
  return "";
}

function approvalFrom(q, chain) {
  const get = (k) => (q.get(k) || "").toLowerCase();
  const again = " Ask for the link again.";
  if (!ADDR.test(get("seat")) || !ADDR.test(get("safe")) || !ADDR.test(get("to"))) return { refuse: "This link's seat, Safe or recipient isn't an address." + again };
  if (!/^(0|[1-9]\d{0,18})$/.test(get("n")) || !UINT.test(get("value")) || !UINT.test(get("nonce"))) return { refuse: "This link's key number, value or nonce isn't a number." + again };
  if (!/^0x([0-9a-f]{2}){0,8192}$/.test(get("data"))) return { refuse: "This link's call data isn't hex bytes." + again };
  if (get("op") !== "0" && get("op") !== "1") return { refuse: "This link's operation is neither a call nor a delegatecall." + again };
  if (!/^0x[0-9a-f]{64}$/.test(get("next"))) return { refuse: "This link's next key isn't a 32-byte fingerprint." + again };
  const ot = unb64(q.get("ot")), sig = unb64(q.get("sig"));
  if (!ot || ot.length !== 2 + 2 * ONE_TIME) return { refuse: "This link's one-time signature isn't 67 values of 32 bytes." + again };
  if (!sig || sig.length < 4 || sig.length > 2 + 2 * 4096) return { refuse: "This link's passkey signature isn't there, or is far too long." + again };
  const oneTime = Array.from({ length: 67 }, (_, j) => "0x" + ot.slice(2 + 64 * j, 66 + 64 * j));
  return { req: { tag: APPROVAL_TAG, chain, seat: get("seat"), safe: get("safe"), n: Number(get("n")), nextKey: get("next"), oneTime, curveSig: sig,
    tx: { to: get("to"), value: get("value"), data: get("data"), operation: Number(get("op")), nonce: get("nonce") } } };
}

function buildFrom(q, chain) {
  const x = (q.get("x") || "").toLowerCase(), y = (q.get("y") || "").toLowerCase();
  const seat = q.get("seat") || "", key = (q.get("key") || "").toLowerCase();
  if (!HEX32.test(x) || !HEX32.test(y)) return { refuse: "This link's passkey public key isn't two 32-byte numbers. Ask for the link again." };
  if (!/^(0|[1-9]\d{0,9})$/.test(seat) || Number(seat) > 0xffffffff) return { refuse: "This link's seat number isn't a number. Ask for the link again." };
  if (!/^0x[0-9a-f]{64}$/.test(key) || /^0x0{64}$/.test(key)) return { refuse: "This link's first key isn't a 32-byte fingerprint. Ask for the link again." };
  return { req: { tag: TAG, chain, x, y, seatNumber: Number(seat), firstKey: key } };
}

/** What a request builds, worked out here from the chain: the passkey's signer (Safe's signer factory
 * names it), the seat (the SeatFactory, or a simulation before it exists), the Safe; whether it is
 * built already; and the calls that build it. */
export async function resolve(C, req) {
  const pk = { x: req.x, y: req.y };
  const signer = getAddress(await ch.signerAddress(C, pk));
  const seat = getAddress(await ch.seatAddress(C, signer, req.seatNumber, req.firstKey));
  const safe = getAddress(await ch.safeAddress(C, seat));
  const built = (await ch.hasCode(C, seat)) && (await ch.hasCode(C, safe));
  const calls = built ? [] : await ch.buildCalls(C, { pk, signer, seatNumber: req.seatNumber, firstKey: req.firstKey, seat });
  return { signer, seat, safe, built, calls };
}
