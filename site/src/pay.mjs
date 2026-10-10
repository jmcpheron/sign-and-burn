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
// A third kind, for the wallet page: a Safe transaction waiting for votes, from one owner's device to
// another's (sign-and-burn/proposal/v1, in "#propose=…"). It holds the Safe and the transaction's
// fields, nothing signed and no hash. The other device's console works out the hash and what it does;
// the votes already cast are on chain, where that page reads them.
import { bytesToHex, getAddress, hexToBytes } from "viem";
import * as ch from "./chain.mjs";

export const TAG = "sign-and-burn/build/v1";
export const APPROVAL_TAG = "sign-and-burn/approval/v1";
export const PROPOSAL_TAG = "sign-and-burn/proposal/v1";
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
  const q = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (!q.has("pay")) return null;
  const tag = q.get("pay");
  if (tag !== TAG && tag !== APPROVAL_TAG) return { refuse: `This link asks for "${tag.slice(0, 40)}", which this page doesn't know. It knows ${TAG} and ${APPROVAL_TAG}.` };
  const chain = Number(q.get("chain"));
  if (chain !== C.id) return { refuse: `This link is for chain ${String(q.get("chain")).slice(0, 12)}. This page works on ${C.chain.name} (${C.id}) only.` };
  return tag === TAG ? buildFrom(q, chain) : approvalFrom(q, chain);
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
