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

## Who pays for the build

The build is one transaction, and nothing in it is approved by whoever sends it: anyone may deploy
the SeatFactory, a passkey's signer, a seat and its Safe. So the device with the passkey doesn't need
a wallet. A phone can make the passkey and key 0, then share a link; a wallet on another device opens
it and pays the gas.

The link (`sign-and-burn/build/v1`, in the URL's fragment, which the browser doesn't send to the
server) holds only public values that go on chain in the build anyway: the passkey's curve (P-256)
public key, which its signer contract holds; the seat number; and key 0's fingerprint. The fingerprint
is a hash of key 0's public key, not the key: the seat, the Safe's owner, holds only that, and key 0
stays unseen until the approval that spends it. So the link shows the curve half, which is public
from the start anyway, and nothing of the one-time half but a hash. No seeds, no addresses, no calls. The page that opens it works
out the signer, the seat and the Safe from those values and the chain (and the console works out the
signer too), shows them, and only then asks its wallet to pay. A link that named calls could make a
wallet send anything; this one can't. A tampered link builds a seat nobody can sign for: the payer
loses its gas, and the phone never sees that seat, because it looks only at the addresses it worked
out itself. Meanwhile the phone's page reads the chain every few seconds and moves on when the Safe
is built, and again when it has ETH. The paying page offers to send that ETH too.

The same request could go to a relay that pays the gas: it would rebuild the same calls the same way
(`site/src/pay.mjs`). None exists yet, and the page makes no call to one. Presses aren't covered:
each press is still sent by a wallet in the browser that signed it, because the console's ledger
tracks what it sent.

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
