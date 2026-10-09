// Who pays the gas for the build. Building a shielded Safe takes one transaction, and nothing in it is
// approved by whoever sends it: anyone may deploy the SeatFactory, a passkey's signer, a seat and its
// Safe. So the device that holds the passkey doesn't need a wallet. It hands out a build request: the
// few public values the calls are made from (the passkey's public key, the seat number, key 0's
// fingerprint), all of which go on chain anyway. A payer rebuilds the calls from them, shows what they
// make, and sends them:
//   - a wallet in this browser (main.mjs, "Build it")
//   - a wallet on another device, which opens the request as a link (#pay=…)
//   - later, perhaps, a relay that pays the gas. It would take the same request and rebuild the same
//     calls. None exists yet, and the page makes no call to one.
// A request carries no seeds and no calldata: a link that could name calls could make a wallet send
// anything. A wrong request builds a seat nobody can sign for; the payer loses its gas, and the device
// that made the request never sees it (it looks only at the addresses it worked out itself).
import { getAddress } from "viem";
import * as ch from "./chain.mjs";

export const TAG = "sign-and-burn/build/v1";
const HEX32 = /^[0-9a-f]{64}$/;

/** The build request for this passkey's seat. */
export const request = (C, pk, home) => ({ tag: TAG, chain: C.id, x: pk.x.toLowerCase(), y: pk.y.toLowerCase(),
  seatNumber: home.seatNumber, firstKey: home.firstKey.toLowerCase() });

/** The request as a link to this page. It rides in the fragment, which the browser never sends to
 * the server. */
export function toLink(req, base) {
  const q = new URLSearchParams({ pay: req.tag, chain: String(req.chain), x: req.x, y: req.y, seat: String(req.seatNumber), key: req.firstKey });
  return `${base}#${q}`;
}

/** A link's fragment -> null if it isn't a build request, else { req } or { refuse }. Every field is
 * checked for its exact shape; nothing in it is drawn as HTML. */
export function fromLink(hash, C) {
  const q = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (!q.has("pay")) return null;
  if (q.get("pay") !== TAG) return { refuse: `This link asks for "${q.get("pay").slice(0, 40)}", which this page doesn't know. It knows ${TAG}.` };
  const chain = Number(q.get("chain")), x = (q.get("x") || "").toLowerCase(), y = (q.get("y") || "").toLowerCase();
  const seat = q.get("seat") || "", key = (q.get("key") || "").toLowerCase();
  if (chain !== C.id) return { refuse: `This link is for chain ${String(q.get("chain")).slice(0, 12)}. This page builds on ${C.chain.name} (${C.id}) only.` };
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
