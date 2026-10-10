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
| `src/ui.mjs` | what both pages draw with: addresses, the hold button, the console's review |
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
One transaction at a time: the Safe runs them in nonce order. The page has no link handoff: with no
wallet here, the main page shares a signed approval as a link.

For a Safe with one seat, the owners card says whether the other owners reach the threshold without
the seat. It counts only this browser's seat as a seat. It reads each other owner's transaction count:
an address that has sent one has shown its public key.

The CSP: `default-src 'none'`; scripts and styles from the folder only, plus `'wasm-unsafe-eval'` for
MicroPython; `connect-src` the folder and the RPC in `console/cfg.py`. GitHub Pages can't send
headers, and the page has no worker, so a `<meta>` tag carries the policy; the page refuses to run
inside a frame instead of `frame-ancestors`.

A press's gas is worked out by the page, as if the Safe transaction must succeed. A wallet's own
estimate would be the least gas with which nothing reverts, and with the Safe transaction allowed to
fail, that is gas with which it fails (found by the e2e).
