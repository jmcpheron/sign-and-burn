# 2026-10-09: pictorial walkthrough diagrams

## The ask

Make the walkthrough's infographics more graphical, with a phone, more color and physical
objects that show transitions. Keep each diagram beside its screenshot in Markdown.

## Changed

Redrew all 14 paired SVGs and the conceptual key-27 example. A phone contains a gold passkey
provider and a violet page-memory area. Seed capsules, public fingerprint tokens, signed
envelopes, a paper ledger, an RPC rack, a copied-link sheet, a gas wallet and chain blocks show
the different parts. The walkthrough explains the colors and labels the drawings as illustrations.
They are not pictures of native passkey dialogs. The captured application screenshots are unchanged.

Setup and wallet connection do not imply a fresh passkey tap. Signing shows both current and next
seeds in memory, followed by signature disclosure. The chain keeps the current fingerprint until
inclusion. Retry shows the same approval. The key-27 example shows F27 before rotation to F28.
No secret values are drawn. No application source, dependency or network endpoint changed.

## Checked

Local Chromium loaded all 15 SVGs. Checks using rendered text rectangles found no text clipping
or overlaps. A contact sheet of all diagrams and representative full-size diagrams were visually
inspected. SVG XML and local Markdown links were checked, as was git diff --check.

The first bounds check ignored SVG group transforms; it was corrected to use rendered rectangles.
A contact-sheet attempt tried to write HTML into an SVG document and failed. A fresh HTML page
rendered it successfully. A separate image-composition attempt lacked Pillow; nothing was installed.

No new wallet, passkey, phone or chain tests were run for this illustration-only revision. The
existing screenshots still come from local Chromium and Anvil, not a live phone or MetaMask.
No site build was needed. docs/ is unchanged. Nothing was committed or pushed.
