# The custom contracts, and ideas for more

Sign and Burn writes three contracts of its own, 137 lines in all (`contracts/src/`). Everything else
on chain is someone else's, deployed already, and used as it is. This note goes through the three
line by line, then lists ideas for more contract code: what each would buy, what it would cost, and
which rule in [AGENTS.md](../../AGENTS.md) it touches. None of the ideas is built or tested.

## What is ours, and what isn't

| contract | whose | what it does here |
|---|---|---|
| `OneTimeKey` | **ours** | checks a Winternitz one-time signature (a library, no state) |
| `Seat` | **ours** | one owner of a Safe: checks both signatures, burns the key, votes |
| `SeatFactory` | **ours** | deploys seats at addresses known ahead, and lists a passkey's seats |
| Safe 1.4.1 L2, its proxy factory and fallback handler | Safe | holds the money, counts votes, runs transactions |
| SafeWebAuthnSignerFactory and its proxies (safe-modules passkey 0.2.1) | Safe | checks the passkey's P-256 signature for the seat (`isValidSignature`) |
| the P-256 precompile at `0x100`, or Daimo's p256-verifier | the chain, or Daimo | the curve arithmetic under the passkey signer |
| Multicall3 | mds1 and others | puts `seat.approve` and `safe.execTransaction` in one wallet transaction |
| the CREATE2 deployer `0x4e59…956c` | Arachnid | puts the factory at the same address on every chain |

The real bytecode of each borrowed contract is in `tools/chain/code.json`, fetched from Base Sepolia,
and the integration tests run against it ([testing the contracts](../testing/contracts.md)).

## `OneTimeKey`: the part most worth reading twice

```solidity
function fingerprint(bytes32 pubSeed, uint64 n, bytes32 m, bytes32[67] calldata sig) internal view returns (bytes32)
```

It answers one question: which key's fingerprint does this signature point to? The seat compares the
answer with `current`. The library never sees a secret and never decides anything by itself.

- **The digits.** `m` is 256 bits, read as 64 hex digits from the top: `(m >> (252 - 4*j)) & 15`.
  Digit `d` means the signer revealed position `d` on chain `j`.
- **The walk.** `_advance` hashes from position `d` up to position 15, the top. Each step hashes
  `pubSeed ‖ n ‖ j ‖ s ‖ x`, so a step on one chain, key or seat can't stand in for a step on another
  ([the messages](messages.md)).
- **The checksum.** It adds `15 - d` over the 64 digits (at most 960) and signs it as three more
  digits on chains 64 to 66. Anyone can push a revealed value further up, which raises a message
  digit; that lowers the checksum, and lowering a checksum digit would mean walking a chain down,
  which takes the secret ([one-time keys](one-time-keys.md)).
- **The ends.** The 67 tops, hashed with `pubSeed` and `n`, make the fingerprint `K(n)`.
- **Why `calldata`.** The 2,144-byte signature is read where it arrived, never copied whole.

It is plain Solidity on purpose: easy to hold against `reference/python/sign_and_burn.py`. It does
about 500 SHA-256 calls on average (67 chains, 7.5 steps each), most of a press's gas.
`OneTimeKey.t.sol` checks it against every case in `reference/vectors/v1.json`.

## `Seat`: one owner of a Safe

[The seat](seat.md) says what it holds and what `approve` checks. Here is why each line is where it
is.

```solidity
uint64 k = n; // never a number from the call
```

The key number comes from storage. A caller can't ask the seat to check key 3 when it is at key 5.

```solidity
if (nextKey == bytes32(0) || nextKey == cur) revert BadNextKey();
```

A zero next key would leave a seat no key can match. A next key equal to the current one would let the
same key sign again. Both are refused before any hashing.

```solidity
bytes32 c = sha256(abi.encodePacked("sign-and-burn/approve/v1", block.chainid, address(this), safe, k, safeTxHash));
bytes32 m = sha256(abi.encodePacked("sign-and-burn/one-time/v1", c, nextKey));
```

The seat builds both messages itself. Every argument of `approve` that matters is inside them:
`safe` and `safeTxHash` in `c`, `nextKey` in `m`. The chain and the seat come from the EVM, not the
call. So anyone may send the call: a copy can only do what was signed.

```solidity
if (OneTimeKey.fingerprint(pubSeed, k, m, oneTime) != cur) revert BadOneTimeSignature();
if (IERC1271(curveSigner).isValidSignature(c, curveSig) != ERC1271_MAGIC) revert BadCurveSignature();
```

The one-time check comes first. It is the one that still holds if curves are broken, and it needs no
call to another contract. The curve check goes to the passkey's signer, which is Safe's code, not
ours.

```solidity
current = nextKey;
n = k + 1;
approvedIn[k] = block.number;
emit Approved(safe, safeTxHash, k, nextKey);
ISafeApprove(safe).approveHash(safeTxHash);
```

