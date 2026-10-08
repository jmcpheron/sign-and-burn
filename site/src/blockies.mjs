// Blockies identicons (github.com/ethereum/blockies), the same picture Etherscan, MetaMask, Safe{Wallet}
// and the console (firmware/blockies.py) draw for an address: the seed is the address in lower case.
// An owner, a Safe or a contract you have seen before looks the same everywhere.
//
// The reference mixes 32-bit int ops with plain Numbers, and its rand() returns [0, 2), not [0, 1).
// Every quirk is kept: the hue can pass 359 (it wraps), saturation and lightness can pass 100 (they
// clamp), and a cell is the colour when its value is 1 and the spot colour when it's 2 or more.

function seeded(seed) {
  const rs = [0, 0, 0, 0];
  for (let i = 0; i < seed.length; i++) rs[i % 4] = ((rs[i % 4] << 5) - rs[i % 4]) + seed.charCodeAt(i);
  return () => {
    const t = rs[0] ^ (rs[0] << 11);
    rs[0] = rs[1]; rs[1] = rs[2]; rs[2] = rs[3];
    rs[3] = rs[3] ^ (rs[3] >> 19) ^ t ^ (t >> 8);
    return (rs[3] >>> 0) / ((1 << 31) >>> 0);
  };
}

const hsl = (rand) => [Math.floor(rand() * 360), rand() * 60 + 40, (rand() + rand() + rand() + rand()) * 25];

// CSS hsl(): the hue wraps, saturation and lightness clamp. firmware/blockies.py hsl_to_rgb, in JS.
export function rgb([h, s, l]) {
  h %= 360; s = Math.min(Math.max(s, 0), 100) / 100; l = Math.min(Math.max(l, 0), 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = h / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

// The reference's buildOpts + createImageData: 64 cells row by row (0 background, 1 colour, 2+ spot),
// and the three colours as [h, s, l].
export function blockie(seed, size = 8) {
  const rand = seeded(seed);
  const color = hsl(rand), bg = hsl(rand), spot = hsl(rand);
  const half = Math.ceil(size / 2), data = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < half; x++) row.push(Math.floor(rand() * 2.3));
    data.push(...row, ...row.slice(0, size - half).reverse());
  }
  return { data, color, bg, spot };
}

// An SVG data URL for an address (the page's CSP allows data: images), one path per colour, cached.
const cache = new Map();
export function blockieSrc(address) {
  const seed = address.toLowerCase();
  let src = cache.get(seed);
  if (src) return src;
  const { data, color, bg, spot } = blockie(seed);
  const hex = (c) => "#" + rgb(c).map((v) => v.toString(16).padStart(2, "0")).join("");
  const d = ["", ""];
  data.forEach((v, i) => { if (v) d[v === 1 ? 0 : 1] += `M${i % 8} ${i >> 3}h1v1h-1z`; });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">` +
    `<path fill="${hex(bg)}" d="M0 0h8v8H0z"/><path fill="${hex(color)}" d="${d[0]}"/><path fill="${hex(spot)}" d="${d[1]}"/></svg>`;
  src = "data:image/svg+xml," + encodeURIComponent(svg);
  cache.set(seed, src);
  return src;
}
