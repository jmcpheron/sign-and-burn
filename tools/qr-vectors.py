#!/usr/bin/env python3
# The QR test vectors (site/qr-vectors.json), made by an independent encoder: python-qrcode 8.2.
# site/test.mjs checks src/qr.mjs against them, module for module. Run by hand, never by CI, in a
# throwaway virtual environment, so the page and CI take on no new dependency. Each case fixes the mask:
# encoders score the eight masks a little differently, and any of them is a valid code.
#   python3 -m venv /tmp/qrenv && /tmp/qrenv/bin/pip install qrcode==8.2
#   /tmp/qrenv/bin/python tools/qr-vectors.py > site/qr-vectors.json
import hashlib
import json

import qrcode
from qrcode.util import MODE_8BIT_BYTE, MODE_ALPHA_NUM, QRData

LEVELS = {"L": qrcode.constants.ERROR_CORRECT_L, "M": qrcode.constants.ERROR_CORRECT_M,
          "Q": qrcode.constants.ERROR_CORRECT_Q, "H": qrcode.constants.ERROR_CORRECT_H}
MODES = {"byte": MODE_8BIT_BYTE, "alnum": MODE_ALPHA_NUM}
ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:"   # base43: the alphanumeric set without space and %

PROPOSAL = ("https://signandburn.app/wallet.html#propose=sign-and-burn%2Fproposal%2Fv1&chain=84532"
            "&safe=0x1ef7ef00000000000000000000000000004bc6d82&to=0xce5fa50000000000000000000000000000074207e"
            "&value=0&data=0x0d582f13000000000000000000000000ce5fa50000000000000000000000000000074207e"
            "0000000000000000000000000000000000000000000000000000000000000001&op=0&nonce=1")
LONG = "".join(ALNUM[(i * 7 + i // 43) % 43] for i in range(3660))   # as long as a compact approval

CASES = [
    ([("byte", "https://signandburn.app/")], "L", list(range(8))),
    ([("alnum", "HELLO WORLD")], "M", [2]),
    ([("byte", "0xb73851aF45A5C21822b9FDA338763DBC7348b6b")], "Q", [5]),
    ([("byte", "Sign and Burn: one-time keys")], "H", [7]),
    ([("byte", PROPOSAL)], "L", [0, 4]),
    ([("byte", "https://signandburn.app/#aq="), ("alnum", LONG[:900])], "L", [1]),
    ([("byte", "https://signandburn.app/#aq="), ("alnum", LONG)], "L", [3, 6]),
]

out = []
for segs, ecl, masks in CASES:
    for mask in masks:
        qr = qrcode.QRCode(version=None, error_correction=LEVELS[ecl], border=0, mask_pattern=mask)
        for mode, text in segs:
            qr.add_data(QRData(text.encode(), mode=MODES[mode], check_data=False))
        qr.make(fit=True)
        rows = ["".join("1" if c else "0" for c in row) for row in qr.get_matrix()]
        case = {"segments": [{"mode": m, "text": t} for m, t in segs], "ecl": ecl, "mask": mask, "version": qr.version,
                "size": len(rows), "sha256": hashlib.sha256("\n".join(rows).encode()).hexdigest()}
        if len(rows) <= 33:
            case["rows"] = rows
        out.append(case)
print(json.dumps({"about": "QR codes made by python-qrcode 8.2 (tools/qr-vectors.py), each with its mask fixed. "
                  "sha256 is over the rows as 0/1 text, joined by newlines, with no quiet zone.", "cases": out}, indent=1))
