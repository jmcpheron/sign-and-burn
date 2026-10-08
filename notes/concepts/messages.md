# The messages, byte by byte

Every value Sign and Burn hashes starts with a tag, `sign-and-burn/<purpose>/v1`. A new version of a
format gets a new tag, never a changed meaning. Integers are big-endian at the width of their
Solidity type: chainId 32 bytes, addresses 20, seatNumber 4, `n` 8, `j` and `s` 1. `‖` joins bytes.

## Per seat

```
pubSeed  = sha256("sign-and-burn/seed/v1" ‖ chainId ‖ signer ‖ seatNumber)
```

Fixed for the life of a seat; the seat computes it in its constructor. It goes into every step of
every chain, so two seats never share anything.

## Per key

```
salt(n)      = sha256("sign-and-burn/prf/v1" ‖ chainId ‖ signer ‖ seatNumber ‖ n)    what the passkey's PRF is asked
seed(n)      = PRF(salt(n))                                                            the passkey's answer
secret(n, j) = sha256("sign-and-burn/sk/v1" ‖ seed(n) ‖ j)                             j = 0 … 66
F(x)         = sha256(pubSeed ‖ n ‖ j ‖ s ‖ x)                                         one step of chain j, from s to s+1
K(n)         = sha256(pubSeed ‖ n ‖ end(0) ‖ … ‖ end(66))                              the key's fingerprint
```

## Per approval

```
c = sha256("sign-and-burn/approve/v1"  ‖ chainId ‖ seat ‖ safe ‖ n ‖ safeTxHash)    the passkey signs c
m = sha256("sign-and-burn/one-time/v1" ‖ c ‖ nextKey)                             key n signs m
```

What each field stops:

| field | in | without it |
|---|---|---|
| `chainId` | `c` | an approval could be replayed on another chain |
| `seat` | `c` | one seat's approval could be used by another |
| `safe` | `c` | an approval could be pointed at another Safe the seat owns |
| `n` | `c` | an old approval could be replayed |
| `safeTxHash` | `c` | the approval could be used for another transaction |
| `nextKey` | `m` | an attacker could swap in their own next key and take the seat |

The Safe transaction hash already holds the Safe's address and chain (its EIP-712 domain). They are in
`c` as well, so an approval reads plainly and can't be moved.

## Who builds what

The **console** builds `c` and `m` itself, from the fields on its screen and the seat's own `n` read
from the chain. It never takes a hash from the page, the wallet or anyone else. The **seat** builds
them again from its own state and checks both signatures against them.

## Checked by

`reference/vectors/v1.json` holds every intermediate value for 7 cases. The Python reference, the
JavaScript reference, the Solidity, the page's JavaScript and the console on MicroPython all give the
same bytes. On 2026-10-08, a real passkey's `pubSeed` and salts, as the console printed them, were
recomputed outside the browser and matched ([the log](../log/2026-10-08-03-wallets-and-first-build.md)).
