# 2026-10-10: "Import transactions" on the wallet page

## The ask

The approval's QR codes were there, but the scanner was only on the main page, folded away under "Pay
for a request". Jason asked for an "Import transactions" button to scan them.

## What changed

- **The wallet page** has "Import transactions" under the console's line, outside the cards a redraw
  replaces, so the camera keeps running while the page reads the chain. It works with no passkey too:
  the paying device may have only a wallet.
- What it reads, it treats as untrusted, as the main page's "Scan a code" does:
  - a proposal link's code opens on the wallet page, as the link would;
  - an approval's parts go to the main page, which pays for it. The page puts the parts in this tab's
    `sessionStorage` (`sab.scanned`) and opens `./#scanned`; the main page takes them out, removes
    them, and puts them together again with `pay.partCollector`. So the main page checks them itself,
    and nothing new is signed or trusted;
  - a payment link's code opens on the main page, as the link would.
- No new format: the parts are `sign-and-burn/approval-qr/v2` as they were scanned.
  `partCollector` gained `texts`, the parts it holds.

## What was checked

- `npm test`: the collector's `texts` are the parts it was given.
- `npm run e2e`: the no-wallet Safe{Wallet} scan now starts on the wallet page with no passkey and a
  fake camera; "Import transactions" hands the codes to the main page, which finds the wallet's
  signature, and one send runs the Safe. The main page's own "Scan a code" is still checked earlier.

## Not checked

- A real phone's camera.
- Scanning a proposal link's code with the camera (the proposal link itself is checked).

## In MetaMask's browser

Jason opened the wallet page in MetaMask's own browser and saw only "No passkey here yet". That is
not new: a wallet app's browser keeps its own storage, so the passkey made in Chrome or Safari isn't
there, and the page had nothing else to offer. The button wasn't on the live site yet either (this
branch wasn't merged). Now the no-passkey screen says this browser can still pay for an approval
signed in the other one, by "Import transactions", and the page says so if the browser gives pages no
camera. Whether MetaMask's browser lets a page use the camera is not checked.
