# The console core: everything Sign and Burn trusts the console with, behind one function. handle()
# takes one request and gives one answer, each a line of JSON. In the browser the page calls it
# through MicroPython for WebAssembly; on a Pico or an ESP32, main.py reads the same lines from USB
# serial. Nothing here touches a screen, a network or a key store.
#
# It takes no hash from anyone. From the fields it is given it rebuilds the Safe transaction hash,
# says what the transaction does in plain words, refuses what it can't explain, and builds both
# messages from the seat's own approval number n (KICKOFF.md, "The messages"):
#   c = sha256("sign-and-burn/approve/v1"  || chainId || seat || safe || n || safeTxHash)  the passkey signs c
#   m = sha256("sign-and-burn/one-time/v1" || c || nextKey)                               one-time key n signs m
# It keeps the guardrail: one signature per key number, ever. Each approval it signs goes into its
# ledger before the answer leaves, and while one for key n waits, it signs nothing else with key n.
#
# Requests are {"op": ..., ...}:
#   hello                                           what this console is
#   signer  x, y                                    the passkey's signer address: its owner on chain
#   keys    chainId, curveSigner, seatNumber, n     pubSeed, and the PRF salts for keys n and n + 1
#   first   chainId, curveSigner, seatNumber, seed  K(0), a new seat's first key, from seed(0)
#   review  chainId, safe, tx                       the hash, and what the transaction does
#   begin   chainId, seat, safe, tx                 review and guardrail; c and the salts to ask for
#   sign    as begin, + passkey, seeds              the approval: both signatures and the next key
#   sent    chainId, seat, n, txHash                the page handed approval n to a wallet
#   chain   chainId, seat, n                        the chain's n now: every approval below it landed
#   ledger                                          what this console has signed
# seat is {address, curveSigner, seatNumber, n, current}, as the page read it from the chain. passkey
# is the WebAuthn answer {authenticatorData, clientDataJSON, signature}, hex but clientDataJSON.
# seeds are the passkey's PRF answers for the two salts. Every answer is {"ok": true, ...} or
# {"ok": false, "refuse": "why, in plain words"}.
import json
import os
from binascii import hexlify

import decode
import safe_tx
import sign_and_burn as sb
import webauthn
from cfg import CFG

VERSION = "sign-and-burn console 1"
LEDGER = "ledger.json"   # on a board, a file in flash; in the browser, the page keeps it in localStorage
KEEP = 50                # landed approvals kept, as one short line each; waiting ones are always kept whole
ZERO = "0x" + "00" * 20


class Refuse(Exception):
    pass


def hx(b):
    return "0x" + hexlify(b).decode()


def _b(h, size, what):
    try:
        b = bytes.fromhex(h[2:] if h.startswith("0x") else h)
    except (ValueError, AttributeError):
        raise Refuse("%s isn't hex." % what)
    if size and len(b) != size:
        raise Refuse("%s should be %d bytes, not %d." % (what, size, len(b)))
    return b


def _chain(req):
    c = str(int(req["chainId"]))
    if c not in CFG["chains"]:
        names = ", ".join(v["name"] for v in CFG["chains"].values())
        raise Refuse("This console signs only on %s, not on chain %s." % (names, c))
    return int(c)


# ----------------------------------------------------------------------------- the ledger
def _load():
    try:
        with open(LEDGER) as f:
            return json.load(f)
    except OSError:
        return []


def _save(entries):
    with open(LEDGER + ".new", "w") as f:
        json.dump(entries, f)
    os.rename(LEDGER + ".new", LEDGER)


def _mine(entries, chain, seat):
    return [e for e in entries if e["chainId"] == chain and e["seat"] == seat]


