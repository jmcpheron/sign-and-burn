# 2026-10-09: a wallet request already waiting

## Report

A copied approval link reached the payment screen and the seat accepted the approval by simulation.
Connect a wallet failed with “Requested resource not available.” The screenshot did not show the
wallet's underlying error details or which request failed.

## Found

The pinned viem version uses that short message for RPC error -32002. MetaMask documents that code
as a request already pending:
https://docs.metamask.io/metamask-connect/evm/guides/manage-user-accounts/

That is the likely cause, not a reproduction with the visitor's wallet. The page discarded the
useful detail by showing only viem's short message. It also always asked for account permission on
an explicit connection, even when the wallet had already granted access to an account.

## Changed

Connection first reads the accounts already granted to this site. It asks for permission only
when none is available. A wallet that returns no account cannot be marked connected. A pending
request error names the wallet and asks the visitor to finish or cancel the waiting request, then
retry. The page does not cancel or approve wallet requests itself.

The e2e wallet can now return no authorized accounts and refuse a permission request with -32002.
On the copied approval link, the test checks the recovery text and that no transaction was sent;
then it clears the pending request, connects and sends the same approval without another passkey
signature. It also checks that an authorized wallet does not get another account permission request.

## Checks

`npm ci`, `npm test`, `npm run build`, `npm run e2e` (installed Chromium, Anvil 1.8.3),
`node tools/fingerprint.mjs --check` and `git diff --check`. The browser test uses a wallet stand-in
and a virtual passkey. The built `docs/` is regenerated. No live MetaMask session or manual
live-chain test was run. The separate reference, console and contract suites were not run; those
sources are unchanged. No dependency, signing format or endpoint changed.
