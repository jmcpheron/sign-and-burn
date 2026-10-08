#!/usr/bin/env python3
# The console on CPython: checks.py (the Safe hash, the words, a real passkey's assertion) and
# core_test.py (the whole request protocol). console/test/run-micropython.mjs runs the same on
# MicroPython 1.26. Exit 1 on any failure.
#   python3 console/test/run.py
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
sys.path[:0] = [os.path.join(ROOT, "console"), os.path.join(ROOT, "reference", "python"), HERE]
import checks  # noqa: E402
import core  # noqa: E402
import core_test  # noqa: E402

core.LEDGER = os.path.join(tempfile.mkdtemp(), "ledger.json")    # not the one in the working directory


def load(name):
    with open(os.path.join(HERE, name)) as f:
        return json.load(f)["vectors"]


def main():
    vectors = load("safe_tx.json")
    failed = checks.check_safe_tx(vectors) + checks.check_decode(vectors) + checks.check_passkey(load("passkey.json"))
    failed += core_test.run()
    print("FAILED: %d" % failed if failed else "all pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
