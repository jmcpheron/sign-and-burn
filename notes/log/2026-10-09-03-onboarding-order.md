# 2026-10-09: the onboarding's order, and where it could get stuck

## The ask

Walk the onboarding (passkey, key 0, build, fund, press) with links to other devices in the mix,
and make sure nothing happens out of order or gets stuck.

## The order

The page doesn't keep a step of its own: `pickStep` works it out from the chain each time. No seat
in this browser's record means key 0; a seat or Safe missing on chain means the build; an empty Safe
means funding; then presses. So a link paid on another device, in any order, lands the page on the
right step. Key 0 is the passkey's first use after it is made: one tap, the PRF gives seed 0, and the
console keeps only the fingerprint. That was already so. What follows is what could still go wrong.

## Found, and fixed

- **Half built, stuck for good.** Anyone may create the seat, or deploy the Safe with its
  initializer, on their own. `buildCalls` always made both, so after that every build reverted:
  "Build" and the link alike. It now makes only what isn't there. The e2e has a stranger deploy the
  factory and create the seat first. With the old `buildCalls` the payer stays stuck at "Pay"
  (checked by putting it back); with the new one the build goes through.
- **Funding with no wallet.** The step said "the device that paid the gas offers to". That held only
  if that tab was still open with its wallet connected. Now it offers the build link again: its page
  sees the Safe built and offers to fund it, connecting a wallet first if need be. It also offers the
  Safe's address to copy, for a faucet or any wallet.
- **A key burned for nothing.** A press could approve more than the Safe holds. The approval landed,
  the key burned, and the Safe couldn't run it. The hold is now held back, with a way to fund the
  Safe, and the console isn't asked at all.
- **A wallet with no gas.** For a press, the passkey tapped and the console signed before the send
  failed. Now a wallet account with no ETH is named before the hold, and the approval goes out as a
  link instead. The build, funding, and both paying pages check the balance before sending, and say
  so plainly.

## What was checked, and how

- `npm test`, `npm run build`, `node tools/fingerprint.mjs --check`.
- `npm run e2e`: all 68 checks pass, with new ones for each fix but the paying pages' gas check.
  An empty account can't be made to send in the e2e, so only the press screen's warning is checked.

The console and the contracts are unchanged.
