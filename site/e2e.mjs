#!/usr/bin/env node
// The whole page in Chromium, against the local chain (tools/chain/anvil.mjs: Base Sepolia's Safe,
// passkey signer and Multicall3 at their own addresses, chain 31337). A virtual authenticator with
// PRF plays the passkey; a stand-in wallet (Anvil's first account) pays the gas. It checks, on chain:
//   make a passkey → key 0 → with no wallet in that browser, share a link → another browser with a
//   wallet and no passkey opens it, refuses a tampered one, pays for the build (deploying the
//   SeatFactory too) and funds it, and the first browser moves on by itself → connect a wallet →
//   two presses, each burning a key and running the Safe transaction → every attack refused →
//   the console's refusals and red page → the guardrail: a wallet that says no, then the same
//   approval sent again with no new signature → the danger case → a browser with no ledger finds
//   the seat and is warned → a front-run approval lands in someone else's transaction → a press
//   with no wallet goes out as a link, and the other browser sends it → the CSP
//   refuses other hosts → a reload keeps the ledger. Before all that, the explainers in "How it works".
//   cd site && npm ci && node e2e.mjs        (Chromium: SAB_CHROMIUM=/path/to/chrome if playwright-core has none)
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { concat, createPublicClient, decodeFunctionData, encodeFunctionData, formatEther, http, parseAbi } from "viem";
import { startChain } from "../tools/chain/anvil.mjs";
import { MULTICALL_ABI } from "./src/chain.mjs";

const SITE = fileURLToPath(new URL(".", import.meta.url));
const SHOTS = join(SITE, "shots");
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "pass" : "FAIL"}  ${what}`); if (!ok) fails++; };

// ---- the development build, the chain, and a server for the folder
const b = spawnSync(process.execPath, ["build.mjs", "--dev"], { cwd: SITE, encoding: "utf8" });
if (b.status) throw new Error(b.stderr || b.stdout);
const chain = await startChain({ port: 8545 });
const pc = createPublicClient({ transport: http(chain.url) });
const DEV = join(SITE, "dev");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm",
  ".json": "application/json", ".svg": "image/svg+xml", ".py": "text/plain; charset=utf-8" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DEV, path);
  try { if (statSync(file).isDirectory()) file = join(file, "index.html"); res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://localhost:${server.address().port}/`;

