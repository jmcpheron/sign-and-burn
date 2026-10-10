# Notes

Explainers, test plans and a log, in plain words. The design itself is [KICKOFF.md](../KICKOFF.md);
each folder's README says how its code works.

## Walkthrough

[Onboarding and three transactions](onboarding-walkthrough.md): screenshots of a phone-sized
signing browser and a separate gas payer, paired with diagrams of the passkey methods, key
counters and where seeds and signatures are exposed. Captured locally with disposable test accounts, not on a real phone.
[PowerPoint version](onboarding-walkthrough.pptx) with the same information and paired images.

## Open questions

[research.md](research.md): what may be new, what isn't, and the seven questions that decide
whether it works, with what was checked for each. [reviews/](reviews/README.md): how contract
changes are reviewed, and the reviews so far.

## Concepts: how it works

| | |
|---|---|
| [Bunker mode](concepts/bunker-mode.md) | the motivation: why a key should sign only once, and why a multisig alone doesn't help |
| [The shielded Safe](concepts/shielded-safe.md) | the key ladder, and what anyone can see on chain at each moment |
| [One-time keys](concepts/one-time-keys.md) | Winternitz signatures: chains, the checksum, and why two signatures are dangerous |
| [The passkey](concepts/passkey.md) | one tap, two jobs: the curve signature and the PRF seeds |
| [The messages](concepts/messages.md) | every hash, byte by byte, and what each field stops |
| [The seat](concepts/seat.md) | the one contract: what it holds, what `approve` checks, the factory, gas |
| [The contracts, and ideas for more](concepts/contracts.md) | ours and borrowed, the three read line by line, and contract ideas with their costs |
| [One press](concepts/one-press.md) | from the button to the block, the wallet's part, and gas |
| [The console](concepts/console.md) | the MicroPython that decides, in the page and on a board |
| [The guardrail](concepts/guardrail.md) | one signature per key, ever, and what's left |
| [Trust](concepts/trust.md) | what it protects and what it doesn't, and how to check the page |

## Testing: what is checked, and what's next

| | |
|---|---|
| [Overview](testing/README.md) | every layer, how often, and how to run what CI runs |
| [The one-time keys](testing/reference.md) | the v1 vectors, in five implementations |
| [The console](testing/console.md) | CPython and MicroPython, every request and refusal, and the plan for a board |
| [The contracts](testing/contracts.md) | the attack table, the real bytecode, gas |
| [The page](testing/page.md) | the whole flow in Chromium, and the bugs it found |
| [The built site](testing/site.md) | the reproducible build, and the live site against the commit |
| [Base Sepolia, by hand](testing/live.md) | real passkeys and wallets: the PRF table, the first build, a press checklist |

## Log: what was done, mistakes included

| | |
|---|---|
| [2026-10-07: the kickoff, and M0](log/2026-10-07-01-kickoff-and-m0.md) | the ask, three decisions, the one-time keys and vectors |
| [2026-10-07: the contracts](log/2026-10-07-02-contracts.md) | a test's aliasing bug, the 500-block log limit, the real bytecode, gas |
| [2026-10-07: the console](log/2026-10-07-03-console.md) | clearing the repository, the core, the heap that was 661 KB and then 33 KB |
| [2026-10-08: the page](log/2026-10-08-01-page.md) | the page, and six things the e2e test caught |
| [2026-10-08: publishing](log/2026-10-08-02-publishing.md) | a private history, a fresh one, Pages and the domain, the live check |
| [2026-10-08: wallets, and the first build](log/2026-10-08-03-wallets-and-first-build.md) | Trezor and WalletConnect, the first real passkey, the first shielded Safe on Base Sepolia |
| [2026-10-08: the first presses](log/2026-10-08-04-first-presses.md) | three keys burned on Base Sepolia, the attack room live, and a bug it found |
| [2026-10-08: a read of the page](log/2026-10-08-05-page-review.md) | two gaps found by reading: a second device's empty ledger, and a receipt that says nothing about the approval |
| [2026-10-08: reframing](log/2026-10-08-06-reframing.md) | what's new and what isn't, the open questions, a review process, and a threat row that said too much |
| [2026-10-09: pay from another device](log/2026-10-09-01-pay-from-another-device.md) | a phone with no wallet shares a link, a wallet elsewhere pays for the build, and groundwork for a relay |
| [2026-10-09: send an approval from another device](log/2026-10-09-02-approval-from-another-device.md) | a press with no wallet: the signed approval goes out as a link, and the guardrail's rule 3 bends |
| [2026-10-09: the onboarding's order](log/2026-10-09-03-onboarding-order.md) | a half-built Safe that stuck every build, funding with no wallet, a key burned for nothing, wallets with no gas |
| [2026-10-09: onboarding walkthrough](log/2026-10-09-06-onboarding-walkthrough.md) | local screenshots, a separate gas payer, three transfers and disclosure timing |
| [2026-10-09: diagrams beside screenshots](log/2026-10-09-07-onboarding-infographics.md) | passkey methods, key counters and public values beside each screen |
| [2026-10-09: pictorial diagrams](log/2026-10-09-08-pictorial-infographics.md) | illustrated phones, seed capsules, signed approvals, wallets and chain blocks |
| [2026-10-09: PowerPoint walkthrough](log/2026-10-09-09-onboarding-presentation.md) | the full walkthrough as editable slides with paired images |

A new log entry is named `YYYY-MM-DD-NN-topic.md`: what was done, what was found, the numbers, and the
mistakes.
