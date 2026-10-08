#!/usr/bin/env node
// The page, built into one folder that holds everything it runs: docs/, which GitHub Pages serves at
// signandburn.app. It loads nothing from anywhere else, and its Content-Security-Policy lets it reach
// only this folder and the RPC endpoint in console/cfg.py. Commit what it writes; CI rebuilds it and
// fails on any difference.
//   index.html, style.css, favicon.svg   the page (no inline script or style: the CSP refuses them)
//   app.js                 src/*.mjs and viem, bundled by esbuild, not minified, so it can be read
//   console/               the console image, exactly the files console/manifest.json lists, by the
//                          names a board gives them. They hash to the console fingerprint.
//   vendor/micropython/    MicroPython 1.26 for WebAssembly, from npm, pinned by its hash
//   CNAME                  signandburn.app, for GitHub Pages, which reads it and doesn't serve it
//   SHA256SUMS, BUILD.json every served file's SHA-256, for sha256sum -c against the live site
//
//   node build.mjs           docs/, Base Sepolia only
//   node build.mjs --dev     site/dev/, with the local Anvil chain (tools/chain/anvil.mjs, port 8545)
//                            in place of Base Sepolia, in cfg.py and the CSP. Never published: docs/
//                            is checked for it.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { consoleFingerprint, fingerprint, image } from "../tools/fingerprint.mjs";

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SITE, "..");
const DEV = process.argv.includes("--dev");
const OUT = DEV ? join(SITE, "dev") : join(ROOT, "docs");
const DOMAIN = "signandburn.app";
const MP = join(SITE, "node_modules", "@micropython", "micropython-webassembly-pyscript");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

rmSync(OUT, { recursive: true, force: true });
const put = (rel, data) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };
const copy = (from, rel) => put(rel, readFileSync(from));

// ----------------------------------------------------------------------------- the console image
const files = image();
const bytes = Object.fromEntries(Object.entries(files).map(([name, from]) => [name, readFileSync(join(ROOT, from))]));
const cfgSrc = bytes["cfg.py"].toString("utf8");
const at = cfgSrc.indexOf("{", cfgSrc.indexOf("CFG ="));
const cfg = JSON.parse(cfgSrc.slice(at));
if (JSON.stringify(Object.keys(cfg.chains)) !== '["84532"]') throw new Error("console/cfg.py must name Base Sepolia (84532) and nothing else");
if (DEV) {
  // The local chain, in place of Base Sepolia: Base Sepolia's contracts at the same addresses.
  cfg.chains = { 31337: { name: "Local Anvil (development build)", rpc: "http://127.0.0.1:8545", explorer: "" } };
  cfg.sameAs = { 31337: "84532" };
  bytes["cfg.py"] = Buffer.from(cfgSrc.slice(0, at).replace("# The console's pinned config:", "# DEVELOPMENT BUILD: the local Anvil chain only. Never published.\n# The console's pinned config:") +
    JSON.stringify(cfg, null, 4) + "\n");
}
for (const [name, b] of Object.entries(bytes)) put(`console/${name}`, b);
const fp = DEV ? fingerprint(Object.keys(bytes), (n) => bytes[n]) : consoleFingerprint(files);
put("console/manifest.json", JSON.stringify({
  about: "The console image: the files a Pico or an ESP32 would run, by their names there, with their SHA-256. The page fetches exactly these and runs them in MicroPython. Their fingerprint (tools/fingerprint.mjs) is the console fingerprint the page and the README show.",
  fingerprint: fp, files: Object.fromEntries(Object.keys(bytes).sort().map((n) => [n, sha256(bytes[n])])),
}, null, 2) + "\n");

