# 2026-10-10: the baseline review's report

## The ask

Record the job, then answer each finding of One Dollar Audit job 987, the baseline review of
`contracts/src` at `f5c1c7d0`.

## Done

- The job was paid from a person's wallet on Base mainnet and filed at 02:24 UTC. The API's
  `description` held only the source link, not the text with the five questions. The report reads
  as if it saw the repository, but not the question about a standing vote in a real threshold.
- The report came back the same day: one high, two low, three informational, and two claims checked
  and ruled out. Each finding was checked against the code and answered in
  [reviews/2026-10-08-baseline.md](../reviews/2026-10-08-baseline.md): two open, four not a bug.

## Found along the way

- `SeatFactory`'s comment says the page ignores seats made with someone else's first key, by
  checking `firstKey`. On a browser with no saved seat it doesn't: it takes the last seat in
  `seatsOf`. The console still won't sign for a seat that isn't the passkey's, so nothing is spent,
  but one junk seat strands a new device. Now in [research.md, question 3](../research.md#3-signer-state).
  The comment was written ahead of the page.

## Not done

- No code changed. The report's Foundry test (a call to an address with no code) was not rerun here,
  and its gas sums for `seatsOf` were not checked.
