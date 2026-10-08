# Testing the built site

## The rebuild (CI, every push)

`cd site && npm run build` must write exactly the `docs/` that is committed. CI rebuilds on Linux and
fails on any difference. A build on macOS gives the same bytes, so the build doesn't depend on the
machine. `docs/BUILD.json` lists every file's SHA-256; `docs/SHA256SUMS` the same, for
`sha256sum -c`.

The build also refuses to publish:
- a page with an inline script or style;
- a `cfg.py` with any chain but Base Sepolia, or a published build that names the local chain;
- a file GitHub Pages' Jekyll would drop or rewrite (a name starting with `_` or `.`, or YAML front
  matter).

## The live site (by hand, after each deploy)

```sh
mkdir live && cd live
curl -sf https://signandburn.app/SHA256SUMS -o SHA256SUMS
while read -r h f; do mkdir -p "$(dirname "$f")"; curl -sf "https://signandburn.app/$f" -o "$f"; done < SHA256SUMS
sha256sum -c SHA256SUMS          # macOS: shasum -a 256 -c SHA256SUMS
```

| date | commit | result |
|---|---|---|
| 2026-10-08 | first deploy | 17 of 18 matched; `CNAME` missing: Pages reads it and doesn't serve it. Fixed by leaving it out of the lists |
| 2026-10-08 | the `CNAME` fix | 17 of 17 |
| 2026-10-08 | the wallet chooser | the live `SHA256SUMS` equals the commit's |

Also checked on the first deploy: `http://` redirects to `https://`, `www` to the apex, the certificate
covers both (expires 2027-01-05), `.wasm` is served as `application/wasm`, and the modules as
JavaScript.

## A smoke test of the live page

A headless Chromium with a throwaway virtual passkey, against signandburn.app and Base Sepolia, up to
the build screen. It sends nothing and needs no wallet. On 2026-10-08: the console booted with the
README's fingerprint; the signer address matched Safe's factory on Base Sepolia; the seat and Safe
addresses were worked out; no CSP violations, no page errors.

## Base Sepolia's contracts (weekly)

`.github/workflows/chain-check.yml` runs `node tools/chain/fetch.mjs --check`: each address the page and
the tests rely on must still hold the bytecode in `tools/chain/code.json`. It reads a public RPC, so it
runs weekly and by hand, not on every push.

## Next

- [ ] Script the live check (a GitHub Action after each Pages deploy, as PicoQuorum had).
