# Testing the one-time keys

The scheme is defined once, in bytes, by `reference/vectors/v1.json`. Every implementation must give
every value in it.

## The vectors

`reference/vectors/generate.py` wrote them from the Python reference. Never run it again for v1: a
change in its output means a change in the format, which needs a new tag (v2) and a new file.

Seven cases, each with every intermediate value (`pubSeed`, the PRF salt, the first and last secrets,
the first step, the first and last chain ends, the key's fingerprint, the next key, `c`, `m`, the 67
digits and the whole signature) and the changes that must be refused:

| case | why |
|---|---|
| `base-sepolia-first` | the ordinary start: chain 84532, seat 0, key 0 |
| `second-key` | key 1: `n` reaches every hash |
| `other-seat-number` | seat 7, key 2: so does `seatNumber` |
| `other-signer-and-chain` | chain 1, another signer: so do they |
| `big-numbers` | `seatNumber` at 2^32 − 1, `n` at 2^64 − 2 (the last key with a next one), a chain id above 2^64 |
| `message-all-zero` | the largest checksum: 960 |
| `message-all-ones` | the smallest checksum: 0 |

Refused, in every case: another message, another key number, one signature value changed.

## The implementations that check them

| implementation | test | runs |
|---|---|---|
| Python, standard library only | `python3 reference/python/test_vectors.py` | CI |
| JavaScript, node's crypto | `node reference/js/test-vectors.mjs` | CI |
| Solidity (`OneTimeKey.sol`), plus a test-side signer written from the spec | `contracts/test/OneTimeKey.t.sol` | CI |
| the page's JavaScript (`site/src/wots.mjs`, viem's SHA-256) | `site/test.mjs` | CI |
| the Python reference on MicroPython 1.26, as the console runs it | `console/test/run-micropython.mjs` | CI |

## What else is checked

- The fuzz test signs a random message with a random seed and checks that another random message gives
  another fingerprint (64 runs per CI run).
- The danger case: four signatures with one key, then a forgery that checks (`site/test.mjs`, and the
  page's attack room).

## What isn't

- An implementation by someone else, from the spec alone. All five share an author.
- A review by a cryptographer of the parameters (w = 16, the tweaks, the checksum encoding).

## Next

- [ ] Ask someone outside the project to write a sixth implementation from KICKOFF.md alone, and run it
      against `v1.json`.
