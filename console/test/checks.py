# The console's pure parts, checked the same way on CPython (run.py) and on MicroPython 1.26
# (run-micropython.mjs): safe_tx.py against every vector in safe_tx.json (viem's hashes, and real Safe
# transactions), decode.py against each vector's "expect", and webauthn.py against a real browser
# passkey's assertion that Safe's passkey signer accepted on chain (passkey.json).
import json

import decode
import safe_tx
import webauthn
from cfg import CFG
from keccak import keccak256


def hx(b):
    return "0x" + "".join("%02x" % x for x in b)


def check_safe_tx(vectors):
    failed = 0
    for v in vectors:
        t = v["tx"]
        dom = hx(safe_tx.domain_separator(v["chainId"], v["safe"]))
        h = safe_tx.safe_tx_hash(v["chainId"], v["safe"], t["to"], t["value"], t["data"], t["operation"],
                                 t["safeTxGas"], t["baseGas"], t["gasPrice"], t["gasToken"],
                                 t["refundReceiver"], t["nonce"])
        ok = dom == v["domainSeparator"].lower() and hx(h) == v["safeTxHash"].lower()
        if ok and safe_tx.verify_code(h) != v["safeTxHash"].lower()[-8:]:
            ok = False
        if not ok:
            failed += 1
            print("FAIL  %-24s hash %s, want %s" % (v["name"], hx(h), v["safeTxHash"]))
    print("safe_tx: %d/%d vectors" % (len(vectors) - failed, len(vectors)))
    return failed


# The vectors are mostly Base mainnet transactions. They name Base's USDC and Uniswap's router, which
# the console's own config doesn't pin (it signs on Base Sepolia only), so the decode check adds them.
BASE = {"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": ["USDC", 6]}
UNISWAP = {"0x6ff5693b99212da76ad316178a184ab56d299b43": ["Uniswap Router", "uniswap", {
    "3593564c": ["execute(bytes,bytes[],uint256)", "Swap on Uniswap"],
    "24856bc3": ["execute(bytes,bytes[])", "Swap on Uniswap"]}]}


def test_cfg():
    c = json.loads(json.dumps(CFG))
    c["tokens"]["8453"] = BASE
    c["contracts"]["8453"] = dict(UNISWAP, **{"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": ["USDC", "usdc", {}]})
    return c


def check_decode(vectors):
    failed = 0
    cfg = test_cfg()
    for sel, sig in decode.SIGS.items():
        if hx(keccak256(sig.encode())[:4])[2:] != sel:
            print("FAIL  selector %s is not %s" % (sel, sig))
            failed += 1
    n = 0
    for v in vectors:
        if "expect" not in v:
            continue
        got = decode.review(v["tx"], decode.context(cfg, v["safe"]))
        n += 1
        items = [[i["title"], i["level"]] for i in got["items"]]
        if got["summary"] != v["expect"]["summary"] or items != v["expect"]["items"]:
            failed += 1
            print("FAIL  decode %-24s got %r %r\n      want %r %r" % (v["name"], got["summary"], items,
                                                                      v["expect"]["summary"], v["expect"]["items"]))
    print("decode: %d/%d expectations, %d selectors" % (n - failed, n, len(decode.SIGS)))
    return failed


def check_passkey(vs):
    """A real browser passkey's assertion (Chromium's virtual authenticator) that Safe's passkey
    signer accepted on Base Sepolia, Base and Ethereum: webauthn.py must take it apart and pack it
    to the same bytes, and work out the same signer address."""
    failed = 0
    for v in vs:
        r, s = int(v["r"], 16), int(v["s"], 16)
        der = _der(r, s)
        ad, fields, r2, s2 = webauthn.parts(v["safeTxHash"], v["authenticatorData"], v["clientDataJSON"], der)
        packed = hx(webauthn.encode(ad, fields, r2, s2))
        owner = webauthn.owner_address(int(v["qx"], 16), int(v["qy"], 16), CFG["signer"])
        high = webauthn.der_rs(_der(r, webauthn.N - s))     # the same signature with s in the high half
        wrong = [w for w, ok in (("fields", fields == v["clientDataFields"]), ("signature", packed == v["signature"]),
                                 ("owner", owner == v["owner"]), ("low s", high == (r, s))) if not ok]
        try:
            webauthn.parts(bytes(32), v["authenticatorData"], v["clientDataJSON"], der)
            wrong.append("another challenge was accepted")
        except ValueError:
            pass
        if wrong:
            failed += 1
            print("FAIL  passkey %s: %s" % (v["name"], ", ".join(wrong)))
    print("webauthn: %d/%d real passkey assertions" % (len(vs) - failed, len(vs)))
    return failed


def _der(r, s):
    def i(x):
        b = x.to_bytes(33, "big").lstrip(b"\x00")
        if b[0] & 0x80:
            b = b"\x00" + b
        return b"\x02" + bytes([len(b)]) + b
    body = i(r) + i(s)
    return b"\x30" + bytes([len(body)]) + body
