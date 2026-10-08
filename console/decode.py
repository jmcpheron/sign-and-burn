# A Safe transaction's fields in plain language, one item per thing it does. From PicoQuorum's
# console. Pure (no screen, no network), so console/test/run.py checks it on CPython and on
# MicroPython.
#
# Everything here is decoded from the same to/value/data/operation that safe_tx.py hashes. Nobody
# else's decoding is read. Names come from the pinned config (cfg.py) and are hints: an item always
# carries the full address too.
#
#   ctx = context(cfg.CFG, safe)
#   review(tx, ctx) -> {"summary": "Send 1.5 ETH", "level": "ok" | "warn" | "red", "items": [...]}
#
# An item is a dict: title (one screen header), level, what (one line), and as needed amount,
# to and label (what that address is: "to", "new owner", "spender"...), frm and frm_label (an
# address being replaced or moved from), text (the explanation), and for calls nobody decoded
# selector, size and digest (ERC-8213's calldata digest, to compare with what the proposer sent).
# Items that call a contract carry it as "contract"; identify() says whether it is a known one.
# "red" is anything that can take the Safe away from its owners or pay out more than it shows:
# owner, threshold, module, guard and handler changes, delegatecall, gas refunds, unlimited
# approvals, and every call this file cannot decode.
from binascii import hexlify
from keccak import keccak256

CALL, DELEGATECALL = 0, 1
LEVELS = ("ok", "warn", "red")
ZERO = "0x0000000000000000000000000000000000000000"
UNLIMITED = 1 << 255    # approvals at or above this are "forever" (max uint256 is the usual one)

# selector -> signature. console/test/run.py checks every one against keccak.
SIGS = {
    "a9059cbb": "transfer(address,uint256)",
    "095ea7b3": "approve(address,uint256)",
    "23b872dd": "transferFrom(address,address,uint256)",
    "8d80ff0a": "multiSend(bytes)",
    "0d582f13": "addOwnerWithThreshold(address,uint256)",
    "f8dc5dd9": "removeOwner(address,address,uint256)",
    "e318b52b": "swapOwner(address,address,address)",
    "694e80c3": "changeThreshold(uint256)",
    "610b5925": "enableModule(address)",
    "e009cfde": "disableModule(address,address)",
    "e19a9dd9": "setGuard(address)",
    "f08a0323": "setFallbackHandler(address)",
}

DONT = "Don't sign unless you were told exactly what to expect."
AS_SAFE = "Runs this contract's code as the Safe itself: it could move everything and change the owners."


def hx(b):
    return "0x" + hexlify(b).decode()


def _bytes(h):
    if isinstance(h, (bytes, bytearray)):
        return bytes(h)
    h = h[2:] if h.startswith("0x") else h
    return bytes.fromhex(h)


def group(n):
    """12345678 -> 12,345,678"""
    s, out = str(n), ""
    while len(s) > 3:
        out = "," + s[-3:] + out
        s = s[:-3]
    return s + out


def units(n, decimals):
    """An integer amount in its token's units, every significant digit kept: 1500000, 6 -> 1.5"""
    whole, frac = divmod(int(n), 10 ** decimals)
    if not frac:
        return group(whole)
    f = str(frac)
    f = ("0" * (decimals - len(f)) + f).rstrip("0")
    return group(whole) + "." + f


def for_chain(cfg, key, chain):
    """One of cfg's per-chain lists ("tokens", "batchers", "contracts", "delegates") for this chain,
    lowercase: the "*" entries (the same contract everywhere) and the chain's own, or those of the
    chain it is the same as (cfg["sameAs"]: the Anvil fork of Base has Base's). None: every chain's."""
    lists = cfg.get(key, {})
    if chain is None:
        keys = list(lists)
    else:
        c = str(chain)
        keys = ["*", cfg.get("sameAs", {}).get(c, c)]
    out = {}
    for k in keys:
        for a, v in lists.get(k, {}).items():
            out[a.lower()] = v
    return out


