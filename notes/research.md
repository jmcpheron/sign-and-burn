# Open questions

Sign and Burn puts established ideas together around an ordinary Safe. None of the cryptography is
new: hash-based one-time signatures, keys derived from one secret, and key rotation all have a long
history. What may be new is the way they are combined into a working approval system:
- **A stable seat, a changing key.** Each signer keeps one seat in the Safe. The key that authorizes
  the seat changes after every approval. The Safe keeps its address, its assets and its threshold.
- **Two signatures per approval.** Each approval needs a passkey's curve signature and a hash-based
  one-time signature. If curve signatures become forgeable, the one-time signature still has to
  authorize the transaction.
- **A console that signs only what it checked.** It works out the Safe transaction hash itself and
  shows the transaction before anything is signed.
- **One-time signing that survives ordinary failure.** A key is spent once its signature is public,
  even if the transaction never lands. So the system has to remember which message each key was
  given, send that same approval again if needed, and never let a key sign a second message. This
  may be the strongest contribution, and it is the least finished.

What can be said today: Sign and Burn explores a practical integration of established cryptography
with an independent review of each transaction. Whether that integration is novel, and whether it
gives the protection it aims for, depends on the exact construction and on how it behaves under
failure. These are the questions that decide it.

Any change to the contracts names the questions it touches and updates this file
([reviews/](reviews/README.md) has the process).

