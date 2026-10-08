// The chain: what the page reads, and the one kind of transaction it asks a wallet to send. The
// wallet only pays gas. Everything it sends is a Multicall3 call whose parts anyone could send, and
// none of it is approved by the wallet's own key: the seat approves, with the passkey and its
// one-time key. So a wallet whose curve key breaks loses its gas money, not the Safe.
//
// Addresses come from console/cfg.py (the same file the console runs) and contracts/deployment.json.
// viem's client keeps ccipRead off: the page never follows a contract's request to fetch elsewhere.
import {
  ContractFunctionRevertedError, concat, createPublicClient, createWalletClient, custom, decodeFunctionData, decodeFunctionResult,
  encodeFunctionData, getAddress, getContractAddress, http, keccak256, pad, parseAbi, zeroAddress,
} from "viem";
import deployment from "../../contracts/deployment.json" with { type: "json" };

export const SEAT_ABI = deployment.abi.Seat;
export const FACTORY_ABI = deployment.abi.SeatFactory;
export const SAFE_ABI = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function isOwner(address owner) view returns (bool)",
  "function VERSION() view returns (string)",
  "function approvedHashes(address owner, bytes32 hash) view returns (uint256)",
]);
const PROXY_FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address)",
  "function proxyCreationCode() pure returns (bytes)",
]);
const SIGNER_FACTORY_ABI = parseAbi([
  "function createSigner(uint256 x, uint256 y, uint176 verifiers) returns (address)",
  "function getSigner(uint256 x, uint256 y, uint176 verifiers) view returns (address)",
]);
export const MULTICALL_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);

/** console/cfg.py's CFG: JSON after "CFG =". */
export function parseCfg(src) {
  return JSON.parse(src.slice(src.indexOf("{", src.indexOf("CFG ="))));
}

/** The chain this page signs on: the only one in the cfg it runs (and, in a development build, the
 * local Anvil chain instead, which has Base Sepolia's contracts at the same addresses). */
export function connect(cfg) {
  const ids = Object.keys(cfg.chains).map(Number);
  const id = ids.includes(31337) ? 31337 : ids[0];
  const c = cfg.chains[String(id)];
  const chain = { id, name: c.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [c.rpc] } }, ...(c.explorer ? { blockExplorers: { default: { name: "Explorer", url: c.explorer } } } : {}),
    testnet: true };
  const pc = createPublicClient({ chain, transport: http(c.rpc, { batch: false, retryCount: 2 }), ccipRead: false });
  return { id, chain, pc, cfg, explorer: c.explorer || "", seatFactory: deployment.SeatFactory.address };
}

export const hasCode = async (C, address) => ((await C.pc.getCode({ address })) || "0x") !== "0x";

// ----------------------------------------------------------------------------- the wallet
/** Wallets in this browser (EIP-6963), or the one injected the old way. */
export function findWallets() {
  const found = [];
  const add = (e) => { if (!found.some((w) => w.info.uuid === e.detail.info.uuid)) found.push(e.detail); };
  window.addEventListener("eip6963:announceProvider", add);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return new Promise((done) => setTimeout(() => {
    window.removeEventListener("eip6963:announceProvider", add);
    if (!found.length && window.ethereum) found.push({ info: { name: "Browser wallet", uuid: "injected", rdns: "injected" }, provider: window.ethereum });
    done(found);
  }, 300));
}

/** quiet: only a wallet already connected to this page and already on this chain, with no prompt. */
export async function useWallet(C, provider, { quiet = false } = {}) {
  const w = createWalletClient({ chain: C.chain, transport: custom(provider) });
  const [account] = quiet ? await w.getAddresses() : await w.requestAddresses();
  if (quiet && (!account || (await w.getChainId()) !== C.id)) return null;
  if ((await w.getChainId()) !== C.id) {
    try {
      await w.switchChain({ id: C.id });
    } catch (e) {
      if (e?.code !== 4902 && !/unrecognized|not been added|unknown chain/i.test(e?.message || "")) throw e;
      await w.addChain({ chain: C.chain });
    }
  }
  return { w, account };
}

/** Send one Multicall3 call from the wallet, after simulating it: a call that would revert is never
 * sent. -> the transaction hash
 * The gas is worked out here, as if every call must succeed. A wallet's own estimate is the least gas
 * with which nothing reverts, and with the Safe transaction allowed to fail, that is gas with which
 * the Safe transaction fails. */
