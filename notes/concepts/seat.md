# The seat: one owner of a Safe

The seat is the one contract Sign and Burn adds (`contracts/src/Seat.sol`). It is an owner of a Safe,
like a person would be. It approves a Safe transaction only when two signatures check out, and every
approval names its next key.

## What it holds

| | |
|---|---|
| `curveSigner` | the passkey's SafeWebAuthnSignerProxy (fixed) |
| `seatNumber`, `pubSeed` | which run of one-time keys this seat uses (fixed) |
| `current` | the fingerprint of one-time key `n` |
| `n` | how many approvals it has made |
| `approvedIn(k)` | the block approval `k` landed in |

No admin, no owner, no upgrade, no pause, no recovery key. The Safe replaces a seat the way it
replaces any owner.

## `approve(safe, safeTxHash, nextKey, oneTime, curveSig)`

1. Build `c` and `m` from the seat's own `n`, never from a number in the call ([the messages](messages.md)).
2. Refuse a `nextKey` that is zero or equal to `current` (`BadNextKey`).
3. Check the one-time signature: walk it up its chains, hash the ends, compare with `current`
   (`BadOneTimeSignature`).
4. Check the curve signature: `curveSigner.isValidSignature(c, curveSig)` must answer `0x1626ba7e`
   (`BadCurveSignature`).
5. Burn: `current = nextKey`, `n += 1`, record `approvedIn`, emit `Approved`.
6. Vote: call `safe.approveHash(safeTxHash)`. If the seat isn't an owner of that Safe, everything
   reverts and the key is not spent.

Anyone may call `approve`. Everything in the call is bound by the signatures, so a copied call can only
do exactly what was signed, once.

## Why it votes on chain

Safe owners usually sign off chain, and the Safe checks their signatures when it runs the transaction.
But the Safe makes that check read-only (a `view` call), and a read-only check could never mark a
one-time key as spent. So the seat checks, burns the key, records the next one and votes with
`approveHash`, which Safe has had since its first versions, all in one call.

## The factory

`SeatFactory.createSeat(signer, seatNumber, firstKey)` deploys a seat with CREATE2, so its address is
known before it exists. `seatsOf(signer)` lists a passkey's seats.

The factory itself goes through the CREATE2 deployer with salt 0, so it sits at
`0x0a6514135d34dfd19c3f1a636f3e952caeba3871` on every chain, deployable by anyone. The first build on
Base Sepolia deployed it, on 2026-10-08. Its code there is byte for byte this repository's build.

Anyone can make a seat for any passkey, with any first key. A seat whose first key isn't that passkey's
own can't be signed for: the console checks key `n`'s fingerprint against `current` before any
one-time signature leaves it.

## Why the indexes

Base Sepolia's public RPC searches logs at most 500 blocks (about 17 minutes) at a time. So the page
can't find a passkey's seats or a seat's history by scanning events. `seatsOf` and `approvedIn` let it
find them with one call each: `approvedIn(k)` names the block, and one log query of that one block
finds the event and the transaction, with the revealed signature in it.

## Gas

About 660,000 gas a press with the P-256 precompile, which Base Sepolia has; about 990,000 without it.
Most of it is about 500 SHA-256 calls in plain Solidity, and 3,556 bytes of calldata. The first build
on Base Sepolia (factory, signer, seat, Safe) used 2,191,473 gas: about 0.000013 test ETH at the price
then. Numbers and how they were measured: `contracts/README.md`.
