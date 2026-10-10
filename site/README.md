# site

The page, built into `docs/`, which GitHub Pages serves at signandburn.app.

```sh
npm ci
npm test          # src/wots.mjs against reference/vectors/v1.json, the danger case, cfg.py
npm run build     # docs/: Base Sepolia only
npm run dev       # site/dev/: the local Anvil chain instead (tools/chain/anvil.mjs, port 8545)
npm run e2e       # the whole flow in Chromium against the local chain (needs anvil)
```

| | |
|---|---|
| `index.html`, `style.css`, `favicon.svg` | the page; no inline script or style |
| `wallet.html` | the wallet page: the same Safe as a plain wallet, with its owners |
| `src/app.mjs` | the one script both pages load; each runs only its own part |
| `src/main.mjs` | the screens, the panels, the attack room, the explainers in "How it works" |
| `src/wallet.mjs` | the wallet page: send, the owners, add or remove one, the threshold, and each owner's vote |
| `src/approve.mjs` | one press, for both pages: the console, one tap, the seat asked by simulation, the wallet, the block |
| `src/ui.mjs` | what both pages draw with: addresses, the hold button, the console's review, "Show QR code" |
| `src/names.mjs` | your names for addresses (`sab.names`), and the JSON file that moves them: `sign-and-burn/address-book/v1` |
| `src/qr.mjs` | QR codes, written here: byte and alphanumeric modes, versions 1 to 40. `test.mjs` checks it against `qr-vectors.json`, made by an independent encoder (`tools/qr-vectors.py`) |
| `src/console.mjs` | MicroPython 1.26 in the page, the console's files, the ledger kept in localStorage, the serial log (seeds never shown) |
| `src/passkey.mjs` | make a passkey; one tap that signs `c` and answers two PRF salts; find a passkey made elsewhere |
| `src/pay.mjs` | links for another device's wallet: the build request (public values only, no calls) and how a payer rebuilds the calls; a signed approval (no hash: the payer's console works it out) |
| `src/chain.mjs` | viem: reads, the shielded Safe's calls, one Multicall3 transaction per press, simulations, the browser's wallets (EIP-6963), owners' votes and owner changes |
| `src/wots.mjs` | the one-time keys in the page's JavaScript, to draw what a signature reveals and run the danger case |
| `build.mjs` | writes the folder, its Content-Security-Policy, `SHA256SUMS` and `BUILD.json` |
| `e2e.mjs` | Chromium, a virtual passkey with PRF, a test wallet (Anvil's first account), the local chain |

The build step keeps “Connect a wallet” beside a payment link. “Copy link” copies only the URL,
with a visible field for copying by hand. A payer can open it or paste it into “Pay for a request”
on this page, review what it builds, then connect a wallet to pay. The same handoff works for
funding and signed approvals. Pasting reads the request here; it does not visit the pasted host.

## QR codes

Every link the pages share has "Show QR code" beside "Copy link", and the wallet page shows the
seat's address as one too. The code is drawn on a canvas, black on white whatever the theme.

A signed approval's link is about 3,600 characters: more than one QR code holds. Its code carries a
compact form instead (`sign-and-burn/approval-qr/v1`, `#aq=` in `src/pay.mjs`). The same fields are
packed as bytes, with the curve signature as its four parts. They are written in base 43, characters
that a QR code's alphanumeric mode stores in 5.5 bits each, and that a URL fragment carries unescaped.
That's about 3,750 characters, in a version 37 or 38 code (165 or 169 modules a side). Only the
part after `#aq=` is alphanumeric; the address before it is in byte mode. The page that opens it gets
exactly what the approval link would give, and checks it the same way. A curve signature that isn't
in its canonical form gets no compact form, and the page says to copy the link.

## The wallet page

`wallet.html` reads the same storage as the main page: the passkey, the seat and Safe (`sab.home`),
and the console's ledger. Making a passkey and building the Safe stay on the main page. Every
transaction, whoever approves it, goes through the console's `review`: it works out the Safe
transaction hash and says what the transaction does. Then owners vote:

- **The seat**, with one press (`src/approve.mjs`, as on the main page). The press carries the votes
  the Safe already holds, so the Safe runs the transaction in the same block if that makes enough.
- **A wallet that is an owner**, with its own curve key: `approveHash`, or `execTransaction` sent by
  itself when its vote makes enough. Not through Multicall3: the Safe counts the sender's own vote.

Votes are on chain (`approvedHashes`). A transaction that waits for more is kept in `sab.proposal`
until it runs; one the seat signed and hasn't landed is the ledger's, and the page offers only that.
One transaction at a time: the Safe runs them in nonce order. With no wallet here, the main page
shares a signed approval as a link.

**Other Safes.** A seat can be an owner of other Safes: another passkey's, say. The page keeps the
Safes this seat is in (`sab.safes`), and shows the seat's address to copy into another Safe's "Add an
owner". A transaction waiting for votes goes to another owner's device as a link to this page
(`sign-and-burn/proposal/v1`, `src/pay.mjs`): the Safe and the transaction's fields, nothing signed,
no hash. That device's console works out the hash and shows the same check code; the votes so far are
on chain. The link opens only on a device whose seat, or wallet, is an owner of that Safe. Key `n` is
bound to whatever it signed: while an approval for one Safe waits, the seat approves nothing for
another, and the main page offers only that approval too.

**Names.** "Name it" beside an owner or a Safe, and the Address book card, keep your names for
addresses in `sab.names`. Every address the pages draw shows its name beside it, never instead of it,
and the console never sees them. Export JSON writes `{tag: "sign-and-burn/address-book/v1", chain,
names: {address: name}}`; Import JSON, or a paste, checks every entry (an address, a name of 1 to 40
characters with nothing invisible: no control, zero-width or direction characters) and refuses the
whole file if one is bad. Imported names are added, and replace yours for the same addresses.

**The verdict.** An owner is a seat if it names a passkey signer (`curveSigner()`) and the SeatFactory
lists it among that signer's seats (`chain.isSeat`). The owners card says two things: whether the
ordinary owners can reach the threshold with no seat (then a broken curve takes the Safe), and
whether the other owners can reach it without this browser's seat (a backup if its passkey is lost).
It reads each ordinary owner's transaction count: an address that has sent one has shown its public key.

The CSP: `default-src 'none'`; scripts and styles from the folder only, plus `'wasm-unsafe-eval'` for
MicroPython; `connect-src` the folder and the RPC in `console/cfg.py`. GitHub Pages can't send
headers, and the page has no worker, so a `<meta>` tag carries the policy; the page refuses to run
inside a frame instead of `frame-ancestors`.

A press's gas is worked out by the page, as if the Safe transaction must succeed. A wallet's own
estimate would be the least gas with which nothing reverts, and with the Safe transaction allowed to
fail, that is gas with which it fails (found by the e2e).
