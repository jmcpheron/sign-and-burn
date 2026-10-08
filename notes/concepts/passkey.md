# The passkey: two jobs, one tap

A passkey is a key pair kept by your device or password manager (Touch ID on a Mac, Windows Hello, a
phone, a security key). The private key never leaves it, and it signs only after you unlock it. Sign
and Burn asks it for two things at once.

## Job 1: the curve signature

An ordinary WebAuthn assertion: a P-256 signature over a challenge. The challenge is `c`, which the
console built ([the messages](messages.md)). The seat checks it by asking the passkey's
**SafeWebAuthnSignerProxy**, Safe's audited passkey signer (safe-modules passkey 0.2.1): "is this a
valid signature over `c`?"

The signer's address is fixed by the passkey's public key, the same on every chain. The console works
it out itself (`console/webauthn.py`), and the page checks that Safe's factory on chain names the same
address.

## Job 2: the seeds (the PRF extension)

WebAuthn's **PRF** extension turns a passkey into a sealed secret. Give it a label (a *salt*), and it
answers 32 bytes made from a secret that never leaves the passkey. The same salt always gives the same
answer, on every device the passkey is synced to.

Sign and Burn uses it to make one-time key seeds:

```
salt(n) = sha256("sign-and-burn/prf/v1" ‖ chainId ‖ signer ‖ seatNumber ‖ n)
seed(n) = the passkey's PRF answer for salt(n)
```

A tap can answer two salts. So each press asks for `seed(n)` (to sign with key `n`) and `seed(n+1)`
(to name the next key's fingerprint).

## One tap

```
navigator.credentials.get({
  challenge: c,                            → the curve signature over c
  userVerification: "required",
  extensions: { prf: { eval: { first: salt(n), second: salt(n+1) } } }   → seed(n), seed(n+1)
})
```

The page learns `seed(n+1)` only during the tap, so the curve signature can't include the next key.
That is why there are two messages: the passkey signs `c`, and the one-time key signs `m`, which holds
the next key. So only the one-time signature binds the next key. A way to have the passkey sign it
too, by working the next key out one press early, is [open question 1](../research.md#1-complete-authorization).

## User verification, always

The page always asks with `userVerification: "required"`. Some authenticators give a different PRF
answer with and without it, and the keys would stop matching. Safe's passkey signer requires the
user-verified flag anyway, and the console checks it before it packs anything.

## Where the seeds go

From the passkey to the page, into one request to the console, and nowhere else. They are never
stored, never shown in the serial log, and never logged. The passkey's own secret never leaves the
passkey at all. The seeds do sit in the page's memory for a moment, so a hostile page or extension
would see them ([trust](trust.md), [open question 4](../research.md#4-secret-handling)).

## Which passkeys have PRF

Apple, Google and many security keys have it; others may not. The page says so and stops if a passkey
has none. What has been tried is in [testing/live.md](../testing/live.md). So far: a MacBook with Touch
ID, on 2026-10-08.

## If the passkey is lost

The seat can't approve again. In this demo the Safe is 1 of 1, so it is stuck. In a real multisig the
other owners would replace the seat. A synced passkey (iCloud Keychain, Google Password Manager)
survives a lost device, but whoever takes over that account takes both halves.
