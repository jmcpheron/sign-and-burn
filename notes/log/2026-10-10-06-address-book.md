# 2026-10-10: an address book

## The ask

With other Safes and seats in play, a way to name them, kept in the browser, with JSON import and
export.

## What changed

- **`site/src/names.mjs`**: your names for addresses, in `sab.names`, and the file that moves them:
  `{"tag": "sign-and-burn/address-book/v1", "chain": 84532, "names": {"0x…": "Phone seat"}}`.
- **Shown wherever an address is**, on both pages: the name beside the address, never instead of it.
  The console never sees names: its words come only from its pinned config, as before.
- **The wallet page**: "Name it" (or "Rename") beside each owner and each Safe, and an Address book
  card to add, rename and remove names, export the file, and import one (a file, or pasted).
- **Import checks every entry**: an address, and a name of 1 to 40 characters with no control
  characters and nothing invisible (zero-width, or the direction overrides that can make text read
  backwards). One bad entry and nothing is imported. Imported names are added, and replace yours for
  the same addresses.

The console and the contracts are unchanged.

## What was checked, and how

- `npm test`: a file reads, with addresses lowercased and names trimmed, and twelve bad files are
  refused, among them a direction override alone, a zero-width space alone, and one bad entry among
  good ones.
- `npm run e2e`: all 129 checks pass. The first browser names the second seat and the shared Safe,
  exports the file (a real download), and the second browser imports it and shows the same names. A
  pasted file with a bad address is refused, and changes nothing.

## Found along the way

- The first test of a "control character" mixed a direction override with a bell character. The
  check refused it for the bell alone: direction overrides passed. Names now refuse them, and the
  zero-width characters, each tested on its own.
