"""Sign and Burn: the one-time keys and messages, v1. Standard library only.

The byte encodings are frozen by reference/vectors/v1.json. A change to any of them is a new tag
("sign-and-burn/<purpose>/v2"), never a changed meaning. Integers are big-endian at the width of the
Solidity type they have on chain: chainId uint256 (32), address (20), seatNumber uint32 (4),
n uint64 (8), j and s uint8 (1). See KICKOFF.md ("The one-time keys", "The messages").
"""
from hashlib import sha256

W = 16                 # Winternitz parameter: digits 0..15
STEPS = W - 1          # 15 steps per chain
MSG_CHAINS = 64        # 256 bits of message, 4 bits each
SUM_CHAINS = 3         # the checksum, at most 960 = 0x3c0
CHAINS = MSG_CHAINS + SUM_CHAINS   # 67

TAG_SEED = b"sign-and-burn/seed/v1"
TAG_PRF = b"sign-and-burn/prf/v1"
TAG_SK = b"sign-and-burn/sk/v1"
TAG_APPROVE = b"sign-and-burn/approve/v1"
TAG_ONE_TIME = b"sign-and-burn/one-time/v1"


def h(*parts):
    return sha256(b"".join(parts)).digest()


def u(value, size):
    return value.to_bytes(size, "big")


def _need(name, b, size):
    if len(b) != size:
        raise ValueError("%s must be %d bytes, not %d" % (name, size, len(b)))
    return b


def pub_seed(chain_id, curve_signer, seat_number):
    return h(TAG_SEED, u(chain_id, 32), _need("curve_signer", curve_signer, 20), u(seat_number, 4))


def prf_salt(chain_id, curve_signer, seat_number, n):
    """The label the page gives the passkey's PRF for key n. The passkey's answer is seed(n)."""
    return h(TAG_PRF, u(chain_id, 32), _need("curve_signer", curve_signer, 20), u(seat_number, 4), u(n, 8))


def secret(seed, j):
    return h(TAG_SK, _need("seed", seed, 32), u(j, 1))


def step(pub, n, j, s, x):
    """One step of chain j, from position s to s+1."""
    return h(pub, u(n, 8), u(j, 1), u(s, 1), x)


def advance(pub, n, j, x, start, stop):
    """x is at position start; walk it to position stop."""
    for s in range(start, stop):
        x = step(pub, n, j, s, x)
    return x


def chain_end(pub, n, j, seed):
    return advance(pub, n, j, secret(seed, j), 0, STEPS)


def fingerprint_of_ends(pub, n, ends):
    if len(ends) != CHAINS:
        raise ValueError("need %d chain ends" % CHAINS)
    return h(pub, u(n, 8), *ends)


def key_fingerprint(pub, n, seed):
    """K(n): what the chain stores for key n."""
    return fingerprint_of_ends(pub, n, [chain_end(pub, n, j, seed) for j in range(CHAINS)])


def digits(m):
    """The 67 digits of a 32-byte message: 64 of it, high nibble first, then the checksum."""
    d = []
    for byte in _need("m", m, 32):
        d += [byte >> 4, byte & 15]
    c = sum(STEPS - x for x in d)
    return d + [c >> 8, (c >> 4) & 15, c & 15]


def sign(pub, n, seed, m):
    """Reveal chain j at position d[j]. Sign each key once, ever (KICKOFF.md, "The guardrail")."""
    return [advance(pub, n, j, secret(seed, j), 0, d) for j, d in enumerate(digits(m))]


def recover(pub, n, m, sig):
    """Step each revealed value to the top and hash the ends: the fingerprint this signature is for.
    The signature is good for key n exactly when this equals K(n)."""
    if len(sig) != CHAINS:
        raise ValueError("need %d values" % CHAINS)
    ends = [advance(pub, n, j, _need("sig[%d]" % j, x, 32), d, STEPS) for j, (x, d) in enumerate(zip(sig, digits(m)))]
    return fingerprint_of_ends(pub, n, ends)


def approval_hash(chain_id, seat, safe, n, safe_tx_hash):
    """c: what the passkey's curve signature covers."""
    return h(TAG_APPROVE, u(chain_id, 32), _need("seat", seat, 20), _need("safe", safe, 20), u(n, 8),
             _need("safe_tx_hash", safe_tx_hash, 32))


def one_time_message(c, next_key):
    """m: what one-time key n signs. It holds the next key, so changing it needs a forged signature."""
    return h(TAG_ONE_TIME, _need("c", c, 32), _need("next_key", next_key, 32))
