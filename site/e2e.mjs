#!/usr/bin/env node
// The whole page in Chromium, against the local chain (tools/chain/anvil.mjs: Base Sepolia's Safe,
// passkey signer and Multicall3 at their own addresses, chain 31337). A virtual authenticator with
// PRF plays the passkey; a stand-in wallet (Anvil's first account) pays the gas. It checks, on chain:
//   make a passkey → key 0 → build the shielded Safe (deploying the SeatFactory too) → fund it →
//   two presses, each burning a key and running the Safe transaction → every attack refused →
//   the console's refusals and red page → the guardrail: a wallet that says no, then the same
//   approval sent again with no new signature → the danger case → the CSP refuses other hosts →
//   a reload keeps the ledger.
//   cd site && npm ci && node e2e.mjs        (Chromium: SAB_CHROMIUM=/path/to/chrome if playwright-core has none)
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { startChain } from "../tools/chain/anvil.mjs";

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
// another wallet that refuses everything, so the page has to let the visitor choose.
const ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", SECOND = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const wallet = { refuseNext: false, sent: 0, account: ACCOUNT };
async function walletRpc(method, params) {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return { result: [wallet.account] };
  if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return { result: null };
  if (method === "eth_sendTransaction" && wallet.refuseNext) { wallet.refuseNext = false; return { error: { code: 4001, message: "User rejected the request." } }; }
  if (method === "eth_sendTransaction") wallet.sent++;
  const r = await (await fetch(chain.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  return r.error ? { error: { code: r.error.code, message: r.error.message } } : { result: r.result };
}

const browser = await chromium.launch({ executablePath: process.env.SAB_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
await ctx.exposeFunction("__e2eWallet", walletRpc);
await ctx.addInitScript(() => {
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
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: otherInfo, provider: other }) }));
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  });
});
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
const waitFor = (re, timeout = 30000) => page.waitForFunction((s) => new RegExp(s).test([...document.querySelectorAll("#screen > :not(.steps-bar)")]
  .map((e) => e.innerText).join("\n")), re.source, { timeout })
  .then(() => true, async () => { console.log("  screen said:", (await screen()).slice(0, 600)); return false; });
const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
const click = (name) => page.getByRole("button", { name }).first().click();
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

  // 2. a passkey, and key 0 from its PRF
  await click("Make a passkey");
  check(await waitFor(/Tap to make key 0/), "a passkey for this site; its signer address worked out by the console and checked against the factory");
  await click("Tap to make key 0");
  check(await waitFor(/Build your shielded Safe/), "one tap: the PRF gives seed 0, the console gives key 0's fingerprint, and the addresses are known before anything exists");
  await shot("2-build");

  // 3. the shielded Safe, in one transaction: SeatFactory (first time on this chain), signer, seat, Safe
  await click("Connect a wallet");
  await page.locator(".chooser").waitFor();
  const names = await page.locator(".chooser .actions button").allInnerTexts();
  check(names.includes("Test wallet (Anvil)") && names.includes("Another wallet"), "two wallets in the browser: the page lets you choose");
  await click("Test wallet (Anvil)");
  await page.getByRole("button", { name: "Build it: one transaction" }).waitFor();
  await click("Build it: one transaction");
  check(await waitFor(/Fund it/, 60000), "one wallet transaction builds the shielded Safe");
  const H = await home();
  const owners = await pc.readContract({ address: H.safe, abi: SAFE_ABI, functionName: "getOwners" });
  check(owners.length === 1 && owners[0].toLowerCase() === H.seat.toLowerCase(), "on chain: a Safe whose one owner is the seat");
  check((await pc.readContract({ address: H.seat, abi: SEAT_ABI, functionName: "current" })) === H.firstKey, "on chain: the seat holds key 0's fingerprint and nothing else");
  await click("Send 0.001 test ETH from my wallet");
  check(await waitFor(/Press the button/), "funded");

  // 4. two presses
  const TO = "0x00000000000000000000000000000000000b0b01";
  await page.locator("#screen input.mono").fill(TO);
  check(await waitFor(/Send 0\.0001 ETH/), "the console says what the transaction does, and the hash it worked out");
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

  // 8. the page reaches only this folder and the RPC
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
