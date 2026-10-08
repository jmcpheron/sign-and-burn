// Checks reference/vectors/v1.json against the JavaScript reference: node reference/js/test-vectors.mjs
import { readFileSync } from "node:fs";
import * as sb from "./sign-and-burn.mjs";

const V = JSON.parse(readFileSync(new URL("../vectors/v1.json", import.meta.url), "utf8"));
const b = (s) => Buffer.from(s.slice(2), "hex"), hex = (x) => "0x" + x.toString("hex");
let fails = 0;
const check = (c, what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL ${c}: ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};

for (const v of V.cases) {
  const name = v.name, pub = b(v.pubSeed), n = BigInt(v.n), chain = BigInt(v.chainId), seatNo = BigInt(v.seatNumber), m = b(v.m), seed = b(v.seed), sig = v.signature.map(b);
  const ends = Array.from({ length: sb.CHAINS }, (_, j) => sb.chainEnd(pub, n, j, seed));
  check(name, "pubSeed", hex(sb.pubSeed(chain, b(v.curveSigner), seatNo)), v.pubSeed);
  check(name, "prfSalt", hex(sb.prfSalt(chain, b(v.curveSigner), seatNo, n)), v.prfSalt);
  check(name, "secret0", hex(sb.secret(seed, 0)), v.secret0);
  check(name, "secret66", hex(sb.secret(seed, 66)), v.secret66);
  check(name, "step0", hex(sb.step(pub, n, 0, 0, sb.secret(seed, 0))), v.step0);
  check(name, "end0", hex(ends[0]), v.end0);
  check(name, "end66", hex(ends[66]), v.end66);
  check(name, "key", hex(sb.fingerprintOfEnds(pub, n, ends)), v.key);
  check(name, "nextKey", hex(sb.keyFingerprint(pub, n + 1n, b(v.nextSeed))), v.nextKey);
  const c = sb.approvalHash(chain, b(v.seat), b(v.safe), n, b(v.safeTxHash));
  check(name, "c", hex(c), v.c);
  if (name !== "message-all-zero" && name !== "message-all-ones") check(name, "m", hex(sb.oneTimeMessage(c, b(v.nextKey))), v.m);
  check(name, "digits", sb.digits(m), v.digits);
  check(name, "signature", sb.sign(pub, n, seed, m).map(hex), v.signature);
  check(name, "recover", hex(sb.recover(pub, n, m, sig)), v.key);
  for (const r of v.refused) {
    const sig2 = [...sig];
    if ("index" in r) sig2[r.index] = Buffer.alloc(32);
    check(name, "refused: " + r.what, hex(sb.recover(pub, r.n ? BigInt(r.n) : n, r.m ? b(r.m) : m, sig2)) !== v.key, true);
  }
  check(name, "signature length", sig.length * 32, V.parameters.signatureBytes);
}
console.log(`javascript reference: ${V.cases.length} cases, ${fails} failures`);
process.exit(fails ? 1 : 0);
