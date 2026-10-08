# contracts

Three small contracts, in Foundry. The design is in [KICKOFF.md](../KICKOFF.md) ("The contracts").

| | |
|---|---|
| `src/OneTimeKey.sol` | A library: steps a one-time signature to the tops of its 67 chains and hashes the ends. The signature is good for key `n` exactly when that gives `K(n)`. The part most worth reading twice. |
| `src/Seat.sol` | One owner of a Safe. `approve` checks a one-time signature and the passkey's curve signature, records the next key, and calls the Safe's `approveHash`. No admin, no upgrade, no recovery key. `approvedIn(n)` is the block each approval landed in. |
| `src/SeatFactory.sol` | Deploys seats with CREATE2, so a seat's address is known before it exists. `seatsOf(curveSigner)` lists a passkey's seats. |

Base Sepolia's public RPC searches logs only 500 blocks at a time, so the page reads `seatsOf` and
`approvedIn` instead of scanning events.

## Tests

```sh
cd contracts
forge test                         # Foundry 1.8.3 (foundryup -i v1.8.3); no libraries
FOUNDRY_PROFILE=osaka forge test   # the same, on Osaka's EVM: the P-256 precompile at 0x100
```

| suite | what it checks |
|---|---|
| `OneTimeKey.t.sol` | the Solidity against every case in `reference/vectors/v1.json`, and a fuzzed message change |
| `Seat.t.sol` | each refusal in the attack table, with mock Safe and mock signer: replay, a spent key, a swapped next key, another Safe, another chain, either signature alone, a Safe that doesn't know the seat (the key is not spent), the last key, the factory's address and list |
| `Integration.t.sol` | the seat with the real contracts: Safe 1.4.1 L2, its proxy factory and fallback handler, Multicall3, and Safe's passkey signer (safe-modules passkey 0.2.1) with Daimo's verifier |

`Integration.t.sol` puts each real contract at its Base Sepolia address with `vm.etch`, from
`tools/chain/code.json` (runtime code fetched from Base Sepolia; `node tools/chain/fetch.mjs --check`
compares it with the chain). A real P-256 key signs WebAuthn assertions shaped as a browser's
(`origin` `https://signandburn.app`, flags UP and UV). The tests:
- deploy the factory through the CREATE2 deployer, at the address `deployment.json` names;
- make the passkey's signer, a seat and a 1-of-1 Safe owned by the seat;
- press twice, each press one Multicall3 call: `seat.approve`, then `safe.execTransaction` with the
  seat's approved hash as its signature;
- show a curve signature over another approval, or without the UV flag, refused;
- show the approval lands even when the Safe transaction can't run yet (`allowFailure`). The key is
  burned, the Safe's nonce stays, and the vote stays for anyone to run it later.

## Gas

Measured in the tests: execution gas of the call, without the transaction's 21,000 or its calldata.

| | gas |
|---|---|
| `seat.approve`, mock signer and mock Safe | 571,998 |
| one press, real stack, Daimo's verifier (`evm_version` cancun) | 991,512, then 987,277 |
| one press, real stack, the P-256 precompile (Osaka) | 659,793, then 655,638 |

Base Sepolia has the precompile at `0x100` (checked with `cast call`: a valid signature returns 1, a
changed one nothing), and so does anvil 1.8.3. So the precompile row is the one that applies there.
A press's calldata is 3,556 bytes, mostly the 2,144-byte one-time signature: about 57,000 gas more
at 16 per nonzero byte, by arithmetic, not measured on chain. About 500 SHA-256 calls for the
one-time check are most of what's left. That's more than the kickoff's guess of 200–350k.
`OneTimeKey` is plain Solidity on purpose; assembly could make it cheaper.

## Deployment

`deployment.json` is the `SeatFactory` as the CREATE2 deployer (`0x4e59b44847b379578588920ca78fbf26c0b4956c`)
puts it with salt 0: **`0x0a6514135d34dfd19c3f1a636f3e952caeba3871`** on every chain. Anyone can
deploy it. The page does, through the visitor's wallet, when there is no code there yet. It also
holds the ABIs the page calls.

```sh
forge build && node ../tools/chain/deployment.mjs --check   # the build gives exactly deployment.json
```

`bytecode_hash = "none"` and the pinned solc make the build the same bytes every time: a clean
rebuild gave the same file, and the Osaka profile builds the same factory too.

## What was not checked

- Nothing is deployed on Base Sepolia yet. The factory address is computed, and `cast` agrees.
- No audit. The tests are the authors' own, written from the same spec as the reference.
- The integration test's passkey is a key in the test that writes a browser's format. The page's
  end-to-end test (`site/e2e.mjs`) sends Chromium's virtual authenticator's assertions through the
  seat on a local chain with this same bytecode. A real device's waits for M3.
- The Safe's other paths (modules, guards, other versions) are not exercised.
