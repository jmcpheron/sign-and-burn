# 2026-10-09: the onboarding walkthrough in PowerPoint

## The ask

Turn the Markdown walkthrough into a presentation with its information and images, then open a PR.

## Changed

Added notes/onboarding-walkthrough.pptx, a 55-slide reading deck in the source document's order.
It keeps all 14 screenshot and diagram pairs and the separate conceptual key-27 example. Text,
the passkey request code and six tables are editable. The diagrams are embedded PNG renditions
of the existing SVGs. Their contents are image assets, not editable PowerPoint shapes.

The deck includes the passkey and PRF distinctions, deployment and funding, three transfers,
refusal and retry, disclosure timing, theoretical exposures and the capture's limitations. Speaker
notes retain source text, image paths and the full original Markdown with its source links.
The Markdown and notes index link to the deck. No application or published docs/ files changed.

## Checked

Rendered and visually inspected all 55 slides. A numbered response list initially ran together
in one paragraph. It was separated and the affected preview inspected again. Package integrity,
slide geometry, headings, font policy, the six native tables and an Artifact Tool re-import passed
with no findings. Checked 55 slides, 29 embedded images and all 14 source screenshot PNGs byte for
byte. Checked the full source text in speaker notes after normalizing XML paragraph whitespace.
Markdown links and git diff --check passed.

The first font setting used an unsupported property and fell back to Aptos. Setting typeface to
Arial fixed it. Re-import validation initially lacked its runtime module environment variable.
A later validation attempt reused a receipt path and failed because the finalizer does not
overwrite receipts. A fresh receipt and output path completed validation. The first notes check
expected literal newlines within XML text nodes; paragraph-aware whitespace normalization fixed
that check. No project dependency was added.

This was a static document conversion using the bundled presentation runtime. Small text in tall
screenshots and diagrams needs zooming. Native PowerPoint and Google Slides were not opened or
tested. No new phone, passkey, wallet or chain test was run, and full application CI was not rerun
locally. The earlier local Chromium and Anvil capture remains the evidence for the pictured flow.
