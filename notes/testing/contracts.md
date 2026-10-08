# Testing the contracts

```sh
cd contracts
forge build && forge test                # Foundry 1.8.3, no libraries
FOUNDRY_PROFILE=osaka forge test         # the same, on Osaka's EVM: the P-256 precompile at 0x100
node ../tools/chain/deployment.mjs --check
```

## The suites

| suite | tests | against |
|---|---|---|
| `OneTimeKey.t.sol` | 2 | `reference/vectors/v1.json`, and a fuzzed message change |
| `Seat.t.sol` | 14 | a mock Safe and a mock signer: every refusal in the attack table |
| `Integration.t.sol` | 6 | Base Sepolia's real bytecode, put at its own addresses with `vm.etch` |

### The attack table, with mocks

Replay an approval; reuse a spent key for a new transaction; swap in your own next key; point it at
another Safe; replay on another chain; a curve signature alone; a one-time signature alone; a Safe that
doesn't know the seat (the key is not spent); a zero or repeated next key; the last key; the factory's
address, list and refusal to make the same seat twice; anyone may send.

### The real stack

The real bytecode (`tools/chain/code.json`, fetched from Base Sepolia): Safe 1.4.1 L2, its proxy
factory and fallback handler, MultiSendCallOnly, Multicall3, Safe's passkey signer factory and
singleton, Daimo's P-256 verifier, and the CREATE2 deployer.

A real P-256 key (`vm.signP256`) signs WebAuthn assertions shaped as a browser's. The tests deploy the
SeatFactory through the CREATE2 deployer at the address `deployment.json` names, make the passkey's
signer, a seat and a 1-of-1 Safe, and press twice, each press one Multicall3 call. They show a curve
signature over another approval, or without user verification, refused; and an approval that lands
even when the Safe transaction can't run, with the vote kept for later.

## Gas, as measured

| | gas |
|---|---|
| `seat.approve`, mocks | 571,998 |
| one press, real stack, Daimo's verifier | 991,512, then 987,277 |
| one press, real stack, the P-256 precompile | 659,793, then 655,638 |
| the first build on Base Sepolia (factory, signer, seat, Safe), real chain | 2,191,473 |

Base Sepolia has the precompile, so the third row is the one that applies there.

## Findings along the way

- Multicall3 hides the seat's own error behind "Multicall3: call failed". The page's attack room asks
  the seat directly.
- A test bug, not a contract bug: in Solidity, `bytes32[67] memory bad = sig;` makes `bad` point at
  the same memory as `sig`, so changing `bad` changed `sig` too. The vector test now copies it.

## What isn't tested

- An audit, or a review by anyone outside the project.
- Invariant tests (a random sequence of calls can never move `n` without a valid signature).
- Other Safe versions, modules and guards.

## Next

- [ ] Invariant tests with Foundry's invariant runner.
- [ ] A cheaper `OneTimeKey`, if anyone needs the gas, checked against the same vectors.
