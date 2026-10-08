# Sign and Burn: Project Kickoff

> **Living draft, started 2026-10-08.** M0 to M2 are built; nothing is deployed yet ([Where it
> stands](#where-it-stands)). Edit this file as decisions get made, and move settled decisions out of
> [Open decisions](#open-decisions) with a one-line reason.

**Repo:** https://github.com/jmcpheron/sign-and-burn (public)
**Site:** https://signandburn.app (registered; its DNS and GitHub Pages are not set up yet)

A demo of a Safe owner that signs each approval with a one-time key and then burns it. Your passkey
plays the key. Each press of the button approves a real transaction on a test network, and the key
that signed it is replaced by a fresh one nobody has seen.

## Where it stands

2026-10-08. What is built, and how it was checked:

| Rung | State |
|---|---|
| **M0** Reference | Done. Python and JavaScript agree on the 7 cases of `reference/vectors/v1.json`. The Solidity, the console on MicroPython and the page's JavaScript check the same file. |
| **M1** Contracts | Done, with one change of plan: instead of an Anvil fork, the integration test puts Base Sepolia's real bytecode (Safe 1.4.1, the passkey signer, Daimo's verifier, Multicall3) at its own addresses, so CI needs no RPC. A weekly job checks that bytecode against the chain. 22 tests, every refusal in the attack table. Gas measured: about 660,000 a press with the P-256 precompile. |
| **M2** Page, locally | Done. `site/e2e.mjs` runs the whole flow in Chromium with a virtual authenticator that has PRF, against a local chain with that same bytecode, and checks the CSP. |
| **M3** Base Sepolia | Next. Needs the domain's DNS and GitHub Pages, then real devices. |
| **M4**, **M5** | Not started. The attack room's simulations and the danger case are built; the Bunker Box isn't. |

Changes from the first draft, each for a reason found while building:
- **The page has a console.** About a thousand lines of MicroPython (`console/`), most of it from
  PicoQuorum's hardware console: the Safe hash, the decoder, the passkey packing. It builds `c` and
  `m`, makes the one-time signature and keeps the guardrail; the page carries its answers to the
  passkey, the wallet and the chain. It runs in the page on MicroPython for WebAssembly, and the same
  files could run on a Pico or an ESP32 ([The console](#the-console)).
- **Two indexes on chain.** Base Sepolia's public RPC searches logs only 500 blocks at a time, so
  events can't be the page's memory. `SeatFactory.seatsOf(curveSigner)` lists a passkey's seats, and
  `Seat.approvedIn(n)` is the block each approval landed in.
- **The Safe transaction may fail without the approval failing.** The press's Multicall3 call lets
  `execTransaction` fail (`allowFailure`). The key still burns, and the Safe keeps the seat's vote, so
  anyone can run the transaction later. The page works out the gas itself: a wallet's estimate would
  be the least gas with which nothing reverts, which is gas with which the Safe transaction fails.
- **The SeatFactory needs no deployer.** It goes through the CREATE2 deployer with salt 0, so it is at
  `0x0a6514135d34dfd19c3f1a636f3e952caeba3871` on every chain, and the first visitor's "build"
  transaction deploys it.
- **No service worker.** The page has no worker for a policy to bind, so a `<meta>` tag carries the
  CSP, and the page refuses to run inside a frame in place of `frame-ancestors`.
- **The page is "shielded Safe" for the visitor.** A Safe whose only owner shows the chain nothing but
  the next key's fingerprint.

## Names

| What | Name |
|---|---|
| The project, in prose | **Sign and Burn** |
| The repository | `jmcpheron/sign-and-burn` |
| The site | `signandburn.app`, the only domain that serves it. Any other domain only redirects there: a passkey belongs to the domain that made it, so serving from two domains would split visitors' passkeys. |
| Packages | `sign-and-burn-site`, `sign-and-burn-reference` |
| Contracts | `Seat`, `SeatFactory`, and the library `OneTimeKey` |
| Message tags | `sign-and-burn/<purpose>/v1`. A new version of any format gets a new tag, never a changed meaning. |

## Why now

In October 2026 Justin Drake asked the industry to plan calmly for "bunker mode". His worry is
that AI-accelerated mathematics could break elliptic-curve signatures (ECDSA, and with it P-256)
before quantum computers do: fast private-key recovery on available hardware, perhaps in months,
not years. Vitalik Buterin's reply agreed that the risk is worth planning for, warned against
rushed migrations, and added that the safe rule for multisigs is for each signer to change their
key after each operation.

What we take from that, and what this demo shows:
- **A key that has never signed is safe from this threat.** An address is a fingerprint of a
  public key. The first signature shows the public key.
- **A multisig doesn't help much on its own.** In a 2-of-3, one transaction shows two keys, which
  is the whole threshold.
- **Rotate after every use.** Each signature should retire the key that made it.
- **Hash-based signatures are the way out.** They rest only on a hash function, with no curve to
  break. Signatures and proofs can be hash-only today.
- **Don't rush, and don't botch a migration.** This is a demo on a test network, so people can see
  the idea before anyone moves real money.

Nobody has shown that elliptic curves can be broken this way. This project is a rehearsal, not a
response to a known attack.

## What this is

A web page, and three small contracts on Base Sepolia.

- **The Safe stays the multisig.** An ordinary Safe holds the money, keeps the list of owners,
  counts approvals and runs transactions. Nothing about it changes.
- **We write one owner: the seat.** A seat is a contract that is an owner of the Safe. It approves
  a transaction only if two signatures check out:
  - a **curve signature** from the passkey (P-256, as passkeys sign today);
  - a **one-time signature**, which uses only SHA-256 and can be used once.
- **Every approval names the next key.** The seat records the next one-time key's fingerprint and
  will accept nothing else. The key that just signed is dead. Rotation happens by itself, on every
  approval.
- **The page has a console.** It works out the Safe transaction hash itself, says in plain words
  what the transaction does, and makes you hold the button before it asks the passkey.

## Goals

- Show, on a real chain, a Safe owner whose every approval retires its key.
- Show that the seat holds even if curves break: a curve signature alone gets nowhere.
- Let anyone try to break it, in an attack room and with a standing challenge (the Bunker Box).
- Keep it small enough to read: one page folder, three contracts, one reference implementation, and
  a console of about a thousand lines.
- Leave a design the PicoQuorum console can use later, with a chip in place of the passkey.

## Non-goals (for now)

- Real money. Base Sepolia only. The page refuses every other chain.
- An audit, or any claim that this is secure.
- Replacing Safe. The seat is one owner; Safe does everything else.
- Recovery. A demo seat whose passkey is lost stays stuck. In a real multisig, the other owners
  would replace it.
- Public-key encryption. Hash functions can't do it.

## How it works

```
                 ┌──────────────────────────────────────────────┐
  passkey ──tap──► console: builds the hash, shows it, hold to   │
  (curve key +   │ press; signs with one-time key n              │
   PRF secret)   └───────────────┬──────────────────────────────┘
                                 │ approve(safe, safeTxHash, nextKey, oneTime, curveSig)
                                 ▼            sent by any wallet
                 ┌──────────────────────────────────────────────┐
                 │ Seat: checks both signatures, burns key n,     │
                 │       records nextKey, calls approveHash       │
                 └───────────────┬──────────────────────────────┘
                                 ▼
                 ┌──────────────────────────────────────────────┐
                 │ Safe (unchanged): counts the seat's approval,  │
                 │       runs execTransaction                     │
                 └──────────────────────────────────────────────┘
```

### The key ladder

```
key 0    burned    its signature is public, and useless now
key 1    burned
key 2    current   only its fingerprint is on chain
key 3…   unseen    not even a fingerprint yet
```

### Why the seat votes on chain

Today's Safe owners sign off chain, and the Safe checks their signatures when it runs the
transaction. But Safe makes that check read-only (a `view` call), so an owner checked that way
could never mark its one-time key as spent. Instead the seat calls `approveHash` on the Safe,
which Safe has had since its first versions. The seat checks, burns the key, records the next one
and votes in one call.

That the vote is public doesn't matter. The one-time key is spent by the time it lands, and the
curve signature alone is not enough.

## The signer: one passkey, two jobs

**The curve half.** A passkey signs with P-256, inside the phone, laptop or security key. The page
asks it for an ordinary WebAuthn assertion whose challenge is the approval (`c`, below). The seat
checks it by calling the passkey's own **SafeWebAuthnSignerProxy**: Safe's audited passkey signer,
already deployed and used by PicoQuorum's owners. We reuse it rather than write our own curve check.

| | value (the same as PicoQuorum's `firmware/quorum_cfg.py`) |
|---|---|
| SafeWebAuthnSignerFactory (safe-modules passkey 0.2.1) | `0x1d31F259eE307358a26dFb23EB365939E8641195` |
| SafeWebAuthnSignerSingleton | `0x4E27b51350e6c2083EE19011120F50DAfEc5CA50` |
| verifiers | `0x0100c2b78104907f722dabac4c69f826a522b2754de4`: the P-256 precompile at `0x100`, then Daimo's verifier |

Each of these is to be checked on Base Sepolia by a test before use (M1).

**The one-time half: the passkey's PRF.**
- WebAuthn's PRF extension lets a passkey act as a sealed secret. Given a label (a "salt"), it
  returns 32 bytes made from a secret that never leaves the passkey.
- It does this for two salts in one tap. The page asks for the seeds of key `n` (to sign) and key
  `n+1` (to name the next key).
- The page makes each key's 67 secrets from its seed by hashing.
- The seeds pass through the page's memory for a moment. The passkey's own secret never leaves it.

**One tap.** The page only learns key `n+1` during the tap, so the curve signature can't include
the next key's fingerprint. So the curve signature covers the approval (`c`), and the one-time
signature covers the approval plus the next key (`m`). Changing the next key would mean forging a
one-time signature.

**Always ask with user verification on** (`userVerification: "required"`). Some authenticators
give a different PRF answer with and without it, and the keys would stop matching. Safe's passkey
signer requires the user-verified flag anyway.

## The one-time keys (frozen by `reference/vectors/v1.json`)

Winternitz one-time signatures (WOTS), with per-step tweaks in the style of WOTS+.

| Parameter | Value |
|---|---|
| Hash | SHA-256: a precompile on chain, native in browsers, and native on the Pico (for later) |
| Winternitz parameter | w = 16: each digit is 0 to 15, so each chain has 15 steps |
| Chains | 64 for the message plus 3 for the checksum: 67 |
| Signature | 67 × 32 bytes = 2,144 bytes |
| Key fingerprint | 32 bytes |

**Definitions.** Integers are big-endian at the width of their Solidity type: chainId 32 bytes,
addresses 20, seatNumber 4, n 8, j and s 1.

```
pubSeed   = sha256("sign-and-burn/seed/v1" ‖ chainId ‖ curveSigner ‖ seatNumber)   fixed per seat
salt(n)   = sha256("sign-and-burn/prf/v1"  ‖ chainId ‖ curveSigner ‖ seatNumber ‖ n)
seed(n)   = the passkey's PRF output for salt(n)
secret(n, j) = sha256("sign-and-burn/sk/v1" ‖ seed(n) ‖ j)                        j = 0..66
F(x, n, j, s) = sha256(pubSeed ‖ n ‖ j ‖ s ‖ x)                                   one step of chain j
end(n, j) = F applied 15 times to secret(n, j), for s = 0..14
K(n)      = sha256(pubSeed ‖ n ‖ end(n, 0) ‖ … ‖ end(n, 66))                      the key's fingerprint
```

**Signing message `m` with key `n`:**
1. Split `m` into 64 hex digits `d[0..63]`, high nibble first.
2. The checksum is `C = Σ (15 − d[i])`, at most 960. Its three hex digits are `d[64..66]`.
3. For each chain `j`, reveal `σ[j]` = `secret(n, j)` stepped `d[j]` times.

**Checking:** step each `σ[j]` the rest of the way, from step `d[j]` to step 14, then compare
`sha256(pubSeed ‖ n ‖ ends)` with the stored fingerprint.

**Why the checksum:** anyone can step a revealed value further, so a forger could push some digits
up and make a different message. The checksum counts how far each digit is from the top, so
pushing any digit up pushes the checksum down. Going down a chain means undoing a hash.

**Why one passkey can run several seats:** `seatNumber` and `chainId` are in every salt and tweak,
so two seats never share a key. The page takes the next `seatNumber` from the length of
`SeatFactory.seatsOf(curveSigner)`. A passkey can't make two seats with one number: the same number
gives the same first key, so the same CREATE2 address, and the second creation reverts.

## The messages

```
c = sha256("sign-and-burn/approve/v1"  ‖ chainId ‖ seat ‖ safe ‖ n ‖ safeTxHash)   the passkey's curve signature covers c
m = sha256("sign-and-burn/one-time/v1" ‖ c ‖ nextKey)                             one-time key n signs m
```

The Safe transaction hash already includes the Safe's address and chain (its EIP-712 domain). They
are in `c` as well, so an approval reads plainly and can't be moved.

## The contracts

### Seat

**State:**

| | |
|---|---|
| `curveSigner` (immutable) | the passkey's SafeWebAuthnSignerProxy |
| `seatNumber`, `pubSeed` (immutable) | which run of keys this seat uses |
| `current` | the fingerprint of one-time key `n` |
| `n` | how many approvals this seat has made |
| `approvedIn(k)` | the block approval `k` landed in, so the page can find its event without scanning logs |

There is no admin, no upgrade and no recovery key. The Safe replaces a seat like any other owner. A
seat is not tied to one Safe: it can be an owner of several, and they share its run of keys.

**`approve(safe, safeTxHash, nextKey, oneTime, curveSig)`:**
1. Build `c` and `m` from the seat's own `n`, never from a number in the call.
2. Refuse a `nextKey` that is zero or equal to `current`.
3. Check the one-time signature against `current`.
4. Check the curve signature: `curveSigner.isValidSignature(c, curveSig)` must return
   `0x1626ba7e`.
5. Set `current = nextKey`, add one to `n`, record `approvedIn`, and emit `Approved`.
6. Call `safe.approveHash(safeTxHash)`. If the seat is not an owner of that Safe, the whole call
   reverts and the key is not spent.

Anyone may call `approve`. Everything in the call is bound by the signatures, so a copied call can
only do exactly what was signed.

```solidity
// The interface, as contracts/src/Seat.sol has it.
interface ISeat {
    event Approved(address indexed safe, bytes32 indexed safeTxHash, uint64 indexed n, bytes32 nextKey);

    function curveSigner() external view returns (address);
    function seatNumber() external view returns (uint32);
    function pubSeed() external view returns (bytes32);
    function current() external view returns (bytes32);
    function n() external view returns (uint64);
    function approvedIn(uint64 k) external view returns (uint256);

    function approve(
        address safe,
        bytes32 safeTxHash,
        bytes32 nextKey,
        bytes32[67] calldata oneTime,
        bytes calldata curveSig   // abi.encode(authenticatorData, clientDataFields, r, s), as Safe's passkey signer takes it
    ) external;
}
```

### SeatFactory

`createSeat(curveSigner, seatNumber, firstKey)` deploys a seat with CREATE2, so a seat's address is
known before it exists. It emits `SeatCreated(curveSigner, seatNumber, seat, firstKey)` and adds the
seat to `seatsOf(curveSigner)`, which the page reads to find a passkey's seats again. Anyone may make
a seat for any passkey; one whose first key isn't that passkey's own can't be signed for, and the
console checks the key before any one-time signature leaves it.

The factory itself is deployed through the CREATE2 deployer (`0x4e59…956c`) with salt 0, so it is at
`0x0a6514135d34dfd19c3f1a636f3e952caeba3871` on every chain (`contracts/deployment.json`). The
first "build" on a chain deploys it in the same transaction.

### OneTimeKey

A library: `fingerprint(pubSeed, n, m, sig) → bytes32`. It is about 30 lines of plain Solidity, and
it is the part most worth reading twice.

### The Safe

An ordinary Safe 1.4.1 L2 at Safe's canonical addresses on Base Sepolia. The addresses are pinned
in one config file and checked on chain by a test.
- **v1:** 1 of 1, owned by your seat.
- **v2:** 2 of 2 with two passkeys (say, a phone and a laptop), to show it is still a multisig.

### One press, one wallet transaction

The visitor's browser wallet sends a single Multicall3 call:
1. `seat.approve(...)`, which must succeed;
2. `safe.execTransaction(...)`, with a pre-approved signature for the seat (`r` = the seat, `s` =
   0, `v` = 1), which may fail: if the Safe can't run it yet (say it lacks the ETH), the approval
   still lands, and the Safe keeps the vote for anyone to run it later.

The wallet only pays gas. It never approves anything. The page works out the gas as if the Safe
transaction must succeed: a wallet's own estimate is the least gas with which nothing reverts, and
with step 2 allowed to fail, that is gas with which it fails.

### Gas (measured in M1)

About 660,000 gas per press with the P-256 precompile, which Base Sepolia has; about 990,000 with
Daimo's verifier as the fallback. More than the first guess of 200–350k:
- about 500 SHA-256 precompile calls for the one-time check, in plain Solidity (assembly could make
  them cheaper);
- the WebAuthn check through the passkey signer;
- 3,556 bytes of calldata, most of it the 2,144-byte one-time signature;
- four storage writes, and the Safe's own execution.

On Base Sepolia this is paid in test ETH. `contracts/README.md` has the numbers.

## The guardrail: one signature per key

The seat enforces that **a spent key is dead**: once an approval lands, the seat accepts only the
next key. It cannot enforce that **a key signs only once**. It only sees signatures that reach it.
Two different signatures with the same key would show enough of its secrets for someone to piece
together a third, with their own next key in it. If curves were broken too, they could take the
seat.

So the console keeps these rules (`console/core.py`):
1. Read the seat's `n` from the chain before every signature.
2. One signature per key number, ever. If a signed approval for `n` exists, send that same one
   again; never make a new one.
3. Sign only immediately before sending, and send at once.
4. Keep the signed approval (it isn't secret) until the chain shows `n` has moved past it.
5. Signing ahead is allowed in order: key `n` for one approval, key `n+1` for the next.

The console writes each approval to its ledger before the signature leaves it. In the browser the
page keeps the ledger in localStorage; on a board it would be a file in flash. A landed approval
keeps one short line.

**What's left:** if a page loses its stored approval *after* sending it, and the transaction is
dropped, the page can't tell that key `n` has already signed something public. The wallet's history
is the fallback. The attack room's danger case shows why it matters: a throwaway key signs several
messages, and a forger with no secret signs one more.

## The page

### Screens

One page. The console takes the middle, with the steps on its screen; the Safe, the ladder and the
history sit beside it; the attack room, how it works and the page check are below. Built (M2) unless
it says otherwise.

| # | Screen | What happens |
|---|---|---|
| 1 | Welcome | What the demo shows, in four sentences, and reveal, run, rotate. Test network only. |
| 2 | Make a passkey | Creates a passkey on signandburn.app, or finds one made elsewhere (two signatures name its key). |
| 3 | First key | One tap: the PRF gives seed 0 and the console gives key 0's fingerprint. Without PRF it says so and stops. |
| 4 | Build your shielded Safe | One wallet transaction deploys the passkey's signer, the seat and a 1-of-1 Safe (and the SeatFactory, the first time on a chain). The addresses are shown before anything exists. |
| 5 | Fund it | Send 0.001 test ETH from the wallet, or a link to a faucet. |
| 6 | The button | Send a little test ETH to an address, or pick something red or refused to see the console's judgement. The console shows the hash it worked out and plain words for what happens. Hold for two seconds, tap the passkey, and the wallet sends. Then what key `n` revealed, chain by chain. |
| 7 | The ladder | Burned, current and unseen keys. Next to it, **what an attacker can see now** and **what they would need**. |
| 8 | History | Each approval, from the console's ledger, with its transaction. |
| 9 | The attack room | Five attacks built from your last approval as anyone can read it from the chain; each asks the live seat by simulation and shows its error. The danger case, with a throwaway key. |
| 10 | The Bunker Box | The standing challenge. Not built (M4). |
| 11 | Check this page | The console fingerprint, worked out in the browser, and how to rebuild the folder and compare. |
| | Serial | Every line the page and the console said to each other, seeds left out. |

### Console rules

The console follows the rules of PicoQuorum's:
- It works out the Safe transaction hash itself, never taking one from anywhere.
- It shows every field in plain words.
- It refuses anything it can't explain.
- Anything that changes who controls the Safe is red, all over.
- The button is held, not clicked.

### The console

About a thousand lines of MicroPython in `console/`: PicoQuorum's `safe_tx.py`, `keccak.py` and
`decode.py`, a `webauthn.py` for browser passkeys, the reference `sign_and_burn.py` itself, and
`core.py`, which answers one JSON line with another. The page runs it on MicroPython 1.26 for
WebAssembly, and shows each line in its serial log. On a Pico 2 W or an ESP32, `main.py` would answer
the same lines over USB serial. Loaded, it holds about 34 KB of heap. It has not been run on a board.

### How it's built

- **One folder** that holds everything it runs: `docs/`, served by GitHub Pages at signandburn.app.
  It loads nothing from anywhere else. Its `console/` is exactly the console image, and hashes to the
  console fingerprint the README names.
- **A Content-Security-Policy** in the page (a `<meta>` tag: Pages can't send headers, and the page
  has no worker for a header to bind):
  - `default-src 'none'`;
  - scripts and styles from the folder only, and `'wasm-unsafe-eval'` for MicroPython;
  - `connect-src` to the folder and the pinned Base Sepolia RPC endpoint only.

  No inline scripts or styles. The page refuses to run inside a frame.
- **The passkey is the only key.** The one exception is the Bunker Box's published key, which is
  labelled everywhere it appears.
- **Reproducible.** `npm ci && npm run build` writes the same bytes, CI checks that, and
  `SHA256SUMS` lists every file.
- **Untrusted text** (anything from the chain or a link) is drawn with `textContent`.
- **viem's client keeps `ccipRead: false`.**

## The attack room

Each attack runs against the live contracts as a simulation (`eth_call`). It costs nothing and
moves nothing. The page asks the seat directly, not through Multicall3, which would hide the seat's
own error behind "call failed". Built, with your last approval as anyone can read it from the chain:

| Attack | Expected refusal |
|---|---|
| Replay an old approval | `BadNextKey`: its next key is the current one now. With your own next key instead, the one-time check fails: `n` has moved on |
| Reuse a spent key on a new transaction | the one-time check fails: `current` has moved on |
| Swap in your own next key | the one-time check fails: the next key is inside `m` |
| Send the approval for another Safe or chain | the one-time and curve checks fail: both are in `c` |
| A curve signature with no one-time signature | the one-time check fails |
| A valid approval to a Safe the seat doesn't own | Safe's `approveHash` reverts; the key is not spent |
| **The danger case:** the same key signs two messages | Shown off chain, step by step: which secrets two signatures reveal, and how a forger would use them. This is why the guardrail exists. |

## The Bunker Box

A standing challenge that stands in for a world where curves are broken.
- A Safe holding a little test ETH, owned by one seat.
- That seat's curve key is a software P-256 key whose private key we **publish**, so anyone can
  make its curve signatures.
- Its one-time keys come from a maintainer's passkey.
- Visitors try to take the test ETH. Only the one-time keys guard it.
- Test network only, labelled everywhere. Its rules and refills are an
  [open decision](#open-decisions).

## Never weaken these

1. **One signature per one-time key number, ever.** The page keeps [the guardrail](#the-guardrail-one-signature-per-key).
2. **The page signs only what it built.** It works out the Safe transaction hash, `c` and `m`
   itself, from the fields on the screen.
3. **The passkey is the only key.** No software keys, except the Bunker Box's published one,
   labelled.
4. **Base Sepolia only.** The page refuses any other chain ID, except a local Anvil chain in
   development builds, which the published build can't contain.
5. **The seat has no admin.** No owner, no upgrade, no pause, no recovery key.
6. **The page is one folder** that holds everything it runs, under its Content-Security-Policy.
7. **The supply chain stays pinned.** Exact versions with lockfiles; install with `npm ci`; install
   scripts off; GitHub Actions pinned by commit, with the least permissions each job needs.
8. **No secrets in the repository,** nor in tests, logs, screenshots or issues. Only test keys and
   disposable testnet wallets.
9. **No claims of safety.** The docs say what was checked and how.

## What it protects, and what it doesn't

| Threat | Holds? | Why |
|---|---|---|
| Curves broken; the attacker sees everything public | **yes** | They can make curve signatures, but not the next one-time signature |
| Copying or replaying an approval | **yes** | `n`, the chain, the seat and the Safe are all in what is signed |
| One key signs two messages, both public, and curves are broken | **no** | The guardrail is the only defence |
| A bug in our one-time code | **partly** | The curve signature still guards, unless curves are broken too |
| A bug in the seat's logic | **maybe not** | Tests, review and the test network |
| A hostile copy of the page, or a malicious browser extension | **no** | The page derives the seeds and builds the messages. The defences are the reproducible build, `SHA256SUMS`, and running your own copy (which then needs its own passkeys). |
| A stolen device that unlocks the passkey, or a compromised Apple or Google account with synced passkeys | **no** | Whoever has the passkey has both halves |
| Lost passkey | stuck | In the demo the seat can't approve again. In a real multisig, the other owners replace it. |

## Test ladder

| Rung | What | Done when |
|---|---|---|
| **M0** Reference ✓ | The one-time keys and messages in Python (standard library only) and in JavaScript. Test vectors. | Both implementations agree on every vector, and the vectors file is frozen as v1 |
| **M1** Contracts ✓ | `OneTimeKey`, `Seat` and `SeatFactory` in Foundry. Vector tests, fuzzing, and every refusal in the attack table. A test against a real Safe 1.4.1 and the real passkey signer, with Base Sepolia's bytecode at its own addresses. | Every refusal is covered and gas is measured |
| **M2** Page, locally ✓ | The whole flow against a local chain with that bytecode, with Chromium's virtual authenticator (it has PRF). CSP checked in the browser. | The end-to-end test passes in CI |
| **M3** Base Sepolia | Real passkeys: Apple, Google, a security key. A PRF support table, published. | Ten presses in a row on two platforms |
| **M4** Attack room and Bunker Box | Both live | Each attack shows its refusal; the Box is funded |
| **M5** Launch | signandburn.app on GitHub Pages over HTTPS (.app domains require it), the reproducible-build check in CI, a README for people who aren't developers | Public, and read by someone outside the project |
| Later | The console on a real Pico or ESP32, over Web Serial from the page. The PicoQuorum console as a seat signer (below). A comparison with SLH-DSA (stateless, no guardrail, much larger). Frame transactions (EIP-8141), which could drop the wallet. A cheaper `OneTimeKey`. | |

## Repo layout

```
sign-and-burn/
├── README.md            what it is, for anyone
├── KICKOFF.md           this file
├── AGENTS.md            rules for AI coding agents (from "Never weaken these")
├── reference/           the one-time keys in Python and JavaScript, and vectors/
├── contracts/           Foundry: src/OneTimeKey.sol, src/Seat.sol, src/SeatFactory.sol, test/, deployment.json
├── console/             the console in MicroPython, and its tests
├── site/                the page's source; npm run build writes docs/
├── docs/                the built page, served at signandburn.app (CNAME); never edited by hand
├── tools/               chain/ (Base Sepolia's bytecode, the local chain, the factory's address), fingerprint.mjs
└── .github/workflows/   ci.yml (reference, console, contracts, page, reproducible build), chain-check.yml
```

## Toolchain

- **Page:** Node with `npm ci`, exact versions and `ignore-scripts=true`. The same versions
  PicoQuorum pins: `viem` 2.56.8, `esbuild` 0.28.2 and `playwright-core` 1.56.1, and MicroPython
  1.26.0 for WebAssembly (`@micropython/micropython-webassembly-pyscript`). No framework.
- **Contracts:** Foundry 1.8.3, pinned in CI by `foundry-toolchain`'s commit. No libraries: the tests
  declare the few cheatcodes they use.
- **Console:** MicroPython 1.26 (the page's) and CPython 3.9 or later, standard library only.

## Relationship to PicoQuorum

Sign and Burn is its own repository and site. What it borrows from PicoQuorum:
- the console's code: the Safe hash, the decoder and the passkey packing, in MicroPython;
- the console's rules;
- the one-folder page with its Content-Security-Policy;
- the reproducible build;
- the passkey-signer configuration.

The bridge back comes later: the same seat could take approvals from a PicoQuorum console.
- **The curve half is already there.** The Pico already wraps its chip's P-256 signatures as
  WebAuthn assertions for Safe's passkey signer (`firmware/webauthn.py`).
- **The one-time half would come from the chip.** A sealed secret in the chip would take the PRF's
  place, but it needs a slot in the chip's configuration before the chip is locked. PicoQuorum's
  quorum v1 table leaves no such slot, so this only applies to chips not yet locked, such as the
  key-c boards.

## Open decisions

| Decision | Options | Leaning |
|---|---|---|
| The Bunker Box | Amount, refills, rules, whether to publish attempts | to decide in M4 |
| The console on a board | Web Serial from the page to a Pico or ESP32 running `main.py`, or a board with its own screen | Web Serial first: the same lines, a second check of the hash and the words |
| A cheaper `OneTimeKey` | Plain Solidity, or assembly with one reused buffer | plain until someone needs the gas |

### Settled

| Decision | Settled | Why |
|---|---|---|
| Hash for the chains | **SHA-256** | A precompile on chain, native in browsers, and `hashlib.sha256` in MicroPython on the boards |
| The curve check | **Call the deployed signer** | Safe's audited passkey signer; the console already packs its format |
| Who pays gas | **The visitor's wallet** | Nothing to run; it pays gas and approves nothing |
| Demo Safe | **1 of 1** first | The seat alone shows the ladder; 2 of 2 comes later |
| Safe version | **1.4.1 L2** | At Safe's canonical addresses on Base Sepolia, checked against its bytecode |
| Parameters | **w = 16** | Frozen by `v1.json`: 2,144-byte signatures, about 500 hashes to check |
| Without PRF | **Refuse** | The page says so and stops; M3 publishes what has PRF |
| Repository | **Public** | It's meant to be read |
| Account | **`jmcpheron`** | Move later if it grows; GitHub redirects |
| License | **MIT code, CC BY-SA docs** | As PicoQuorum |
| RPC endpoint | **`https://sepolia.base.org`**, Base's own | It answers browsers (CORS); its 500-block log limit is why the contracts keep two indexes |
| The repository's start | **PicoQuorum's checkout, cleared** | The parts reused moved to `console/`, `site/` and `tools/`; the rest is gone from the tree |

## Risks

- **PRF support varies** by platform and browser. Apple, Google and many security keys have it;
  others may not. M3 publishes what was tested.
- **Some authenticators give PRF answers that depend on user verification.** We always ask with it
  on.
- **The demo could be read as "safe for real money".** It isn't, and every screen says test
  network only.
- **Gas** may come in above the estimate. M1 measures it before the page is designed around it.
- **A format change after launch** would strand seats. Formats are versioned by tag and never
  changed in place.
- **Domain binding.** Passkeys made on signandburn.app work only there. The domain is chosen for
  the long term.

## Glossary

| Term | Meaning |
|---|---|
| **Curve key** | The passkey's P-256 key. It can sign many times, but a curve break would expose it. |
| **One-time key** | A hash-based key that may sign exactly one message. |
| **Fingerprint** | A SHA-256 hash that stands for a key without showing it. |
| **Seat** | Our contract: one owner of a Safe, requiring both signatures. |
| **Approval number (`n`)** | Which one-time key the seat expects next. It is separate from the Safe's nonce. |
| **Burn** | The seat recording the next key, after which the old one is refused for good. |
| **PRF** | A WebAuthn extension: the passkey returns a value made from a secret it keeps. |

## Credit

- **Safe:** the Safe contracts and the passkey module (safe-modules), which the seat relies on.
- **Robert Winternitz and Ralph Merkle** for one-time signatures. **Leslie Lamport** for the first
  one.
- **PicoQuorum** (and before it, Austin Griffith's picowallet) for the console's rules and the
  passkey-signer work.
- **Justin Drake** and **Vitalik Buterin**, whose October 2026 posts prompted this.

## First steps

- [x] Register `signandburn.app`.
- [x] Create `jmcpheron/sign-and-burn`, public.
- [x] M0: write the one-time keys in Python and JavaScript, and generate the first vectors.
- [x] Decide the hash and the curve check, before M1 starts.
- [x] M1 and M2 (above).
- [ ] Point `signandburn.app` at GitHub Pages: Pages from `main`, folder `/docs` (it has the
      `CNAME`), the apex `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
      `185.199.111.153` (and `AAAA` `2606:50c0:8000::153` to `2606:50c0:8003::153`), then "Enforce
      HTTPS". `.app` requires HTTPS.
- [ ] Test PRF by hand on the devices at hand (a phone, a laptop, a security key), to know early
      what M3 will find.
- [ ] The first press on Base Sepolia, which also deploys the SeatFactory.
