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
//   with no wallet goes out as a link, and the other browser sends it → the wallet page: the wallet
//   added as a second owner, 1 of 2 and 2 of 2, the guardrail when the wallet's own transaction gets
//   ahead of an approval the seat signed, the owner removed again → the CSP refuses other hosts → a
//   reload keeps the ledger. Before all that, the explainers in "How it works".
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
const wallet = { refuseNext: false, frontRun: false, frontRunHash: "", sent: 0, account: ACCOUNT };
const rpc = async (method, params) => (await (await fetch(chain.url, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json());
async function walletRpc(method, params) {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return { result: [wallet.account] };
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
async function hold(ms = 2400, on = page) {
  const btn = on.locator("button.hold");
  await btn.scrollIntoViewIfNeeded();
  const box = await btn.boundingBox();
  await on.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await on.mouse.down();
  await on.waitForTimeout(ms);
  await on.mouse.up();
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
  await click("Show QR code");
  check((await page.locator(".qr canvas").getAttribute("data-text")) === link, "Show QR code: the same link, as a QR code");

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
  // the same seat, in a browser that has lost its record of it: built and unused, the seat proves
  // nothing on chain, so the page takes it only after a tap shows its first key is this passkey's
  const saved = await page.evaluate(() => localStorage.getItem("sab.home"));
  await page.evaluate(() => localStorage.removeItem("sab.home"));
  await page.reload();
  check(await waitFor(/Tap to make key 0/), "a browser with no record of an unused seat doesn't take it from seatsOf on trust");
  await click("Tap to make key 0");
  check(await waitFor(/Your Safe is built, and empty/) && (await home()).seat.toLowerCase() === H.seat.toLowerCase(),
    "…one tap shows the seat's first key is this passkey's, and the page finds it");
  await page.evaluate((h) => localStorage.setItem("sab.home", h), saved);
  await page.reload();
  await waitFor(/Your Safe is built, and empty/);
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
  // A stranger first adds two seats nobody can sign for to this passkey's list, as anyone may (the
  // baseline review's H-1): the newest seats in seatsOf are theirs, not this passkey's.
  for (const junk of ["0x" + "11".repeat(32), "0x" + "22".repeat(32)]) {
    const r = await rpc("eth_sendTransaction", [{ from: THIRD, to: dep.SeatFactory.address, gas: "0x" + (5000000).toString(16),
      data: encodeFunctionData({ abi: dep.abi.SeatFactory, functionName: "createSeat", args: [signer, 7, junk] }) }]);
    await pc.waitForTransactionReceipt({ hash: r.result });
  }
  await page.evaluate(() => { localStorage.removeItem("sab.ledger"); localStorage.removeItem("sab.home"); });
  await page.reload();
  check(await waitFor(/Another device made this seat/), "a browser with no ledger finds the seat on chain, and is told another device's console holds its record");
  check((await home()).seat.toLowerCase() === H.seat.toLowerCase(), "…the seat this passkey signed for, not the strangers' newer seats in seatsOf");
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
  // The link is too long for one QR code; the code carries the approval's compact form (#aq=).
  if (!(await page.locator(".qr canvas").count())) await click("Show QR code");
  const qrText = await page.locator(".qr canvas").getAttribute("data-text");
  await page.locator(".qr canvas").screenshot({ path: join(SHOTS, "qr-approval.png") });
  check(qrText.startsWith(URL_ + "#aq=") && /^[0-9A-Z$*+\-./:]+$/.test(qrText.split("#aq=")[1]), "its QR code: the approval in compact form, this page's address then base 43");
  const tampered = new URLSearchParams(new URL(alink).hash.slice(1));
  tampered.set("next", "0x" + "ab".repeat(32));
  await payer.goto(URL_ + "#" + tampered);
  check(await waitFor(/The seat would refuse this approval \(Bad/, 30000, payer) && !(await payer.getByRole("button", { name: "Send it: one transaction" }).count()),
    "the other browser: the link with another next key, and the seat would refuse it; no button");
  await payer.goto(qrText);
  check(await waitFor(/Send approval 5[\s\S]*The seat accepts it/, 30000, payer) && (await payer.locator("#screen .verify .code").innerText()) === code,
    "the compact form, opened as a phone's camera would: the same approval, the same check code, and the seat accepts it");
  await payer.goto(URL_);
  await payer.locator(".payment-request summary").click();
  await payer.locator("#pay-request-link").fill(alink);
  await click("Review request", payer);
  check(await waitFor(/Send approval 5[\s\S]*The seat accepts it/, 30000, payer) && (await payer.locator("#screen .verify .code").innerText()) === code,
    "the real link: the seat accepts it, and the hash worked out there shows the code this browser shows");
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

  // 9c. the wallet page: the same Safe, its owners, and the wallet in this browser as a second owner. It
  // shares this browser's passkey, home and ledger with the main page.
  const SAFE_OWNERS_ABI = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)", "function nonce() view returns (uint256)",
    "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)"]);
  const onChain = async () => ({ n: Number(await pc.readContract({ address: H.seat, abi: SEAT_ABI, functionName: "n" })),
    nonce: Number(await pc.readContract({ address: H.safe, abi: SAFE_OWNERS_ABI, functionName: "nonce" })),
    owners: (await pc.readContract({ address: H.safe, abi: SAFE_OWNERS_ABI, functionName: "getOwners" })).map((o) => o.toLowerCase()),
    threshold: Number(await pc.readContract({ address: H.safe, abi: SAFE_OWNERS_ABI, functionName: "getThreshold" })) });
  const wsaid = (on) => on.evaluate(() => document.querySelector("main").innerText);
  const see = (re, timeout = 30000, on = page) => on.waitForFunction(([s, f]) => new RegExp(s, f).test(document.querySelector("main").innerText), [re.source, re.flags], { timeout })
    .then(() => true, async () => { console.log("  page said:", (await wsaid(on)).slice(0, 900)); return false; });
  const inCard = (id, name) => page.locator(id).getByRole("button", { name, exact: true }).click();
  const ME = wallet.account;
  await page.goto(URL_ + "wallet.html");
  const start = await onChain();
  check(await see(/your shielded safe[\s\S]*1 of 1 to approve[\s\S]*Every owner is a seat[\s\S]*No backup if your passkey is lost/i) && await see(new RegExp(`seat at key ${start.n}`)),
    "the wallet page: the main page's Safe, its balance and its one owner, the seat");
  check(await see(/pays gas only/), "…and the wallet in this browser, which pays gas only");
  await shot("9-wallet");

  // a. the wallet becomes a second owner, 1 of 2: a red transaction, approved by the seat with one press
  await inCard("#owners", "Use my wallet's address");
  await inCard("#owners .owner-add", "Review");
  check(await see(/Approve: Add owner[\s\S]*ADD OWNER/) && await page.locator("#act.red").count() === 1 && await page.locator("button.hold").isDisabled(),
    "adding the wallet as an owner: the console's red page, and holding waits for the box");
  await page.getByLabel("I read the red page").check();
  before = await signCount();
  await hold();
  check(await see(new RegExp(`Key ${start.n}: signed, sent, burned\\. The Safe ran it`), 60000) && (await signCount()) === before + 1, "one press: the seat approves it, and the Safe runs it");
  let now = await onChain();
  check(now.owners.length === 2 && now.owners.includes(ME) && now.threshold === 1, "on chain: two owners, the seat and the wallet, 1 of 2");
  check(await see(/1 of 2 to approve[\s\S]*Ordinary keys can approve without a seat[\s\S]*A backup if your passkey is lost/) && await see(/this wallet[\s\S]*Ordinary key|Ordinary key[\s\S]*this wallet/),
    "the page says the wallet can approve without a seat: a backup, and a way around the seat");
  check(await see(/Sent \d+ transactions?\. Its public key is on chain/), "…and that the wallet's public key is already on chain");
  await shot("9-wallet-1of2");

  // b. 1 of 2: the wallet sends on its own key. No passkey, no one-time key
  const TO3 = "0x00000000000000000000000000000000000b0b03";
  await page.locator("#send-to").fill(TO3);
  await page.locator("#send-amount").fill("0.0001");
  await inCard("#send", "Review");
  check(await see(/Approve: Send 0\.0001 ETH[\s\S]*Votes: 0 of 1/) && await page.getByRole("button", { name: "Run it with my wallet" }).count() === 1,
    "a send in a 1 of 2: the console reviews it, and the wallet may run it alone");
  before = await signCount();
  await page.getByRole("button", { name: "Run it with my wallet" }).click();
  check(await see(/Your wallet ran it/, 60000), "the wallet runs it, with its own key as its vote");
  now = await onChain();
  check(now.nonce === start.nonce + 2 && now.n === start.n + 1 && (await signCount()) === before && formatEther(await pc.getBalance({ address: TO3 })) === "0.0001",
    "on chain: the Safe ran it; the seat and the passkey did nothing");

  // c. the guardrail across both kinds of owner: key n signs, the wallet refuses to send it, and the
  // wallet's own key then runs another transaction at the same nonce. Key n's approval is overtaken,
  // yet it is still the only thing key n may send: the page sends it, and it runs nothing.
  const k = now.n;
  await page.locator("#send-to").fill(TO3);
  await inCard("#send", "Review");
  await see(/Approve: Send 0\.0001 ETH/);
  wallet.refuseNext = true;
  before = await signCount();
  await hold();
  check(await see(/wallet said no/) && (await signCount()) === before + 1, `the wallet refuses to send approval ${k}, after the passkey signed it`);
  check(await see(new RegExp(`Key ${k} already signed this approval`)) && !(await page.locator("#act").getByRole("button", { name: /^Reject/ }).count()) &&
    !(await page.getByRole("button", { name: "Run it with my wallet" }).count()), `…the card keeps it: no reject, no other vote, only approval ${k} again`);
  const rejection = encodeFunctionData({ abi: SAFE_OWNERS_ABI, functionName: "execTransaction",
    args: [H.safe, 0n, "0x", 0, 0n, 0n, 0n, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", concat(["0x" + ME.slice(2).padStart(64, "0"), "0x" + "00".repeat(32), "0x01"])] });
  const r = await rpc("eth_sendTransaction", [{ from: ME, to: H.safe, data: rejection, gas: "0x" + (300000).toString(16) }]);
  await pc.waitForTransactionReceipt({ hash: r.result });
  await page.reload();
  check(await see(new RegExp(`Overtaken[\\s\\S]*this approval is the only thing key ${k} will ever send`)), "the wallet's own transaction overtakes it: the page says so, and still offers only that approval");
  before = await signCount();
  const nonceNow = (await onChain()).nonce;
  await hold();
  check(await see(new RegExp(`Key ${k}: signed, sent, burned\\. The Safe had moved past this transaction`), 60000), "sent: it lands, and runs nothing");
  now = await onChain();
  check(now.n === k + 1 && now.nonce === nonceNow && (await signCount()) === before, `on chain: the seat is at key ${k + 1}, the Safe ran nothing, and key ${k} signed once, ever`);

  // d. 2 of 2, decided by the wallet alone while it still can
  await page.locator("#threshold").selectOption("2");
  await inCard("#owners .threshold-row", "Review");
  check(await see(/THRESHOLD[\s\S]*Approvals needed: 2/) && await page.getByRole("button", { name: "Run it with my wallet" }).isDisabled(), "2 of 2: red, and the wallet's button waits for the box too");
  await page.getByLabel("I read the red page").check();
  await page.getByRole("button", { name: "Run it with my wallet" }).click();
  check(await see(/2 of 2 to approve[\s\S]*Every approval needs a seat[\s\S]*No backup if your passkey is lost/, 60000) && (await onChain()).threshold === 2, "on chain: 2 of 2, and the page says every approval needs the seat");
  await shot("9-wallet-2of2");

  // e. 2 of 2, the seat first: its vote lands, the Safe waits; then the wallet's vote runs it
  const nonce2 = (await onChain()).nonce;
  await page.locator("#send-to").fill(TO3);
  await inCard("#send", "Review");
  await see(/Votes: 0 of 2/);
  check(!(await page.getByRole("button", { name: "Run it with my wallet" }).count()) && await page.getByRole("button", { name: "Approve with my wallet" }).count() === 1,
    "with no votes yet, the wallet's vote alone isn't enough: it approves, it doesn't run");
  before = await signCount();
  await hold();
  check(await see(/The seat's vote is on chain\. The Safe runs it once 2 owners have approved[\s\S]*Votes: 1 of 2/, 60000) && (await signCount()) === before + 1,
    "the seat votes with one press; the Safe waits for the second vote");
  now = await onChain();
  check(now.n === k + 2 && now.nonce === nonce2, "on chain: the seat's key moved on; the Safe hasn't run it");
  await page.reload();
  check(await see(/Votes: 1 of 2/), "after a reload: the transaction and its vote are still there");
  await page.getByRole("button", { name: "Run it with my wallet" }).click();
  check(await see(/Your wallet ran it/, 60000) && (await onChain()).nonce === nonce2 + 1 && formatEther(await pc.getBalance({ address: TO3 })) === "0.0002",
    "the wallet's vote makes two: it runs it");

  // f. remove the wallet, the wallet first: its vote waits on chain, and the seat's press runs it
  const n2 = (await onChain()).n;
  await page.locator(`#owners li.owner:has-text("this wallet")`).getByRole("button", { name: "Remove" }).click();
  check(await see(/REMOVE OWNER[\s\S]*Approvals needed becomes 1/), "removing the wallet: red, and approvals needed drops to 1");
  await page.getByLabel("I read the red page").check();
  await page.getByRole("button", { name: "Approve with my wallet" }).click();
  check(await see(/Your wallet's vote is on chain[\s\S]*Votes: 1 of 2/, 60000), "the wallet votes first, with approveHash");
  await page.getByLabel("I read the red page").check();
  before = await signCount();
  await hold();
  check(await see(new RegExp(`Key ${n2}: signed, sent, burned\\. The Safe ran it`), 60000) && (await signCount()) === before + 1, "then the seat's press carries both votes, and the Safe runs it");
  now = await onChain();
  check(now.owners.length === 1 && now.owners[0] === H.seat.toLowerCase() && now.threshold === 1 && now.n === n2 + 1, "on chain: the seat alone again, 1 of 1");

  // g. at phone width, with a transaction on the card; then reject is one press
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator("#send-to").fill(TO3);
  await inCard("#send", "Review");
  await see(/Approve: Send 0\.0001 ETH/);
  await page.locator("#act details summary").click();
  const wide = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 391)
    .map((e) => `${e.tagName.toLowerCase()}.${e.className}#${e.id}:${Math.round(e.getBoundingClientRect().right)}`).slice(0, 8));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 390), `the wallet page at phone width, a transaction open: no sideways scroll${wide.length ? ": " + wide.join(" ") : ""}`);
  await shot("9-wallet-phone");
  await inCard("#act", "Reject");
  check(await page.locator("#act").waitFor({ state: "hidden", timeout: 5000 }).then(() => true, () => false) && (await onChain()).n === n2 + 1, "Reject: one press, and nothing signed");
  const hist2 = await page.locator("#activity").innerText();
  check([k, k + 1, n2].every((x) => hist2.includes(`#${x}`)), "the seat's approvals from both pages, in one ledger");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.setViewportSize({ width: 1360, height: 1000 });

  // 9d. two seats. A second browser makes its own passkey, key 0 and shielded Safe; its own wallet pays
  // for the build, from the main page. The first Safe takes the second seat as an owner (1 of 2: every
  // owner a seat, and a backup), then the wallet (2 of 3). The wallet starts a send, a link carries it
  // to the second browser, and the second seat's press makes two votes: the Safe runs it.
  const ctx3 = await newBrowser();
  const second = await ctx3.newPage();
  second.on("pageerror", (e) => errors.push("second: " + e.message));
  const cdp3 = await ctx3.newCDPSession(second);
  await cdp3.send("WebAuthn.enable");
  const { authenticatorId: auth3 } = await cdp3.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true, hasPrf: true } });
  const signCount3 = async () => (await cdp3.send("WebAuthn.getCredentials", { authenticatorId: auth3 })).credentials[0]?.signCount ?? 0;
  await second.goto(URL_);
  await waitFor(/Make a passkey/, 30000, second);
  await click("Make a passkey", second);
  await waitFor(/Tap to make key 0/, 30000, second);
  await click("Tap to make key 0", second);
  await waitFor(/Build your shielded Safe/, 30000, second);
  await click("Connect a wallet", second);
  await second.locator(".chooser").waitFor();
  await click("Test wallet (Anvil)", second);
  await click("Build it: one transaction", second);
  check(await waitFor(/Your Safe is built, and empty/, 60000, second), "a second browser: its own passkey, key 0 and shielded Safe, built by the wallet in that browser");
  const H2 = Object.values(JSON.parse(await second.evaluate(() => localStorage.getItem("sab.home"))))[0];

  // a. the second seat joins the first Safe, 1 of 2
  let k2 = (await onChain()).n;
  await page.locator("#add-owner").fill(H2.seat);
  await page.locator("#add-threshold").selectOption("1");
  await inCard("#owners .owner-add", "Review");
  await see(/ADD OWNER/);
  await page.getByLabel("I read the red page").check();
  await hold();
  check(await see(new RegExp(`Key ${k2}: signed, sent, burned\\. The Safe ran it`), 60000), "the first seat adds the second as an owner: one press");
  check(await see(/1 of 2 to approve[\s\S]*Every approval needs a seat[\s\S]*A backup if your passkey is lost/) && await page.locator("#owners li.owner.seat").count() === 2 &&
    /Another passkey's seat/.test(await page.locator("#owners").innerText()),
    "two seats, 1 of 2: the page knows the other for a seat (the SeatFactory made it): every approval needs a seat, and there is a backup");

  // b. the wallet as a third owner, 2 of 3
  k2 = (await onChain()).n;
  await inCard("#owners", "Use my wallet's address");
  await page.locator("#add-threshold").selectOption("2");
  await inCard("#owners .owner-add", "Review");
  await see(/ADD OWNER[\s\S]*Approvals needed becomes 2/);
  await page.getByLabel("I read the red page").check();
  await hold();
  await see(new RegExp(`Key ${k2}: signed, sent, burned\\. The Safe ran it`), 60000);
  now = await onChain();
  check(now.owners.length === 3 && now.owners.includes(H2.seat.toLowerCase()) && now.owners.includes(ME) && now.threshold === 2, "on chain: two seats and the wallet, 2 of 3");
  check(await see(/2 of 3 to approve[\s\S]*Every approval needs a seat[\s\S]*A backup if your passkey is lost/), "2 of 3: the wallet can't approve alone, and either seat with the wallet still reaches 2");

  // c. the wallet starts a send, and asks the second seat by link
  const TO4 = "0x00000000000000000000000000000000000b0b04";
  await page.locator("#send-to").fill(TO4);
  await page.locator("#send-amount").fill("0.0001");
  await inCard("#send", "Review");
  await see(/Votes: 0 of 2/);
  await page.getByRole("button", { name: "Approve with my wallet" }).click();
  check(await see(/Your wallet's vote is on chain[\s\S]*Votes: 1 of 2/, 60000), "the wallet votes first");
  const code2 = await page.locator("#act .verify .code").innerText();
  await inCard("#act", "Copy link");
  const plink = await page.evaluate(() => window.__e2eCopied);
  check(plink.startsWith(URL_ + "wallet.html#propose=") && !plink.includes(code2), "the link to ask another owner: the wallet page and the transaction, no hash");
  const nonce4 = (await onChain()).nonce;
  await second.goto(plink);
  check(await see(/A Safe your seat is in[\s\S]*Votes: 1 of 2/i, 30000, second) && (await second.locator("#act .verify .code").innerText()) === code2,
    "the second browser opens it: the first Safe, the wallet's vote counted, and its own console shows the same check code");
  const before3 = await signCount3();
  await hold(2400, second);
  check(await see(/Key 0: signed, sent, burned\. The Safe ran it/, 60000, second) && (await signCount3()) === before3 + 1,
    "the second seat's press: one tap, key 0, and with the wallet's vote that makes two: the Safe runs it");
  check((await onChain()).nonce === nonce4 + 1 && formatEther(await pc.getBalance({ address: TO4 })) === "0.0001" &&
    Number(await pc.readContract({ address: H2.seat, abi: SEAT_ABI, functionName: "n" })) === 1, "on chain: the Safe ran it, and the second seat is at key 1");
  check(await page.locator("#act").waitFor({ state: "hidden", timeout: 15000 }).then(() => true, () => false), "the first browser sees it run, by itself");
  // d. a phone with no wallet, as on a real one: the second browser adds the first seat to its own
  // Safe, 1 of 2. Holding signs; nobody else is asked (its seat's vote is enough); the approval goes
  // out as a link, and the first browser's wallet sends it from the main page.
  await second.evaluate(() => localStorage.setItem("e2e.nowallet", "1"));
  await second.goto(URL_ + "wallet.html");
  await see(/your shielded safe[\s\S]*1 of 1 to approve/i, 30000, second);
  await second.locator("#add-owner").fill(H.seat);
  await second.locator("#owners .owner-add").getByRole("button", { name: "Review", exact: true }).click();
  check(await see(/ADD OWNER[\s\S]*No wallet here: you then share the approval as a link/, 30000, second) && !(await second.getByText(/Ask another owner/).count()),
    "a browser with no wallet, a 1 of 1: holding is offered, and no other owner is asked");
  await second.getByLabel("I read the red page").check();
  const b3 = await signCount3();
  await hold(2400, second);
  check(await see(/Approval 1 is signed\. Send it from another device/, 60000, second) && (await signCount3()) === b3 + 1, "…one tap: key 1 signs, and the approval waits, as a link");
  await second.locator("#act").getByRole("button", { name: "Copy link" }).click();
  const alink2 = await second.evaluate(() => window.__e2eCopied);
  check(alink2.startsWith(URL_ + "#pay="), "the link opens on the main page, where any wallet can send it");
  await page.goto(alink2);
  await waitFor(/Send approval 1[\s\S]*The seat accepts it/, 30000);
  await click("Send it: one transaction");
  check(await waitFor(/Sent\. Approval 1 landed[\s\S]*The Safe ran the transaction/, 60000), "the first browser's wallet sends it");
  const owners2 = (await pc.readContract({ address: H2.safe, abi: SAFE_OWNERS_ABI, functionName: "getOwners" })).map((o) => o.toLowerCase());
  check(owners2.length === 2 && owners2.includes(H.seat.toLowerCase()), "on chain: the second Safe has both seats");
  check(await second.locator("#act").waitFor({ state: "hidden", timeout: 15000 }).then(() => true, () => false) &&
    await see(/1 of 2 to approve[\s\S]*Every approval needs a seat[\s\S]*A backup if your passkey is lost/, 30000, second),
    "the second browser sees it land by itself: two seats, 1 of 2, and a backup");
  const listed = (await second.locator("#safes").innerText()).toLowerCase();
  check(listed.includes(H.safe.slice(-6).toLowerCase()) && listed.includes(H2.safe.slice(-6).toLowerCase()), "the second browser keeps both Safes its seat is in");
  await ctx3.close();

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
