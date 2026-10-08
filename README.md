<p align="center">
  <img src="site/favicon.svg" width="72" height="72" alt="">
</p>

<h1 align="center">Sign and Burn</h1>

<p align="center">
  <strong>A Safe owner that signs each approval with a one-time key, then burns it.</strong><br>
  Your passkey plays the key. Base Sepolia only.
</p>

<p align="center">
  <a href="https://github.com/jmcpheron/sign-and-burn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jmcpheron/sign-and-burn/actions/workflows/ci.yml/badge.svg"></a>
</p>

Each press of the button approves a real transaction on a test network. One wallet transaction
reveals the one-time signature, runs the Safe transaction, and names the next key. The key that
signed is dead; the next one has never been seen, so only its fingerprint is on chain. A Safe
guarded this way is **shielded**: there is no public key to attack until the moment it is used,
and by then it is spent.

> **Test network only.** This is a rehearsal, not a product. It has not been audited. Nobody has
> shown that elliptic curves can be broken the way this guards against.

## Why

In October 2026 Justin Drake asked the industry to plan calmly for "bunker mode": AI-accelerated
mathematics might break elliptic-curve signatures (ECDSA, and P-256 with it) before quantum
computers do. Vitalik Buterin agreed it is worth planning for, warned against rushed migrations, and
said the safe rule for a multisig is for each signer to change their key after each operation.

So, on a real chain:
- **A key that has never signed is safe from this.** An address is a fingerprint of a public key;
  the first signature shows the key.
- **Rotate after every use.** Here each signature retires the key that made it, by itself.
- **Hash-based signatures are the way out.** They rest on SHA-256 alone, with no curve to break.

## How it works

- **The Safe stays the multisig.** An ordinary Safe 1.4.1 holds the money and runs transactions.
- **One owner is a seat**, a small contract (`contracts/`). It approves only when two signatures
  check out: the passkey's **curve signature** (P-256, through Safe's own passkey signer) and a
  **one-time signature** (Winternitz, 67 chains of SHA-256, usable once).
- **Every approval names the next key.** The seat records its fingerprint and accepts nothing else.
- **One tap does both.** The passkey signs `c` with its curve key, and its PRF extension answers two
  labels with two seeds: the seeds of keys *n* and *n*+1. Neither secret leaves the passkey.
- **One press, one transaction.** The visitor's wallet sends one Multicall3 call: `seat.approve`, then
  `safe.execTransaction`. The wallet pays gas and approves nothing.

The whole design, with every message's bytes: [KICKOFF.md](KICKOFF.md).

### The console

The page is built around a console: about a thousand lines of MicroPython ([`console/`](console/)).
It works out the Safe transaction hash itself, says in plain words what the transaction does,
refuses what it can't explain, builds both messages from the seat's own *n*, makes the one-time
signature, and keeps **the guardrail**: one signature per key, ever. It answers one JSON line with
another.

