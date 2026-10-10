// The page's own JavaScript, without a browser: src/wots.mjs against reference/vectors/v1.json, the
// danger case's forgery against a throwaway key, finding an approval inside a wallet's transaction,
// the links another device pays from (a build, an approval), the votes and owner changes the wallet page
// sends, and console/cfg.py against what the page reads.
//   cd site && npm ci && node test.mjs
import { readFileSync } from "node:fs";
import * as w from "./src/wots.mjs";
import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";
import { MULTICALL_ABI, SAFE_ABI, approveCalls, execData, findApprove, ownerTx, parseCfg } from "./src/chain.mjs";
import * as pay from "./src/pay.mjs";

let fails = 0;
const check = (what, ok) => { if (!ok) { fails++; console.log("FAIL", what); } };
const V = JSON.parse(readFileSync(new URL("../reference/vectors/v1.json", import.meta.url), "utf8"));
for (const v of V.cases) {
  const pub = w.pubSeed(v.chainId, v.curveSigner, v.seatNumber), seed = w.bytes(v.seed), m = w.bytes(v.m), n = BigInt(v.n);
  check(`${v.name}: pubSeed`, w.hex(pub) === v.pubSeed);
  check(`${v.name}: key`, w.hex(w.keyFingerprint(pub, n, seed)) === v.key);
  check(`${v.name}: digits`, JSON.stringify(w.digits(m)) === JSON.stringify(v.digits));
  const sig = w.sign(pub, n, seed, m);
  check(`${v.name}: signature`, JSON.stringify(sig.map(w.hex)) === JSON.stringify(v.signature));
  check(`${v.name}: recover`, w.hex(w.recover(pub, n, m, sig)) === v.key);
}
console.log(`wots.mjs: ${V.cases.length} vectors`);

// The danger case, as the attack room runs it: four signatures with one throwaway key, then a forgery
// for a message nobody signed, which checks out against the key.
const pub = w.pubSeed(84532, "0x" + "11".repeat(20), 0), seed = w.h(new TextEncoder().encode("throwaway")), n = 0n;
const key = w.keyFingerprint(pub, n, seed);
const ms = [1, 2, 3, 4].map((i) => w.h(new TextEncoder().encode("message " + i)));
const low = w.lowest(ms.map((m) => w.sign(pub, n, seed, m)), ms);
const got = w.forge(pub, n, low, (t) => w.h(new TextEncoder().encode("forged " + t)));
check("a forgery from four signatures", got && w.hex(w.recover(pub, n, got.m, got.sig)) === w.hex(key));
console.log(`danger case: forged after ${got?.tries} tries (estimated chance per try ${w.chance(low).toExponential(1)})`);

// The attack room reads an approval's revealed signature from the transaction that carried it, however
// the wallet wrapped the page's Multicall3 call: as is, or inside a smart account's own call (EIP-7702
// wallets send through a delegation manager's redeemDelegations).
const a = { seat: "0x" + "33".repeat(20), safe: "0x" + "44".repeat(20), safeTxHash: "0x" + "ab".repeat(32), nextKey: "0x" + "cd".repeat(32),
  oneTime: Array.from({ length: 67 }, (_, j) => "0x" + j.toString(16).padStart(64, "0")), curveSig: "0x" + "ee".repeat(300) };
const multicall = encodeFunctionData({ abi: MULTICALL_ABI, functionName: "aggregate3", args: [approveCalls(a, { to: a.safe, value: "1", data: "0x", operation: 0 })] });
const wrapped = encodeFunctionData({ abi: parseAbi(["function redeemDelegations(bytes[] delegations, bytes32[] modes, bytes[] executions)"]),
  functionName: "redeemDelegations", args: [["0x" + "99".repeat(97)], ["0x" + "00".repeat(32)], ["0x" + "11".repeat(52) + multicall.slice(2)]] });
const event = { safeTxHash: a.safeTxHash, nextKey: a.nextKey };
for (const [what, input] of [["a plain Multicall3 call", multicall], ["a smart account's wrapper", wrapped]]) {
  const got = findApprove(input, event);
  check(`the approval inside ${what}`, got && got[3][66] === a.oneTime[66] && got[4] === a.curveSig);
}
check("not an approval with another next key", findApprove(wrapped, { ...event, nextKey: "0x" + "00".repeat(32) }) === null);
console.log("findApprove: plain and wrapped");

