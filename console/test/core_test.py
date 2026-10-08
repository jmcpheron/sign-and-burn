# The console's request protocol, end to end, on CPython (run.py) and on MicroPython 1.26
# (run-micropython.mjs). A stand-in passkey: its seeds are fixed, and its curve signature is any
# well-formed one, since the console checks what was signed (the challenge, the UV flag) and the
# seat's signer checks the signature itself (contracts/test/Integration.t.sol).
import json
from hashlib import sha256

import core
import safe_tx
import sign_and_burn as sb
import webauthn

CHAIN = 84532
SIGNER = "0x" + "11" * 20
SEAT = "0x" + "33" * 20
SAFE = "0x" + "44" * 20
NUM = 2
fails = [0]


def hx(b):
    return "0x" + "".join("%02x" % x for x in b)


def seed(n, who=b"mine"):
    return sha256(who + n.to_bytes(8, "big")).digest()


PUB = sb.pub_seed(CHAIN, bytes.fromhex(SIGNER[2:]), NUM)


def key(n, who=b"mine"):
    return sb.key_fingerprint(PUB, n, seed(n, who))


def send_eth(nonce, to="0x" + "a1" * 20, value="100000000000000"):
    return {"to": to, "value": value, "data": "0x", "operation": 0, "nonce": str(nonce)}


def ask(op, **req):
    req["op"] = op
    return json.loads(core.handle(json.dumps(req)))


def check(what, ok, got=None):
    if not ok:
        fails[0] += 1
        print("FAIL  core: %s%s" % (what, "" if got is None else "\n      got %r" % (got,)))


def refused(what, out, words):
    check(what, not out["ok"] and words in out.get("refuse", ""), out)


def seat_state(n):
    return {"address": SEAT, "curveSigner": SIGNER, "seatNumber": NUM, "n": n, "current": hx(key(n))}


def passkey(c, flags=0x05, challenge=None):
    """What a browser hands back from navigator.credentials.get, as hex (clientDataJSON as text)."""
    cdj = '{"type":"webauthn.get","challenge":"%s","origin":"https://signandburn.app","crossOrigin":false}' % (
        webauthn.b64url(challenge or bytes.fromhex(c[2:])))
    ad = sha256(b"signandburn.app").digest() + bytes([flags]) + bytes(4)
    r = s = (12345).to_bytes(2, "big")
    der = b"\x30\x08\x02\x02" + r + b"\x02\x02" + s
    return {"authenticatorData": hx(ad), "clientDataJSON": cdj, "signature": hx(der)}


def approve(n, tx, seeds=None, **kw):
    """begin, then sign with the seeds the passkey's PRF gives for the salts begin named."""
    b = ask("begin", chainId=CHAIN, seat=seat_state(n), safe=SAFE, tx=tx)
    if not b["ok"] or "resend" in b:
        return b, None
    check("salts are for keys n and n + 1", b["salts"] == [hx(sb.prf_salt(CHAIN, bytes.fromhex(SIGNER[2:]), NUM, n)),
                                                          hx(sb.prf_salt(CHAIN, bytes.fromhex(SIGNER[2:]), NUM, n + 1))], b)
    pk = passkey(b["c"], **kw)
    s = ask("sign", chainId=CHAIN, seat=seat_state(n), safe=SAFE, tx=tx, passkey=pk,
            seeds=seeds or [hx(seed(n)), hx(seed(n + 1))])
    return b, s


