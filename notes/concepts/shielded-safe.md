# The shielded Safe, and the key ladder

A **shielded Safe** is an ordinary Safe 1.4.1 whose one owner is a [seat](seat.md). The seat shows
the chain nothing about its next key except a fingerprint: a SHA-256 hash of it. The key itself
appears only in the transaction that uses it, and that same transaction retires it.

## The ladder

```
key 0    burned    its signature is public, and useless now
key 1    burned
key 2    current   only its fingerprint is on chain
key 3…   unseen    not even a fingerprint yet
```

Every approval moves the ladder up one rung, in one transaction:

1. **Reveal.** Key `n`'s one-time signature goes on chain. Key `n` is spent.
2. **Run.** The Safe runs the transaction it approved.
3. **Rotate.** The seat records key `n+1`'s fingerprint, which the signature itself named.

## What anyone can see, and when

| moment | on chain | what an attacker could do with it |
|---|---|---|
| Before the build | nothing | nothing |
| After the build | the passkey's P-256 public key (in its signer contract), key 0's fingerprint, the Safe | break the curve: make curve signatures. Not enough: the seat also wants key 0's one-time signature, and a fingerprint can't be reversed |
| After approval `n` | key `n`'s 67 revealed values, key `n+1`'s fingerprint | the revealed values belong to a spent key; the seat now wants key `n+1` |

The passkey's curve public key is public from the start, because Safe's passkey signer needs it. That
is fine here: the curve half alone gets nowhere. The one-time half is the one that is never public
before it is used.

The wallet that pays the gas has a curve key too, and it signs every transaction it sends. It holds
only gas money and owns nothing in the Safe ([one press](one-press.md)).

## What it would take to take the Safe

A signature by the current key, over a message that names the attacker's own next key. That takes
the current key's seed, which only the passkey's PRF can make ([the passkey](passkey.md)). So the
attacker needs your unlocked passkey, not a curve break.

The one weak spot is the rule the seat can't enforce: a key must sign only once. Two signatures with
one key show enough to forge a third. The console keeps that rule ([the guardrail](guardrail.md)).

## On the page

The side panel shows the Safe and its seat. **The key ladder** shows burned, current and unseen keys
and, next to it, *what an attacker sees* and *what they would need*. After each press, the console
draws what the burned key revealed: one value on each of its 67 chains.
