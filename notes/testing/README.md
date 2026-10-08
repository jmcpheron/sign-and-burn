# Testing

Each layer is tested on its own, then together. Everything above the line runs in CI on every push;
everything below is done by hand, and recorded here.

| layer | what | where | how often | plan |
|---|---|---|---|---|
| The one-time keys | 7 vectors, in five implementations | `reference/`, and each layer below | CI | [reference.md](reference.md) |
| The console | the Safe hash, the words, a real passkey's assertion, every request and refusal, on CPython and MicroPython | `console/test/` | CI | [console.md](console.md) |
| The contracts | the attack table with mocks; two presses against Base Sepolia's real bytecode | `contracts/test/` | CI | [contracts.md](contracts.md) |
| The page | the whole flow in Chromium against a local chain | `site/test.mjs`, `site/e2e.mjs` | CI | [page.md](page.md) |
| The built site | rebuild equals `docs/`; the live site equals the commit | CI, and by hand | CI, and after each deploy | [site.md](site.md) |
| Base Sepolia's contracts | still the bytecode the tests use | `.github/workflows/chain-check.yml` | weekly | [site.md](site.md) |
| — | — | — | — | — |
| Real passkeys and wallets on Base Sepolia | PRF per device, presses, the attack room, the guardrail | by hand, on signandburn.app | as devices come | [live.md](live.md) |
| The console on a board | a Pico 2 W or an ESP32 answering over USB | by hand | not yet | [console.md](console.md#on-a-board) |

## Run everything CI runs

From the repository root (AGENTS.md, "Before you push"):

```sh
python3 reference/python/test_vectors.py && node reference/js/test-vectors.mjs
(cd site && npm ci)
python3 console/test/run.py && node console/test/run-micropython.mjs
node tools/fingerprint.mjs --check
(cd contracts && forge build && forge test && FOUNDRY_PROFILE=osaka forge test)
node tools/chain/deployment.mjs --check
(cd site && npm test && npm run build && npm run e2e)
```

Needs Python 3.9+, Node 22, Foundry 1.8.3 (anvil too) and Chromium (playwright-core's own, or
`SAB_CHROMIUM=/path/to/chrome`). About two minutes on a laptop.

## Counts, as of 2026-10-08

| | |
|---|---|
| reference vectors | 7 cases, in Python, JavaScript, Solidity, the page's JavaScript and MicroPython |
| console | 17 Safe-hash vectors, 15 decode expectations, 12 selectors, 1 real passkey assertion, the request protocol |
| contracts | 22 tests (14 with mocks, 2 vector and fuzz, 6 against real bytecode), on two EVM versions |
| page e2e | 38 checks |

## What no test covers

- An independent implementation of the one-time keys: every implementation shares an author and a
  spec.
- An audit, of anything.
- Most real devices' passkeys and most wallets ([live.md](live.md) records the ones tried).
- A real board running the console.
