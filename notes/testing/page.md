# Testing the page

```sh
cd site && npm ci
npm test        # the page's JavaScript, no browser
npm run e2e     # the whole flow in Chromium (needs anvil)
```

## Without a browser (`site/test.mjs`)

`src/wots.mjs` against all 7 vectors; the danger case's forgery against a throwaway key; and
`console/cfg.py` against what the page reads (Base Sepolia only, the factory's address as
`contracts/deployment.json` has it).

## In Chromium (`site/e2e.mjs`)

It builds the development page (`site/dev/`), starts a local chain with Base Sepolia's real bytecode at
its own addresses (`tools/chain/anvil.mjs`, chain 31337), and serves the folder on localhost.

- **The passkey** is Chromium's virtual authenticator, with user verification and PRF.
- **The wallets** are two, as EIP-6963 announces them: a test wallet backed by Anvil's unlocked
  accounts, and another that refuses everything, so the page must let you choose. A browser whose
  page sets `e2e.nowallet` has none, as on a phone.
- **A second browser** (its own context: no passkey, no site data) plays the device that pays for
  the build by link, and later sends an approval by link. The clipboard is a stand-in that keeps
  the copied URL or refuses the copy.

The checks, in order:

1. The console boots in MicroPython; the page's fingerprint is the manifest's.
2. Make a passkey; its signer address, worked out by the console, matches Safe's factory.
3. One tap: key 0's fingerprint, and every address before anything exists.
4. With no wallet in the browser, at phone width, the build keeps Connect and a visible link.
   Copied, it is this page's address followed by public values only: it names neither the seat nor the Safe.
5. With no wallet found, Connect stays available and explains the payment link. Copy writes only
   the URL, even when the browser has a share sheet. If the clipboard refuses, the link stays visible.
   The second browser refuses a link with another chain. Its “Pay for a request” form refuses bad
   text and another chain too. Pasting a valid request from another host stays here and shows
   the same seat and Safe. A payer with no wallet gets instructions without needing the sender's
   passkey. Two wallets: the page lets you choose. The wallet says no: nothing built.
   Then a stranger deploys the SeatFactory and creates the seat alone, as anyone may: half built.
6. Then one transaction from the second browser builds the shielded Safe (deploying the SeatFactory
   too), making only what isn't there. On chain: the Safe's one owner is the seat, and the seat holds
   key 0's fingerprint. The first browser moves on by itself, to funding it from another device (a
   link, and the Safe's address to copy). The second funds it and keeps no `sab.home`; the first moves on again,
   then connects a wallet for the presses.
7. More than the Safe holds: the hold is held back, with a way to fund it. A wallet account with no
   ETH for gas: said before the hold. The console's words and hash for "Send 0.0001 ETH".
8. Two presses. Each: exactly one passkey signature; the seat's `n` moves; the Safe runs it. Between
   them the wallet switches account, and the second press's gas comes from the new one.
9. The attack room: five attacks, each refused by the live seat.
10. The danger case forges a signature that checks.
11. Adding an owner: the whole screen red, and holding waits for the box. A call it can't read, and a
    delegatecall: refused, no button.
12. The guardrail: the wallet refuses approval 2 after the passkey signed it. The console offers only
    that approval again; the serial log shows the request and never the seeds; after a reload too; then
    it lands with no new passkey signature. History: three approvals, all landed.
13. A browser with no ledger (its site data cleared, as a second device with the synced passkey would
    be): it finds the seat on chain, says another device's console holds its record, and holds the
    button back until the visitor ticks that nothing is waiting there. Then key 3 signs; the warning is
    gone once this ledger has an approval.
14. A front-run: a third account copies the approve call out of the page's transaction and sends it
    first. The page's transaction reverts; the page says approval 4 landed in another transaction and
    names it, the seat is at key 5, and the Safe hasn't run it.
