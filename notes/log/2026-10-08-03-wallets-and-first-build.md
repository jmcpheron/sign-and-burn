# 2026-10-08, about 00:30: wallets, and the first build on Base Sepolia

## A Trezor, and WalletConnect

The ask: pay the gas from a Trezor, through WalletConnect or something like it.

What was found:
- Trezor Suite has spoken WalletConnect since August 2025, but only on networks Suite supports. Its own
  issue (#32283, September 2026) lists Base mainnet, and among testnets only Bitcoin Testnet, Solana
  Devnet and Stellar Testnet. Not Base Sepolia.
- WalletConnect would bring a dependency (Reown's provider), its relay hosts and a project ID into the
  page's CSP.
- A Trezor already works through a browser wallet that drives it: Rabby (Trezor has a guide), MetaMask,
  Frame.

So no WalletConnect for now; it is an open decision in KICKOFF.md. The page got a wallet chooser
instead. It lists every EIP-6963 wallet in the browser, remembers the choice by `rdns` (a wallet's
`uuid` changes every visit), and follows account and network changes. The e2e test added two wallets,
an account switch between presses and a reload: 38 checks, all passing. The decision afterwards was to
use another wallet.

## The first real passkey

A MacBook, Touch ID. The page's serial log, the public parts:

```
page → console  {"op":"signer","x":"1123159d…b911f1","y":"99ed53af…814618"}
console → page  {"ok": true, "signer": "0x0bd08bd1fff7963a2fc53db469ec51c61ec8ecda"}
page → console  {"op":"keys","chainId":84532,"curveSigner":"0x0bd0…ecda","seatNumber":0,"n":0}
console → page  {"salts": ["0xeca066c6…8b46e8", "0x1addf66e…e6bc39"], "pubSeed": "0x4d708b7b…ef7da2", "ok": true}
page → console  {"op":"first",…,"seed":"(32 bytes from your passkey's PRF: not shown)"}
console → page  {"firstKey": "0x28573ad8bc01d64226d12d34fa95814aa281e3e7f06dc9ff8f45262db46b0d48", …}
```

- **PRF works** on that passkey: the first real-device result for the M3 table.
- The seed never appears in the log.
- Recomputed outside the browser with the Python reference: `pubSeed` and both salts match exactly.
- Safe's passkey factory on Base Sepolia names the same signer address for that public key.

## The first build

At 07:39:56 UTC, block 47,838,454, transaction
`0x2a532629339cdb0e1d860f6c8e5ff0f8f71fa51cd8638fc1d73c0f26823b41c1`. Status success, 2,191,473 gas,
about 0.000013 test ETH at 0.006 gwei. The first build on the chain, so it also deployed the SeatFactory.

The wallet didn't send it to Multicall3 directly. It was an EIP-7702 transaction (type 4) to a delegation
manager, calling `redeemDelegations`, with the page's Multicall3 call inside. That is how a smart
account sends. It worked; whether such a wallet keeps the page's gas for a press is the thing to watch
next.

Checked on chain:
- **The SeatFactory** at `0x0a6514135d34dfd19c3f1a636f3e952caeba3871`: its code's keccak is
  `0x2b9ced12…bbe177`, the same as this repository's build.
- **The passkey's signer** `0x0bd0…ecda`: deployed.
- **Seat #0** `0xCE5fa5f2f0Ae07123c8C5358e9D424d94B74207e`: at key 0, holding exactly the log's
  `firstKey`.
- **The Safe** `0xDB6B5258fD85005F7037B67292E43D130C07D60F`: Safe 1.4.1, 1 of 1, its one owner the
  seat, nonce 0, balance 0.

Next: fund it, and the first press ([the first presses](2026-10-08-04-first-presses.md)).