def _guard(entries, chain, seat, n, h):
    """The guardrail, before anything is signed. -> the approval already signed with key n for this
    same transaction, to send again; None if key n has signed nothing."""
    mine = _mine(entries, chain, seat)
    for e in mine:
        if e["n"] > n:
            raise Refuse("This console already signed with key %d for this seat, but the chain says the seat is at "
                         "key %d. Wait for the chain to catch up." % (e["n"], n))
    for e in mine:
        if e["n"] == n:
            if e["safeTxHash"] != h:
                raise Refuse("Key %d already signed an approval for another transaction (%s, %s). One signature "
                             "per key, ever: send that one, and approve this after it lands." % (n, e["summary"], e["safeTxHash"]))
            if not e.get("approval"):
                raise Refuse("This console saw approval %d land, but the chain says the seat is still at key %d." % (n, n))
            return e
    return None


# ----------------------------------------------------------------------------- the requests
def hello(req):
    return {"version": VERSION, "chains": dict((k, v["name"]) for k, v in CFG["chains"].items()),
            "seatFactory": CFG["seatFactory"]}


def signer(req):
    return {"signer": webauthn.owner_address(int(req["x"], 16), int(req["y"], 16), CFG["signer"])}


def keys(req):
    chain = _chain(req)
    s, num, n = _b(req["curveSigner"], 20, "curveSigner"), int(req["seatNumber"]), int(req["n"])
    return {"pubSeed": hx(sb.pub_seed(chain, s, num)),
            "salts": [hx(sb.prf_salt(chain, s, num, n)), hx(sb.prf_salt(chain, s, num, n + 1))]}


def first(req):
    chain = _chain(req)
    pub = sb.pub_seed(chain, _b(req["curveSigner"], 20, "curveSigner"), int(req["seatNumber"]))
    return {"pubSeed": hx(pub), "firstKey": hx(sb.key_fingerprint(pub, 0, _b(req["seed"], 32, "seed")))}


def _review(req, chain, names=None):
    safe, tx = req["safe"], req["tx"]
    _b(safe, 20, "The Safe's address")
    _b(tx["to"], 20, "The address it calls")
    data = tx.get("data") or "0x"
    h = safe_tx.safe_tx_hash(chain, safe, tx["to"], tx["value"], data, int(tx["operation"]), tx.get("safeTxGas", 0),
                             tx.get("baseGas", 0), tx.get("gasPrice", 0), tx.get("gasToken") or ZERO,
                             tx.get("refundReceiver") or ZERO, tx["nonce"])
    r = decode.review(tx, decode.context(CFG, safe, names, chain))
    refuse = r["refuse"]
    for it in r["items"]:
        if it["title"] == "UNKNOWN CALL":
            refuse = refuse or "A call this console can't read. It approves only what it can explain."
    return h, {"safeTxHash": hx(h), "verify": safe_tx.verify_code(h), "nonce": str(int(tx["nonce"])),
               "summary": r["summary"], "level": r["level"], "items": r["items"], "refuse": refuse}


def review(req):
    return _review(req, _chain(req))[1]


def _approval_context(req):
    """Everything begin and sign both work out from scratch, so sign trusts nothing begin said."""
    chain = _chain(req)
    s = req["seat"]
    seat = _b(s["address"], 20, "The seat's address")
    signer_ = _b(s["curveSigner"], 20, "The seat's signer")
    num, n = int(s["seatNumber"]), int(s["n"])
    current = _b(s["current"], 32, "The seat's current key")
    safe = _b(req["safe"], 20, "The Safe's address")
    h, words = _review(req, chain, {hx(seat): "Your seat"})
    if words["refuse"]:
        raise Refuse(words["refuse"])
    pub = sb.pub_seed(chain, signer_, num)
    c = sb.approval_hash(chain, seat, safe, n, h)
    return {"chain": chain, "seat": seat, "signer": signer_, "num": num, "n": n, "current": current, "safe": safe, "h": h,
            "words": words, "pub": pub, "c": c}


def begin(req):
    x = _approval_context(req)
    waiting = _guard(_load(), x["chain"], hx(x["seat"]), x["n"], hx(x["h"]))
    out = {"review": x["words"], "n": x["n"], "c": hx(x["c"])}
    if waiting:
        out["resend"] = waiting["approval"]
        return out
    out["salts"] = [hx(sb.prf_salt(x["chain"], x["signer"], x["num"], x["n"])),
                    hx(sb.prf_salt(x["chain"], x["signer"], x["num"], x["n"] + 1))]
    return out


