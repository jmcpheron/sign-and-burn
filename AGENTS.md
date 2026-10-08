# Instructions for AI coding agents

Sign and Burn is a Safe owner that signs each approval with a one-time key, then burns it. A
passkey plays the key; a console, written in MicroPython, works out what is signed. The README says
how the pieces fit and [KICKOFF.md](KICKOFF.md) says why; read them, and the README of the part you
are changing, before you change it.

Do what was asked and no more. Keep changes small and plain, like the code around them. Don't add a
dependency, a network call or a new way to sign without asking first.

## Never weaken these

1. **One signature per one-time key, ever.**
   - The console signs with key `n` only in `core.sign` (`console/core.py`), and records the approval
     in its ledger before the answer leaves.
   - While an approval for key `n` waits, it signs nothing else with key `n`: it hands back that same
     approval to send again (`core.begin`, "resend").
   - `console/test/core_test.py` and `site/e2e.mjs` (a wallet that says no, then a reload) check this.
2. **The console signs only what it built.**
   - It works out the Safe transaction hash, `c` and `m` itself, from the fields on the screen and the
     seat's own `n`. It never takes a hash from the page, a wallet, a link or the chain.
   - It checks that the passkey signed exactly `c`, with user verification (`console/webauthn.py`).
   - It refuses what it can't explain (decode.py: unknown calls, unpinned delegatecalls). Red pages
     stay red. The button is held, not clicked, and Reject stays one easy press.
3. **The passkey is the only key.** No software keys, no stored seeds. The seeds pass through the
   page and the console for one request and are never logged or shown: the serial log redacts them.
4. **Base Sepolia only.**
   - `console/cfg.py` names chain 84532 and nothing else. A development build (`npm run dev`) puts
     the local Anvil chain in its place; `site/build.mjs` refuses to publish one.
5. **The seat has no admin.** No owner, no upgrade, no pause, no recovery key.
6. **The page is one folder that holds everything it runs** (`docs/`, built from `site/` and
   `console/` by `site/build.mjs`).
   - It loads nothing from anywhere else. Its Content-Security-Policy allows the folder and the RPC
     in `cfg.py`, nothing else. No inline scripts or styles.
   - Its `console/` is exactly the console image (`console/manifest.json`), so it hashes to the
     console fingerprint the README names.
   - It refuses to run inside another page.
   - Untrusted text (anything from the chain, a wallet or a link) is drawn with `textContent`.
   - viem's client keeps `ccipRead: false` (`site/src/chain.mjs`).
7. **`docs/` holds built files: never edit them by hand.** `cd site && npm ci && npm run build`
   writes it. Commit what it writes; CI rebuilds it and fails on any difference.
8. **Formats are versioned by tag, never changed in place.** `sign-and-burn/<purpose>/v1` and
   `reference/vectors/v1.json` mean what they mean now. A change is a new tag and a new file.
9. **No secrets in the repository**, nor in tests, logs, screenshots or pull requests. Use Anvil's
   test accounts, Chromium's virtual authenticator, and disposable testnet wallets: never a real key,
   seed phrase or API key.
10. **The supply chain stays pinned.**
    - `site/` pins exact versions, and its lockfile pins every package by hash. Install with
      `npm ci`, never `npm install`. Its `.npmrc` turns install scripts off.
    - Foundry is 1.8.3; the contracts have no libraries. GitHub Actions are pinned by commit, and each
      job gets the least permissions it needs.
11. **No claims of safety.** The docs say what was checked and how, and what wasn't.

## Changing the contracts

Follow [notes/reviews/README.md](notes/reviews/README.md):
- Name the [open questions](notes/research.md) the change touches, and update that file.
- Run the tests below.
- Get an outside review of the exact commit, and answer every finding in a file under
  `notes/reviews/`.
- A person pays for a review, from their own wallet. An agent never pays, never holds a key for it,
  and never asks for one. Write the review's job ID into its file as soon as it is known.
- Any change to the contracts moves the factory to a new address. A change to what is signed means
  new tags.

## Before you push

Run what CI runs for the parts you changed (`.github/workflows/ci.yml`):

```sh
python3 reference/python/test_vectors.py && node reference/js/test-vectors.mjs   # the one-time keys
(cd site && npm ci)
python3 console/test/run.py && node console/test/run-micropython.mjs            # the console
node tools/fingerprint.mjs --check                                              # the README names it
(cd contracts && forge build && forge test && FOUNDRY_PROFILE=osaka forge test)
node tools/chain/deployment.mjs --check                                         # the factory's address
(cd site && npm test && npm run build && npm run e2e)                           # the page, in Chromium
```

The e2e needs anvil (Foundry 1.8.3) and Chromium: `SAB_CHROMIUM=/path/to/chrome` if playwright-core
has none of its own. After the build, `git status`: `docs/` changes only if you changed what it is
built from. A change to `console/` changes the console fingerprint: update the README's table.

Say exactly what ran, what didn't, and what you assumed. Don't call a change secure or audited.

## Writing

`notes/` holds the explainers (`concepts/`), the test plans (`testing/`) and a dated log (`log/`).
Keep them true when you change what they describe. A test done by hand goes in `testing/live.md`'s
tables; anything found along the way goes in a new log entry, mistakes included.

The docs use short sentences and plain words, and say what was checked and how. Match them, and keep
comments as dense as the code around them.
