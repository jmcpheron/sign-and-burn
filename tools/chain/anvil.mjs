#!/usr/bin/env node
// The local chain: anvil as chain 31337, with Base Sepolia's contracts (code.json) at Base Sepolia's
// addresses. No fork and no network: the page's e2e test and its dev build run against this.
//   node tools/chain/anvil.mjs [--port 8545]     run it in the foreground
//   import { startChain } from "./anvil.mjs"    -> { url, chainId, child, stop() }
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_FILE, foundryBin, rpc } from "./fetch.mjs";

export const CHAIN_ID = 31337;

export async function startChain({ port = 8545, quiet = true } = {}) {
  const url = `http://127.0.0.1:${port}`;
  let busy = false;
  try { await rpc(url, "eth_chainId"); busy = true; } catch {}
  if (busy) throw new Error(`something already answers on ${url}: stop it (an old anvil?) or pick another port`);
  const child = spawn(foundryBin("anvil"), ["--chain-id", String(CHAIN_ID), "--port", String(port), ...(quiet ? ["--silent"] : [])],
    { stdio: ["ignore", quiet ? "ignore" : "inherit", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  const stop = () => { if (child.exitCode === null) child.kill(); };
  process.on("exit", stop);             // never leave an anvil behind, even when the caller crashes
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error(`anvil exited: ${err.trim().split("\n").pop()}`);
    try { await rpc(url, "eth_chainId"); break; } catch {}
    if (i > 300) { stop(); throw new Error("anvil did not answer in 30 s"); }
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    const { contracts } = JSON.parse(readFileSync(CODE_FILE, "utf8"));
    for (const c of Object.values(contracts)) {
      if ((await rpc(url, "eth_getCode", [c.address, "latest"])) !== c.code) await rpc(url, "anvil_setCode", [c.address, c.code]);
      if ((await rpc(url, "eth_getCode", [c.address, "latest"])) !== c.code) throw new Error(`${c.address}: the code did not take`);
    }
    return { url, chainId: CHAIN_ID, child, stop, contracts };
  } catch (e) {
    stop();
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--port");
  const chain = await startChain({ port: i > 0 ? Number(process.argv[i + 1]) : 8545 });
  for (const [name, c] of Object.entries(chain.contracts)) console.log(`${name.padEnd(29)} ${c.address}`);
  console.log(`chain ${CHAIN_ID} on ${chain.url}, with Base Sepolia's code at its addresses. Ctrl-C stops it.`);
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { chain.stop(); process.exit(0); });
  chain.child.on("exit", (code) => process.exit(code ?? 0));
}