15. A press with no wallet: the first browser loses its wallet. Holding asks the passkey once (key 5),
    and the approval waits to be shared. After a reload: the same link, and no new passkey signature.
    The second browser refuses a link with another next key (the seat's own refusal, no button), then
    pastes the real one into “Pay for a request”. The seat accepts it, and the hash it works out
    shows the same check code. Its wallet sends it: the seat moves to key 6, and the Safe runs it. The first browser sees approval 5
    land by itself, says another device sent it, and its history has it landed.
16. The wallet page (`wallet.html`), in the same browser: it finds the main page's Safe, its balance,
    and the seat as its one owner; the wallet pays gas only.
    - **Add the wallet as an owner, 1 of 2.** Red, and holding waits for the box. One press: the
      seat approves and the Safe runs it. On chain: two owners, threshold 1. The page says the seat
      isn't needed now, and that the wallet's public key is on chain (it has sent transactions).
    - **The wallet alone.** A send the console reviews; the wallet runs it as an owner. The Safe runs
      it; the seat's `n` and the passkey's sign count don't move.
    - **The guardrail across both kinds of owner.** Key 7 signs a send and the wallet refuses to
      send it. The card offers only approval 7 again: no Reject, no wallet vote. Then the wallet
      runs another transaction at the same Safe nonce, straight to the Safe. After a reload the card
      says the approval was overtaken and still offers only it. Sent: it lands, the seat moves to
      key 8, the Safe runs nothing, and no new passkey signature.
    - **2 of 2**, run by the wallet while it still can (red, and its button waits for the box). The
      page says every approval needs the seat.
    - **2 of 2, the seat first.** With no votes, the wallet may approve but not run. One press: the
      seat's vote lands and the Safe waits. After a reload the vote is still shown. The wallet's
      vote runs it.
    - **Remove the wallet, the wallet first.** Red; approvals needed drops to 1. The wallet votes
      with `approveHash`; the seat's press carries both votes, and the Safe runs it. On chain: the
      seat alone, 1 of 1.
    - **Reject** is one press, and nothing is signed. The seat's history lists approvals made on
      both pages, from one ledger. At phone width, no sideways scroll.
17. Two seats. A second browser, with its own virtual passkey, makes a passkey, key 0 and its own
    Safe; the wallet in that browser pays for the build from the main page ("Build it"). Then, on
    the first browser's wallet page:
    - The second seat is added to the first Safe, 1 of 2, with one press. The owners card knows it
      for a seat (the SeatFactory made it): every approval needs a seat, and there is a backup.
    - The wallet is added too, 2 of 3. On chain: two seats and the wallet, threshold 2.
    - The wallet votes first on a send, and copies the link to ask another owner. It names the
      wallet page and the transaction, and no hash. The second browser opens it: the first Safe,
      the wallet's vote counted, the same check code. One press there (key 0, one passkey signature)
      makes two votes, and the Safe runs it. The first browser sees it run by itself; the second
      keeps both Safes its seat is in.
18. The CSP refuses another host. A phone-width screen has no sideways scroll. No page errors.

Screenshots go to `site/shots/` (not committed).

## Bugs it found

| bug | fix |
|---|---|
| A wallet's gas estimate, with the Safe transaction allowed to fail, left the Safe transaction short: approvals landed, transfers didn't | the page works out the gas as if every part must succeed |
| After a reload, the page didn't reconnect the wallet, so "send it again" had no button | a quiet reconnect, with no prompt, of the wallet used last |
| The page took the first wallet the browser announced | a chooser, remembered by the wallet's `rdns` |
| The danger case sometimes found no forgery in two million tries: four random signatures can leave long odds | it signs until the odds are about 1 in 50,000, and says how many it took |
| A link pasted into "Pay for a request" while the page started was opened twice, and the screen went back to "Working out…" for a moment | start-up leaves an open review alone, and redraws it with the wallet it found |
| Two quick account switches: the first one's late redraw replaced the recipient field while it was being typed in | a switch that a later one has replaced doesn't redraw |
| The wallet page scrolled sideways at phone width with a transaction open: the Safe transaction hash didn't wrap | the hash wraps, and the wallet page's columns are `minmax(0, 1fr)` |

Found live, not by the e2e: with a smart-account wallet the attack room stayed empty, because the page
looked for the approval only in a plain Multicall3 call, and that wallet wraps it. It now searches the
whole transaction (`findApprove`); `site/test.mjs` checks a plain call and a wrapped one.

Found by reading the page, not by the e2e (2026-10-08): a browser with no ledger adopted a seat it found
on chain in silence, and the done screen trusted the receipt, so a front-run approval would have read
as "has the Safe the ETH?". Checks 13 and 14 cover both now.

And two in the test itself: it matched "Fund it" in the steps bar, which names every step, and it
first used `eval` inside the page, which the page's CSP refuses.

## Next

- [ ] The build from a wallet in the passkey's own browser ("Build it") is no longer driven by the
      e2e: the link path took its place. Both go through `pay.resolve`; `build()` also checks the
      addresses against the ones from key 0.

- [ ] Run the e2e against a fork of Base Sepolia too, once in a while, for anything the bytecode copy
      misses.
- [ ] A smart-account wallet in the e2e: the test wallet could wrap its calls in a delegation
      manager, as the live one did.
