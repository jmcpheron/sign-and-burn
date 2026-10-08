// The console fingerprint: one SHA-256 that names the console image, the files console/manifest.json
// lists. The page works it out again in the browser over the files it runs, and a board running the
// same files would have the same one. From PicoQuorum's release fingerprint, unchanged:
//
//   fingerprint = sha256( for each file, sorted by name: name "\0" sha256(bytes) as hex "\n" )
//
//   node tools/fingerprint.mjs            print it
//   node tools/fingerprint.mjs --check    fail unless README.md names it
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** { name on a board: path in this repository } */
export const image = () => JSON.parse(readFileSync(join(ROOT, "console", "manifest.json"), "utf8")).files;

/** read(name) -> bytes for each name. */
export function fingerprint(names, read) {
  const lines = [...new Set(names)].sort().map((n) => {
    const b = read(n);
    if (b == null) throw new Error(`fingerprint: no file ${n}`);
    return `${n}\0${sha256(typeof b === "string" ? Buffer.from(b, "utf8") : b)}\n`;
  });
  return sha256(Buffer.from(lines.join(""), "utf8"));
}

export const consoleFingerprint = (files = image()) => fingerprint(Object.keys(files), (n) => readFileSync(join(ROOT, files[n])));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fp = consoleFingerprint();
  if (process.argv.includes("--check")) {
    const named = readFileSync(join(ROOT, "README.md"), "utf8").includes("`" + fp + "`");
    console.log(`${named ? "ok  " : "FAIL"} README.md ${named ? "names" : "does not name"} the console fingerprint ${fp}`);
    process.exit(named ? 0 : 1);
  }
  console.log(fp);
}
