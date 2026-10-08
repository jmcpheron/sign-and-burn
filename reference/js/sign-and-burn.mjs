// Sign and Burn: the one-time keys and messages, v1. The same as reference/python/sign_and_burn.py,
// byte for byte (reference/vectors/v1.json). Node's own crypto, no packages. Byte strings are Buffers.
import { createHash } from "node:crypto";

export const STEPS = 15, MSG_CHAINS = 64, CHAINS = 67;
const tag = (s) => Buffer.from(s, "ascii");
const TAG_SEED = tag("sign-and-burn/seed/v1"), TAG_PRF = tag("sign-and-burn/prf/v1"), TAG_SK = tag("sign-and-burn/sk/v1");
const TAG_APPROVE = tag("sign-and-burn/approve/v1"), TAG_ONE_TIME = tag("sign-and-burn/one-time/v1");

export const h = (...parts) => createHash("sha256").update(Buffer.concat(parts)).digest();
export const u = (value, size) => {
  let v = BigInt(value);
  if (v < 0n || v >= 1n << BigInt(8 * size)) throw new Error(`${value} does not fit ${size} bytes`);
  const b = Buffer.alloc(size);
  for (let i = size - 1; i >= 0; i--, v >>= 8n) b[i] = Number(v & 255n);
  return b;
};
const need = (name, b, size) => {
  if (!Buffer.isBuffer(b) || b.length !== size) throw new Error(`${name} must be ${size} bytes`);
  return b;
};

export const pubSeed = (chainId, curveSigner, seatNumber) => h(TAG_SEED, u(chainId, 32), need("curveSigner", curveSigner, 20), u(seatNumber, 4));
// The label the page gives the passkey's PRF for key n. The passkey's answer is seed(n).
export const prfSalt = (chainId, curveSigner, seatNumber, n) => h(TAG_PRF, u(chainId, 32), need("curveSigner", curveSigner, 20), u(seatNumber, 4), u(n, 8));
export const secret = (seed, j) => h(TAG_SK, need("seed", seed, 32), u(j, 1));
export const step = (pub, n, j, s, x) => h(pub, u(n, 8), u(j, 1), u(s, 1), x);
export function advance(pub, n, j, x, start, stop) {
  for (let s = start; s < stop; s++) x = step(pub, n, j, s, x);
  return x;
}
export const chainEnd = (pub, n, j, seed) => advance(pub, n, j, secret(seed, j), 0, STEPS);
export function fingerprintOfEnds(pub, n, ends) {
  if (ends.length !== CHAINS) throw new Error(`need ${CHAINS} chain ends`);
  return h(pub, u(n, 8), ...ends);
}
// K(n): what the chain stores for key n.
export const keyFingerprint = (pub, n, seed) => fingerprintOfEnds(pub, n, Array.from({ length: CHAINS }, (_, j) => chainEnd(pub, n, j, seed)));

// The 67 digits of a 32-byte message: 64 of it, high nibble first, then the checksum.
export function digits(m) {
  const d = [];
  for (const byte of need("m", m, 32)) d.push(byte >> 4, byte & 15);
  const c = d.reduce((a, x) => a + STEPS - x, 0);
  return d.concat([c >> 8, (c >> 4) & 15, c & 15]);
}
// Reveal chain j at position d[j]. Sign each key once, ever.
export const sign = (pub, n, seed, m) => digits(m).map((d, j) => advance(pub, n, j, secret(seed, j), 0, d));
// Step each revealed value to the top and hash the ends. Good for key n exactly when this is K(n).
export function recover(pub, n, m, sig) {
  if (sig.length !== CHAINS) throw new Error(`need ${CHAINS} values`);
  const d = digits(m);
  return fingerprintOfEnds(pub, n, sig.map((x, j) => advance(pub, n, j, need(`sig[${j}]`, x, 32), d[j], STEPS)));
}

// c: what the passkey's curve signature covers.
export const approvalHash = (chainId, seat, safe, n, safeTxHash) =>
  h(TAG_APPROVE, u(chainId, 32), need("seat", seat, 20), need("safe", safe, 20), u(n, 8), need("safeTxHash", safeTxHash, 32));
// m: what one-time key n signs. It holds the next key, so changing it needs a forged signature.
export const oneTimeMessage = (c, nextKey) => h(TAG_ONE_TIME, need("c", c, 32), need("nextKey", nextKey, 32));
