# 2026-10-09: diagrams beside the walkthrough screenshots

## The ask

Pair each screenshot with an infographic showing the passkey on the signing device, the key
number, what is disclosed and when gas and rotation happen. The initial request's last sentence
was ambiguous; the visitor clarified that the pairs belong in the Markdown walkthrough.

## Changed

The walkthrough now uses two-column Markdown tables: one unmodified screenshot and one matching
SVG diagram. There are 14 pairs and a separate conceptual example at key 27. Each diagram separates
the passkey provider, page and console memory, external recipients, and chain state. A phone and
key symbol identify the signing device and authenticator. No secret values are drawn.

Creation returns the public P-256 key to the page. The first PRF call returns seed 0, from which
the console computes a hashed one-time fingerprint. Approval taps return current and next seeds;
the one-time signature discloses chain positions from which public endpoints can be computed.
The diagrams distinguish the seat's n from the Safe transaction nonce and signing use from the
later on-chain retirement. Key 27 is illustrative, not a claim of another captured transaction.

A separate HTML gallery was used only as a temporary preview and removed after the clarification.
No gallery, application change, dependency or network endpoint is part of this update.

## Checked

Chromium loaded every SVG. Text bounding boxes were checked for clipping and overlaps; the paired
layout and representative first-key, signed-approval and retry diagrams were inspected visually.
The first paired-preview capture used a CSS ID selector starting with a digit, which is invalid;
it was corrected to an attribute selector. Relative image and source links and XML parsing were
checked, with git diff --check. The screenshots remain those from the earlier local capture.

No new wallet, passkey, live-phone or chain tests were run for these static diagrams. No site build
was needed; docs/ and application sources are unchanged. Nothing was committed or pushed.
