// The page's own JavaScript, without a browser: src/wots.mjs against reference/vectors/v1.json, the
// danger case's forgery against a throwaway key, and console/cfg.py against what the page reads.
//   cd site && npm ci && node test.mjs
import { readFileSync } from "node:fs";
import * as w from "./src/wots.mjs";
import { parseCfg } from "./src/chain.mjs";

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

const cfg = parseCfg(readFileSync(new URL("../console/cfg.py", import.meta.url), "utf8"));
const dep = JSON.parse(readFileSync(new URL("../contracts/deployment.json", import.meta.url), "utf8"));
check("cfg.py: Base Sepolia only", JSON.stringify(Object.keys(cfg.chains)) === '["84532"]');
check("cfg.py's seatFactory is deployment.json's", cfg.seatFactory === dep.SeatFactory.address.toLowerCase());
check("cfg.py's CREATE2 deployer is deployment.json's", cfg.create2Deployer === dep.create2Deployer.toLowerCase());
console.log(fails ? `FAILED: ${fails}` : "all pass");
process.exit(fails ? 1 : 0);