// ---- the stand-in wallet: Anvil's first account, unlocked, so Anvil signs what it sends. Beside it,
// another wallet that refuses everything, so the page has to let the visitor choose. A third account
// plays someone watching the mempool.
const ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", SECOND = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", THIRD = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const wallet = { refuseNext: false, frontRun: false, frontRunHash: "", sent: 0, account: ACCOUNT, authorized: true, pendingConnect: false, accountRequests: 0 };
const rpc = async (method, params) => (await (await fetch(chain.url, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json());
async function walletRpc(method, params) {
  if (method === "eth_accounts") return { result: wallet.authorized ? [wallet.account] : [] };
  if (method === "eth_requestAccounts") {
    wallet.accountRequests++;
    if (wallet.pendingConnect) return { error: { code: -32002, message: "Request of type eth_requestAccounts already pending." } };
    wallet.authorized = true;
    return { result: [wallet.account] };
  }
  if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return { result: null };
  if (method === "eth_sendTransaction" && wallet.refuseNext) { wallet.refuseNext = false; return { error: { code: 4001, message: "User rejected the request." } }; }
  if (method === "eth_sendTransaction" && wallet.frontRun) {
    // Someone copies the seat.approve call out of the page's Multicall3 call and sends it first, alone.
    wallet.frontRun = false;
    const [calls] = decodeFunctionData({ abi: MULTICALL_ABI, data: params[0].data }).args;
    const r = await rpc("eth_sendTransaction", [{ from: THIRD, to: calls[0].target, data: calls[0].callData, gas: "0x" + (1500000).toString(16) }]);
    if (r.error) throw new Error(`front-run: ${r.error.message}`);
    wallet.frontRunHash = r.result;
    await pc.waitForTransactionReceipt({ hash: r.result });
  }
  if (method === "eth_sendTransaction") wallet.sent++;
  const r = await rpc(method, params);
  return r.error ? { error: { code: r.error.code, message: r.error.message } } : { result: r.result };
}

const browser = await chromium.launch({ executablePath: process.env.SAB_CHROMIUM || undefined });
// Each browser has the two wallets, unless the page sets e2e.nowallet in its localStorage: then it
// has none, as on a phone. The clipboard keeps exactly what was copied, even in a browser with a share sheet.
async function newBrowser() {
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
await ctx.exposeFunction("__e2eWallet", walletRpc);
await ctx.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: async () => { throw new Error("Copy link must not open a share sheet"); } });
  Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, value: { writeText: async (text) => {
    if (window.__e2eCopyFails) throw new Error("clipboard unavailable");
    window.__e2eCopied = text;
  } } });
  const listeners = {};
  const provider = {
    request: async ({ method, params }) => {
      const r = await window.__e2eWallet(method, params || []);
      if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; }
      return r.result;
    },
    on(ev, f) { (listeners[ev] ||= []).push(f); }, removeListener() {},
  };
  window.__e2eEmit = (ev, data) => (listeners[ev] || []).forEach((f) => f(data));
  const other = { request: async () => { const e = new Error("not this wallet"); e.code = 4001; throw e; }, on() {}, removeListener() {} };
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E";
  // a new uuid on every page load, as wallets do; the page remembers the rdns
  const info = Object.freeze({ uuid: crypto.randomUUID(), name: "Test wallet (Anvil)", rdns: "app.signandburn.e2e", icon });
  const otherInfo = Object.freeze({ uuid: crypto.randomUUID(), name: "Another wallet", rdns: "app.signandburn.other", icon });
  window.addEventListener("eip6963:requestProvider", () => {
    if (localStorage.getItem("e2e.nowallet")) return;
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: otherInfo, provider: other }) }));
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  });
});
return ctx;
}
const ctx = await newBrowser();
const page = await ctx.newPage();
const csp = [], errors = [];
page.on("console", (m) => { if (/Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
  protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
  automaticPresenceSimulation: true, hasPrf: true } });
const signCount = async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials[0]?.signCount ?? 0;

// what the screen says, without its steps bar (which names every step)
const said = () => [...document.querySelectorAll("#screen > :not(.steps-bar)")].map((e) => e.innerText).join("\n");
const screen = () => page.evaluate(said);
const waitFor = (re, timeout = 30000, on = page) => on.waitForFunction((s) => new RegExp(s).test([...document.querySelectorAll("#screen > :not(.steps-bar)")]
  .map((e) => e.innerText).join("\n")), re.source, { timeout })
  .then(() => true, async () => { console.log("  screen said:", (await on.evaluate(said)).slice(0, 600)); return false; });
const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
const click = (name, on = page) => on.getByRole("button", { name }).first().click();
async function hold(ms = 2400) {
  const btn = page.locator("button.hold");
  await btn.scrollIntoViewIfNeeded();
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}
const SEAT_ABI = parseAbi(["function n() view returns (uint64)", "function current() view returns (bytes32)"]);
const SAFE_ABI = parseAbi(["function nonce() view returns (uint256)", "function getOwners() view returns (address[])"]);
const home = async () => Object.values(JSON.parse(await page.evaluate(() => localStorage.getItem("sab.home"))))[0];

