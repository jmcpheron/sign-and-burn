<p align="center">
  <img src="site/favicon.svg" width="72" height="72" alt="">
</p>

<h1 align="center">Sign and Burn</h1>

<p align="center">
  <strong>One-time keys for an ordinary Safe: a seat whose key changes after every approval.</strong><br>
  Your passkey plays the key. Base Sepolia only.
</p>

<p align="center">
  <a href="https://github.com/jmcpheron/sign-and-burn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jmcpheron/sign-and-burn/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p align="center">
  <a href="https://youtu.be/Kjxk-1oTdZg"><img src="https://img.youtube.com/vi/Kjxk-1oTdZg/maxresdefault.jpg" width="560" alt="Sign and Burn: The 1979 Idea That Could Protect Crypto From AI Math Breakthroughs (video, 6 minutes)"></a><br>
  <sub><b>The idea in six minutes:</b> from elliptic curves and bunker mode to Lamport's one-time
  signatures, and the seat. The backup seats it mentions (a chip, a sealed seed phrase) aren't built
  yet.</sub>
</p>

The Safe keeps its address, its money and its threshold. One of its owners is a **seat**, and the
key behind the seat changes after every approval. Each approval needs two signatures from one tap
of a passkey: a curve signature (P-256) and a one-time signature that rests on SHA-256 alone. One
wallet transaction reveals the one-time signature, runs the Safe transaction, and names the next
key. The key that signed is spent; the next one has never signed, so only its fingerprint is on
chain.

> **Test network only.** This is a rehearsal, not a product. It has not been audited, and no
> cryptographer has reviewed it. Nobody has shown that elliptic curves can be broken the way this
> guards against.

## Why

In October 2026 Justin Drake asked the industry to plan calmly for "bunker mode": AI-accelerated
mathematics might break elliptic-curve signatures (ECDSA, and P-256 with it) before quantum
computers do. Vitalik Buterin agreed it is worth planning for, warned against rushed migrations, and
said the safe rule for a multisig is for each signer to change their key after each operation.

What follows from that:
- **A key that has never signed shows only a hash of itself.** An address is a fingerprint of a
  public key; the first signature shows the key.
- **Rotate after every use.** Here each signature retires the key that made it.
- **Hash-based signatures don't use curves.** They rest on a hash function alone.

## What's new, and what isn't

None of the cryptography is new. Hash-based one-time signatures, keys derived from one secret, and
key rotation all have a long history. What may be new is the way they are combined into a working
approval system around an ordinary Safe:
- **A stable seat, a changing key.** No new wallet address for each approval.
- **Two signatures over the same approval.** If curve signatures become forgeable, the one-time
  signature still has to authorize the transaction.
- **A console that signs only what it worked out itself**, and shows the transaction before it asks
  for a signature.
- **One-time signing that survives ordinary failure.** A key is spent once its signature is public,
  even if the transaction never lands. So the console remembers what each key signed, sends the same
  approval again when needed, and never signs a second message with that key. Today this works in
  one browser on one device. Making it work across devices and backups is the main open problem.

Whether the integration is novel, and whether it gives the protection it aims for, depends on the
exact construction and on how it behaves when things fail. The questions that decide it, and what
was checked for each: [notes/research.md](notes/research.md). Changes to the contracts go through
[a review process](notes/reviews/README.md).

## How it works

- **The Safe stays the multisig.** An ordinary Safe 1.4.1 holds the money and runs transactions.
- **One owner is a seat**, a small contract (`contracts/`). It approves only when two signatures
  check out: the passkey's **curve signature** (P-256, through Safe's own passkey signer) and a
  **one-time signature** (Winternitz, 67 chains of SHA-256, usable once).
- **Every approval names the next key.** The seat records its fingerprint and accepts nothing else.
- **One tap does both.** The passkey signs `c` with its curve key, and its PRF extension answers two
  labels with two seeds: the seeds of keys *n* and *n*+1. The passkey's own secrets never leave it;
  the seeds pass through the page and the console for one request. The curve signature covers `c`
  but not the next key, because the seeds arrive in the same tap. Only the one-time signature binds
  the next key ([open question 1](notes/research.md#1-complete-authorization)).
- **One press, one transaction.** The visitor's wallet sends one Multicall3 call: `seat.approve`, then
  `safe.execTransaction`. The wallet pays gas and approves nothing.

The whole design, with every message's bytes: [KICKOFF.md](KICKOFF.md). Each idea on its own, in
plain words: [notes/concepts](notes/README.md).

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
only pays gas. With no wallet on the passkey's device (a phone, say), the page shares links instead: a
wallet on another device pays for the build, and sends each approval after the console has signed it. A Trezor or a Ledger works through a browser wallet that drives it, such as Rabby,
MetaMask or Frame; the page lets you pick among the wallets in your browser.

**The wallet page** ([signandburn.app/wallet.html](https://signandburn.app/wallet.html)) shows the same
Safe as a plain wallet: its balance, a send form, and its owners. It can add your browser wallet as a
second owner, remove it, and change how many must approve. Each change is a Safe transaction that
the console marks red. In a **1 of 2** your wallet can approve alone: a backup if the passkey is lost,
and a way to get used to a multisig. It is also the way around the seat. Your wallet's key rests on a
curve, and once it has signed a transaction its public key is public, so if curves break the seat no
longer protects the Safe. In a **2 of 2** the seat's protection holds, and there is no backup. The page
says which of the two the Safe is in. It shares the main page's passkey and ledger, so the guardrail
is the same one.

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
| The page | `site/e2e.mjs`, in Chromium against a local chain with that same bytecode: passkey, first key, a shielded Safe paid for from a second browser by link, two presses, five attacks refused, red pages and refusals, the guardrail across a refused wallet, a reload and a browser with no ledger, a front-run approval, the danger case, and the CSP. The wallet page: the wallet added as an owner, 1 of 2 and 2 of 2 with votes in either order, a signed approval overtaken by the wallet's own transaction, and the owner removed again. |

On Base Sepolia, by hand ([notes/testing/live.md](notes/testing/live.md)): a MacBook's Touch ID
passkey has PRF; the first shielded Safe was built, which deployed the SeatFactory at
`0x0a6514135d34dfd19c3f1a636f3e952caeba3871` (its code is byte for byte this repository's build); three
presses landed and the Safe ran each; the attack room's five attacks were refused by the live seat.

What wasn't: an audit, or a cryptographer's review; any passkey but that one; a real second device; the
console on a real board. An AI review of the contracts is under way
([notes/reviews/](notes/reviews/README.md)).

## The build you're looking at

The **console fingerprint** is one SHA-256 over the console's files (`node tools/fingerprint.mjs`).
The page works it out again in your browser over the files it runs and shows it under
"Check this page"; a board running the same files would have the same one.

| | fingerprint |
|---|---|
| **console** | `4ab406c3611fa40dce02fcd1763db83ae4233a5c608847df1d8ec8f9008e785f` |

`docs/` is the site, built by `cd site && npm ci && npm run build`. The build is reproducible: CI
rebuilds it and fails on any difference. `docs/SHA256SUMS` lists every file for `sha256sum -c`.

## Layout

| path | what |
|---|---|
| [`KICKOFF.md`](KICKOFF.md) | the design, the decisions, and the test ladder |
| [`notes/`](notes/) | explainers of each idea, [the open questions](notes/research.md), test plans (with the by-hand tests on Base Sepolia), reviews, and a dated log |
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
