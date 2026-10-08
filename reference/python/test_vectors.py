#!/usr/bin/env python3
"""Checks reference/vectors/v1.json against the Python reference: python3 reference/python/test_vectors.py"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sign_and_burn as sb

V = json.load(open(os.path.join(HERE, "..", "vectors", "v1.json")))
b = lambda s: bytes.fromhex(s[2:])
fails = 0

def norm(v):
    if isinstance(v, bytes):
        return "0x" + v.hex()
    return [norm(x) for x in v] if isinstance(v, list) and v and isinstance(v[0], bytes) else v

def check(case, what, got, want):
    global fails
    if norm(got) != want:
        fails += 1
        print("FAIL %s: %s\n  got  %s\n  want %s" % (case, what, norm(got), want))

for v in V["cases"]:
    name, pub, n, m = v["name"], b(v["pubSeed"]), int(v["n"]), b(v["m"])
    chain, seat_no, signer = int(v["chainId"]), int(v["seatNumber"]), b(v["curveSigner"])
    seed, sig = b(v["seed"]), [b(s) for s in v["signature"]]
    ends = [sb.chain_end(pub, n, j, seed) for j in range(sb.CHAINS)]
    check(name, "pubSeed", sb.pub_seed(chain, signer, seat_no), v["pubSeed"])
    check(name, "prfSalt", sb.prf_salt(chain, signer, seat_no, n), v["prfSalt"])
    check(name, "secret0", sb.secret(seed, 0), v["secret0"])
    check(name, "secret66", sb.secret(seed, 66), v["secret66"])
    check(name, "step0", sb.step(pub, n, 0, 0, sb.secret(seed, 0)), v["step0"])
    check(name, "end0", ends[0], v["end0"])
    check(name, "end66", ends[66], v["end66"])
    check(name, "key", sb.fingerprint_of_ends(pub, n, ends), v["key"])
    check(name, "nextKey", sb.key_fingerprint(pub, n + 1, b(v["nextSeed"])), v["nextKey"])
    c = sb.approval_hash(chain, b(v["seat"]), b(v["safe"]), n, b(v["safeTxHash"]))
    check(name, "c", c, v["c"])
    if name not in ("message-all-zero", "message-all-ones"):
        check(name, "m", sb.one_time_message(c, b(v["nextKey"])), v["m"])
    check(name, "digits", sb.digits(m), v["digits"])
    check(name, "signature", sb.sign(pub, n, seed, m), v["signature"])
    check(name, "recover", sb.recover(pub, n, m, sig), v["key"])
    for r in v["refused"]:
        m2, n2, sig2 = b(r.get("m", v["m"])), int(r.get("n", n)), list(sig)
        if "index" in r:
            sig2[r["index"]] = bytes(32)
        check(name, "refused: " + r["what"], sb.recover(pub, n2, m2, sig2) != b(v["key"]), True)
    check(name, "signature length", len(sig) * 32, V["parameters"]["signatureBytes"])

print("python reference: %d cases, %d failures" % (len(V["cases"]), fails))
sys.exit(1 if fails else 0)