export async function send(C, W, calls) {
  const encode = (cs) => encodeFunctionData({ abi: MULTICALL_ABI, functionName: "aggregate3", args: [cs] });
  const data = encode(calls), to = C.cfg.multicall, account = W.account;
  await C.pc.call({ account, to, data });
  let gas;
  try {
    gas = await C.pc.estimateGas({ account, to, data: encode(calls.map((c) => ({ ...c, allowFailure: false }))) });
  } catch {
    gas = (await C.pc.estimateGas({ account, to, data })) + 300000n;   // it can't run yet (no ETH?): its vote still lands
  }
  return W.w.sendTransaction({ account, to, data, gas: gas + gas / 4n, chain: C.chain });
}

export const receipt = (C, hash) => C.pc.waitForTransactionReceipt({ hash, pollingInterval: C.id === 31337 ? 250 : 2000 });

// ----------------------------------------------------------------------------- reads
export async function signerAddress(C, pk) {
  return C.pc.readContract({ address: C.cfg.signer.factory, abi: SIGNER_FACTORY_ABI, functionName: "getSigner",
    args: [BigInt("0x" + pk.x), BigInt("0x" + pk.y), BigInt(C.cfg.signer.verifiers)] });
}

/** The seats made for this passkey signer, by anyone (SeatFactory.seatsOf). */
export async function seatsOf(C, signer) {
  if (!(await hasCode(C, C.seatFactory))) return [];
  return C.pc.readContract({ address: C.seatFactory, abi: FACTORY_ABI, functionName: "seatsOf", args: [signer] });
}

export async function readSeat(C, address) {
  const read = (functionName) => C.pc.readContract({ address, abi: SEAT_ABI, functionName });
  const [n, current, curveSigner, seatNumber, pubSeed] = await Promise.all(["n", "current", "curveSigner", "seatNumber", "pubSeed"].map(read));
  return { address, n: Number(n), current, curveSigner, seatNumber: Number(seatNumber), pubSeed };
}

export async function readSafe(C, address) {
  if (!(await hasCode(C, address))) return { address, exists: false, balance: await C.pc.getBalance({ address }) };
  const read = (functionName) => C.pc.readContract({ address, abi: SAFE_ABI, functionName });
  const [owners, threshold, nonce, version, balance] = await Promise.all([read("getOwners"), read("getThreshold"), read("nonce"), read("VERSION"),
    C.pc.getBalance({ address })]);
  return { address, exists: true, owners, threshold: Number(threshold), nonce: Number(nonce), version, balance };
}

/** Where approval k landed, and what it put on chain: the Approved event, and the transaction that
 * carried it, decoded. This is what anyone can read: the revealed one-time signature among it. */
export async function approvalOnChain(C, seat, k) {
  const block = await C.pc.readContract({ address: seat, abi: SEAT_ABI, functionName: "approvedIn", args: [BigInt(k)] });
  if (!block) return null;
  const event = SEAT_ABI.find((x) => x.type === "event" && x.name === "Approved");
  const [log] = await C.pc.getLogs({ address: seat, event, args: { n: BigInt(k) }, fromBlock: block, toBlock: block });
  if (!log) return { k, block };
  const tx = await C.pc.getTransaction({ hash: log.transactionHash });
  let args = null;
  try {
    const outer = decodeFunctionData({ abi: MULTICALL_ABI, data: tx.input });
    for (const call of outer.args[0]) {
      if (call.target.toLowerCase() !== seat.toLowerCase()) continue;
      const inner = decodeFunctionData({ abi: SEAT_ABI, data: call.callData });
      if (inner.functionName === "approve" && inner.args[0] && inner.args[2] === log.args.nextKey) args = inner.args;
    }
  } catch {}
  return { k, block, txHash: log.transactionHash, safe: log.args.safe, safeTxHash: log.args.safeTxHash, nextKey: log.args.nextKey, args };
}

// ----------------------------------------------------------------------------- the shielded Safe
/** A 1-of-1 Safe 1.4.1 whose one owner is the seat, at an address fixed by the seat. */
export function safeInitializer(C, seat) {
  return encodeFunctionData({ abi: SAFE_ABI, functionName: "setup",
    args: [[seat], 1n, zeroAddress, "0x", C.cfg.safe.fallbackHandler, zeroAddress, 0n, zeroAddress] });
}

