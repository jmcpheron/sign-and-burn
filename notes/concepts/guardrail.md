# The guardrail: one signature per key, ever

## The gap the seat can't close

The seat makes sure a **spent key is dead**: once approval `n` lands, it accepts only key `n+1`. It
can't make sure a key **signs only once**. It only sees signatures that reach it.

Two signatures with the same key show enough of its chains for someone to forge a third, with their
own next key in it ([one-time keys](one-time-keys.md), "Why only once"). If curves were broken too,
they could take the seat.

## How it could happen

Not through an attack on the seat. Through the signer: signing key `n` for one transaction, then,
before it lands, signing key `n` again for another. A wallet that says no, a dropped transaction, a
second tab, a retry button: each is a way to make a second signature by accident.

## The rules (`console/core.py`)

1. Read the seat's `n` from the chain before every signature.
2. **One signature per key number, ever.** If a signed approval for key `n` exists, send that same one
   again; never make a new one. A different transaction waits until it lands.
3. Sign only immediately before sending, and send at once.
4. Keep the signed approval (it isn't secret) until the chain shows `n` has moved past it.
5. Signing ahead is allowed in order: key `n` for one approval, key `n+1` for the next.

The console writes each approval to its ledger **before** the answer leaves it. If the chain says the
seat is behind what the ledger has signed, the console refuses to sign until the chain catches up.

An approval sent from another device, by link ([one press](one-press.md#sent-from-another-device)),
bends rule 3: the approval leaves at once, but it lands only when someone opens the link and pays.
Rules 2 and 4 still hold: while it waits, the console offers only that same approval, as the same
link. What the wait adds is time. For longer, a lost ledger (cleared site data) on the signing device
would let key `n` sign a second message, so don't clear it while a link is out.

## What you see

Say the wallet refuses to send approval 2 after the passkey signed it. The console now says: *"Key 2
already signed this approval. One signature per key, ever: the console will only send this same one
again. No tap needed."* The form for a new transaction is gone. Holding the button sends the same
approval, without asking the passkey. This survives a reload. The e2e test checks all of it, including
that the passkey signed exactly once.

## What's left

- **A lost ledger.** If the browser's site data is cleared after an approval was sent, and that
  transaction is dropped, the console can't tell that key `n` already signed something public. The
  wallet's history is the fallback.
- **Another device.** A synced passkey on a second device has its own ledger, empty. The page finds the
  seat on chain, and until this console has signed for it once, it says that another device's console
  holds the record and keeps the button held back until the visitor ticks that nothing signed with key
  `n` is waiting there. It can't check that itself. Use one device per seat.
- **Someone else's transaction.** Anyone can copy the approve call from the mempool and send it first.
  It can only do what was signed, so the approval lands all the same, in their transaction, and the
  page's own reverts. The page asks the seat where approval `n` landed rather than trusting its receipt,
  says so, and names their transaction. If the seat says `n` hasn't moved, the approval didn't land,
  whatever the receipt says, and the console keeps it to send again.
- **A hostile page.** The page sees the seeds. A hostile copy of it could sign anything. See
  [trust](trust.md).

## The danger case, on the page

The attack room's **danger case** shows the reason with a throwaway key made in the page and never on
chain. It signs several messages, marks the lowest position revealed on each chain, then tries
messages until one fits above those marks, and signs it with no secret at all. The forged signature
checks out against the key's fingerprint.
