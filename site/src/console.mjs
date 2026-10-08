// The console, run here: MicroPython 1.26 for WebAssembly, the files in console/ (the console image,
// the same files a Pico or an ESP32 would run), and core.handle(), one JSON line in, one JSON line
// out. On a board those lines would cross USB serial (console/main.py); here they cross from this
// page into MicroPython, and the page shows them in its serial log.
//
// The core keeps its ledger in a file, ledger.json, as it would in a board's flash. The page keeps
// that file in this browser's localStorage between visits: it writes the file in before each
// request and reads it back after. The ledger is the guardrail's memory (KICKOFF.md): clear this
// site's data and the console forgets which keys have signed.
import { loadMicroPython } from "./vendor/micropython/micropython.mjs";

const LEDGER = "sab.ledger";
const listeners = new Set();
let mp = null;

export const onLine = (f) => listeners.add(f);
const emit = (dir, line) => listeners.forEach((f) => f(dir, line));

/** The seeds are secret: they never reach the log, the screen or the browser's console. */
function redact(line) {
  try {
    const req = JSON.parse(line);
    if (req.seeds) req.seeds = req.seeds.map(() => "(32 bytes from your passkey's PRF: not shown)");
    if (req.seed) req.seed = "(32 bytes from your passkey's PRF: not shown)";
    return JSON.stringify(req);
  } catch {
    return line;
  }
}

async function sha256hex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The console fingerprint, as tools/fingerprint.mjs takes it: sha256 over "name \0 sha256(file) \n",
 * names sorted. The same files on a board would give the same one. */
async function fingerprint(files) {
  let lines = "";
  for (const name of Object.keys(files).sort()) lines += `${name}\0${await sha256hex(files[name])}\n`;
  return sha256hex(new TextEncoder().encode(lines));
}

export const ledgerKept = () => {
  try { localStorage.setItem("sab.test", "1"); localStorage.removeItem("sab.test"); return true; } catch { return false; }
};

/** Load MicroPython and the console image; import core. -> what the console is, for the label. */
export async function boot() {
  const manifest = await (await fetch("console/manifest.json")).json();
  const files = {};
  await Promise.all(Object.keys(manifest.files).map(async (name) => {
    files[name] = new Uint8Array(await (await fetch("console/" + name)).arrayBuffer());
  }));
  mp = await loadMicroPython({ url: "vendor/micropython/micropython.wasm", linebuffer: true,
    stdout: (l) => emit("py", l), stderr: (l) => emit("py", l) });
  for (const [name, bytes] of Object.entries(files)) mp.FS.writeFile("/" + name, bytes);
  // The WebAssembly port frees garbage only between top-level calls, so each collect is its own call.
  mp.runPython("import gc\ngc.collect()\n_base = gc.mem_alloc()");
  mp.runPython("import core");
  mp.runPython("gc.collect()\n_heap = gc.mem_alloc() - _base");
  mp.runPython("import sys\n_v = '.'.join(str(x) for x in sys.implementation.version[:3])");
  const py = Object.entries(files).filter(([n]) => n.endsWith(".py"));
  const hello = ask({ op: "hello" });
  return {
    version: hello.version, chains: hello.chains, fingerprint: await fingerprint(files),
    files: Object.keys(files).length, lines: py.reduce((n, [, b]) => n + (new TextDecoder().decode(b).match(/\n/g) || []).length, 0),
    heap: mp.globals.get("_heap"), micropython: mp.globals.get("_v"),
  };
}

/** One request, one answer. Synchronous: even an approval is a few thousand SHA-256 steps. */
export function ask(req) {
  let kept = null;
  try { kept = localStorage.getItem(LEDGER); } catch {}
  try { mp.FS.unlink("/ledger.json"); } catch {}
  if (kept) mp.FS.writeFile("/ledger.json", kept);
  const line = JSON.stringify(req);
  emit("in", redact(line));
  mp.globals.set("_req", line);
  mp.runPython("_ans = core.handle(_req)");
  const answer = mp.globals.get("_ans");
  mp.runPython("_req = _ans = None\ngc.collect()");
  try { localStorage.setItem(LEDGER, new TextDecoder().decode(mp.FS.readFile("/ledger.json"))); } catch {}
  emit("out", answer);
  return JSON.parse(answer);
}
