# 2026-10-10: copy, switch, pick a contact, send a share

## The ask

From using the wallet page on a phone: a copy icon on addresses; a caret to switch between Safes;
the address book as contacts, offered in a menu when sending, with blockies and names; and 25%,
50% and 100% buttons.

## What changed

- **Copy icons** (two sheets) beside the Safe's address in the header, the wallet's, each owner, each
  Safe, the seat and the address book. One press copies the whole address; the icon turns to a check
  for a moment. The icons are SVG elements built in script (no markup strings, nothing inline the CSP
  would refuse).
- **A caret beside the Safe's address** opens a menu of your Safes, each by blockie and name;
  picking one opens it, with "Open another Safe your seat is in…" at the bottom.
- **Contacts.** The address book already took any address; now its names are the contacts. A caret
  beside "To" offers your other Safes, the wallet here, and every named address, by blockie and name
  (never the Safe you send from). Under "To", as you type or pick, the page says whom it is: your name
  for it, or "not in your address book".
- **25%, 50%, Max** under the amount: a share of the Safe's balance of the chosen asset, worked out in
  its smallest units, with nothing rounded. Max is all of it: the Safe pays no gas of its own.
- **The seat's history** said "not sent yet" for an approval another device had sent and that had
  landed. It says "sent from another device" now, on both pages; its badge no longer stretches.

The console and the contracts are unchanged.

## What was checked, and how

- `npm run e2e`: all 145 checks pass. New: the copy icon copies the Safe's address; the caret
  switches to the shared Safe by its name; the To menu lists the other Safe and the contacts, not the
  Safe sent from, and picking one fills To and names it; an unknown address says so; 50% and Max give
  2.5 and 5 of 5 USDC.
- `npm test`, and `npm run build` twice: the same bytes.

## Then, from a phone

The caret's menu hung off the right edge of an iPhone's screen: it opened from the left of a caret
that sat partway along a wrapping row. And the address line under the balance repeated the big
blockie above it. The header now holds the Safe in one rounded box: the blockie, the eyebrow, your
name for the Safe, the start and end of its address with the copy icon, and the caret at the box's
far right; the menu opens from there, leftwards. The separate address line is gone. The e2e opens the
menu at 390 pixels wide and checks it is inside the screen (146 checks pass).

Not checked: on a phone. The menus are `<details>`, so they open by tap; a tap elsewhere closes them.
