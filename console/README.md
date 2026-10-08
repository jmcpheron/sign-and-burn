# console

The console: everything Sign and Burn trusts the console with, in MicroPython. The page runs it on
MicroPython 1.26 for WebAssembly. The same files could run on a Raspberry Pi Pico 2 W or an ESP32.

| file | what |
|---|---|
| `core.py` | `handle(line)`: one JSON request in, one JSON answer out. Builds `c` and `m` from the seat's own `n`, signs with the one-time key, keeps the ledger and the guardrail. The list of requests is at its top. |
| `safe_tx.py`, `keccak.py` | the Safe transaction hash, worked out here from the fields (from PicoQuorum, and picowallet before it) |
| `decode.py` | what a transaction does, in plain words; red for anything that changes who controls the Safe (from PicoQuorum) |
| `webauthn.py` | checks that the passkey signed exactly `c`, with user verification, and packs its signature for Safe's passkey signer |
| `cfg.py` | the chain (Base Sepolia only) and the contracts it relies on. JSON, so the page reads the same file |
| `main.py` | on a board: `core.handle` over USB serial, one line per request |
| `manifest.json` | the image: each file by its name on a board. `sign_and_burn.py` is `reference/python/sign_and_burn.py` itself, not a copy |

## The guardrail

The seat can make sure a spent key is dead. It can't make sure a key signs only once, and two
signatures with one key reveal enough to forge a third. So `core.sign` writes each approval to
`ledger.json` before its answer leaves, and while approval `n` waits, `core.begin` hands that same
approval back instead of asking for a new signature. On a board, `ledger.json` is a file in flash.
In the browser, the page keeps it in localStorage: clear the site's data and the console forgets.
A landed approval keeps one short line; the newest 50 stay.

## Tests

```sh
python3 console/test/run.py                         # CPython
(cd site && npm ci) && node console/test/run-micropython.mjs   # MicroPython 1.26
```

Both run `test/checks.py` and `test/core_test.py`:
- the Safe hash against 17 vectors in `safe_tx.json` (viem's hashes, and real Safe transactions);
- the decoder against 15 expectations;
- `webauthn.py` against `passkey.json`: a real browser passkey's assertion that Safe's passkey signer
  accepted on Base Sepolia, Base and Ethereum. It must pack to the same bytes and name the same
  signer address;
- every request: a whole approval, then the guardrail (another transaction for a spent key, the same
  one again, signing twice), another passkey's seeds, no user verification, another challenge, a chain
  that is behind the ledger, calls it can't read, a delegatecall, and requests that aren't JSON.

On MicroPython it also feeds `main.py` three requests on stdin, and measures the heap the loaded
console holds: about 34 KB. MicroPython starts with a 56 KB heap on an ESP32-WROOM-32 and grows it
from what's left; a Pico 2 W has about 450 KB. The WebAssembly port frees garbage only between
top-level calls, so the runner collects between calls; a board collects any time.

## On a board

Not tried yet. The plan: flash MicroPython 1.26, copy the files `manifest.json` lists with
`mpremote cp`, and send it lines over USB serial. `hashlib.sha256`, `json` and `binascii` are in
MicroPython's builds for both. An approval is about 3,000 SHA-256 steps and three keccaks. The seeds
would still come from the passkey through the page, so a board adds a second, independent check of
the hash and the words, not a safer key. A chip's sealed secret in place of the PRF is the bridge back
to PicoQuorum (KICKOFF.md).