try {
  // 1. the console boots: MicroPython running the console image, its fingerprint worked out here
  await page.goto(URL_);
  await page.waitForFunction(() => /files · .* lines of MicroPython/.test(document.querySelector("#stats").innerText), null, { timeout: 30000 });
  const stats = await page.locator("#stats").innerText();
  const want = JSON.parse(readFileSync(join(DEV, "console", "manifest.json"), "utf8")).fingerprint;
  check((await page.locator("#fp").innerText()).trim() === want, `the console boots in MicroPython, and the page works out its fingerprint (${stats})`);
  check(await waitFor(/Make a passkey/), "first visit: make a passkey");
  await shot("1-welcome");
  // the explainers in "How it works", drawn with src/wots.mjs and a throwaway key
  await page.locator("#chain-demo .bar").nth(64).click();
  const chainSaid = await page.locator("#chain-demo").innerText();
  check(/Chain 64 of 67\. Checksum digit 1 of 3/.test(chainSaid) && /the key's fingerprint, so the signature is good/.test(chainSaid), "the chain explainer: pick a chain, and the signature checks out");
  await page.locator("#once-demo").getByRole("button", { name: "4", exact: true }).click();
  check(/^1 in [\d,]+$/.test(await page.locator("#once-demo .odds").innerText()), "the only-once explainer: four signatures by one key, and a forger's odds per try");

  // 2. a passkey, and key 0 from its PRF
  await click("Make a passkey");
  check(await waitFor(/Tap to make key 0/), "a passkey for this site; its signer address worked out by the console and checked against the factory");
  await click("Tap to make key 0");
  check(await waitFor(/Build your shielded Safe/), "one tap: the PRF gives seed 0, the console gives key 0's fingerprint, and the addresses are known before anything exists");
  await shot("2-build");

  // 3. the shielded Safe, in one transaction: SeatFactory (first time on this chain), signer, seat, Safe.
  // This browser has no wallet, as on a phone; another browser, with a wallet and no passkey, pays.
  await page.evaluate(() => localStorage.setItem("e2e.nowallet", "1"));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();
  check(await waitFor(/No wallet here\? Pay from another device/) && (await page.locator("#screen").getByRole("button", { name: "Connect a wallet" }).count()) === 1,
    "no wallet in this browser: Connect a wallet stays available beside the payment link");
  await click("Connect a wallet");
  check(await waitFor(/No wallet found in this browser[\s\S]*They review the transaction here/) && await page.locator("#screen .share-link").isVisible(),
    "no wallet found: explain who pays and keep the prepared link visible");
  await page.evaluate(() => { window.__e2eCopyFails = true; });
  await click("Copy link");
  check(await waitFor(/Select the link shown here/) && await page.locator("#screen .share-link").isVisible(), "clipboard refused: the link stays visible to copy by hand");
  await page.evaluate(() => { window.__e2eCopyFails = false; });
  await shot("2-build-phone");
  await page.setViewportSize({ width: 1360, height: 1000 });
  await click("Copy link");
  const link = await page.evaluate(() => window.__e2eCopied);
  const H = await home();
  check(link === await page.locator(".share-link").inputValue() && link.startsWith(URL_ + "#pay=") && !link.includes(H.seat.slice(2).toLowerCase()) && !link.includes(H.safe.slice(2).toLowerCase()),
    "the link: this page's address, then public values only (it names neither the seat nor the Safe)");

  const ctx2 = await newBrowser();
  const payer = await ctx2.newPage();
  payer.on("pageerror", (e) => errors.push("payer: " + e.message));
  payer.on("console", (m) => { if (/Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()); });
  await payer.goto(link.replace("chain=31337", "chain=1"));
  check(await waitFor(/This link is for chain 1\./, 30000, payer), "another browser refuses a link for another chain");
  await payer.evaluate(() => localStorage.setItem("e2e.nowallet", "1"));
  await payer.goto(URL_);
  await payer.locator(".payment-request summary").click();
  await payer.locator("#pay-request-link").fill("not a link");
  await click("Review request", payer);
  check(await payer.locator("#pay-request-status").innerText() === "Paste a complete Sign and Burn payment link. Nothing was sent.", "pasting invalid text gives an explanation without sending");
  await payer.locator("#pay-request-link").fill(link.replace("chain=31337", "chain=1"));
  await click("Review request", payer);
  check(/This link is for chain 1/.test(await payer.locator("#pay-request-status").innerText()), "pasted requests also refuse another chain");
  await payer.locator("#pay-request-link").fill(link.replace(URL_, "https://example.invalid/"));
  await click("Review request", payer);
  check(payer.url().startsWith(URL_), "pasted request is reviewed here without visiting the link's host");
  check(await waitFor(/Pay the gas for a shielded Safe[\s\S]*Seat #0/, 30000, payer), "…and opens the real one in place: what it builds, worked out there");
  const shown = await payer.evaluate(() => [...document.querySelectorAll("#screen .addr span[title]")].map((e) => e.title.toLowerCase()));
  check(shown.includes(H.seat.toLowerCase()) && shown.includes(H.safe.toLowerCase()), "…the same seat and Safe the first browser worked out at key 0");
  await click("Connect a wallet", payer);
  check(await waitFor(/No wallet found in this browser[\s\S]*You do not need the sender's passkey/, 30000, payer),
    "a payer with no wallet gets instructions for paying without the sender's passkey");
  await payer.evaluate(() => localStorage.removeItem("e2e.nowallet"));
  await payer.reload();
  await waitFor(/Pay the gas for a shielded Safe[\s\S]*Seat #0/, 30000, payer);
  await click("Connect a wallet", payer);
  await payer.locator(".chooser").waitFor();
  const names = await payer.locator(".chooser .actions button").allInnerTexts();
  check(names.includes("Test wallet (Anvil)") && names.includes("Another wallet"), "two wallets in the browser: the page lets you choose");
  await click("Test wallet (Anvil)", payer);
  await payer.getByRole("button", { name: "Pay: one transaction" }).waitFor();
  check(wallet.accountRequests === 0, "an authorized wallet connects without another account permission request");
  await payer.screenshot({ path: join(SHOTS, "2-pay.png"), fullPage: true });
  wallet.refuseNext = true;
  await click("Pay: one transaction", payer);
  check(await waitFor(/wallet said no/, 30000, payer) && !(await pc.getCode({ address: H.safe })), "the payer's wallet says no: nothing is built");
  // Meanwhile a stranger deploys the SeatFactory and creates the seat on its own, as anyone may. The
  // build must still go through: it makes only what isn't there yet.
  const dep = JSON.parse(readFileSync(join(SITE, "..", "contracts", "deployment.json"), "utf8"));
  const signer = shown[0];
  for (const tx of [{ to: dep.create2Deployer, data: concat([dep.salt, dep.SeatFactory.initCode]) },
    { to: dep.SeatFactory.address, data: encodeFunctionData({ abi: dep.abi.SeatFactory, functionName: "createSeat", args: [signer, H.seatNumber, H.firstKey] }) }]) {
    const r = await rpc("eth_sendTransaction", [{ from: THIRD, ...tx, gas: "0x" + (5000000).toString(16) }]);
    await pc.waitForTransactionReceipt({ hash: r.result });
  }
  check(!!(await pc.getCode({ address: H.seat })) && !(await pc.getCode({ address: H.safe })), "a stranger creates the seat alone: half built");
  await click("Pay: one transaction", payer);
  check(await waitFor(/Built\./, 60000, payer), "then one wallet transaction from the other browser builds the shielded Safe");
  const owners = await pc.readContract({ address: H.safe, abi: SAFE_ABI, functionName: "getOwners" });
  check(owners.length === 1 && owners[0].toLowerCase() === H.seat.toLowerCase(), "on chain: a Safe whose one owner is the seat");
  check((await pc.readContract({ address: H.seat, abi: SEAT_ABI, functionName: "current" })) === H.firstKey, "on chain: the seat holds key 0's fingerprint and nothing else");
  check(await waitFor(/Your Safe is built, and empty[\s\S]*Fund it from another device/, 30000) && await page.getByRole("button", { name: "Copy the Safe's address" }).count() === 1,
    "the first browser sees the Safe and moves on by itself, to funding it from another device");
  await click("Send it 0.001 test ETH", payer);
  check(await waitFor(/Funded/, 30000, payer) && await payer.evaluate(() => localStorage.getItem("sab.home") === null), "the payer funds it too, and keeps nothing");
  check(await waitFor(/Press the button/), "the first browser sees the ETH and moves on");

  // a wallet in the first browser after all, to send the presses
  await page.evaluate(() => localStorage.removeItem("e2e.nowallet"));
  await click("I have a wallet in this browser");
  await page.locator(".chooser").waitFor();
  await click("Test wallet (Anvil)");

  // 4. two presses
  // more than the Safe holds: the hold is held back, or key 0 would burn on an approval the Safe can't run
  const amount = page.locator("#screen .form input").nth(1);
  await amount.fill("1");
  check(await waitFor(/Approving now would burn key 0[\s\S]*Fund it from another device/) && await page.locator("button.hold").isDisabled(), "sending more than the Safe holds: no hold, and a way to fund it");
  await amount.fill("0.0001");
  // a wallet account with no ETH for gas: the page says so before anything is signed
  const EMPTY = "0x00000000000000000000000000000000000e0e01";
  wallet.account = EMPTY;
  await page.evaluate((a) => window.__e2eEmit("accountsChanged", [a]), EMPTY);
  check(await waitFor(/has no Local Anvil[^\n]* ETH for gas[\s\S]*Holding still signs here/), "a wallet account with no ETH for gas: said before the hold, and the approval would go out as a link");
  wallet.account = ACCOUNT;
  await page.evaluate((a) => window.__e2eEmit("accountsChanged", [a]), ACCOUNT);
  await waitFor(/Holding asks your passkey once\. The console signs with key 0, burns it and names key 1; your wallet/);
  const TO = "0x00000000000000000000000000000000000b0b01";
  await page.locator("#screen input.mono").fill(TO);
  check(await waitFor(/Send 0\.0001 ETH[\s\S]*…0b0b01/), "the console says what the transaction does, and the hash it worked out");
  await shot("3-review");
  for (const k of [0, 1]) {
    const before = await signCount();
    await hold();
    check(await waitFor(new RegExp(`Key ${k}: signed, sent, burned`), 60000), `press ${k + 1}: one tap, key ${k} signs and burns`);
    check((await signCount()) === before + 1, `press ${k + 1}: exactly one passkey signature`);
    check(Number(await pc.readContract({ address: H.seat, abi: SEAT_ABI, functionName: "n" })) === k + 1, `on chain: the seat is at key ${k + 1}`);
    check(Number(await pc.readContract({ address: H.safe, abi: SAFE_ABI, functionName: "nonce" })) === k + 1, `on chain: the Safe ran transaction ${k}`);
    if (k === 0) {
      await shot("4-done");
      // the visitor picks another account in their wallet (say, the Trezor's in Rabby)
      wallet.account = SECOND;
      await page.evaluate((a) => window.__e2eEmit("accountsChanged", [a]), SECOND);
      await page.waitForFunction((a) => document.querySelector("#safe").innerText.includes(a), SECOND.slice(0, 8), { timeout: 10000 });
    }
    await click("Another one");
    await waitFor(/Press the button/);
  }
  check(formatEther(await pc.getBalance({ address: TO })) === "0.0002", "on chain: the recipient got 0.0001 ETH twice");
  check((await pc.getTransactionCount({ address: SECOND })) === 1, "the wallet switched accounts: the second press's gas came from the new one");

  // 5. the attack room: everything a replay can do, refused by the seat itself
  await page.locator("#attacks").scrollIntoViewIfNeeded();
  const tries = page.locator("#attack-list .attack button");
  await tries.first().waitFor({ timeout: 20000 });
  const n = await tries.count();
  for (let i = 0; i < n; i++) await tries.nth(i).click();
  await page.waitForFunction(() => [...document.querySelectorAll("#attack-list .result")].every((r) => /Refused|ACCEPTED/.test(r.textContent)), null, { timeout: 20000 });
  const results = await page.locator("#attack-list .result").allInnerTexts();
  check(n === 5 && results.every((r) => r.startsWith("Refused: Bad")), `the attack room: ${n} attacks, each refused (${results.map((r) => r.split(".")[0].slice(9)).join(", ")})`);
  await click("Run it with a throwaway key");
  await page.waitForFunction(() => /Forged|No forgery/.test(document.querySelector("#danger").innerText), null, { timeout: 30000 });
  check(/Forged\. After/.test(await page.locator("#danger").innerText()), "the danger case: a throwaway key signs several messages, and a forgery checks out");
  await shot("5-attacks");

  // 6. the console's own judgement: a red page, and what it refuses
  const preset = page.locator("#screen select");
  await preset.selectOption("owner");
  check(await waitFor(/ADD OWNER/) && await page.locator("#screen.red").count() === 1, "adding an owner: the whole screen is red, and holding needs the red page read first");
  check(await page.locator("button.hold").isDisabled(), "…the hold button waits for that");
  await shot("6-red");
  await preset.selectOption("unknown");
  check(await waitFor(/The console refuses: A call this console can't read/) && !(await page.locator("button.hold").count()), "a call it can't read: refused, no button");
  await preset.selectOption("delegate");
  check(await waitFor(/The console refuses: .*delegatecall/i), "a delegatecall: refused");
  await preset.selectOption("send");
  await waitFor(/Send 0\.0001 ETH/);

  // 7. the guardrail: the wallet says no after key 2 signed; key 2 then only ever sends that approval
  wallet.refuseNext = true;
  let before = await signCount();
  await hold();
  check(await waitFor(/wallet said no/), "the wallet refuses to send approval 2");
  check((await signCount()) === before + 1, "…after the passkey signed it");
  check(/Key 2 already signed this approval/.test(await screen()) && !(await page.locator("#screen select").count()),
    "the console keeps it: no other transaction for key 2, only this one again");
  const serial = await page.locator("#log").textContent();
  check(serial.includes('"op":"sign"') && serial.includes("not shown") && !/"seeds":\["0x/.test(serial), "the serial log shows every request, and never the seeds");
  await page.reload();
  check(await waitFor(/Key 2 already signed this approval/), "after a reload too: the ledger survives in this browser");
  before = await signCount();
  const sent = wallet.sent;
  await hold();
  check(await waitFor(/Key 2: signed, sent, burned/, 60000), "sent again: the same approval lands");
  check((await signCount()) === before && wallet.sent === sent + 1, "…with no new passkey signature: key 2 signed once, ever");
  check(Number(await pc.readContract({ address: H.seat, abi: SEAT_ABI, functionName: "n" })) === 3, "on chain: the seat is at key 3");
  const hist = await page.locator("#history").innerText();
  check(["#0", "#1", "#2"].every((k) => hist.includes(k)) && (hist.match(/landed/g) || []).length === 3, "history: three approvals, all landed");

  // 8. a browser whose console has no ledger for the seat (a second device with the synced passkey):
  // it finds the seat on chain, warns that another device's console holds its record, and signs only
  // once the visitor says nothing is waiting there
  await page.evaluate(() => { localStorage.removeItem("sab.ledger"); localStorage.removeItem("sab.home"); });
  await page.reload();
  check(await waitFor(/Another device made this seat/), "a browser with no ledger finds the seat on chain, and is told another device's console holds its record");
  check(await page.locator("button.hold").isDisabled(), "…holding waits until the visitor says nothing is waiting on that device");
  await page.getByLabel(/Nothing signed with key 3 is waiting/).check();
  before = await signCount();
  await hold();
  check(await waitFor(/Key 3: signed, sent, burned/, 60000) && (await signCount()) === before + 1, "…then key 3 signs and burns, from this browser's new ledger");
  await click("Another one");
  check(await waitFor(/Press the button/) && !/Another device made this seat/.test(await screen()), "with an approval in its ledger, this browser is the seat's device: no warning");

  // 9. a front-run: someone copies the approve call from the mempool and sends it first. The page's own
  // transaction reverts; the approval has landed all the same, in theirs, and key 4 is burned
  wallet.frontRun = true;
  const nonceBefore = Number(await pc.readContract({ address: H.safe, abi: SAFE_ABI, functionName: "nonce" }));
  await hold();
  check(await waitFor(/already landed in another transaction/, 60000), "front-run: the page says approval 4 landed in someone else's transaction, not the page's");
  check(Number(await pc.readContract({ address: H.seat, abi: SEAT_ABI, functionName: "n" })) === 5, "on chain: the seat is at key 5 all the same");
  check(Number(await pc.readContract({ address: H.safe, abi: SAFE_ABI, functionName: "nonce" })) === nonceBefore && /Safe hasn't run it/.test(await screen()),
    "…the Safe hasn't run it, and the page says so");
  const theirs = `${wallet.frontRunHash.slice(0, 10)}…${wallet.frontRunHash.slice(-6)}`;
  check((await page.locator("#history").innerText()).includes(theirs) && (await page.locator("#screen").innerText()).includes(theirs),
    "the screen and the history name their transaction, the one the approval is in");

  // 9b. a press with no wallet here: the console signs and records approval 5, and it goes out as a
  // link. Until it lands, this browser shares only that approval. A wallet in the other browser sends it.
  await page.evaluate(() => localStorage.setItem("e2e.nowallet", "1"));
  await page.reload();
  check(await waitFor(/No wallet here: you then share the approval as a link/), "no wallet in this browser: holding signs, and then the approval goes out as a link");
  // the screen redraws on the next frame: wait for the new recipient, or the hold button found is the old one
  await page.locator("#screen input.mono").first().fill("0x00000000000000000000000000000000000b0b02");
  await waitFor(/Send 0\.0001 ETH[\s\S]*…0b0b02/);
  before = await signCount();
  await hold();
  check(await waitFor(/Approval 5 is signed\. Send it from another device/, 60000) && (await signCount()) === before + 1, "…one tap: key 5 signs, and the approval waits in the ledger");
  const code = await page.locator("#screen .verify .code").innerText();
  await click("Copy link");
  const alink = await page.evaluate(() => window.__e2eCopied);
  await page.reload();
  check(await waitFor(/Approval 5 is signed/) && (await signCount()) === before + 1 && (await page.locator(".share-link").inputValue()) === alink,
    "after a reload: the same approval, the same link, and no new passkey signature");
  const tampered = new URLSearchParams(new URL(alink).hash.slice(1));
  tampered.set("next", "0x" + "ab".repeat(32));
  await payer.goto(URL_ + "#" + tampered);
  check(await waitFor(/The seat would refuse this approval \(Bad/, 30000, payer) && !(await payer.getByRole("button", { name: "Send it: one transaction" }).count()),
    "the other browser: the link with another next key, and the seat would refuse it; no button");
  wallet.authorized = false; wallet.pendingConnect = true;
  await payer.goto(URL_);
  await payer.locator(".payment-request summary").click();
  await payer.locator("#pay-request-link").fill(alink);
  await click("Review request", payer);
  check(await waitFor(/Send approval 5[\s\S]*The seat accepts it/, 30000, payer) && (await payer.locator("#screen .verify .code").innerText()) === code,
    "the real link: the seat accepts it, and the hash worked out there shows the code this browser shows");
  const sentBeforeConnect = wallet.sent;
  await click("Connect a wallet", payer);
  await payer.locator(".chooser").waitFor();
  await click("Test wallet (Anvil)", payer);
  check(await waitFor(/already has a request waiting[\s\S]*finish or cancel that request/, 30000, payer) && wallet.sent === sentBeforeConnect,
    "a pending wallet request on an approval link explains recovery and sends nothing");
  wallet.pendingConnect = false;
  await click("Connect a wallet", payer);
  await payer.locator(".chooser").waitFor();
  await click("Test wallet (Anvil)", payer);
  await payer.getByRole("button", { name: "Send it: one transaction" }).waitFor();
  check((await signCount()) === before + 1, "retrying the payer connection uses the same approval with no new passkey signature");
  await payer.screenshot({ path: join(SHOTS, "8-send-approval.png"), fullPage: true });
  const safeNonce = Number(await pc.readContract({ address: H.safe, abi: SAFE_ABI, functionName: "nonce" }));
  await click("Send it: one transaction", payer);
  check(await waitFor(/Sent\. Approval 5 landed[\s\S]*The Safe ran the transaction/, 60000, payer), "the other browser's wallet sends it, and the Safe runs it");
  check(Number(await pc.readContract({ address: H.seat, abi: SEAT_ABI, functionName: "n" })) === 6 &&
    Number(await pc.readContract({ address: H.safe, abi: SAFE_ABI, functionName: "nonce" })) === safeNonce + 1, "on chain: the seat is at key 6, and the Safe ran it");
  check(await waitFor(/Key 5: signed, sent, burned[\s\S]*A wallet on another device sent approval 5/, 30000), "this browser sees approval 5 land by itself, and says who sent it");
  check(/#5[\s\S]*landed/.test(await page.locator("#history").innerText()), "history: approval 5 landed, with the other browser's transaction");
  await ctx2.close();
  await page.evaluate(() => localStorage.removeItem("e2e.nowallet"));

  // 10. the page reaches only this folder and the RPC
  const reach = await page.evaluate(() => fetch("https://example.com/").then(() => "reached", () => "blocked"));
  check(reach === "blocked" && csp.some((m) => /example\.com/.test(m)), "the CSP refuses any other host");
  await page.setViewportSize({ width: 390, height: 900 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 390), "a phone-width screen has no sideways scroll");
  await shot("7-phone");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join("; ") : ""}`);
} catch (e) {
  fails++;
  console.log("FAIL ", e.message);
  await shot("failure").catch(() => {});
} finally {
  await browser.close();
  server.close();
  chain.stop();
}
console.log(fails ? `FAILED: ${fails}` : "all pass");
process.exit(fails ? 1 : 0);
