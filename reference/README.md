# Reference: the one-time keys and messages (v1)

The scheme in [KICKOFF.md](../KICKOFF.md), written twice and checked against one file of vectors.

| | |
|---|---|
| `python/sign_and_burn.py` | Python, standard library only |
| `js/sign-and-burn.mjs` | JavaScript, Node's own crypto, no packages |
| `vectors/v1.json` | 7 cases: every intermediate value, a full signature, and changes that must be refused |
| `vectors/generate.py` | writes `v1.json` from the Python. Never run it again once v1 is released |

```sh
python3 reference/python/test_vectors.py
node reference/js/test-vectors.mjs
```

What was checked: both implementations give every value in `v1.json`, and recovering the fingerprint
from a signature gives the key's own fingerprint. A changed message, key number or signature value
gives a different one. The cases cover the two extreme checksums (960 for an all-zero message, 0 for
all-ones), `seatNumber` and `n` at their largest, and a chain id above 2^64.

The same file checks three more implementations: the Solidity (`contracts/test/OneTimeKey.t.sol`),
the page's own JavaScript (`site/src/wots.mjs`, in `site/test.mjs`), and this Python itself running
on MicroPython 1.26, where it is part of the console image (`console/test/run-micropython.mjs`).

What was not checked: that any of them matches an independent implementation. They share an author
and a spec.

Integers in `v1.json` that can exceed 2^53 are decimal strings. `n` must be below 2^64 − 1, so that
key `n + 1` exists; the seat's checked add reverts at the end of the ladder.
