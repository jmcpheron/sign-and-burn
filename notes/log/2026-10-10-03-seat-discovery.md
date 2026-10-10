# 2026-10-10: finding the seat past a stranger's seats

## The ask

Fix what the baseline review's H-1 showed in the page: on a browser with no saved seat, the page took
the last seat in `SeatFactory.seatsOf`, and anyone can add seats to that list for any passkey.

## Done

- The page reads the newest eight seats in `seatsOf` (`n` and the seat number of each), not just the
  last. It takes the newest with `n > 0`. A seat moves past key 0 only with this passkey's signature
  over a message that names the seat's own address, so such a seat is this passkey's.
- A seat with `n = 0` proves nothing on chain. The page no longer takes one on sight; it shows
  "Tap to make key 0". That tap now asks the PRF for two seeds: key 0 of a new seat, as before, and
  key 0 at the seat number of the newest unused seat in the list. If that second first key puts a seat
  at an address in the list, the page takes it, marked as found by another device, so the warning
  about another device's ledger still shows. Otherwise it makes the new seat, as before.
- The console didn't change, so the console fingerprint didn't either. The contracts didn't change.
- Two new e2e checks: a browser whose `sab.home` is gone finds the built, unused seat only through
  the tap; and after a stranger adds two seats for the passkey (seat number 7, made-up first keys), a
  browser with no ledger finds the real seat at key 3, not theirs. Run against the old page, the
  first fails (it took the unused seat on sight) and the e2e stops there, so the second was never
  run against the old page. On the new page both pass.

- `main`'s new wallet page (`site/src/wallet.mjs`) came in with a merge of `main` into this branch,
  and it took the last seat in `seatsOf` too. It now takes the newest of the last eight with
  `n > 0`. It can't tap, so an unused seat is left to the main page. No e2e check covers the wallet
  page's search yet.
- The merge itself didn't rebuild `docs/`, so CI failed on it ("docs/ differs from a rebuild").
  Rebuilt and committed.

## Not done

- A list with more than eight strangers' seats after the real one still hides it, and a long enough
  list makes `seatsOf` too big to read at all. Paging it needs a new factory: research.md, question 3.
- A browser that already saved a stranger's seat as found, under the old page, keeps it. Clearing
  site data for the page fixes it. No such seat is known on Base Sepolia.
- The tap checks only the newest unused seat's number. An unused seat older than that, or hidden by a
  stranger's unused seat with another number, isn't found; the page makes a new seat instead.
