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
  accounts, and another that refuses everything, so the page must let you choose.

The 38 checks, in order:

1. The console boots in MicroPython; the page's fingerprint is the manifest's.
2. Make a passkey; its signer address, worked out by the console, matches Safe's factory.
3. One tap: key 0's fingerprint, and every address before anything exists.
4. Two wallets: the page lets you choose.
5. One transaction builds the shielded Safe (deploying the SeatFactory too). On chain: the Safe's one
   owner is the seat, and the seat holds key 0's fingerprint.
6. Fund it.
7. The console's words and hash for "Send 0.0001 ETH".
8. Two presses. Each: exactly one passkey signature; the seat's `n` moves; the Safe runs it. Between
   them the wallet switches account, and the second press's gas comes from the new one.
9. The attack room: five attacks, each refused by the live seat.
10. The danger case forges a signature that checks.
11. Adding an owner: the whole screen red, and holding waits for the box. A call it can't read, and a
    delegatecall: refused, no button.
12. The guardrail: the wallet refuses approval 2 after the passkey signed it. The console offers only
    that approval again; the serial log shows the request and never the seeds; after a reload too; then
    it lands with no new passkey signature. History: three approvals, all landed.
13. The CSP refuses another host. A phone-width screen has no sideways scroll. No page errors.

Screenshots go to `site/shots/` (not committed).

## Bugs it found

| bug | fix |
|---|---|
| A wallet's gas estimate, with the Safe transaction allowed to fail, left the Safe transaction short: approvals landed, transfers didn't | the page works out the gas as if every part must succeed |
| After a reload, the page didn't reconnect the wallet, so "send it again" had no button | a quiet reconnect, with no prompt, of the wallet used last |
| The page took the first wallet the browser announced | a chooser, remembered by the wallet's `rdns` |
| The danger case sometimes found no forgery in two million tries: four random signatures can leave long odds | it signs until the odds are about 1 in 50,000, and says how many it took |

Found live, not by the e2e: with a smart-account wallet the attack room stayed empty, because the page
looked for the approval only in a plain Multicall3 call, and that wallet wraps it. It now searches the
whole transaction (`findApprove`); `site/test.mjs` checks a plain call and a wrapped one.

And two in the test itself: it matched "Fund it" in the steps bar, which names every step, and it
first used `eval` inside the page, which the page's CSP refuses.

## Next

- [ ] Run the e2e against a fork of Base Sepolia too, once in a while, for anything the bytecode copy
      misses.
- [ ] A smart-account wallet in the e2e: the test wallet could wrap its calls in a delegation
      manager, as the live one did.
