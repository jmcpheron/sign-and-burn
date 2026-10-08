# One-time keys: Winternitz signatures

Sign and Burn's one-time keys are Winternitz signatures (WOTS), with a tweak per step in the style of
WOTS+. They use SHA-256 and nothing else. The exact bytes are frozen by
`reference/vectors/v1.json`; the code is `reference/python/sign_and_burn.py`.

| | |
|---|---|
| Hash | SHA-256 |
| Winternitz parameter | w = 16: each digit is 0 to 15 |
| Chains | 64 for the message, 3 for the checksum: 67 |
| Steps per chain | 15 |
| Signature | 67 × 32 bytes = 2,144 bytes |
| Public key (fingerprint) | 32 bytes |

## A chain

Start from a secret. Hash it, hash the result, and so on, 15 times. The last value is the chain's
**end**.

```
secret ─h→ x1 ─h→ x2 ─h→ … ─h→ x14 ─h→ end
 pos 0     pos 1    pos 2          pos 14  pos 15
```

Anyone can walk **up** a chain: hash a value and you get the next one. Nobody can walk **down**: that
would mean undoing a hash.

## The key

A key has 67 chains. Its secrets come from one 32-byte seed: `secret(j) = sha256("sign-and-burn/sk/v1"
‖ seed ‖ j)`. The key's **fingerprint** is a hash of the 67 chain ends. That fingerprint is all the
seat stores.

## Signing

The message is 32 bytes: 64 hex digits, each 0 to 15. For chain `j`, the signature reveals the value
at position `d[j]`, where `d[j]` is the message's `j`-th digit.

**Checking** is the same walk the rest of the way: step each revealed value from position `d[j]` up to
15, hash the 67 ends, and compare with the fingerprint. The seat does this in `OneTimeKey.sol`: about
500 SHA-256 calls on average.

## The checksum

A forger who has your signature can walk any revealed value further up its chain. That turns your
message into one with some digits pushed up, and the signature would still check. The three checksum
chains stop it:

```
C = Σ (15 − d[i])  over the 64 message digits     at most 960, three more digits
```

Pushing any message digit up pushes `C` down. To match, the forger would have to walk a checksum chain
**down**, which means undoing a hash.

## Why only once

One signature shows, on each chain, one position. Two signatures with the same key show, on each
chain, the lower of two positions. Anyone can compute everything above the lowest position shown. With
enough low positions, a forger can find a message whose every digit (checksum included) sits at or
above them, and sign it without any secret.

How hard that is depends on how many signatures leaked:

| signatures by one key | chance per tried message (the 64 message digits only) | tries |
|---|---|---|
| 1 | 0 | impossible: the checksum blocks it |
| 2 | about 1 in 10^10 | a GPU's work |
| 4 | about 1 in 150,000 | well under a second in a browser |

The forger chooses the message's next key, so they can try as many messages as they like. The attack
room's **danger case** does this with a throwaway key; `site/test.mjs` forges after about 175,000
tries from four signatures. That is why [the guardrail](guardrail.md) exists.

## Tweaks: n, j, s and pubSeed

Every step hashes more than the value: `F(x) = sha256(pubSeed ‖ n ‖ j ‖ s ‖ x)`. `pubSeed` is fixed
per seat (chain, signer, seat number), `n` is the key number, `j` the chain and `s` the step. So no two
steps anywhere, in any seat, key or chain, hash the same input. A value revealed by one key is useless
for any other key, seat or chain.

## Where the seeds come from

From the passkey's PRF: one seed per key, `seed(n) = PRF(salt(n))` ([the passkey](passkey.md)). The
seeds never exist anywhere for longer than one request to the console.