In the browser it runs on MicroPython 1.26 for WebAssembly. **The same files could run on a
Raspberry Pi Pico 2 W or an ESP32**: `main.py` answers the same lines over USB serial. What was
checked: the console's tests pass on MicroPython 1.26, `main.py` answers requests on stdin, and the
loaded console holds 34 KB of heap. It has not been run on a board yet. Much of it comes from
[PicoQuorum](#credit)'s hardware console: the Safe hash, the decoder, and the passkey packing.

## Try it

**On the site:** [signandburn.app](https://signandburn.app/).
You need a passkey with PRF (a current Safari, Chrome or Edge with Touch ID, Windows Hello, a phone or
a security key), a browser wallet on Base Sepolia, and a little Base Sepolia ETH for gas. The wallet
only pays gas. A Trezor or a Ledger works through a browser wallet that drives it, such as Rabby,
MetaMask or Frame; the page lets you pick among the wallets in your browser.

**On your own computer**, with nothing on a real chain:

```sh
(cd site && npm ci && npm run dev)       # writes site/dev/, for the local chain
node tools/chain/anvil.mjs                # anvil with Base Sepolia's contracts, chain 31337 (Foundry 1.8.3)
python3 -m http.server -d site/dev 8000   # then open http://localhost:8000 with a browser wallet on 31337
```

`cd site && npm run e2e` does all of it in Chromium by itself, with a virtual passkey and a test
wallet: it builds a shielded Safe, presses twice, runs every attack, and checks each result on chain.

## What was checked

| | how |
|---|---|
| The one-time keys | Python and JavaScript, against 7 vectors in `reference/vectors/v1.json`. The Solidity, the page's JavaScript and the console on MicroPython check the same file. |
| The console | `console/test/`: the Safe hash against 17 vectors (real mainnet transactions among them), the decoder against 15 expectations, a real browser passkey's assertion that Safe's signer accepted on chain, and every request and refusal. On CPython and on MicroPython 1.26. |
| The contracts | 22 Foundry tests: every refusal in the attack table, and two presses against Base Sepolia's real Safe 1.4.1, passkey signer and Multicall3 bytecode, with a real P-256 key. About 660,000 gas a press. |
| The page | `site/e2e.mjs`, in Chromium against a local chain with that same bytecode: passkey, first key, shielded Safe, two presses, five attacks refused, red pages and refusals, the guardrail across a refused wallet and a reload, the danger case, and the CSP. |

What wasn't: an audit; a real device's passkey (M3 in the kickoff publishes which ones have PRF);
Base Sepolia itself (nothing is deployed yet; the page deploys the SeatFactory, at
`0x0a6514135d34dfd19c3f1a636f3e952caeba3871` on every chain, the first time anyone builds a
shielded Safe); the console on a real board.

## The build you're looking at

The **console fingerprint** is one SHA-256 over the console's files (`node tools/fingerprint.mjs`).
The page works it out again in your browser over the files it runs and shows it under
"Check this page"; a board running the same files would have the same one.

| | fingerprint |
|---|---|
| **console** | `a46b5cfdc0f904fa3f14f6b69402b61b766f7a47de7c07e1dc8c025cb1a5163d` |

`docs/` is the site, built by `cd site && npm ci && npm run build`. The build is reproducible: CI
rebuilds it and fails on any difference. `docs/SHA256SUMS` lists every file for `sha256sum -c`.

## Layout

| path | what |
|---|---|
| [`KICKOFF.md`](KICKOFF.md) | the design, the decisions, and the test ladder |
| [`reference/`](reference/) | the one-time keys in Python and JavaScript, and the v1 test vectors |
| [`contracts/`](contracts/) | `OneTimeKey`, `Seat`, `SeatFactory`, in Foundry |
| [`console/`](console/) | the console: MicroPython that runs in the page and could run on a board |
| [`site/`](site/) | the page's source; `npm run build` writes `docs/` |
| `docs/` | the built page, served at signandburn.app. Never edited by hand |
| [`tools/`](tools/) | `chain/` (Base Sepolia's bytecode, a local chain, the factory's address), `fingerprint.mjs` |
| [`AGENTS.md`](AGENTS.md) | the rules for AI coding agents, and for everyone |

## Credit

- **Safe**: the Safe contracts, and the passkey module (safe-modules) that the seat relies on.
- **Robert Winternitz** and **Ralph Merkle** for one-time signatures, and **Leslie Lamport** for the
  first one.
- **PicoQuorum**, a hardware console that is one owner of a Safe, and before it **Austin Griffith**'s
  [picowallet](https://github.com/austintgriffith/picowallet), for the console, its rules, and the
  passkey-signer work.
- **MicroPython**, which runs the console here and on boards.
- **Justin Drake** and **Vitalik Buterin**, whose October 2026 posts prompted this.

Third-party parts and their licenses: [NOTICE](NOTICE).

## License

Code, the contracts and the built site: [MIT](LICENSE). The docs: [CC BY-SA 4.0](LICENSE-DOCS).
