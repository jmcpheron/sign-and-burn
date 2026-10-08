#!/usr/bin/env node
// contracts/deployment.json: the SeatFactory as the CREATE2 deployer puts it, with salt 0, so its
// address is the same on every chain and anyone can deploy it (the page does, through the visitor's
// wallet, if it isn't there yet). Also the ABIs the page uses. Written from forge's output, which is
// the same bytes on every build (foundry.toml: bytecode_hash "none", solc pinned).
//   (cd contracts && forge build) && node tools/chain/deployment.mjs           rewrite it
//   (cd contracts && forge build) && node tools/chain/deployment.mjs --check   exit 1 if the build differs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTRACTS, keccak } from "./fetch.mjs";

const CONTRACTS_DIR = fileURLToPath(new URL("../../contracts/", import.meta.url));
const FILE = `${CONTRACTS_DIR}deployment.json`;
const SALT = "0x" + "00".repeat(32);
const out = (name) => JSON.parse(readFileSync(`${CONTRACTS_DIR}out/${name}.sol/${name}.json`, "utf8"));

const factory = out("SeatFactory"), seat = out("Seat");
const deployer = CONTRACTS.Create2Deployer.toLowerCase();
const initCode = factory.bytecode.object;
const initCodeHash = keccak(initCode);
const address = "0x" + keccak("0xff" + deployer.slice(2) + SALT.slice(2) + initCodeHash.slice(2)).slice(-40);

const text = JSON.stringify({
  about: "The SeatFactory through the CREATE2 deployer (Arachnid's, at the same address on every chain), salt 0: the page sends deployer.call(salt ‖ initCode) when there is no code at this address yet. tools/chain/deployment.mjs writes this from forge's build and --check compares them. abi: what the page calls.",
  solc: factory.metadata.compiler.version,
  create2Deployer: deployer,
  salt: SALT,
  SeatFactory: { address, initCodeHash, initCode },
  abi: { Seat: seat.abi, SeatFactory: factory.abi },
}, null, 1) + "\n";

if (process.argv.includes("--check")) {
  let kept = "";
  try { kept = readFileSync(FILE, "utf8"); } catch {}
  if (kept !== text) {
    console.log("contracts/deployment.json differs from the build: run node tools/chain/deployment.mjs, then read the change");
    process.exit(1);
  }
  console.log(`ok   contracts/deployment.json: SeatFactory at ${address}`);
} else {
  writeFileSync(FILE, text);
  console.log(`contracts/deployment.json: SeatFactory at ${address} (init code ${(initCode.length - 2) / 2} bytes, ${initCodeHash})`);
}