| | question | status |
|---|---|---|
| 1 | [Complete authorization](#1-complete-authorization) | **open**: the curve signature doesn't cover the next key |
| 2 | [Retirement and execution](#2-retirement-and-execution) | mostly answered; a reentrancy test to add |
| 3 | [Signer state](#3-signer-state) | **open**: one device, one browser only |
| 4 | [Secret handling](#4-secret-handling) | partly answered; a board's chip not yet |
| 5 | [Recovery and bypasses](#5-recovery-and-bypasses) | **open**: the demo is 1 of 1 |
| 6 | [Practical cost](#6-practical-cost) | measured on Base Sepolia; no comparisons yet |
| 7 | [Prior art and review](#7-prior-art-and-review) | **open**: no survey; a baseline AI review asked for |

## 1. Complete authorization

**The question.** The transaction, the next key, the chain, the Safe, the seat and the sequence
number must all be bound together. An approval must not work anywhere else, and it must not be
redirected to an attacker's next key.

**Today** (`Seat.approve`, [the messages](concepts/messages.md), and the contracts line by line in
[concepts/contracts.md](concepts/contracts.md)):
- `c = sha256("sign-and-burn/approve/v1" ‖ chainId ‖ seat ‖ safe ‖ n ‖ safeTxHash)`. Safe's own hash
  binds the chain and the Safe again, through its domain separator.
- `n` comes from the seat's storage, never from the call.
- `m = sha256("sign-and-burn/one-time/v1" ‖ c ‖ nextKey)`.
- The passkey signs `c`, and key `n` signs `m`.
- Checked by `contracts/test/Seat.t.sol` (replay, another Safe, another chain, swapping the next key,
  either signature alone) and by the attack room against the live seat.

**Open: the curve signature doesn't cover the next key.** The page learns `seed(n+1)` only during the
tap, and the tap's challenge is fixed before that, so `c` can't include `nextKey`. Only the
one-time signature binds the next key. Most of the time that is enough. It stops being enough if
one-time signatures can be forged (a bug in `OneTimeKey`, or a break of SHA-256) while curves still
hold. Then someone who sees an approval waiting in the mempool could keep its valid curve
signature, forge a one-time signature naming their own next key, and take the seat. The curve
signature still stops them from approving a different transaction, but not from taking the seat.

**A candidate fix: work out the next key one press early.**
- The tap at press `n` answers `seed(n)` (to sign) and `seed(n+2)`.
- The console keeps `K(n+2)`, which is public, for the following press.
- At press `n`, `K(n+1)` is already known from press `n-1`, so `c` can include it, and the passkey
  signs the next key too.
- Still one tap per press. The cost: building a seat needs `K(0)` and `K(1)`. A console that lost
  `K(n+1)` needs one extra tap, with no signature, to find it again.
- It changes `c` and the seat, so it would be new `/v2` tags and a new seat contract, never a change
  to v1.

**How to check.** A contract test that pairs a valid curve signature with a one-time signature for
another next key. Today that can't be built without forging. A test seat with a deliberately broken
`OneTimeKey` would show the gap and the fix.

## 2. Retirement and execution

**The question.** When exactly does the old key stop working, and when does the next one start? What
happens if the transaction it approves fails? What about rollback and reentrancy?

**Today:**
- `Seat.approve` checks both signatures, then writes `current = nextKey` and `n = k + 1`, then calls
  `safe.approveHash`. Key `n` dies in the same call that reveals its signature.
- If `approveHash` reverts (the seat isn't an owner of that Safe), everything reverts and the key
  isn't spent on chain (`test_safeThatDoesNotKnowTheSeat_keyNotSpent`). Its signature may still be
  public in a failed transaction. See question 3.
- A press is one Multicall3 call. `execTransaction` may fail without undoing the approval. The Safe
  keeps the seat's vote in `approvedHashes`, and anyone can run the transaction later
  (`test_approvalLandsWhenTheTransactionCannotRun`).

**Open:**
- **Reentrancy.** No test calls back into the seat from `safe`. The state is written before the
  external call, and a second `approve` would need key `n+1`'s signature, but a test should show it.
- **An approval that can never run.** The vote stays in `approvedHashes` forever. That is harmless
  in a 1-of-1, but in a real threshold it is a standing vote. Safe can cancel it by using the same
  nonce for another transaction. Write this down for a real multisig.

## 3. Signer state

**The question.** Prevent a key from signing twice across retries, crashes, backups, synced passkeys
and multiple devices. The chain alone can't show that a signature which never landed is already
public.

**Today** ([the guardrail](concepts/guardrail.md)):
- The console records each approval in its ledger before the answer leaves it. While approval `n`
  waits, it will only hand back that same approval.
- The ledger survives a reload (localStorage).
- A browser that finds the seat on chain with no ledger for it (a second device, or cleared storage)
  says so. Its hold button waits for a tick that nothing signed with key `n` is waiting elsewhere.
  It can't check that itself ([the page review](log/2026-10-08-05-page-review.md)).
- The page asks the seat where approval `n` landed (`approvedIn`), rather than trusting the
  receipt. So a copy sent first by someone else, or a smart-account wrapper that hides a revert,
  reads right.
- The e2e checks a refused wallet, a reload, a browser with no ledger, and a front-run.

**Open:**
- **Lost storage.** Clearing site data, a private window, or a restored backup loses the ledger. If
  the approval was sent and then dropped, the console can't tell that key `n` has signed.
- **Another device.** A synced passkey gives the same seeds on a second device, which has its own
  ledger. Two devices could each sign key `n` for different transactions. Today the page warns and
  asks, and the rule is one device per seat. A warning can't stop it.

**Candidates:**
- **Reserve on chain first.** A first transaction records "key `n` is for `hash(m)`" with the curve
  signature alone. The seat then accepts only that `m` for key `n`, and every device reads the
  reservation before signing. It costs a second transaction. Someone who can forge curve signatures
  could reserve first and block the seat, but couldn't take it.
- **A ledger that travels with the passkey.** WebAuthn's `largeBlob` extension stores bytes with
  the credential. Whether it syncs, and on which platforms, is untested.
- **Look before signing.** Search the mempool and recent blocks for any transaction carrying key `n`.
  It is cheap, but it can't see a transaction that was never broadcast.

## 4. Secret handling

**The question.** Keep the protected root separate from the secrets derived from it. Passkey PRF
answers (or a chip's HMAC answers) reach host memory. How long do they live there, and could one
answer reveal future keys?

**Today** ([the passkey](concepts/passkey.md)):
- The root is the passkey's PRF secret, which never leaves the authenticator.
- Each key has its own salt, `salt(n)`, so each PRF answer is the seed of exactly one key.
- A seed passes through the page's memory and one request to the console. It isn't stored, and the
  serial log redacts it.
- If PRF is a PRF, one seed says nothing about another.

**Open:**
- **How long seeds live.** JavaScript and MicroPython can't reliably wipe memory, and nobody has
  measured how long a seed stays in the heap.
- **Seeds pass through the page.** A hostile page or extension sees them ([trust](concepts/trust.md)),
  and every press shows it two seeds. A board that asks the chip for the seeds itself would keep them
  off the host. A chip's HMAC slot would play the PRF there.
- **Chips.** Which chips can do this (HMAC with a key that can't be read out), how fast, and how
  their answer is bound to user presence.

## 5. Recovery and bypasses

**The question.** Look at the whole Safe: the threshold, the other owners, modules, guards and
upgrades. A protected seat helps only if no required authorization can go around it.

**Today:**
- The demo Safe is 1 of 1, its only owner the seat, with no modules and no guard. Its fallback
  handler is Safe's standard one (`console/cfg.py`).
- The seat has no admin, no upgrade and no recovery key.
- A lost passkey leaves the demo Safe stuck.

**Open:**
- **A real threshold.** In a 2-of-3 with one seat and two ordinary owners, someone who can forge
  curve signatures can sign for both ordinary owners and reach the threshold without the seat. A
  Safe is protected only when every set of owners that meets the threshold includes enough seats.
  Write down that rule and check it on the page before a build.
- **Modules, guards, fallback handlers, `delegatecall`, and changes to owners or threshold.** Each
  is a way around the owners. The console already marks owner changes red and refuses unpinned
  delegatecalls; a full list is still to be written.
- **Replacing a seat.** The other owners swap it out with `swapOwner`. Rehearse that on the page in a
  2-of-2.

## 6. Practical cost

**The question.** Signature size, verification cost, a chip's speed, and what a press feels like.
How does a rotating chain of one-time keys compare with established hash-based schemes?

**Measured** ([testing/live.md](testing/live.md), [testing/contracts.md](testing/contracts.md)):
- A 2,144-byte one-time signature, most of a press's calldata.
- About 660,000 gas executed, and 870,000 to 920,000 all in through a smart-account wallet. That
  was about 0.0000053 test ETH at 0.006 gwei.
- One tap and one wallet confirmation a press.

**Open:**
- A press on a board: how long the console takes to sign on a Pico 2 W or an ESP32.
- **A comparison with established schemes:**
  - XMSS (RFC 8391) and LMS (RFC 8554), which are stateful many-time signatures built from the same
    one-time signatures, standardised in NIST SP 800-208.
  - SLH-DSA (FIPS 205), which is stateless.
  - Safe's own passkey flow alone.
  - Measures: size, gas, and how much state each needs.
- A cheaper `OneTimeKey` (KICKOFF.md, open decisions).

## 7. Prior art and review

**The question.** Compare the exact construction with existing hash-based wallets, Safe
integrations, and hybrid passkey and post-quantum signers. Get independent cryptographic and
contract review before making stronger claims.

**Today:**
- No survey yet.
- A baseline AI review of the contracts, asked for on 2026-10-08:
  [reviews/2026-10-08-baseline.md](reviews/2026-10-08-baseline.md). That is a first pass, not an
  audit.

**To find and read:**
- Hash-based (Lamport or Winternitz) contract wallets and vaults on Ethereum and elsewhere.
- QRL, a chain built on XMSS.
- Safe's passkey modules and their 4337 flow.
- Proposals for hybrid passkey and post-quantum signers.
- Work on keeping state for stateful hash-based signatures (the SP 800-208 guidance on not reusing
  state).

For each: what it binds, how it rotates, how it keeps state, and what it does when a transaction
fails.

**Review wanted:**
- A cryptographer on the WOTS+ variant and the message construction (`reference/`, KICKOFF.md).
- A contract reviewer on `Seat` and `OneTimeKey`.
- Someone who knows Safe on the threshold and bypass questions.
