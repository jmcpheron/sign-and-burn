# 2026-10-09: pay for the build from another device

## The ask

On a phone the onboarding stopped at "Connect a wallet": there is no browser wallet there. Let the
phone share a link, so a wallet on another device pays the build's gas. Lay the groundwork for a
relay that pays the gas later, but build only the link for now.

## What changed

- **`site/src/pay.mjs`.** The build request: the passkey's public key, the seat number, key 0's
  fingerprint, tagged `sign-and-burn/build/v1`. Public values only, all of which go on chain in the
  build. As a link it rides in the fragment. `fromLink` checks every field's exact shape and refuses
  anything else with a reason. `resolve` works out the signer, the seat and the Safe from the chain
  and builds the calls. A relay could take the same request; none exists, and there is no new
  network call.
- **The build step.** It looks for wallets in the browser first. With none, the link leads: share it
  (the system share sheet) or copy it, with three steps on what to do with it. With a wallet, the
  link is offered below "Connect a wallet". While waiting, the page reads the chain every few
  seconds and moves on when the Safe is built, and again when it has ETH. The hardware-wallet note
  shows only where there is a wallet.
- **The paying page.** A link opens a screen of its own: what the build makes, worked out there (the
  console works out the signer too), then "Pay: one transaction", then an offer to send 0.001 test
  ETH. It keeps nothing.
- **"Build it"** in the passkey's own browser goes through the same `pay.resolve`, and checks the
  addresses against the ones worked out at key 0 before it sends.
- **The passkey step** says up front that no wallet is needed on this device.
- **"What the link holds"** tells the two public keys apart, after a read on a phone: the passkey's
  curve public key is in the link, and its signer holds it; key 0's public key is not, only its
  fingerprint, which is all the seat holds until key 0's one approval.

The console is unchanged, so its fingerprint is too. The contracts are unchanged.

## What was checked, and how

- `npm test`: the link round-trips, holds no seeds or calls, and seven bad links are refused.
- `npm run build`, `node tools/fingerprint.mjs --check`.
- `npm run e2e` with Foundry 1.8.3 and Chromium: all 57 checks pass. The build is now paid from a
  second browser context by link (see [testing/page.md](../testing/page.md)).

Not checked: a real phone's share sheet, and the link on Base Sepolia with a real second device.
Those go in [testing/live.md](../testing/live.md) once done.

## Found along the way

- The e2e first counted the side panel's "Connect a wallet" link as the screen's button. It now looks
  only inside the console's screen.
- In the e2e, the in-browser "Build it" path gave way to the link path. Both share `pay.resolve`, but
  the first isn't driven end to end any more: noted under "Next" in the test plan.
