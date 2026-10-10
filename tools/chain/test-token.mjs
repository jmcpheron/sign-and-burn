// A test token for the local chain only: the e2e puts its runtime code at Base Sepolia's USDC address
// (anvil_setCode), so the console's pinned USDC is there to send, and at another address as a token
// the console doesn't know. Never deployed on a real chain, and not one of contracts/: it is the least
// ERC-20 a send needs, assembled here so the tests need no compiler.
//   balanceOf(address)   a balance is the storage slot at the address itself (anvil_setStorageAt mints)
//   transfer(address,uint256)   moves it, emits Transfer, returns true; reverts with too little
//   decimals(), symbol()
//   tokenCode("USDC", 6) -> runtime bytecode, hex
const OP = { STOP: 0x00, ADD: 0x01, SUB: 0x03, LT: 0x10, EQ: 0x14, SHR: 0x1c, CALLER: 0x33, CALLDATALOAD: 0x35, MSTORE: 0x52, SLOAD: 0x54,
  SSTORE: 0x55, JUMPI: 0x57, JUMPDEST: 0x5b, DUP1: 0x80, DUP2: 0x81, SWAP1: 0x90, LOG3: 0xa3, RETURN: 0xf3, REVERT: 0xfd };
const TRANSFER = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";   // keccak("Transfer(address,address,uint256)")

/** Assemble: strings are opcodes or "@label" (a JUMPDEST) or ">label" (PUSH2 of its offset);
 * arrays are [n, hex] for PUSHn. Two passes, for the labels. */
function assemble(prog) {
  const size = (x) => (Array.isArray(x) ? 1 + x[0] : x.startsWith(">") ? 3 : 1);
  const at = {};
  let pc = 0;
  for (const x of prog) { if (typeof x === "string" && x.startsWith("@")) at[x.slice(1)] = pc; pc += size(x); }
  let out = "";
  for (const x of prog) {
    if (Array.isArray(x)) out += (0x5f + x[0]).toString(16) + x[1].padStart(x[0] * 2, "0");
    else if (x.startsWith(">")) out += "61" + at[x.slice(1)].toString(16).padStart(4, "0");
    else if (x.startsWith("@")) out += "5b";
    else out += OP[x].toString(16).padStart(2, "0");
  }
  return "0x" + out;
}

export function tokenCode(symbol, decimals) {
  const sym = Buffer.from(symbol, "utf8");
  if (sym.length > 32) throw new Error("symbol too long");
  const ret32 = [[1, "20"], [1, "00"], "RETURN"];
  return assemble([
    [1, "00"], "CALLDATALOAD", [1, "e0"], "SHR",
    "DUP1", [4, "70a08231"], "EQ", ">balanceOf", "JUMPI",
    "DUP1", [4, "a9059cbb"], "EQ", ">transfer", "JUMPI",
    "DUP1", [4, "313ce567"], "EQ", ">decimals", "JUMPI",
    "DUP1", [4, "95d89b41"], "EQ", ">symbol", "JUMPI",
    "@fail", [1, "00"], "DUP1", "REVERT",
    "@balanceOf", [1, "04"], "CALLDATALOAD", "SLOAD", [1, "00"], "MSTORE", ...ret32,
    "@decimals", [1, decimals.toString(16)], [1, "00"], "MSTORE", ...ret32,
    "@symbol", [1, "20"], [1, "00"], "MSTORE", [1, sym.length.toString(16)], [1, "20"], "MSTORE",
    [32, sym.toString("hex").padEnd(64, "0")], [1, "40"], "MSTORE", [1, "60"], [1, "00"], "RETURN",
    // transfer: amount, then the sender's balance; too little reverts
    "@transfer", [1, "24"], "CALLDATALOAD", "CALLER", "SLOAD",
    "DUP2", "DUP2", "LT", ">fail", "JUMPI",
    "DUP2", "SWAP1", "SUB", "CALLER", "SSTORE",
    [1, "04"], "CALLDATALOAD", "SLOAD", "DUP2", "ADD", [1, "04"], "CALLDATALOAD", "SSTORE",
    [1, "00"], "MSTORE",
    [1, "04"], "CALLDATALOAD", "CALLER", [32, TRANSFER], [1, "20"], [1, "00"], "LOG3",
    [1, "01"], [1, "00"], "MSTORE", ...ret32,
  ]);
}