// The build request a phone shares so another device's wallet pays the gas: it survives the trip as a
// link, and a link of any other shape is refused with a reason, never half-read.
const C = { id: 84532, chain: { name: "Base Sepolia" } };
const req = pay.request(C, { x: "AB".repeat(32), y: "cd".repeat(32) }, { seatNumber: 3, firstKey: "0x" + "Ef".repeat(32) });
const link = pay.toLink(req, "https://signandburn.app/");
check("a build link round-trips", JSON.stringify(pay.fromLink(new URL(link).hash, C).req) === JSON.stringify(req));
check("a build link holds no seeds and no calls", !/seed|call|0x[0-9a-f]{40}(?![0-9a-f])/i.test(link.replace(req.firstKey, "")));
check("not a build link: the page's own anchors", pay.fromLink("#how", C) === null && pay.fromLink("", C) === null);
const bad = (what, f) => { const q = new URLSearchParams(new URL(link).hash.slice(1)); f(q); check(`refused: ${what}`, !!pay.fromLink("#" + q, C)?.refuse); };
bad("another tag", (q) => q.set("pay", "sign-and-burn/build/v2"));
bad("another chain", (q) => q.set("chain", "1"));
bad("a short public key", (q) => q.set("x", "ab".repeat(31)));
bad("a seat number that isn't one", (q) => q.set("seat", "1e3"));
bad("a seat number past uint32", (q) => q.set("seat", "4294967296"));
bad("a first key of zeros", (q) => q.set("key", "0x" + "00".repeat(32)));
bad("a first key with markup", (q) => q.set("key", "<b>" + "0".repeat(61)));
console.log("build links: round trip, and seven refusals");

// An approval the console signed, as a link: every signature byte survives, and it holds no hash.
const tx = { to: "0x" + "0b".repeat(20), value: "30000000000000", data: "0x", operation: 0, nonce: "7" };
const alink = pay.approvalLink(C, 5, a, tx, "https://signandburn.app/");
const back = pay.fromLink(new URL(alink).hash, C).req;
check("an approval link round-trips", back && back.n === 5 && back.seat === a.seat && back.safe === a.safe && back.nextKey === a.nextKey &&
  JSON.stringify(back.oneTime) === JSON.stringify(a.oneTime) && back.curveSig === a.curveSig && JSON.stringify(back.tx) === JSON.stringify(tx));
check("an approval link holds no Safe transaction hash", !alink.includes(a.safeTxHash.slice(2)));
const badA = (what, f) => { const q = new URLSearchParams(new URL(alink).hash.slice(1)); f(q); check(`refused: ${what}`, !!pay.fromLink("#" + q, C)?.refuse); };
badA("a one-time signature one value short", (q) => q.set("ot", q.get("ot").slice(0, -43)));
badA("a signature that isn't base64url", (q) => q.set("sig", "<script>"));
badA("a recipient that isn't an address", (q) => q.set("to", "0x1234"));
badA("data that isn't hex bytes", (q) => q.set("data", "0xabc"));
badA("an operation that is neither", (q) => q.set("op", "2"));
badA("a value that isn't a number", (q) => q.set("value", "-1"));
console.log(`approval links: round trip (${alink.length} characters), and six refusals`);

