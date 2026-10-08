# The passkey's curve signature, packed the way Safe's passkey signer checks it (safe-modules
# passkey 0.2.1, SafeWebAuthnSignerProxy). From PicoQuorum's console, which packed a chip's
# signatures the same way.
#
# The signer rebuilds clientDataJSON as {"type":"webauthn.get","challenge":"<base64url(c)>",<fields>}
# and checks the P-256 signature over sha256(authenticatorData || sha256(clientDataJSON)), with the
# user-verified flag set. So the console checks what the passkey signed before it packs anything:
# the challenge must be the c it built itself, and the passkey must have verified the user.
#
#   parts(c, authenticatorData, clientDataJSON, der) -> (authenticatorData, clientDataFields, r, s)
#   encode(ad, fields, r, s)        abi.encode(bytes, string, uint256, uint256): the seat's curveSig
#   owner_address(qx, qy, signer)   the passkey's signer address, the same on every chain
from binascii import b2a_base64, hexlify
from keccak import keccak256

N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551   # the P-256 group order
UV = 0x04                                                                 # authenticatorData flag: user verified


def _b(h):
    if isinstance(h, (bytes, bytearray)):
        return bytes(h)
    return bytes.fromhex(h[2:] if h.startswith("0x") else h)


def _u256(n):
    """A uint256 word from an int or a 0x hex string."""
    if isinstance(n, str):
        n = int(n, 16)
    return int(n).to_bytes(32, "big")


def _pad(b):
    return b + bytes(-len(b) % 32)


def b64url(b):
    """base64url without padding, as WebAuthn puts the challenge in clientDataJSON."""
    s = b2a_base64(b).decode().strip()
    return s.replace("+", "-").replace("/", "_").replace("=", "")


def der_rs(der):
    """A DER ECDSA signature -> (r, s), s moved to the low half (the signer accepts either; a chip
    and most libraries give the low one)."""
    d = _b(der)
    if len(d) < 8 or d[0] != 0x30 or d[1] != len(d) - 2:
        raise ValueError("not a DER signature")
    out, i = [], 2
    for _ in range(2):
        if d[i] != 0x02:
            raise ValueError("not a DER signature")
        n = d[i + 1]
        out.append(int.from_bytes(d[i + 2:i + 2 + n], "big"))
        i += 2 + n
    r, s = out
    if i != len(d) or not 0 < r < N or not 0 < s < N:
        raise ValueError("bad signature values")
    return r, (N - s if s > N // 2 else s)


def parts(challenge, ad, client_json, der):
    """What the passkey returned, checked against the 32-byte challenge the console built."""
    challenge, ad = _b(challenge), _b(ad)
    head = '{"type":"webauthn.get","challenge":"%s",' % b64url(challenge)
    if len(challenge) != 32 or not client_json.startswith(head) or not client_json.endswith("}"):
        raise ValueError("the passkey signed something other than this approval")
    if len(ad) < 37:
        raise ValueError("authenticatorData is too short")
    if not ad[32] & UV:
        raise ValueError("the passkey did not verify you (Touch ID, PIN), and the signer requires it")
    r, s = der_rs(der)
    return ad, client_json[len(head):-1], r, s


def encode(ad, fields, r, s):
    """abi.encode(bytes authenticatorData, string clientDataFields, uint256 r, uint256 s),
    canonical: the contract refuses trailing bytes."""
    f = fields.encode()
    tail_a = _u256(len(ad)) + _pad(ad)
    return _u256(128) + _u256(128 + len(tail_a)) + _u256(r) + _u256(s) + tail_a + _u256(len(f)) + _pad(f)


def owner_address(qx, qy, signer):
    """The SafeWebAuthnSignerProxy the factory deploys for this key: CREATE2 with salt 0 over the
    proxy's creation code and its constructor arguments (singleton, x, y, verifiers). signer is
    cfg.CFG["signer"]; its verifiers are part of the address, so they can never change."""
    init = (_b(signer["proxyCode"]) + bytes(12) + _b(signer["singleton"]) + _u256(qx) + _u256(qy)
            + _u256(signer["verifiers"]))
    h = keccak256(b"\xff" + _b(signer["factory"]) + bytes(32) + keccak256(init))
    return "0x" + hexlify(h[12:]).decode()
