# 2026-10-09: send an approval from another device

## The ask

After building a Safe by link, a phone with no wallet stopped at "Connect a wallet to send". Do the
same for presses: a link someone else opens to pay for the rest.

## What changed

- **The press, with no wallet.** Holding works as before: one tap, the console signs with key `n` and
  records the approval in its ledger, and the seat is asked by simulation. Then the page stops short
  of a wallet and offers the approval as a link (`sign-and-burn/approval/v1`). The share is a second
  tap, because a share sheet needs a fresh gesture and the passkey's has been used.
- **While it waits,** the screen offers only that same approval, as the same link, with no new tap.
  That is `core.begin`'s "resend", unchanged. The page reads the seat's `n` every few seconds and,
  once approval `n` lands, records the transaction (`sent`) and shows the press as done, saying
  another device sent it. With a wallet here, the link is offered beside "send it again".
- **The paying page.** It refuses a link of the wrong shape. Its own console works out the Safe
  transaction hash and what the transaction does from the fields; the link carries no hash. It
  shows the check code to compare with the signing device's, asks the seat by simulation, and only
  then offers "Send it". It refuses when its console refuses, when the seat isn't an owner of the
  Safe, or when the seat would refuse. It keeps nothing.
- **`reviewParts`** draws the review, the fields and the check code for both pages.
- **`src/pay.mjs`**: `approvalLink`, and `fromLink` for both tags. Signatures ride as base64url;
  a link is about 3,600 characters.

The console is unchanged, so its fingerprint is too. The contracts are unchanged.

## What was checked, and how

- `npm test`: an approval link round-trips every signature byte, holds no Safe transaction hash, and
  six bad links are refused.
- `npm run build`, `node tools/fingerprint.mjs --check`.
- `npm run e2e` with Foundry 1.8.3 and Chromium: all 65 checks pass. The new ones are listed as item
  15 in [testing/page.md](../testing/page.md).

Not checked: a real phone, and a real second device on Base Sepolia. Nor how long a link stays
usable in messaging apps that shorten or preview long URLs.

## Found along the way

- The guardrail's rule 3 ("sign only immediately before sending, and send at once") bends: the
  approval leaves at once but lands when someone pays. Rules 2 and 4 keep one signature per key.
  The longer wait makes a lost ledger on the signing device more dangerous. Written up in
  [guardrail.md](../concepts/guardrail.md).
- The e2e's switch to a wallet clicked "Connect a wallet to send", which a press screen with no
  wallet no longer shows: it offers the hold, and "I have a wallet in this browser".
