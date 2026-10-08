# 2026-10-08, about 00:50: the first presses on Base Sepolia

While the notes were being written, the Safe was funded and three presses went through, a minute or
two apart, from the MacBook's Touch ID passkey and the smart-account wallet.

| press | key | time (UTC) | block | gas used | the Safe |
|---|---|---|---|---|---|
| 1 | 0 | 07:47:58 | 47,838,695 | 888,402 | ran it |
| 2 | 1 | 07:49:16 | 47,838,734 | 916,782 | ran it |
| 3 | 2 | 07:50:52 | 47,838,782 | 869,611 | ran it |

Read back from the chain:
- the seat is at key 3; `approvedIn(0)`, `(1)` and `(2)` name those blocks;
- the Safe's nonce is 3, and each transaction logged the Safe's `ExecutionSuccess`;
- the Safe holds 0.048 ETH.

## The smart account and the gas

Each press went as a type-2 transaction to a delegation manager's `redeemDelegations`, with the
page's Multicall3 call inside. The wallet set its own gas limit, about 11% over use, and that was
enough for the Safe transaction every time. The worry from the build (a wallet's own estimate leaving
the Safe transaction short) didn't happen with this wallet.

All in, a press is 870,000 to 920,000 gas: the ~660,000 the contract tests measure is execution only,
and the rest is the transaction's base cost, its calldata and the wallet's wrapper. About 0.0000053
test ETH a press at 0.006 gwei.

## The attack room found a bug in itself

With approvals on chain, the attack room should have offered five attacks. It would have said "Make one
first". The page read the revealed signature from the transaction's input, assuming the input was the
page's own Multicall3 call; this wallet's input is its wrapper around that call. Checked against the
chain: for all three approvals, nothing found.

The fix finds the seat's `approve` call wherever it sits in the input, and takes the one whose next key
and Safe transaction hash are the event's. `site/test.mjs` now checks a plain call and a synthetic
wrapper. Against the live seat, by simulation (nothing sent), with approval 2 as read from the chain:

| attack | the seat said |
|---|---|
| Replay the last approval | `BadNextKey` |
| Name your own next key | `BadOneTimeSignature` |
| Point it at another Safe | `BadOneTimeSignature` |
| Approve another transaction | `BadOneTimeSignature` |
| A curve signature alone | `BadOneTimeSignature` |

## Still to do on the live site

The guardrail by hand (reject in the wallet, then send the same approval again), a red page, a second
device with the synced passkey, and ten in a row on two platforms ([live.md](../testing/live.md)).