State changes before the outside call. If `safe` calls back into the seat, the seat is already at key
`k + 1`, and the old signatures are worth nothing. If `approveHash` reverts (the seat isn't an owner),
the whole call reverts and the key is not spent. `n = k + 1` reverts at the last `uint64`: there is no
key after it.

The seat doesn't know whether `safe` is a real Safe. A contract whose `approveHash` does nothing would
take the vote and the key would burn. That is only possible if the passkey signed a `c` naming that
contract: the console decides what it signs, not the seat.

The immutables (`curveSigner`, `seatNumber`, `pubSeed`) are set once. `pubSeed` mixes in
`block.chainid`, so the same seat number on another chain has unrelated keys. There is nothing else:
no owner, no upgrade, no pause, no way to change `current` but `approve`.

## `SeatFactory`: addresses known ahead

```solidity
bytes32 salt = keccak256(abi.encode(curveSigner, seatNumber, firstKey));
seat = address(new Seat{salt: salt}(curveSigner, seatNumber, firstKey));
```

The salt is every constructor argument, so the address names the seat's whole starting state. The page
can work it out (`seatAddress`) before the seat exists, and the Safe can be made with it as an owner in
the same transaction. The same arguments twice give the same address, and the second CREATE2 fails.

`seatsOf(curveSigner)` is a list anyone can append to: anyone may make a seat for any passkey, with any
first key. A seat whose first key isn't the passkey's own can't be signed for, and the console checks
the key before signing, so a stranger's seat is noise, not a danger. It could make the list long.
The page reads it in one call; see "A paged `seatsOf`" below.

The factory itself has no state but that list and no owner. With salt 0 through the CREATE2 deployer,
it lands at `0x0a6514135d34dfd19c3f1a636f3e952caeba3871` on every chain.

## Ideas for more contract code

Each is an idea, not a plan. A change to the one-time key format is a new tag and a new vectors file
(rule 8), and anything here would need the same tests the current contracts have.

### A cheaper `OneTimeKey`

Already an open decision in [KICKOFF.md](../../KICKOFF.md): assembly with one reused buffer, calling
`0x02` directly instead of `abi.encodePacked` and `sha256` per step. The format doesn't change, so
`v1.json` checks it as it is. It would save gas, by an amount not measured. It would cost
readability, in the part most worth reading. Leaning: plain until someone needs the gas.

### Another Winternitz width

`w = 16` is frozen in v1. By arithmetic, for a 256-bit message (not measured):

| `w` | chains | signature | hashes to check, on average | calldata at 16 gas a byte |
|---|---|---|---|---|
| 4 | 133 | 4,256 bytes | about 200 | about 68,000 |
| **16** (v1) | **67** | **2,144 bytes** | **about 500** | **about 34,000** |
| 256 | 34 | 1,088 bytes | about 4,300 | about 17,000 |

On Base, calldata is also posted to L1 and paid for there, so `w = 4` would cost more than it looks
here, and `w = 256` less. Worth measuring before choosing. It would be a v2: new tags, new vectors, a new seat.

### A Safe guard instead of a seat

Safe 1.4.1 calls a guard's `checkTransaction` before every transaction, and it may write state. A
guard could demand a one-time approval for each Safe transaction hash and burn the key there. An
existing Safe with ordinary owners would then need a hash-based co-signature for everything,
`setGuard` included, without changing its owners.

The cost: a guard that refuses locks the Safe. A lost passkey would mean a Safe nobody can move,
since removing the guard is a transaction the guard must allow. The seat avoids this: it is one owner,
and the other owners can replace it. A guard would need its own way out, and every way out is a
recovery path (rule 5 rules it out for the seat; a guard would need the same care).

### A Safe module instead of a seat

A module could check the signatures and call `execTransactionFromModule` in one call: no Multicall3,
no `approveHash` vote. But a module bypasses the Safe's owners and threshold. A 2-of-2 Safe with one
seat module would be a 1-of-1 for whoever has the passkey. The seat keeps the Safe the multisig, and
this would give that up.

### The seat pays its own gas

Today the wallet pays gas and approves nothing. With account abstraction (ERC-4337, or frame
transactions, EIP-8141, a "later" in the kickoff), the seat, or a Safe it owns, could pay for itself
and drop the wallet. The open questions: whether bundlers take a 2 KB signature and about 600,000 gas
of checking, and the storage rules on what validation may read. Not looked into beyond that.

### A stateless signature: SLH-DSA

A `Seat` that checks SLH-DSA (SPHINCS+) instead of Winternitz would need no guardrail: one key signs
many times. The cost is size and gas: signatures of several kilobytes (about 7.8 KB at the smallest
standard size) and many more hashes to check. Also a "later" in the kickoff, as a comparison.

### A tree of one-time keys

The seat could commit to many keys at once (a Merkle root, as in XMSS) instead of naming one next key
per approval. Each approval would then carry a path up the tree, more calldata. Here it buys little:
each approval already names its next key, and the passkey's PRF makes any key on demand. Listed so
it isn't rediscovered.

### Two seats, one Safe

The kickoff's v2: a 2-of-2 Safe owned by two seats, two passkeys. No new contract: one Multicall3 call
with two `approve`s and then `execTransaction`. Gas would roughly double the seat's part.

### A paged `seatsOf`

`seatsOf(signer, start, count)` beside the current one, so a list padded by strangers can still be
read in pieces. Small and additive, but it changes the factory's bytecode, so the factory's address
changes too, and the page and `deployment.json` with it. Only worth it if someone pads a list.

### Invariant tests

Not contract code, but the first "next" in [testing the contracts](../testing/contracts.md): a random
sequence of calls can never move `n` without a valid pair of signatures.

## Ideas this project rules out

| idea | why not |
|---|---|
| a recovery key, an admin, an upgrade, a pause on the seat | rule 5: the seat has no admin. The Safe replaces a lost seat |
| a seat that also accepts a software key | rule 3: the passkey is the only key |
| a seat for another chain | rule 4: Base Sepolia only, in the page. The contracts would deploy anywhere; the page refuses |
| changing what `v1` means | rule 8: a new format is a new tag |
| an ECDSA-only fallback | it would be the key bunker mode guards against |

## What was checked for this note

The three contracts were read against `contracts/README.md`, [the seat](seat.md) and the kickoff. The
`w` table is arithmetic, not a measurement. The guard, module, account-abstraction and SLH-DSA notes
come from what those interfaces are documented to do; none was tried here.