def sign(req):
    x = _approval_context(req)
    entries = _load()
    seat, n, pub, c = hx(x["seat"]), x["n"], x["pub"], x["c"]
    if _guard(entries, x["chain"], seat, n, hx(x["h"])):
        raise Refuse("Key %d already signed this approval. Send that one: begin hands it back." % n)
    p = req["passkey"]
    try:
        ad, fields, r, s = webauthn.parts(c, _b(p["authenticatorData"], 0, "authenticatorData"), p["clientDataJSON"],
                                          _b(p["signature"], 0, "The passkey's signature"))
    except ValueError as e:
        raise Refuse(str(e))
    seed, seed_next = _b(req["seeds"][0], 32, "seed n"), _b(req["seeds"][1], 32, "seed n + 1")
    if sb.key_fingerprint(pub, n, seed) != x["current"]:
        raise Refuse("This passkey's key %d isn't the one the seat holds: another passkey, or another seat. The "
                     "one-time key signed nothing." % n)
    next_key = sb.key_fingerprint(pub, n + 1, seed_next)
    m = sb.one_time_message(c, next_key)
    one_time = sb.sign(pub, n, seed, m)
    if sb.recover(pub, n, m, one_time) != x["current"]:
        raise Refuse("The one-time signature didn't check out here, so it stays here.")
    approval = {"seat": seat, "safe": hx(x["safe"]), "safeTxHash": hx(x["h"]), "nextKey": hx(next_key),
                "oneTime": [hx(v) for v in one_time], "curveSig": hx(webauthn.encode(ad, fields, r, s))}
    w = x["words"]
    entries.append({"chainId": x["chain"], "seat": seat, "n": n, "safe": approval["safe"], "safeTxHash": approval["safeTxHash"],
                    "verify": w["verify"], "summary": w["summary"], "level": w["level"], "tx": req["tx"],
                    "c": hx(c), "m": hx(m), "nextKey": approval["nextKey"], "status": "signed", "txHash": "",
                    "approval": approval})
    _save(entries)   # the guardrail's record, before the signature leaves
    return {"approval": approval, "n": n, "c": hx(c), "m": hx(m), "review": w}


def sent(req):
    chain, seat, n = _chain(req), req["seat"].lower(), int(req["n"])
    entries = _load()
    for e in _mine(entries, chain, seat):
        if e["n"] == n and e["status"] == "signed":
            e["status"], e["txHash"] = "sent", req["txHash"]
    _save(entries)
    return {}


def chain(req):
    """The chain says the seat is at key n: every approval below n has landed. A landed one keeps
    one short line (the chain has the rest), and only the newest KEEP of those stay."""
    chain_id, seat, n = _chain(req), req["seat"].lower(), int(req["n"])
    entries = _load()
    for e in _mine(entries, chain_id, seat):
        if e["n"] < n and e["status"] != "landed":
            e["status"] = "landed"
            e.pop("approval", None)
            e.pop("tx", None)
    landed = [e for e in entries if e["status"] == "landed"]
    drop = landed[:-KEEP] if len(landed) > KEEP else []
    entries = [e for e in entries if e not in drop]
    _save(entries)
    return {"waiting": [e["n"] for e in _mine(entries, chain_id, seat) if e["status"] != "landed"]}


def ledger(req):
    return {"entries": _load()}


OPS = {"hello": hello, "signer": signer, "keys": keys, "first": first, "review": review, "begin": begin,
       "sign": sign, "sent": sent, "chain": chain, "ledger": ledger}


def handle(line):
    """One request, one answer: a line of JSON each."""
    try:
        req = json.loads(line)
        op = OPS.get(req.get("op"))
        if not op:
            raise Refuse("This console doesn't know that request.")
        out = op(req)
        out["ok"] = True
    except Refuse as e:
        out = {"ok": False, "refuse": e.args[0]}
    except (KeyError, ValueError, TypeError, IndexError, AttributeError) as e:
        out = {"ok": False, "refuse": "A request this console can't read (%s %s)." % (type(e).__name__, e)}
    return json.dumps(out)
