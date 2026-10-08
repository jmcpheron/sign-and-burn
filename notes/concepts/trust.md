# What to trust, and how to check it

## What it protects, and what it doesn't

| Threat | Holds? | Why |
|---|---|---|
| Curves broken; the attacker sees everything public | **yes** | They can make curve signatures, but not the next one-time signature |
| Copying or replaying an approval | **yes** | The chain, the seat, the Safe and `n` are all in what is signed |
| A wallet's curve key broken | **yes** | The wallet only pays gas; it approves nothing in the Safe |
| One key signs two messages, both public, and curves are broken | **no** | [The guardrail](guardrail.md) is the only defence |
| A bug in the one-time code | **partly** | The curve signature still guards, unless curves are broken too |
| A bug in the seat's logic | **maybe not** | Tests, review, and a test network |
| A hostile copy of the page, or a hostile browser extension | **no** | The page sees the seeds. Check its fingerprint, or run your own copy |
| A stolen, unlocked device, or a taken-over account that syncs your passkeys | **no** | Whoever has the passkey has both halves |
| Lost passkey | **stuck** | The seat can't approve again; in a real multisig the other owners replace it |

Nobody has shown that elliptic curves can be broken this way, and nothing here has been audited.

## The page is one folder

Everything the page runs is in `docs/`, served by GitHub Pages at signandburn.app: the page, its
JavaScript, MicroPython for WebAssembly, and the console's files. It loads nothing from anywhere else.

Its **Content-Security-Policy** says so, and the browser enforces it:

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:;
connect-src 'self' https://sepolia.base.org; base-uri 'none'; form-action 'none'
```

No inline scripts or styles. The only host it can reach is the Base Sepolia RPC in `console/cfg.py`.
It refuses to run inside another page's frame. Untrusted text (from the chain, a wallet, a link) is
drawn as text, never as HTML.

## How to check it

1. **Save a copy.** `SHA256SUMS` lists every file the site serves: fetch them, then
   `sha256sum -c SHA256SUMS`. On 2026-10-08 all 17 served files matched the commit Pages deployed.
2. **Rebuild it.** `cd site && npm ci && npm run build` writes the same bytes into `docs/`. CI rebuilds
   on Linux and fails on any difference; macOS gives the same bytes too.
3. **Hold it up to the README.** The console fingerprint the page works out in your browser is the one
   the README names.
4. **Run your copy.** `python3 -m http.server` in the folder, then `localhost:8000`. A passkey made
   there belongs to your copy; this site can never ask it to sign.

## The supply chain

`site/` pins exact versions (viem 2.56.8, esbuild 0.28.2, playwright-core 1.56.1, MicroPython 1.26.0),
and its lockfile pins every package by hash. Install with `npm ci`; install scripts are off. Foundry is
1.8.3, and the contracts use no libraries. GitHub Actions are pinned by commit. The contracts the page
relies on (Safe, the passkey signer, Multicall3) are checked against Base Sepolia's bytecode weekly
(`.github/workflows/chain-check.yml`).
