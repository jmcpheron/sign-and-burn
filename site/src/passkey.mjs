// The visitor's passkey: the console's only key. One tap does two jobs (KICKOFF.md, "The signer"):
//   the curve half      an ordinary WebAuthn assertion over c, which the seat checks through Safe's
//                       passkey signer;
//   the one-time half   the PRF extension: given a salt, the passkey answers 32 bytes made from a
//                       secret that never leaves it. It answers two salts per tap: the seeds of keys
//                       n and n + 1. The console makes each key's 67 secrets from its seed.
// Always with user verification required: some authenticators give a different PRF answer without
// it, and the keys would stop matching. Safe's passkey signer requires the UV flag anyway.
import { b64url, hex, recoverKeys, spkiXY, unb64url, unhex } from "./webauthn.mjs";

const KEY = "sab.passkey";
const rpId = () => location.hostname;

export function stored() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function keep(pk) {
  try { localStorage.setItem(KEY, JSON.stringify(pk)); } catch {}
  return pk;
}
export function forget() {
  try { localStorage.removeItem(KEY); } catch {}
}

export const supported = () => !!(globalThis.PublicKeyCredential && navigator.credentials);

export class NoPrf extends Error {
  constructor() {
    super("This passkey can't make one-time keys: it has no PRF. Try another device or password manager (the README lists what was tested).");
  }
}

/** A new passkey for this site, P-256 only (Safe's passkey signer checks P-256). One tap. */
export async function make() {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: "Sign and Burn", id: rpId() },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: `Sign and Burn ${new Date().toISOString().slice(0, 10)}`, displayName: "Sign and Burn" },
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    extensions: { prf: {} },
  } });
  const { x, y } = spkiXY(cred.response.getPublicKey());
  return keep({ id: b64url(new Uint8Array(cred.rawId)), x, y, rpId: rpId(), made: new Date().toISOString().slice(0, 10),
    attachment: cred.authenticatorAttachment || "", prf: !!cred.getClientExtensionResults().prf?.enabled });
}

/** One tap: the passkey signs the 32-byte challenge, and its PRF answers each salt (one or two).
 * -> { passkey: {authenticatorData, clientDataJSON, signature}, seeds: [hex, ...] }, all for the console. */
export async function tap(pk, challengeHex, salts = []) {
  const publicKey = { challenge: unhex(challengeHex), rpId: rpId(), userVerification: "required", timeout: 120000,
    allowCredentials: [{ type: "public-key", id: unb64url(pk.id) }] };
  if (salts.length) publicKey.extensions = { prf: { eval: salts.length > 1 ? { first: unhex(salts[0]), second: unhex(salts[1]) } : { first: unhex(salts[0]) } } };
  const a = await navigator.credentials.get({ publicKey });
  const got = a.getClientExtensionResults().prf?.results;
  if (salts.length && !(got?.first && (salts.length < 2 || got.second))) throw new NoPrf();
  const r = a.response;
  return {
    passkey: { authenticatorData: "0x" + hex(r.authenticatorData), clientDataJSON: new TextDecoder().decode(r.clientDataJSON),
      signature: "0x" + hex(r.signature) },
    seeds: salts.map((_, i) => "0x" + hex(i ? got.second : got.first)),
  };
}

/** A passkey made on another device or in another browser (synced by iCloud Keychain or Google
 * Password Manager). WebAuthn hands out a passkey's public key only when it is made, so it signs
 * twice and the key is worked out from the two signatures. Two taps. */
export async function findExisting() {
  const sign = async (id) => {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const a = await navigator.credentials.get({ publicKey: { challenge, rpId: rpId(), userVerification: "required",
      ...(id ? { allowCredentials: [{ type: "public-key", id: unb64url(id) }] } : {}) } });
    const r = a.response;
    const signed = new Uint8Array([...new Uint8Array(r.authenticatorData), ...new Uint8Array(await crypto.subtle.digest("SHA-256", r.clientDataJSON))]);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", signed));
    const { r: rr, s } = (await import("./webauthn.mjs")).derToRS(r.signature);
    return { id: b64url(new Uint8Array(a.rawId)), keys: recoverKeys(digest, rr, s) };
  };
  const one = await sign(null);
  const two = await sign(one.id);
  const both = one.keys.filter((k) => two.keys.some((t) => t.x === k.x && t.y === k.y));
  if (both.length !== 1) throw new Error("Couldn't work out this passkey's public key from two signatures. Try once more.");
  return keep({ id: one.id, x: both[0].x, y: both[0].y, rpId: rpId(), made: "earlier", attachment: "", prf: true });
}