def context(cfg, safe, names=None, chain=None):
    """What review() needs from the pinned config, with lowercase keys, for a Safe on this chain.
    names: extra {address: name}, such as the seat. Tokens, batchers, contracts and delegates are
    this chain's (for_chain)."""
    book = {}
    for a, n in cfg.get("book", {}).items():
        book[a.lower()] = n
    for a, n in (names or {}).items():
        book[a.lower()] = n
    return {"safe": safe.lower(), "book": book, "tokens": for_chain(cfg, "tokens", chain),
            "batchers": for_chain(cfg, "batchers", chain), "contracts": for_chain(cfg, "contracts", chain),
            "delegates": for_chain(cfg, "delegates", chain)}


def name(ctx, a):
    return ctx["book"].get(a.lower())


def identify(ctx, a):
    """(name, logo, known) for an address: this Safe, a pinned contract, or a name from the
    address book (people have no logo). (None, None, False) for anything else."""
    a = a.lower()
    if a == ctx["safe"]:
        return "This Safe", "safe", True
    k = ctx["contracts"].get(a)
    if k:
        return k[0], k[1], True
    n = ctx["book"].get(a)
    if n:
        return n, None, True
    return None, None, False


# ----------------------------------------------------------------------------- ABI words
def _word(args, i):
    w = args[32 * i:32 * i + 32]
    if len(w) != 32:
        raise ValueError("calldata too short")
    return int.from_bytes(w, "big")


def _addr(args, i):
    n = _word(args, i)
    if n >> 160:
        raise ValueError("not an address")
    return hx(n.to_bytes(20, "big"))


def unpack_multisend(data):
    """multiSend(bytes) calldata -> [(operation, to, value, data), ...]"""
    args = data[4:]
    off = _word(args, 0)
    n = int.from_bytes(args[off:off + 32], "big")
    p = args[off + 32:off + 32 + n]
    if len(p) != n:
        raise ValueError("batch too short")
    calls, i = [], 0
    while i < n:
        if i + 85 > n:
            raise ValueError("batch entry too short")
        op = p[i]
        to = hx(p[i + 1:i + 21])
        value = int.from_bytes(p[i + 21:i + 53], "big")
        ln = int.from_bytes(p[i + 53:i + 85], "big")
        if i + 85 + ln > n:
            raise ValueError("batch entry too short")
        calls.append((op, to, value, p[i + 85:i + 85 + ln]))
        i += 85 + ln
    return calls


def calldata_digest(data):
    """ERC-8213's Calldata Digest: keccak256(uint256(length) || calldata)."""
    return keccak256(len(data).to_bytes(32, "big") + data)


# ----------------------------------------------------------------------------- one call
def _unknown(to, data, why=""):
    sel = hx(data[:4]) if len(data) >= 4 else hx(data)
    return {"title": "UNKNOWN CALL", "level": "red", "what": "Unknown call", "to": to, "label": "contract",
            "text": (why + " " if why else "") + DONT, "selector": sel, "size": len(data), "contract": to,
            "digest": hx(calldata_digest(data))}


def _self_call(sel, args, ctx):
    """The Safe calling itself: its own settings. Every one of these is red."""
    if sel == "0d582f13":
        owner, t = _addr(args, 0), _word(args, 1)
        return {"title": "ADD OWNER", "level": "red", "what": "Add owner", "to": owner, "label": "new owner",
                "text": "Adds this address as an owner, with a vote on everything the Safe does. Approvals needed becomes %d." % t}
    if sel == "f8dc5dd9":
        owner, t = _addr(args, 1), _word(args, 2)
        return {"title": "REMOVE OWNER", "level": "red", "what": "Remove owner", "to": owner, "label": "owner",
                "text": "Removes this owner. Approvals needed becomes %d." % t}
    if sel == "e318b52b":
        old, new = _addr(args, 1), _addr(args, 2)
        return {"title": "SWAP OWNER", "level": "red", "what": "Replace owner", "to": new, "label": "new owner",
                "frm": old, "frm_label": "replaces",
                "text": "Removes one owner and puts the address below in its place, with the same vote."}
    if sel == "694e80c3":
        t = _word(args, 0)
        return {"title": "THRESHOLD", "level": "red", "what": "Approvals needed: %d" % t, "amount": "%d NEEDED" % t,
                "text": "Changes how many owners must approve every transaction from now on, to %d." % t}
    if sel == "610b5925":
        return {"title": "ADD MODULE", "level": "red", "what": "Add module", "to": _addr(args, 0), "label": "module",
                "text": "This contract will be able to move funds and change owners WITHOUT any owner approval."}
    if sel == "e009cfde":
        return {"title": "REMOVE MODULE", "level": "red", "what": "Remove module", "to": _addr(args, 1), "label": "module",
                "text": "Turns off this module; it can no longer act for the Safe."}
    if sel == "e19a9dd9":
        g = _addr(args, 0)
        if g == ZERO:
            return {"title": "REMOVE GUARD", "level": "red", "what": "Remove guard",
                    "text": "Turns off the transaction guard; nothing checks transactions after this."}
        return {"title": "SET GUARD", "level": "red", "what": "Set guard", "to": g, "label": "guard",
                "text": "This contract will check, and can block, every future transaction. A broken guard can lock the Safe for good."}
    if sel == "f08a0323":
        return {"title": "FALLBACK", "level": "red", "what": "Set fallback handler", "to": _addr(args, 0), "label": "handler",
                "text": "This contract answers calls the Safe does not know itself, including checks of messages the Safe has signed."}
    return None