def run():
    try:
        import os
        os.remove(core.LEDGER)
    except OSError:
        pass
    out = ask("hello")
    check("hello", out["ok"] and out["chains"] == {"84532": "Base Sepolia"}, out)

    out = ask("first", chainId=CHAIN, curveSigner=SIGNER, seatNumber=NUM, seed=hx(seed(0)))
    check("first key is K(0)", out["firstKey"] == hx(key(0)) and out["pubSeed"] == hx(PUB), out)
    out = ask("keys", chainId=CHAIN, curveSigner=SIGNER, seatNumber=NUM, n=7)
    check("keys", out["salts"][1] == hx(sb.prf_salt(CHAIN, bytes.fromhex(SIGNER[2:]), NUM, 8)), out)

    # the words, and the hash worked out here
    out = ask("review", chainId=CHAIN, safe=SAFE, tx=send_eth(0))
    want = safe_tx.safe_tx_hash(CHAIN, SAFE, "0x" + "a1" * 20, 10 ** 14, "0x", 0, nonce=0)
    check("review", out["ok"] and out["summary"] == "Send 0.0001 ETH" and out["level"] == "ok"
          and out["safeTxHash"] == hx(want) and not out["refuse"], out)
    refused("another chain", ask("review", chainId=1, safe=SAFE, tx=send_eth(0)), "only on Base Sepolia")
    owner = {"to": SAFE, "value": "0", "operation": 0, "nonce": "0",
             "data": "0x0d582f13" + "00" * 12 + "be" * 20 + "%064x" % 1}
    out = ask("review", chainId=CHAIN, safe=SAFE, tx=owner)
    check("adding an owner is red, and allowed", out["level"] == "red" and not out["refuse"], out)

    # approval 0: both messages from the seat's own n, and a one-time signature for key 0
    tx0 = send_eth(0)
    b, s = approve(0, tx0)
    h0 = safe_tx.safe_tx_hash(CHAIN, SAFE, tx0["to"], int(tx0["value"]), "0x", 0, nonce=0)
    c0 = sb.approval_hash(CHAIN, bytes.fromhex(SEAT[2:]), bytes.fromhex(SAFE[2:]), 0, h0)
    check("begin builds c itself", b["ok"] and b["c"] == hx(c0), b)
    a = s["approval"]
    m0 = sb.one_time_message(c0, key(1))
    check("the next key is K(1)", a["nextKey"] == hx(key(1)), a)
    check("m holds the next key", s["m"] == hx(m0), s)
    sig = [bytes.fromhex(v[2:]) for v in a["oneTime"]]
    check("the one-time signature is good for key 0", sb.recover(PUB, 0, m0, sig) == key(0))
    check("curveSig is the packed assertion", a["curveSig"].startswith("0x" + "%064x" % 128), a["curveSig"][:70])

    # the guardrail: key 0 has signed; it may only send that same approval again
    refused("key 0 for another transaction", ask("begin", chainId=CHAIN, seat=seat_state(0), safe=SAFE,
                                                 tx=send_eth(0, value="5")), "already signed an approval for another")
    out = ask("begin", chainId=CHAIN, seat=seat_state(0), safe=SAFE, tx=tx0)
    check("the same transaction: send the same approval", out["ok"] and out.get("resend") == a and "salts" not in out, out)
    refused("signing it again", ask("sign", chainId=CHAIN, seat=seat_state(0), safe=SAFE, tx=tx0, passkey=passkey(b["c"]),
                                    seeds=[hx(seed(0)), hx(seed(1))]), "already signed this approval")
    check("sent", ask("sent", chainId=CHAIN, seat=SEAT, n=0, txHash="0x" + "ab" * 32)["ok"])
    e = ask("ledger")["entries"][0]
    check("the ledger has it, sent", e["status"] == "sent" and e["txHash"] == "0x" + "ab" * 32 and e["approval"] == a, e)

    # it lands: the chain says n = 1. The ledger keeps a short line.
    out = ask("chain", chainId=CHAIN, seat=SEAT, n=1)
    e = ask("ledger")["entries"][0]
    check("landed", out["waiting"] == [] and e["status"] == "landed" and "approval" not in e, e)

    # approval 1, with key 1
    tx1 = send_eth(1)
    b, s = approve(1, tx1)
    check("approval 1", s["ok"] and s["approval"]["nextKey"] == hx(key(2)), s)

    # refusals that sign nothing
    tx2 = send_eth(2)
    out = ask("chain", chainId=CHAIN, seat=SEAT, n=2)
    b, s = approve(2, tx2, seeds=[hx(seed(2, b"another passkey")), hx(seed(3))])
    refused("another passkey's key", s, "isn't the one the seat holds")
    b, s = approve(2, tx2, flags=0x01)
    refused("no user verification", s, "did not verify you")
    b, s = approve(2, tx2, challenge=bytes(32))
    refused("the passkey signed another challenge", s, "something other than this approval")
    check("none of those reached the ledger", [x["n"] for x in ask("ledger")["entries"]] == [0, 1], ask("ledger"))
    refused("a spent key on a new transaction", ask("begin", chainId=CHAIN, seat=seat_state(1), safe=SAFE, tx=tx2),
            "Key 1 already signed")
    refused("chain behind the ledger", ask("begin", chainId=CHAIN, seat=seat_state(0), safe=SAFE, tx=tx2),
            "already signed with key 1")

    unknown = {"to": "0x" + "c0" * 20, "value": "0", "data": "0xdeadbeef", "operation": 0, "nonce": "2"}
    refused("a call it can't read", ask("begin", chainId=CHAIN, seat=seat_state(2), safe=SAFE, tx=unknown), "can't read")
    dc = dict(send_eth(2), operation=1)
    refused("a delegatecall", ask("begin", chainId=CHAIN, seat=seat_state(2), safe=SAFE, tx=dc), "delegatecall")
    refused("nonsense", json.loads(core.handle("{\"op\": \"begin\"}")), "can't read")
    refused("not JSON", json.loads(core.handle("hello")), "can't read")

    # and the honest path still works after all that
    b, s = approve(2, tx2)
    check("approval 2", s["ok"] and s["n"] == 2, s)
    print("core: %s" % ("all requests behave" if not fails[0] else "%d failures" % fails[0]))
    return fails[0]
