// The page's own JavaScript, without a browser: src/wots.mjs against reference/vectors/v1.json, the
// danger case's forgery against a throwaway key, finding an approval inside a wallet's transaction,
// the build link another device pays from, and console/cfg.py against what the page reads.
//   cd site && npm ci && node test.mjs
import { readFileSync } from "node:fs";
import * as w from "./src/wots.mjs";
import { encodeFunctionData, parseAbi } from "viem";
import { MULTICALL_ABI, approveCalls, findApprove, parseCfg } from "./src/chain.mjs";
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

const cfg = parseCfg(readFileSync(new URL("../console/cfg.py", import.meta.url), "utf8"));
const dep = JSON.parse(readFileSync(new URL("../contracts/deployment.json", import.meta.url), "utf8"));
check("cfg.py: Base Sepolia only", JSON.stringify(Object.keys(cfg.chains)) === '["84532"]');
check("cfg.py's seatFactory is deployment.json's", cfg.seatFactory === dep.SeatFactory.address.toLowerCase());
check("cfg.py's CREATE2 deployer is deployment.json's", cfg.create2Deployer === dep.create2Deployer.toLowerCase());
console.log(fails ? `FAILED: ${fails}` : "all pass");
process.exit(fails ? 1 : 0);
