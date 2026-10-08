// The console on real MicroPython 1.26 (the WebAssembly build the page runs; a Pico 2 W or an ESP32
// runs 1.26 too): the files console/manifest.json lists, by the names a board gives them, then
// checks.py and core_test.py as run.py runs them on CPython. Then main.py, the board's serial loop,
// fed requests on stdin. And the heap the core holds once loaded, which is what has to fit a board.
//   (cd site && npm ci) && node console/test/run-micropython.mjs
import { readFileSync } from "node:fs";
import { loadMicroPython } from "../../site/node_modules/@micropython/micropython-webassembly-pyscript/micropython.mjs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const image = JSON.parse(read("console/manifest.json")).files;
const boot = async (opts = {}) => {
  const mp = await loadMicroPython({ stdout: (l) => console.log(l), ...opts });
  for (const [name, from] of Object.entries(image)) mp.FS.writeFile("/" + name, read(from));
  return mp;
};

// ---- the same checks as on CPython
const mp = await boot();
for (const f of ["checks.py", "core_test.py", "safe_tx.json", "passkey.json"]) mp.FS.writeFile("/" + f, read("console/test/" + f));
// The heap the loaded core holds. The WebAssembly port frees garbage only when no Python is running,
// so each gc.collect() here is a top-level call of its own; a board's collector runs any time.
mp.runPython("import gc\ngc.collect()\nbefore = gc.mem_alloc()");
mp.runPython("import core");
mp.runPython("gc.collect()\nloaded = gc.mem_alloc() - before");
mp.runPython(`
import json, sys
core.LEDGER = "/test-ledger.json"
import checks, core_test
load = lambda n: json.load(open("/" + n))["vectors"]
vs = load("safe_tx.json")
failed = checks.check_safe_tx(vs) + checks.check_decode(vs) + checks.check_passkey(load("passkey.json"))
failed += core_test.run()
print("%s %s: %s" % (sys.implementation.name, ".".join(str(x) for x in sys.implementation.version[:3]),
                     "FAILED: %d" % failed if failed else "all pass"))
print("heap held by the loaded console core: %d KB (MicroPython starts with a 56 KB heap on an ESP32-WROOM-32 and grows it; a Pico 2 W has about 450 KB)" % (loaded // 1024))
`);
let failed = mp.globals.get("failed");

// ---- main.py: the serial loop a board runs at power-up, one request per line on stdin
const lines = ['{"op": "hello"}', '{"op": "review", "chainId": 84532, "safe": "0x' + "44".repeat(20) +
  '", "tx": {"to": "0x' + "a1".repeat(20) + '", "value": "100000000000000", "data": "0x", "operation": 0, "nonce": "0"}}', '{"op": "nope"}'];
const input = [...new TextEncoder().encode(lines.join("\n") + "\n")];
const out = [];
const serial = await boot({ stdin: () => (input.length ? input.shift() : null), stdout: (l) => out.push(l) });
serial.runPython("import main");
const answers = out.map((l) => JSON.parse(l));
const ok = answers.length === 3 && answers[0].ok && answers[0].chains["84532"] === "Base Sepolia" &&
  answers[1].summary === "Send 0.0001 ETH" && answers[2].ok === false;
console.log(`main.py over serial: ${ok ? "3 requests, 3 answers" : "FAIL " + JSON.stringify(out)}`);
if (!ok) failed++;
process.exit(failed ? 1 : 0);
