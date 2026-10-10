// Your names for addresses: Safes, seats, wallets. Kept in this browser ("sab.names"), and moved
// between browsers as a JSON file (sign-and-burn/address-book/v1). They are the page's labels only:
// the console never sees them, and wherever a name is shown, so is the address. A file someone sends
// you is untrusted text: every entry is checked, a bad file is refused whole, and names are drawn as
// text, never as HTML.
//   { "tag": "sign-and-burn/address-book/v1", "chain": 84532, "names": { "0x…": "My phone's seat" } }
export const BOOK_TAG = "sign-and-burn/address-book/v1";
const KEY = "sab.names";
export const MAX_NAME = 40, MAX_ENTRIES = 500;

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY))?.names || {}; } catch { cache = {}; }
  return cache;
}
function save(chain, names) {
  cache = names;
  try { localStorage.setItem(KEY, JSON.stringify({ tag: BOOK_TAG, chain, names })); } catch {}
}
try { addEventListener("storage", (e) => { if (e.key === KEY) cache = null; }); } catch {}

export const nameOf = (a) => (a ? load()[a.toLowerCase()] || "" : "");
export const all = () => ({ ...load() });

/** A name as you typed it: trimmed, 1 to MAX_NAME characters, nothing invisible. -> it, or why not. */
export function cleanName(s) {
  const t = String(s ?? "").trim();
  if (!t) return { why: "A name can't be empty." };
  if ([...t].length > MAX_NAME) return { why: `A name has at most ${MAX_NAME} characters.` };
  // Control characters, and the invisible ones that turn text around or hide in it (direction
  // overrides, zero-width), which could make a name read as something else.
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/.test(t)) return { why: "A name can't have control or invisible characters." };
  return { name: t };
}

export function setName(chain, a, name) {
  const names = all();
  if (name) names[a.toLowerCase()] = name; else delete names[a.toLowerCase()];
  save(chain, names);
}

export const exportBook = (chain) => JSON.stringify({ tag: BOOK_TAG, chain, names: all() }, null, 2) + "\n";

/** A file's text -> { names } if every entry checks out, else throws, in plain words. Pure. */
export function parseBook(text, chain) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error("That isn't JSON."); }
  if (!o || typeof o !== "object" || o.tag !== BOOK_TAG) throw new Error(`That isn't a Sign and Burn address book (${BOOK_TAG}).`);
  if (o.chain !== chain) throw new Error(`That address book is for chain ${String(o.chain).slice(0, 12)}, not this one (${chain}).`);
  if (!o.names || typeof o.names !== "object" || Array.isArray(o.names)) throw new Error("That address book has no names.");
  const entries = Object.entries(o.names);
  if (entries.length > MAX_ENTRIES) throw new Error(`That address book has more than ${MAX_ENTRIES} names.`);
  const names = {};
  for (const [a, n] of entries) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`"${String(a).slice(0, 44)}" isn't an address. Nothing was imported.`);
    const c = cleanName(n);
    if (c.why || typeof n !== "string") throw new Error(`The name for ${a.slice(0, 10)}…: ${c.why || "not text."} Nothing was imported.`);
    names[a.toLowerCase()] = c.name;
  }
  return { names };
}

/** Import a file's text: its names are added, and replace yours for the same addresses.
 * -> { added, replaced } */
export function importBook(text, chain) {
  const { names } = parseBook(text, chain), mine = all();
  let added = 0, replaced = 0;
  for (const [a, n] of Object.entries(names)) {
    if (!(a in mine)) added++; else if (mine[a] !== n) replaced++;
    mine[a] = n;
  }
  save(chain, mine);
  return { added, replaced };
}