def _token_call(sel, to, args, ctx):
    tok = ctx["tokens"].get(to)
    sym, dec = (tok[0], tok[1]) if tok else ("TOKEN", 0)
    note = "" if tok else " This token is not in the console's list, so the amount is in raw units."
    if sel == "a9059cbb":
        dest, amt = _addr(args, 0), _word(args, 1)
        return {"title": "SEND " + sym, "level": "ok" if tok else "warn", "what": "Send %s %s" % (units(amt, dec), sym),
                "amount": "%s %s" % (units(amt, dec), sym), "to": dest, "text": ("Token " + to + "." + note) if not tok else ""}
    if sel == "095ea7b3":
        sp, amt = _addr(args, 0), _word(args, 1)
        if amt >= UNLIMITED:
            return {"title": "APPROVE " + sym, "level": "red", "what": "Approve UNLIMITED " + sym, "amount": "UNLIMITED " + sym,
                    "to": sp, "label": "spender", "text": "The address below can take every %s this Safe holds, now and later, until someone revokes it.%s" % (sym, note)}
        return {"title": "APPROVE " + sym, "level": "ok" if tok else "warn", "what": "Approve %s %s" % (units(amt, dec), sym),
                "amount": "%s %s" % (units(amt, dec), sym), "to": sp, "label": "spender",
                "text": "The address below may take up to this much from the Safe." + note}
    if sel == "23b872dd":
        src, dest, amt = _addr(args, 0), _addr(args, 1), _word(args, 2)
        return {"title": "MOVE " + sym, "level": "ok" if tok else "warn", "what": "Move %s %s" % (units(amt, dec), sym),
                "amount": "%s %s" % (units(amt, dec), sym), "to": dest, "frm": src, "frm_label": "from",
                "text": "Moves tokens out of another address that approved this Safe." + note}
    return None


def _call(to, value, data, ctx):
    """One plain CALL -> [item]"""
    to = to.lower()
    if not data:
        if to == ctx["safe"] and value == 0:
            return [{"title": "REJECTION", "level": "ok", "what": "On-chain rejection",
                     "text": "Does nothing. Once executed it uses up this transaction number, cancelling every other transaction waiting on it."}]
        if value == 0:
            return [{"title": "EMPTY CALL", "level": "warn", "what": "Empty call", "to": to, "label": "address",
                     "text": "Sends nothing and calls nothing, unless the address is a contract."}]
        return [{"title": "SEND ETH", "level": "ok", "what": "Send %s ETH" % units(value, 18),
                 "amount": units(value, 18) + " ETH", "to": to}]
    if len(data) < 4:
        return [_unknown(to, data)]
    sel, args = hexlify(data[:4]).decode(), data[4:]
    try:
        it = _self_call(sel, args, ctx) if to == ctx["safe"] else _token_call(sel, to, args, ctx)
    except ValueError as e:
        return [_unknown(to, data, "Could not read it (%s)." % e)]
    if it is None:
        k = ctx["contracts"].get(to)
        call = k[2].get(sel) if k else None
        if not call:
            return [_unknown(to, data)]
        it = {"title": "CONTRACT CALL", "level": "warn", "what": call[1], "to": to, "label": "contract",
              "text": "Known contract, but this call isn't decoded here. Confirm what it does with the proposer.",
              "selector": hx(data[:4]), "size": len(data), "digest": hx(calldata_digest(data))}
    it["contract"] = to
    if value:
        it["text"] = (it.get("text", "") + " Also sends %s ETH with the call." % units(value, 18)).strip()
        if it["level"] == "ok":
            it["level"] = "warn"
    return [it]


