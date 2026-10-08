# The console

The console is the part of Sign and Burn that decides. It is about a thousand lines of MicroPython in
`console/`, and it answers one JSON line with another. The page asks it; it never asks the page.

## What it does

- **Works out the Safe transaction hash** from the fields (`safe_tx.py`, `keccak.py`), never taking one
  from anyone.
- **Says what the transaction does** in plain words (`decode.py`): "Send 0.0001 ETH to 0x…". Anything
  that changes who controls the Safe is red, all over. A call it can't read, or a delegatecall to
  something it hasn't pinned, is refused: no button.
- **Builds the messages** `c` and `m` from the seat's own `n` ([the messages](messages.md)).
- **Checks the passkey's answer**: the challenge must be its own `c`, with the user-verified flag set
  (`webauthn.py`).
- **Signs with the one-time key**, after checking that the seed gives the key the seat holds.
- **Keeps the guardrail** in its ledger ([the guardrail](guardrail.md)).

## Why a console

PicoQuorum, which this grew out of, is a hardware console: a Pico with its own screen that is one
owner of a Safe. Its rule is that the device works out what it signs, says it in plain words, and
makes you hold a button. Sign and Burn keeps the rule and most of the code: the Safe hash, the
decoder, and the passkey packing come from PicoQuorum's firmware.

## The requests

```
hello · signer · keys · first · review · begin · sign · sent · chain · ledger
```

Each is `{"op": …}` in and `{"ok": true, …}` or `{"ok": false, "refuse": "…"}` out. `console/core.py`
lists them at its top. The page's **Serial** panel shows every line both ways, as a board's USB serial
would, with the passkey's seeds replaced by "not shown".

## In the browser

The page loads MicroPython 1.26 for WebAssembly from its own folder, writes the console's files into
it, and imports `core`. Requests are synchronous: even an approval is a few thousand SHA-256 steps,
milliseconds. The console's `ledger.json` is a file, as it would be in a board's flash; the page keeps
it in localStorage between visits.

## On a board

The same files could run on a Raspberry Pi Pico 2 W or an ESP32: `main.py` reads requests from USB
serial and prints answers. What was checked:
- every console test passes on MicroPython 1.26, the version boards run;
- `main.py` answers requests fed on stdin;
- once loaded, the console holds about 34 KB of heap. MicroPython starts with a 56 KB heap on an
  ESP32-WROOM-32 and grows it; a Pico 2 W has about 450 KB.

What wasn't: a real board. The plan is in [testing/console.md](../testing/console.md). A board would
add a second, independent check of the hash and the words. It would not make the key safer, since
the seeds would still come from the passkey through the page.

## The fingerprint

One SHA-256 over the console's files (`tools/fingerprint.mjs`). The page works it out again in your
browser, over the files it actually runs, and shows it under "Check this page". The README names the
same one, and a board running the same files would have it too. Today: `a46b5cfd…cb1a5163d`.
