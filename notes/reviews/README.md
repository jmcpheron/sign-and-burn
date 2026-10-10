# Reviews of the contracts

Every change to `contracts/src/` goes through these steps, and each review is kept here.

## The steps

1. **Name the questions it touches.** Say which of the [open questions](../research.md) the change
   is about, and update that file: what changed, and what is still open.
2. **Test it.**
   - `cd contracts && forge build && forge test && FOUNDRY_PROFILE=osaka forge test`
   - `node tools/chain/deployment.mjs --check`
   - `cd site && npm test && npm run build && npm run e2e`
   - A new refusal gets a test in `contracts/test/`, and an attack the page can show gets a place in
     the attack room.
3. **Get an outside review of the exact commit.** Today that is an AI review from One Dollar Audit
   (onedollaraudit.com, $1 in USDC on Base mainnet).
   - Push the commit first, so the review can read it on GitHub.
   - Draft the job's description in a new file here, `YYYY-MM-DD-<scope>.md`:
     - a link to `contracts/src` at the commit;
     - what the contracts do (the line-by-line read in
       [concepts/contracts.md](../concepts/contracts.md) is a good source);
     - the questions to focus on.
     - Keep it under 12,000 characters. It is stored on chain, in public, for good.
   - **A person pays, from their own wallet**, on the site. An AI agent never pays, never holds a key
     for it, and never asks for one.
   - **What the wallet needs.** Real funds on Base mainnet (chain 8453), not Base Sepolia: test ETH
     can't pay. The site takes USDC, ETH or CLAWD, swaps it to CLAWD and burns it. Have about $1 of
     USDC or ETH, plus a little ETH for gas; paying in USDC on chain takes an approval first, so two
     transactions. The price can change: the site shows the total before you sign. A wallet that
     holds only a few dollars is enough, and keeps the rest of your funds out of it. The payment, the
     wallet's address and the description are public on chain.
   - Write the job ID into the review's file as soon as it is known. The job lives on chain, so the
     report can be fetched later from anywhere.
   - Fetch the report from `GET https://onedollaraudit.com/api/jobs/<jobId>` (JSON, no login; it
     only reads). Poll it until `status` is `complete`.
4. **Answer every finding.** In the review's file, one line per finding: **fixed** (with the commit),
   **not a bug** (with the reason), or **open** (and add it to [research.md](../research.md)). A
   fix is a new change, and it goes through these steps again.
5. **Say what it was.** "An AI review, for a dollar": a first pass, not an audit (AGENTS.md, rule 11).
   Nothing in the docs says the contracts are audited or secure because of it.

## A change to the contracts is a new deployment

- The factory is at a CREATE2 address worked out from its bytecode, and that bytecode includes the
  seat's. Any change to `Seat`, `OneTimeKey` or `SeatFactory` therefore moves the factory to a new
  address.
- `contracts/deployment.json` and `console/cfg.py` change with it. `tools/chain/deployment.mjs
  --check` and `site/test.mjs` check that they agree.
- Seats already built stay at the old factory and keep working there.
- A change to what is signed (`c`, `m`, the one-time keys) is a new `/v2` tag and a new vectors
  file, never a change to v1 (AGENTS.md, rule 8).

## Reviews so far

| date | commit | scope | job | status |
|---|---|---|---|---|
| 2026-10-08 | `f5c1c7d0` | `Seat`, `OneTimeKey`, `SeatFactory`, as deployed | [baseline](2026-10-08-baseline.md) | description updated 2026-10-10; waiting for the job ID |