// A transaction waiting for votes, from one owner's device to another's: the Safe and the fields
// survive the trip, it holds no hash, and a link of any other shape is refused.
const plink = pay.proposalLink(C, a.safe, tx, "https://signandburn.app/wallet.html");
const pback = pay.proposalFrom(new URL(plink).hash, C).req;
check("a proposal link round-trips", pback && pback.safe === a.safe && JSON.stringify(pback.tx) === JSON.stringify(tx));
check("a proposal link holds no hash and nothing signed", !plink.includes(a.safeTxHash.slice(2)) && !/[?&#](sig|ot|next|seat)=/.test(plink));
check("not a proposal: a payment link, or the page's own anchors", pay.proposalFrom(new URL(alink).hash, C) === null && pay.proposalFrom("#how", C) === null);
check("a payment link isn't a proposal either way", pay.fromLink(new URL(plink).hash, C) === null);
const badP = (what, f) => { const q = new URLSearchParams(new URL(plink).hash.slice(1)); f(q); check(`refused: ${what}`, !!pay.proposalFrom("#" + q, C)?.refuse); };
badP("another tag", (q) => q.set("propose", "sign-and-burn/proposal/v2"));
badP("another chain", (q) => q.set("chain", "1"));
badP("a Safe that isn't an address", (q) => q.set("safe", "0x1234"));
badP("a recipient with markup", (q) => q.set("to", "<b>"));
badP("data that isn't hex bytes", (q) => q.set("data", "0xabc"));
badP("an operation that is neither", (q) => q.set("op", "2"));
badP("a nonce that isn't a number", (q) => q.set("nonce", "1e3"));
console.log("proposal links: round trip, and seven refusals");

// Votes: one pre-approved signature (r = owner, s = 0, v = 1) per owner, in ascending order, as Safe
// wants. With only the seat's, the press is what it always was.
const lo = "0x" + "0a".repeat(20), hi = "0x" + "f0".repeat(20);
const sigs = (data) => decodeFunctionData({ abi: SAFE_ABI, data }).args[9];
const vote = (o) => o.slice(2).padStart(64, "0") + "00".repeat(32) + "01";
check("votes in ascending order of owner", sigs(execData(tx, [hi, lo, hi.toUpperCase().replace("0X", "0x")])) === "0x" + vote(lo) + vote(hi));
check("a press with no other votes: the seat's alone", sigs(approveCalls(a, tx)[1].callData) === "0x" + vote(a.seat));
check("a press with another vote carries both", sigs(approveCalls(a, tx, [lo])[1].callData) === "0x" + vote(lo) + vote(a.seat));
// Owner changes: removing one names the owner before it in the Safe's list (the sentinel for the first).
const owners = [a.seat, lo, hi], safe = a.safe;
const call = (t) => decodeFunctionData({ abi: SAFE_ABI, data: t.data });
const add = ownerTx(safe, 4, { add: lo, threshold: 1 });
check("add an owner", add.to === safe && add.nonce === "4" && add.value === "0" && add.operation === 0 &&
  call(add).functionName === "addOwnerWithThreshold" && call(add).args[0].toLowerCase() === lo && call(add).args[1] === 1n);
check("remove the first owner: after the sentinel", JSON.stringify(call(ownerTx(safe, 4, { remove: a.seat, owners, threshold: 1 })).args.map(String).map((x) => x.toLowerCase())) ===
  JSON.stringify(["0x0000000000000000000000000000000000000001", a.seat, "1"]));
check("remove a later owner: after the one before it", call(ownerTx(safe, 4, { remove: hi, owners, threshold: 2 })).args[0].toLowerCase() === lo);
check("change the threshold", call(ownerTx(safe, 4, { threshold: 2 })).functionName === "changeThreshold");
let threw = false;
try { ownerTx(safe, 4, { remove: "0x" + "77".repeat(20), owners, threshold: 1 }); } catch { threw = true; }
check("refused: removing an address that isn't an owner", threw);
console.log("votes and owner changes: order, the press, add, remove, threshold");

const cfg = parseCfg(readFileSync(new URL("../console/cfg.py", import.meta.url), "utf8"));
const dep = JSON.parse(readFileSync(new URL("../contracts/deployment.json", import.meta.url), "utf8"));
check("cfg.py: Base Sepolia only", JSON.stringify(Object.keys(cfg.chains)) === '["84532"]');
check("cfg.py's seatFactory is deployment.json's", cfg.seatFactory === dep.SeatFactory.address.toLowerCase());
check("cfg.py's CREATE2 deployer is deployment.json's", cfg.create2Deployer === dep.create2Deployer.toLowerCase());
console.log(fails ? `FAILED: ${fails}` : "all pass");
process.exit(fails ? 1 : 0);
