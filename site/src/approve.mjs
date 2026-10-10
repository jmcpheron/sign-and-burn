// One press, as the console rules it (KICKOFF.md, "The guardrail"), for both pages:
// the console builds c and the salts (or hands back an approval already signed for key n) → one tap
// → the console signs with key n and records it → the seat is asked, by simulation → the wallet
// sends → the block, and the seat says where approval n landed.
import * as consoleCore from "./console.mjs";
import * as P from "./passkey.mjs";
import * as ch from "./chain.mjs";
import { eth, short } from "./ui.mjs";

/** seat and safe as just read from the chain. wallet: one that can pay the gas, or null, and the
 * approval waits in the ledger, to go out as a link. others: owners whose votes the Safe already
 * holds for this transaction, so the Safe can run it in the same transaction. say(text): what is
 * happening now.
 * -> { n, a, signed, review } and, once sent, { hash, theirs }. Throws, in plain words, on a refusal. */
export async function approve({ C, pk, seat, safe, tx, wallet, others = [], say }) {
  const n = seat.n;
  const req = { chainId: C.id, seat: { address: seat.address, curveSigner: seat.curveSigner, seatNumber: seat.seatNumber, n, current: seat.current },
    safe: safe.address, tx };
  const begin = consoleCore.ask({ op: "begin", ...req });
  if (!begin.ok) throw new Error(begin.refuse);
  let a = begin.resend, signed = null;
  // A key burned on an approval the Safe can't run helps nobody: fund it first.
  if (!a && BigInt(tx.value || 0) > safe.balance) throw new Error(`The Safe has ${eth(safe.balance)}, and this sends ${eth(BigInt(tx.value))}. Fund it first. Nothing was signed.`);
  if (!a) {
    say(`One tap: your passkey signs c, and its PRF makes the seeds of keys ${n} and ${n + 1}…`);
    const t = await P.tap(pk, begin.c, begin.salts);
    say(`The console signs with key ${n}, and names key ${n + 1}…`);
    signed = consoleCore.ask({ op: "sign", ...req, passkey: t.passkey, seeds: t.seeds });
    t.seeds.length = 0;
    if (!signed.ok) throw new Error(signed.refuse);
    a = signed.approval;
  }
  const out = { n, a, signed, review: begin.review };
  say("Asking the seat, without sending anything…");
  const why = await ch.trySeat(C, a.seat, [a.safe, a.safeTxHash, a.nextKey, a.oneTime, a.curveSig], wallet?.account);
  if (why) throw new Error(`The seat would refuse this approval (${why}). The console keeps it, and will only ever send this one for key ${n}.`);
  // No wallet: the approval waits in the ledger (a share needs a fresh tap, so it can't happen here,
  // after the passkey's).
  if (!wallet) return out;
  say("Your wallet sends it. It pays gas, and approves nothing…");
  const hash = await ch.send(C, wallet, ch.approveCalls(a, tx, others));
  consoleCore.ask({ op: "sent", chainId: C.id, seat: a.seat, n, txHash: hash });
  say("Waiting for the block…");
  const r = await ch.receipt(C, hash);
  // The receipt doesn't say whether the approval landed; the seat does. Anyone could copy the approve
  // call from the mempool and send it first (it can only do what was signed): then this transaction
  // reverts, and approval n is on chain in theirs. A smart-account wallet's wrapper may also hide a
  // revert behind a success. So ask the seat where approval n landed, if it did.
  const landed = await ch.approvalOnChain(C, a.seat, n);
  if (!landed) throw new Error(`The transaction ${r.status === "reverted" ? "reverted" : "went through"} (${short(hash, 10, 6)}), but approval ${n} didn't land: ` +
    `the seat is still at key ${n}. The console keeps the approval, and will only ever send this one for key ${n}.`);
  const theirs = !!landed.txHash && landed.txHash.toLowerCase() !== hash.toLowerCase();
  if (theirs) consoleCore.ask({ op: "sent", chainId: C.id, seat: a.seat, n, txHash: landed.txHash });
  return { ...out, hash: landed.txHash || hash, theirs };
}
