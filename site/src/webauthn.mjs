// WebAuthn's byte formats, for the page: hex, base64url, a DER signature's (r, s), a passkey's public
// key from its SPKI, and the public key from two signatures (a passkey made on another device hands
// out no public key here). From PicoQuorum's console page. The console checks what a passkey signed
// (console/webauthn.py); this only reads what the browser hands back.

const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const unhex = (h) => Uint8Array.from((h.startsWith("0x") ? h.slice(2) : h).match(/../g) || [], (x) => parseInt(x, 16));
export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** DER ECDSA signature -> { r, s } as BigInt, s normalised to the low half (as p256.py and the chips give it). */
export function derToRS(der) {
  const d = new Uint8Array(der);
  if (d[0] !== 0x30) throw new Error("not a DER signature");
  let i = 2;
  const int = () => {
    if (d[i++] !== 0x02) throw new Error("bad DER integer");
    const n = d[i++];
    const v = BigInt("0x" + (hex(d.slice(i, i + n)) || "0"));
    i += n;
    return v;
  };
  const r = int();
  let s = int();
  if (s > N / 2n) s = N - s;
  if (!r || !s || r >= N) throw new Error("bad signature values");
  return { r, s };
}

/** The P-256 public key (x, y as hex) at the end of an uncompressed SPKI, as getPublicKey() returns. */
export function spkiXY(spki) {
  const b = new Uint8Array(spki);
  if (b.length < 65 || b[b.length - 65] !== 0x04) throw new Error("not an uncompressed P-256 key");
  return { x: hex(b.slice(-64, -32)), y: hex(b.slice(-32)) };
}

// ---- the public key, from signatures --------------------------------------------------------------
// A passkey made in another browser (say on the Mac, synced to the iPhone) is there, but its public
// key isn't: WebAuthn only hands that out when the passkey is made. An ECDSA signature names its key
// up to a choice of two (four, in a case too rare to meet), so two signatures from the same passkey
// over different challenges name it exactly. Plain affine P-256 arithmetic: a few calls, not hot.
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const G = [0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n, 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n];
const mod = (a, m) => ((a % m) + m) % m;
function inv(a, m) {                              // extended Euclid
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  if (r0 !== 1n) throw new Error("not invertible");
  return mod(s0, m);
}
function powmod(b, e, m) { let r = 1n; b = mod(b, m); for (; e; e >>= 1n, b = b * b % m) if (e & 1n) r = r * b % m; return r; }
function add(p1, p2) {                            // null is the point at infinity
  if (!p1) return p2;
  if (!p2) return p1;
  const [x1, y1] = p1, [x2, y2] = p2;
  let l;
  if (x1 === x2) {
    if (mod(y1 + y2, P) === 0n) return null;
    l = mod((3n * x1 * x1 - 3n) * inv(2n * y1, P), P);
  } else l = mod((y2 - y1) * inv(x2 - x1, P), P);
  const x3 = mod(l * l - x1 - x2, P);
  return [x3, mod(l * (x1 - x3) - y1, P)];
}
function mul(k, pt) { let r = null; for (k = mod(k, N); k; k >>= 1n, pt = add(pt, pt)) if (k & 1n) r = add(r, pt); return r; }

/** The P-256 public keys ({x, y} hex) that the signature (r, s) over the 32-byte digest could be from. */
export function recoverKeys(digest, r, s) {
  const e = BigInt("0x" + hex(digest)), ri = inv(r, N), out = [];
  for (const x of [r, r + N]) {
    if (x >= P) continue;
    const c = mod(x * x * x - 3n * x + B, P), y = powmod(c, (P + 1n) / 4n, P);
    if (y * y % P !== c) continue;
    for (const yy of [y, P - y]) {
      const q = add(mul(mod(-e * ri, N), G), mul(s * ri % N, [x, yy]));
      if (q) out.push({ x: q[0].toString(16).padStart(64, "0"), y: q[1].toString(16).padStart(64, "0") });
    }
  }
  return out;
}