# ----------------------------------------------------------------------------- the transaction
def _gas(tx, ctx):
    gp = int(tx.get("gasPrice") or 0)
    token = (tx.get("gasToken") or ZERO).lower()
    rr = (tx.get("refundReceiver") or ZERO).lower()
    base, stg = int(tx.get("baseGas") or 0), int(tx.get("safeTxGas") or 0)
    if gp:
        if token == ZERO:
            price = units(gp, 18) + " ETH"
        elif token in ctx["tokens"]:
            sym, dec = ctx["tokens"][token]
            price = "%s %s" % (units(gp, dec), sym)
        else:
            price = "%d raw units of the token %s" % (gp, token)
        return {"title": "GAS REFUND", "level": "red", "what": "Pays a gas refund",
                "to": rr if rr != ZERO else None, "label": "paid to",
                "text": "Whoever executes this is paid by the Safe: %s for every unit of gas used, plus %d more units. Paid to %s." % (
                    price, base, "the address below" if rr != ZERO else "whoever sends it")}
    if base or stg or token != ZERO or rr != ZERO:
        return {"title": "GAS FIELDS", "level": "warn", "what": "Unusual gas fields",
                "text": "safeTxGas %d, baseGas %d. No refund is paid because gasPrice is 0." % (stg, base)}
    return None


def worst(items):
    return LEVELS[max([LEVELS.index(i["level"]) for i in items] + [0])]


def review(tx, ctx):
    """The screen's view of a transaction. "refuse" is set when the console must not sign it at
    all, however long A is held: an operation the Safe does not have, or a delegatecall anywhere
    except to a pinned batcher (cfg "batchers", for a multiSend) or a pinned delegate (cfg
    "delegates"). A delegatecall runs the target's code as the Safe itself, so an unpinned one could
    move everything and change the owners (the attack that emptied Bybit's Safe in 2025)."""
    op = int(tx["operation"])
    to = tx["to"].lower()
    value = int(tx["value"])
    data = _bytes(tx.get("data") or "0x")
    items = []
    refuse = ""
    if op not in (CALL, DELEGATECALL):
        refuse = "Operation %d is neither a call nor a delegatecall." % op
    elif op == DELEGATECALL and not (to in ctx["delegates"] or (to in ctx["batchers"] and data[:4] == b"\x8d\x80\xff\x0a")):
        refuse = "A delegatecall to a contract this console has not pinned. It would run that code as the Safe itself."
    if op == DELEGATECALL and to in ctx["batchers"] and data[:4] == b"\x8d\x80\xff\x0a":
        try:
            calls = unpack_multisend(data)
        except (ValueError, IndexError) as e:
            calls = None
            items.append(_unknown(to, data, "A batch that could not be read (%s)." % e))
        if calls is not None:
            for iop, ito, ival, idata in calls:
                if iop != CALL:
                    items.append({"title": "DELEGATECALL", "level": "red", "what": "Delegatecall inside a batch", "to": ito,
                                  "label": "contract", "text": AS_SAFE})
                    refuse = refuse or "A delegatecall inside the batch. It would run that code as the Safe itself."
                else:
                    items += _call(ito, ival, idata, ctx)
            summary = "Batch: %d action%s" % (len(calls), "" if len(calls) == 1 else "s")
        else:
            summary = "Unreadable batch"
    elif op == DELEGATECALL:
        items.append({"title": "DELEGATECALL", "level": "red", "what": "Delegatecall", "to": to, "label": "contract",
                      "text": AS_SAFE, "selector": hx(data[:4]), "size": len(data), "contract": to,
                      "digest": hx(calldata_digest(data))})
        summary = "Delegatecall"
    else:
        items += _call(to, value, data, ctx)
        summary = items[0]["what"]
    g = _gas(tx, ctx)
    if g:
        items.append(g)
    # the contract the Safe calls first (a token, the batch helper, itself), for the header
    return {"summary": summary, "level": worst(items), "items": items, "contract": to if data else None,
            "refuse": refuse}