// ----------------------------------------------------------------------------- the page's code
const js = await build({
  entryPoints: [join(SITE, "src", "main.mjs")], bundle: true, format: "esm", target: "es2022", platform: "browser",
  external: ["./vendor/*"], write: false, minify: false, legalComments: "eof", charset: "utf8", logLevel: "warning",
});
put("app.js", js.outputFiles[0].contents);
for (const f of ["micropython.mjs", "micropython.wasm"]) copy(join(MP, f), `vendor/micropython/${f}`);
const mpVersion = JSON.parse(readFileSync(join(MP, "package.json"), "utf8")).version;
put("vendor/micropython/LICENSE.txt", `MicroPython ${mpVersion}, WebAssembly build (@micropython/micropython-webassembly-pyscript).\nMIT License, Copyright (c) 2013-2025 Damien P. George and others. https://github.com/micropython/micropython\n`);
for (const f of ["style.css", "favicon.svg"]) copy(join(SITE, f), f);
copy(join(ROOT, "LICENSE"), "LICENSE");
if (!DEV) put("CNAME", DOMAIN + "\n");

// ----------------------------------------------------------------------------- the policy
const hosts = [...new Set(Object.values(cfg.chains).map((c) => new URL(c.rpc).origin))].sort();
if (!DEV && hosts.some((h) => !h.startsWith("https://"))) throw new Error(`a published RPC must be https: ${hosts}`);
const policy = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",         // MicroPython's WebAssembly; no inline script at all
  "style-src 'self'",
  "img-src 'self' data:",                         // blockies, drawn as data: SVG
  `connect-src 'self' ${hosts.join(" ")}`,        // this folder (the console's files) and the RPC
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
let html = readFileSync(join(SITE, "index.html"), "utf8");
if (/<script(?![^>]*\bsrc=)/.test(html) || /\sstyle=/.test(html) || /<style/.test(html)) throw new Error("index.html: no inline scripts or styles (the CSP refuses them)");
html = html.replace('<meta charset="utf-8">\n', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${policy}">\n`);
if (DEV) html = html.replace("Base Sepolia · test network only", "Development build · local Anvil chain");
put("index.html", html);

// ----------------------------------------------------------------------------- checks, and the seal
const walk = (d, all = []) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); statSync(p).isDirectory() ? walk(p, all) : all.push(p); } return all; };
const rel = (p) => relative(OUT, p).split("\\").join("/");
if (!DEV) {
  const local = walk(OUT).filter((p) => /127\.0\.0\.1|localhost:8545|"31337"/.test(readFileSync(p, "latin1")));
  if (local.length) throw new Error(`the published build names the local chain: ${local.map(rel).join(", ")}`);
}
// Pages runs the site through Jekyll: it rewrites a file that opens with YAML front matter and drops
// any whose name starts with "_" or "."
const jekyll = walk(OUT).filter((p) => readFileSync(p).subarray(0, 4).toString() === "---\n" || /(^|\/)[_.]/.test(rel(p)));
if (jekyll.length) throw new Error(`Jekyll on Pages would rewrite or drop: ${jekyll.map(rel).join(", ")}`);
// CNAME is GitHub's setting, not the page: Pages reads it for the domain and doesn't serve it, so the
// lists a visitor checks the live site against leave it out.
const served = () => walk(OUT).filter((p) => rel(p) !== "CNAME");
put("SHA256SUMS", served().map((p) => `${sha256(readFileSync(p))}  ${rel(p)}\n`).join(""));
const all = served();
put("BUILD.json", JSON.stringify({
  note: "SHA-256 of every file site/build.mjs wrote. Rebuild from the same commit (cd site && npm ci && npm run build) and compare. SHA256SUMS lists the same files for sha256sum -c.",
  console: fp, files: Object.fromEntries(all.map((p) => [rel(p), sha256(readFileSync(p))])),
}, null, 2) + "\n");
const kb = Math.round(all.reduce((n, p) => n + statSync(p).size, 0) / 1024);
console.log(`${relative(ROOT, OUT)}/: ${all.length + 1} files, ${kb} KB, console ${fp.slice(0, 4)}·${fp.slice(4, 8)}${DEV ? " (development build: local Anvil)" : ""}`);