let creationCode = null;
export async function safeAddress(C, seat) {
  creationCode ||= await C.pc.readContract({ address: C.cfg.safe.factory, abi: PROXY_FACTORY_ABI, functionName: "proxyCreationCode" });
  const salt = keccak256(concat([keccak256(safeInitializer(C, seat)), pad(seat, { size: 32 })]));
  return getContractAddress({ opcode: "CREATE2", from: C.cfg.safe.factory, salt,
    bytecode: concat([creationCode, pad(C.cfg.safe.singleton, { size: 32 })]) });
}

/** Where createSeat puts this seat: the factory says, or, before the factory exists, a simulation
 * of deploying it and then the seat. */
export async function seatAddress(C, signer, seatNumber, firstKey) {
  const args = [signer, seatNumber, firstKey];
  if (await hasCode(C, C.seatFactory)) return C.pc.readContract({ address: C.seatFactory, abi: FACTORY_ABI, functionName: "seatAddress", args });
  const calls = [deployFactory(C), { target: C.seatFactory, allowFailure: false, callData: encodeFunctionData({ abi: FACTORY_ABI, functionName: "createSeat", args }) }];
  const r = await C.pc.call({ to: C.cfg.multicall, data: encodeFunctionData({ abi: MULTICALL_ABI, functionName: "aggregate3", args: [calls] }) });
  const results = decodeFunctionResult({ abi: MULTICALL_ABI, functionName: "aggregate3", data: r.data });
  return getAddress("0x" + results[1].returnData.slice(-40));
}

const deployFactory = (C) => ({ target: C.cfg.create2Deployer, allowFailure: false, callData: concat([deployment.salt, deployment.SeatFactory.initCode]) });

/** The calls that build a shielded Safe in one transaction: the SeatFactory if nobody has deployed it
 * yet (anyone may, at the same address on every chain), the passkey's signer if it isn't there, the
 * seat, and the Safe. */
export async function buildCalls(C, { pk, signer, seatNumber, firstKey, seat }) {
  const calls = [];
  if (!(await hasCode(C, C.seatFactory))) calls.push(deployFactory(C));
  if (!(await hasCode(C, signer))) calls.push({ target: C.cfg.signer.factory, allowFailure: false, callData: encodeFunctionData({
    abi: SIGNER_FACTORY_ABI, functionName: "createSigner", args: [BigInt("0x" + pk.x), BigInt("0x" + pk.y), BigInt(C.cfg.signer.verifiers)] }) });
  calls.push({ target: C.seatFactory, allowFailure: false, callData: encodeFunctionData({ abi: FACTORY_ABI, functionName: "createSeat", args: [signer, seatNumber, firstKey] }) });
  calls.push({ target: C.cfg.safe.factory, allowFailure: false, callData: encodeFunctionData({ abi: PROXY_FACTORY_ABI, functionName: "createProxyWithNonce",
    args: [C.cfg.safe.singleton, safeInitializer(C, seat), BigInt(seat)] }) });
  return calls;
}

/** One press: the seat's approval (it must land), then the Safe transaction it approves (it may
 * fail, say for lack of ETH, and run later: the Safe keeps the seat's vote). */
export function approveCalls(a, tx) {
  const approve = { target: a.seat, allowFailure: false, callData: encodeFunctionData({ abi: SEAT_ABI, functionName: "approve",
    args: [a.safe, a.safeTxHash, a.nextKey, a.oneTime, a.curveSig] }) };
  return [approve, execCall(a.seat, a.safe, tx)];
}

/** execTransaction with the seat's vote as a pre-approved signature: r = the seat, s = 0, v = 1. */
export function execCall(seat, safe, tx) {
  const signatures = concat([pad(seat, { size: 32 }), pad("0x", { size: 32 }), "0x01"]);
  return { target: safe, allowFailure: true, callData: encodeFunctionData({ abi: SAFE_ABI, functionName: "execTransaction",
    args: [tx.to, BigInt(tx.value), tx.data || "0x", Number(tx.operation), 0n, 0n, 0n, zeroAddress, zeroAddress, signatures] }) };
}

/** Ask the seat itself, without sending anything: -> null if it would accept, else its error's name. */
export async function trySeat(C, seat, args, from) {
  try {
    await C.pc.simulateContract({ address: seat, abi: SEAT_ABI, functionName: "approve", args, account: from || zeroAddress });
    return null;
  } catch (e) {
    const r = e?.walk?.((x) => x instanceof ContractFunctionRevertedError);
    return r?.data?.errorName || r?.reason || r?.shortMessage || e.shortMessage || String(e.message || e);
  }
}
