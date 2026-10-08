# Testing on Base Sepolia, by hand (M3)

Real passkeys, real wallets, signandburn.app, Base Sepolia. Nothing here can be automated: it needs
your finger on a device. Record each try in the tables below, and anything surprising in a log entry.

The kickoff's bar for M3: **ten presses in a row on two platforms**, and a published table of which
passkeys have PRF.

## Passkeys: which have PRF

| date | device | unlock | browser | where the passkey lives | made | PRF | evidence |
|---|---|---|---|---|---|---|---|
| 2026-10-08 | MacBook | Touch ID | not recorded | not recorded | yes | **yes** | key 0's fingerprint from the console's log is what seat #0 holds on chain |
| | iPhone | Face ID | Safari | iCloud Keychain | | | |
| | Android phone | fingerprint | Chrome | Google Password Manager | | | |
| | Windows laptop | Windows Hello | Edge | Windows | | | |
| | a security key (YubiKey) | PIN | Chrome | the key | | | |
| | the same passkey, synced to a second device | | | | | | same seat, same keys? |

For each: make a passkey, tap for key 0 (the PRF test), and note what the page said. A passkey with no
PRF stops at "This passkey can't make one-time keys". The synced row matters: a passkey synced to
another device must give the same seeds there, or its seat stops working.

## Wallets that paid the gas

| date | wallet | how it sent | build | presses |
|---|---|---|---|---|
| 2026-10-08 | not recorded; a smart account (EIP-7702) | the build as a type-4 transaction, the presses as type-2, each to a delegation manager's `redeemDelegations`, which then called Multicall3 | worked: 2,191,473 gas | 3 of 3: the Safe ran each |
| | MetaMask, a plain account | | | |
| | Rabby with a Trezor | | | |

A smart account sets the gas itself. This one set about 11% over what each press used, and the Safe
ran every transaction. If a wallet's done screen ever says the Safe "couldn't run it yet" while the
Safe holds enough ETH, its gas was short for the Safe transaction: the approval still landed and the
key still burned. Record it here; the fix would be a "Run it now" button that sends the Safe
transaction alone.

## The first shielded Safe

Built 2026-10-08 07:39:56 UTC, block 47,838,454, transaction
`0x2a532629339cdb0e1d860f6c8e5ff0f8f71fa51cd8638fc1d73c0f26823b41c1`. It was the first build on
the chain, so it also deployed the SeatFactory.

| | address | checked |
|---|---|---|
| SeatFactory | `0x0a6514135d34dfd19c3f1a636f3e952caeba3871` | its code is byte for byte this repository's build |
| passkey signer | `0x0bd08bd1fff7963a2fc53db469ec51c61ec8ecda` | Safe's factory names it for the passkey's public key |
| seat #0 | `0xCE5fa5f2f0Ae07123c8C5358e9D424d94B74207e` | holds key 0's fingerprint, `0x28573ad8…db46b0d48`, at key 0 |
| Safe, 1 of 1 | `0xDB6B5258fD85005F7037B67292E43D130C07D60F` | Safe 1.4.1, its one owner the seat, nonce 0 |

## A press: what to check

1. The Safe holds the ETH it will send ("Fund it" sends 0.001), and the wallet has gas.
2. The console's words and hash match what you meant to send.
3. Hold, then one Touch ID. The wallet asks to send one transaction to Multicall3 (`0xcA11…CA11`).
4. After the block, on the page: "Key `n`: signed, sent, burned. The Safe ran it."
5. On chain: the seat's `n` moved up one; the Safe's nonce moved up one; the recipient got the ETH.
   On basescan, the transaction's input holds the one-time signature: 67 values of 32 bytes.

```sh
cast call 0xCE5fa5f2f0Ae07123c8C5358e9D424d94B74207e "n()(uint64)" --rpc-url https://sepolia.base.org
cast call 0xDB6B5258fD85005F7037B67292E43D130C07D60F "nonce()(uint256)" --rpc-url https://sepolia.base.org
```

| date | press | key | Safe ran it | gas used (limit) | wallet | transaction |
|---|---|---|---|---|---|---|
| 2026-10-08 07:47:58 UTC | 1 | 0 | yes | 888,402 (986,282) | smart account | `0x0fa8860e474e478bd5a4c7ebc3849ae6c6eed7b0b45d1dec85fed68391fcf22d` |
| 2026-10-08 07:49:16 UTC | 2 | 1 | yes | 916,782 (1,017,747) | smart account | `0x9fb626b32505eb365db9c797d8d73d966be9bdd0d27652627087f88e3cf010c6` |
| 2026-10-08 07:50:52 UTC | 3 | 2 | yes | 869,611 (965,448) | smart account | `0xdf215b469b38d2d8bcafc4916112515b9801b7e209a87b393c444219fd59cf98` |

870,000 to 920,000 gas a press, all in. The ~660,000 in the contract tests counts the call's execution
only; the rest is the transaction's base cost (21,000), its calldata (about 57,000), and the smart
account's own wrapper. At 0.006 gwei, about 0.0000053 test ETH a press. After the three: the seat at key
3, the Safe's nonce 3, its balance 0.048 ETH.

## After the first press

- [x] **The attack room.** All five attacks against the live seat, by simulation, with approval 2 as
      read from the chain: replay `BadNextKey`; your own next key, another Safe, another transaction
      and a curve signature alone, each `BadOneTimeSignature` (2026-10-08). This found a bug first: the
      page looked for the approval only in a plain Multicall3 call, so with a smart account the attack
      room stayed empty. It now finds the approval wherever the wallet wrapped it.
- [ ] **The danger case**, which needs no chain.
- [ ] **The guardrail, live.** Press, tap, then reject in the wallet. The console should offer only
      "send approval `n` again", with no new tap. Reload: still. Send it: it lands.
- [ ] **A red page.** Pick "Something red: add an owner": the screen goes red and holding waits for
      the box. Reject it.
- [ ] **A second device** with the synced passkey: "I already have one", then a press from there. One
      device at a time (KICKOFF.md, "What's left").
- [ ] **Ten in a row**, on this Mac and one other platform.
