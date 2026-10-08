// The one-time keys again, in the page's own JavaScript: reference/js/sign-and-burn.mjs with the
// browser's bytes (Uint8Array) and viem's SHA-256 in place of node's. The page never signs with a
// passkey's keys here: the console does that. This draws what a signature reveals, and runs the
// attack room's danger case with a throwaway key. site/test.mjs checks it against
// reference/vectors/v1.json.
import { sha256 } from "viem";

export const STEPS = 15, CHAINS = 67;
const enc = new TextEncoder();
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
export const h = (...parts) => sha256(cat(...parts), "bytes");
export function u(value, size) {
  let v = BigInt(value);
  const b = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--, v >>= 8n) b[i] = Number(v & 255n);
  return b;
}
export const bytes = (hex) => Uint8Array.from((hex.startsWith("0x") ? hex.slice(2) : hex).match(/../g) || [], (x) => parseInt(x, 16));
export const hex = (b) => "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export const pubSeed = (chainId, curveSigner, seatNumber) => h(enc.encode("sign-and-burn/seed/v1"), u(chainId, 32), bytes(curveSigner), u(seatNumber, 4));
export const secret = (seed, j) => h(enc.encode("sign-and-burn/sk/v1"), seed, u(j, 1));
export const step = (pub, n, j, s, x) => h(pub, u(n, 8), u(j, 1), u(s, 1), x);
export function advance(pub, n, j, x, start, stop) {
  for (let s = start; s < stop; s++) x = step(pub, n, j, s, x);
  return x;
}
export const fingerprintOfEnds = (pub, n, ends) => h(pub, u(n, 8), ...ends);
export const keyFingerprint = (pub, n, seed) => fingerprintOfEnds(pub, n, Array.from({ length: CHAINS }, (_, j) => advance(pub, n, j, secret(seed, j), 0, STEPS)));

/** The 67 digits of a 32-byte message: 64 of it, high nibble first, then the checksum. */
export function digits(m) {
  const d = [];
  for (const byte of m) d.push(byte >> 4, byte & 15);
  const c = d.reduce((a, x) => a + STEPS - x, 0);
  return d.concat([c >> 8, (c >> 4) & 15, c & 15]);
}
export const sign = (pub, n, seed, m) => digits(m).map((d, j) => advance(pub, n, j, secret(seed, j), 0, d));
export function recover(pub, n, m, sig) {
  const d = digits(m);
  return fingerprintOfEnds(pub, n, sig.map((x, j) => advance(pub, n, j, x, d[j], STEPS)));
}

// ----------------------------------------------------------------------------- the danger case
// Why the guardrail exists. A signature reveals chain j at position d[j]; anyone can step it up the
// chain, never down. Several signatures with one key reveal, on each chain, the lowest position any
// of them showed. A forger who finds a message whose every digit (checksum included) sits at or above
// those lowest positions can sign it, with no secret at all. The forger picks the message's next key,
// so they try next keys until one gives such a message.

/** Per chain, the lowest position any of these signatures revealed, and the value there. */
export function lowest(sigs, ms) {
  const ds = ms.map(digits);
  return Array.from({ length: CHAINS }, (_, j) => {
    let best = 0;
    for (let i = 1; i < sigs.length; i++) if (ds[i][j] < ds[best][j]) best = i;
    return { at: ds[best][j], value: sigs[best][j] };
  });
}

/** The chance that one try (one message) can be forged from these lowest positions. */
export function chance(low) {
  // digits of a random message are uniform for the 64 message chains; the checksum is checked on the
  // real thing, so this is the message part only, an estimate on the hopeful side
  return low.slice(0, 64).reduce((p, { at }) => p * (16 - at) / 16, 1);
}

/** Try messages until one can be forged; -> { tries, m, sig } or null after `limit` tries. */
export function forge(pub, n, low, makeMessage, limit = 2e6) {
  for (let t = 1; t <= limit; t++) {
    const m = makeMessage(t);
    const d = digits(m);
    if (d.every((x, j) => x >= low[j].at)) return { tries: t, m, sig: d.map((x, j) => advance(pub, n, j, low[j].value, low[j].at, x)) };
  }
  return null;
}
