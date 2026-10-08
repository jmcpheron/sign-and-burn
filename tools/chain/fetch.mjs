#!/usr/bin/env node
// The contracts Sign and Burn relies on, as Base Sepolia runs them: Safe 1.4.1, Multicall3, Safe's
// passkey signer (safe-modules passkey 0.2.1) and its P-256 verifier, and the CREATE2 deployer.
// code.json keeps each one's runtime code, so the local chain (anvil.mjs) and the Foundry tests
// (contracts/test/Integration.t.sol, vm.etch) run the real bytecode at the real addresses, offline.
//   node tools/chain/fetch.mjs           fetch them again and rewrite code.json
//   node tools/chain/fetch.mjs --check   compare each live code hash with code.json; exit 1 on a difference
// Hashes come from `cast keccak` (Foundry).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
export const CODE_FILE = fileURLToPath(new URL("code.json", import.meta.url));
const CHAIN_ID = 84532;

export const CONTRACTS = {
  SafeL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",                   // Safe 1.4.1 L2 singleton
  SafeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",         // 1.4.1
  CompatibilityFallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99", // 1.4.1
  MultiSendCallOnly: "0x9641d764fc13c8b624c04430c7356c1c7c8102e2",        // 1.4.1
  Multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  SafeWebAuthnSignerFactory: "0x1d31F259eE307358a26dFb23EB365939E8641195",  // passkey 0.2.1
  SafeWebAuthnSignerSingleton: "0x4E27b51350e6c2083EE19011120F50DAfEc5CA50",
  DaimoP256Verifier: "0xc2b78104907F722DABAc4C69f826a522B2754De4",          // Daimo's, the signer's fallback
  Create2Deployer: "0x4e59b44847b379578588920ca78fbf26c0b4956c",          // Arachnid's deterministic deployer
};

export function foundryBin(name) {
  if (spawnSync(name, ["--version"]).status === 0) return name;
  const own = join(homedir(), ".foundry", "bin", name);
  if (existsSync(own)) return own;
  throw new Error(`no ${name}: install Foundry 1.8.3 (foundryup -i v1.8.3)`);
}

export function keccak(hex) {
  const r = spawnSync(foundryBin("cast"), ["keccak", hex], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`cast keccak: ${r.stderr}`);
  return r.stdout.trim();
}

export async function rpc(url, method, params = []) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
                               body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function fetchAll(block) {
  const out = {};
  for (const [name, a] of Object.entries(CONTRACTS)) {
    const code = await rpc(RPC, "eth_getCode", [a, block]);
    if (!code || code === "0x") throw new Error(`${name} ${a}: no code on chain ${CHAIN_ID}`);
    out[name] = { address: a.toLowerCase(), codeHash: keccak(code), code };
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const id = Number(await rpc(RPC, "eth_chainId"));
  if (id !== CHAIN_ID) throw new Error(`${RPC} is chain ${id}, not Base Sepolia (${CHAIN_ID})`);

  if (process.argv.includes("--check")) {
    const file = JSON.parse(readFileSync(CODE_FILE, "utf8"));
    let bad = 0;
    for (const [name, c] of Object.entries(file.contracts)) {
      const live = keccak(await rpc(RPC, "eth_getCode", [c.address, "latest"]));
      const kept = keccak(c.code);
      const ok = live === c.codeHash && kept === c.codeHash;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "DIFF"} ${name.padEnd(29)} ${c.address}${ok ? "" : `  live ${live}, file ${c.codeHash}`}`);
    }
    if (bad) {
      console.log(`${bad} contract(s) differ from Base Sepolia: run node tools/chain/fetch.mjs, then read the change`);
      process.exit(1);
    }
  } else {
    const block = await rpc(RPC, "eth_blockNumber");
    const contracts = await fetchAll(block);
    writeFileSync(CODE_FILE, JSON.stringify({
      about: "Runtime code of the contracts Sign and Burn relies on, as Base Sepolia runs them. tools/chain/fetch.mjs writes it and --check compares it with the chain; tools/chain/anvil.mjs and contracts/test/Integration.t.sol put this code at these addresses.",
      chainId: CHAIN_ID, block: Number(block), rpc: RPC, contracts,
    }, null, 1) + "\n");
    for (const [name, c] of Object.entries(contracts)) console.log(`${name.padEnd(29)} ${c.address}  ${(c.code.length - 2) / 2} bytes  ${c.codeHash}`);
    console.log(`code.json: block ${Number(block)}`);
  }
}
