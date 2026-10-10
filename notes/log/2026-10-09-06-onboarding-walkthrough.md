# 2026-10-09: onboarding and disclosure, with screenshots

## The ask

A Markdown walkthrough from passkey setup through a few shielded transactions. Show the phone
and gas payer, explain the browser methods and keys, and name the theoretical exposure points.

## Written and captured

`notes/onboarding-walkthrough.md`, linked from the notes index, with 14 screenshots under
`notes/screenshots/onboarding/`. Application code is commit f13bf89. The capture used the existing
e2e setup in a temporary script: Chromium's virtual passkey, a signing context at 390 pixels with
no wallet, a separate payer context and Anvil 1.8.3. It deployed and funded the Safe, then sent
0.0001, 0.0002 and 0.0001 test ETH with keys 0, 1 and 2. The third send was first refused by the
payer, then retried after a reload of the signing page. The temporary script was removed.

All capture checks passed: one assertion per fresh approval, no extra assertion after that reload,
the seat advancing to key 3, three Safe executions and no page errors. These are local browser
screenshots, not evidence of real phone PRF support or real MetaMask dialogs. The native prompts
are described but not pictured. Screenshots show only public test data; no seeds were captured.

The walkthrough distinguishes the passkey private key, its PRF secret, the seeds returned to the
page, the chain values revealed by a one-time signature, and the public key endpoints anyone can
compute from that signature. It explains that the first intended external disclosure of the
completed signature is the simulation RPC, before the payment link or on-chain burn. It also
names the next seed's exposure during the current tap.

## Found, and limits

Visual inspection found stray `nullnull` text on the funding screen and clipped hash text at phone
width. Both are noted beside the screenshots. The screenshots preserve those current display
issues. Application code was not changed for this document.

An attempted contact-sheet script could not import Pillow in the system Python. Each retained
screenshot was inspected directly instead; no dependency was installed. Relative Markdown links
and image signatures were checked, along with `git diff --check` and the console fingerprint.

No manual live-chain, real-phone or native wallet test was done. No new full CI run was needed for
the Markdown and PNG additions. The capture script built only `site/dev/`; published `docs/` was
not changed. No commit, push or publication was part of this documentation request.
