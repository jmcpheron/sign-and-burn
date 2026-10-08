# Bunker mode: the motivation

## The worry

Almost every wallet today signs with elliptic curves: secp256k1 for Ethereum accounts, P-256 for
passkeys. Their safety rests on one hard problem: from a public key, you can't work out the private
key. In October 2026 Justin Drake asked the industry to plan calmly for "bunker mode": the chance
that AI-accelerated mathematics breaks that problem before quantum computers do. Vitalik Buterin
agreed it is worth planning for, warned against rushed migrations, and said the safe rule for a
multisig is for each signer to change their key after each operation.

Nobody has shown that curves can be broken this way. Sign and Burn is a rehearsal on a test network.

## What follows from it

**A key that has never signed shows only a hash of itself.** An Ethereum address is a hash of a
public key. The public key itself appears only with the first signature. A curve break needs the
public key, so an address that has never signed has nothing to attack.

**A multisig doesn't help much on its own.** Each owner's signature shows that owner's public key. In
a 2-of-3, one transaction shows two keys, which is the whole threshold. After that, an attacker who
can break curves can sign for the Safe.

**So rotate after every use.** If every signature retires the key that made it, then whatever the
signature shows is already useless. The next key has never signed, so only a hash of it is public.

**Hash-based signatures make the rotation cheap and safe.** A Winternitz one-time signature rests on
SHA-256 alone, with no curve in it. Its public key is a single hash. It can sign exactly once, which
is exactly the rule above, enforced by the math ([one-time keys](one-time-keys.md)).

**Don't rush, and don't botch a migration.** Moving real money in a hurry is how money gets lost. A
test network lets people see the idea working before anyone moves anything.

## What Sign and Burn does with it

It keeps the Safe, which already works, and replaces one owner with a [seat](seat.md): a contract
that needs both a passkey's curve signature and a one-time signature, and names the next one-time
key in every approval. If curves break, an attacker can make curve signatures, but not the one-time
signature that each approval also needs. See [the shielded Safe](shielded-safe.md) for what is
visible on chain at each moment.

Whether that holds in practice depends on more than the math: a key must never sign twice, even
when transactions fail or devices change, and the Safe's other owners must not be able to reach the
threshold without the seat. Those are [the open questions](../research.md).
