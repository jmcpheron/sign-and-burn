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
| `src/main.mjs` | the screens, the panels, the attack room, the explainers in "How it works" |
| `src/console.mjs` | MicroPython 1.26 in the page, the console's files, the ledger kept in localStorage, the serial log (seeds never shown) |
| `src/passkey.mjs` | make a passkey; one tap that signs `c` and answers two PRF salts; find a passkey made elsewhere |
| `src/pay.mjs` | the build request: what a link to another device holds (public values only, no calls), and how a payer rebuilds the calls from it |
| `src/chain.mjs` | viem: reads, the shielded Safe's calls, one Multicall3 transaction per press, simulations, the browser's wallets (EIP-6963) |
| `src/wots.mjs` | the one-time keys in the page's JavaScript, to draw what a signature reveals and run the danger case |
| `build.mjs` | writes the folder, its Content-Security-Policy, `SHA256SUMS` and `BUILD.json` |
| `e2e.mjs` | Chromium, a virtual passkey with PRF, a test wallet (Anvil's first account), the local chain |

The CSP: `default-src 'none'`; scripts and styles from the folder only, plus `'wasm-unsafe-eval'` for
MicroPython; `connect-src` the folder and the RPC in `console/cfg.py`. GitHub Pages can't send
headers, and the page has no worker, so a `<meta>` tag carries the policy; the page refuses to run
inside a frame instead of `frame-ancestors`.

A press's gas is worked out by the page, as if the Safe transaction must succeed. A wallet's own
estimate would be the least gas with which nothing reverts, and with the Safe transaction allowed to
fail, that is gas with which it fails (found by the e2e).
