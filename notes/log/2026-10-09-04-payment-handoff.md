# 2026-10-09: a plain payment link

## The ask

Keep the wallet option. Explain that the page prepares a transaction which someone else can pay
for. Make copying and opening that request clear, without a share sheet mixing text and a link.

## Changed

- Key 0 says that its tap prepares a key, costs no gas and sends no transaction.
- The build says what is ready and what the transaction deploys. Connect a wallet stays available
  when no wallet was found. The explanation points to someone else paying the gas.
- Build, funding and approval links stay visible. Copy link writes only the URL, including when
  the browser has a share sheet. A failed copy points to the visible field.
- Pay for a request accepts a pasted link on the same page. It checks the existing request format
  and chain, then uses the existing review and payment screens. It reads only the fragment and
  never visits the pasted host. It needs no passkey and sends nothing until the payer chooses to.

The assumption: a plain URL is the copyable handoff, rather than a second text or transaction
format. The request tags, console, contracts, dependencies and network calls are unchanged.

## Checks and mistakes

`npm ci`, `npm test`, `npm run build`, `npm run e2e` with the installed Chromium, and
`node tools/fingerprint.mjs --check`. The e2e uses Anvil 1.8.3 and a virtual passkey. Its clipboard
is a stand-in that records the copied string or refuses it. It checks the plain URL, the visible
fallback, bad pasted text, a wrong chain, review on this host, deployment and a signed approval
paid from the second browser. The existing reload and one-signature checks still pass. The phone
layout was inspected from its screenshot. Built `docs/` was regenerated.

The first e2e attempt could not bind Anvil's localhost port inside the sandbox. It was rerun
outside it. Two test mistakes stopped the next runs: the paste field initially shared the selector
for the outgoing link; then the test looked for a button inside a closed details panel. The fields
now have separate classes, and the test opens the panel first. npm commands were also run from the
repository root by mistake; they were rerun from `site/`.

No manual live-chain test or real second-device test was done. The separate reference, console and
contract suites were not run: those sources did not change.

Before the pull request, a second look found three finishing touches: the no-wallet message now
addresses a payer without claiming they hold the passkey; the paste form waits while the request
is reviewed; and each copy attempt clears the previous success message. The page checks were rerun.
The first edit script for these touches also used the wrong working directory and made no changes;
it was rerun from the repository root. The change is prepared on a separate branch for review;
the live site has not been changed.
