# Testing the console

```sh
python3 console/test/run.py                                   # CPython
(cd site && npm ci) && node console/test/run-micropython.mjs  # MicroPython 1.26
```

Both run the same two files, `console/test/checks.py` and `console/test/core_test.py`.

## The pure parts (`checks.py`)

| part | against | what it shows |
|---|---|---|
| `safe_tx.py` | 17 vectors in `safe_tx.json`: viem's hashes, and real Safe transactions from Ethereum mainnet | the console's Safe hash is Safe's |
| `decode.py` | 15 expectations: the summary and each item's title and colour | the plain words don't drift |
| `decode.SIGS` | keccak of each signature | 12 function selectors are what they say |
| `webauthn.py` | `passkey.json`: a real browser passkey's assertion that Safe's passkey signer accepted on Base Sepolia, Base and Ethereum | the console packs a real assertion to the same bytes, and names the same signer address |

The decode vectors are mostly Base mainnet transactions, so the check adds Base's USDC and Uniswap's
router to the config it decodes with. The console's own config pins Base Sepolia only.

## The requests (`core_test.py`)

A stand-in passkey: its seeds are fixed, and its curve signature is any well-formed one, because the
console checks what was signed and the seat's signer checks the signature itself.

| | |
|---|---|
| a whole approval | `begin` builds `c` itself; `sign` gives a one-time signature good for key 0, `nextKey` = K(1), and `m` holding it |
| the guardrail | key 0 for another transaction: refused. The same transaction: the same approval handed back, no salts. Signing it again: refused. `sent`, then `chain` with `n` = 1: landed, kept as one short line |
| the next key | approval 1 with key 1 |
| refusals that sign nothing | another passkey's seed; no user verification; the passkey signed another challenge; none of them reach the ledger |
| a stale chain | a spent key for a new transaction; a chain behind the ledger |
| what it can't explain | a call it can't read; a delegatecall; a request that isn't JSON |
| the words | adding an owner is red, and allowed; another chain is refused |

## MicroPython only

- `main.py` is fed three requests on stdin and must print three answers: the serial loop a board runs.
- The heap the loaded console holds: about 33 KB on the runner, 34 KB in the page.

A mistake worth knowing: the first measurement said 661 KB. MicroPython's WebAssembly port frees
garbage only when no Python is running, so a `gc.collect()` inside the same call frees almost nothing.
The runner now collects in separate top-level calls. A board's collector runs at any time.

## On a board

Not done yet. The plan:

1. Flash MicroPython 1.26 on a Pico 2 W, then an ESP32-WROOM-32.
2. Copy the files `console/manifest.json` lists: `mpremote cp console/*.py :` and
   `mpremote cp reference/python/sign_and_burn.py :`.
3. Feed it the requests from `core_test.py` over USB serial, and compare every answer with CPython's.
4. Time a whole approval (about 3,000 SHA-256 steps and three keccaks) and record free heap after one.
5. Check that `ledger.json` survives a power cycle.

Record the board, MicroPython build, timings and heap in a new log entry.

## Next

- [ ] Run it on a board (above).
- [ ] Have the page talk to a board over Web Serial, as a second check of the hash and the words
      (KICKOFF.md, open decisions).
