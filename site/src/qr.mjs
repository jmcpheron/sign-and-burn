// QR codes, for showing a link to another device's camera. Written here rather than taken from a
// package (ISO/IEC 18004). The structure and the tables follow Project Nayuki's QR Code generator,
// Copyright (c) Project Nayuki, MIT (https://www.nayuki.io/page/qr-code-generator-library; NOTICE). It encodes
// text in byte mode or alphanumeric mode, or both in one code, at a fixed error correction level,
// in the smallest version that holds it. site/test.mjs checks it module for module against an
// independent encoder (site/qr-vectors.json, made by tools/qr-vectors.py).
//
//   encode([{ mode: "byte" | "alnum", text }], { ecl: "L", mask }) -> { version, mask, size, modules }
//   modules[y][x] is true for a dark module. null if the text doesn't fit in version 40.

const ECL = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = [1, 0, 3, 2];   // L, M, Q, H as the format information writes them
// Per version (index 1-40) and level: error correction codewords per block, and the number of blocks.
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
export const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const MODES = { byte: { bits: 0b0100, count: [8, 16, 16] }, alnum: { bits: 0b0010, count: [9, 11, 13] } };

const rawModules = (v) => {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const align = Math.floor(v / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (v >= 7) n -= 36;
  }
  return n;
};
const dataCodewords = (v, e) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[e][v] * BLOCKS[e][v];

/** A segment's data bits, as an array of 0/1. */
function segmentBits(seg) {
  const out = [], put = (val, len) => { for (let i = len - 1; i >= 0; i--) out.push((val >>> i) & 1); };
  if (seg.mode === "byte") {
    for (const b of new TextEncoder().encode(seg.text)) put(b, 8);
    return { bits: out, count: new TextEncoder().encode(seg.text).length };
  }
  const t = seg.text;
  for (let i = 0; i < t.length; i += 2) {
    const a = ALNUM.indexOf(t[i]);
    if (a < 0) throw new Error(`not alphanumeric: ${JSON.stringify(t[i])}`);
    if (i + 1 < t.length) {
      const b = ALNUM.indexOf(t[i + 1]);
      if (b < 0) throw new Error(`not alphanumeric: ${JSON.stringify(t[i + 1])}`);
      put(a * 45 + b, 11);
    } else put(a, 6);
  }
  return { bits: out, count: t.length };
}

// ----------------------------------------------------------------------------- Reed-Solomon, GF(256)
function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisor(degree) {
  const r = Array(degree - 1).fill(0).concat([1]);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = mul(root, 0x02);
  }
  return r;
}
function remainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => { r[i] ^= mul(c, f); });
  }
  return r;
}

// ----------------------------------------------------------------------------- the code
export function encode(segments, { ecl = "L", mask = -1 } = {}) {
  const e = ECL[ecl];
  const parts = segments.map((s) => ({ ...segmentBits(s), mode: MODES[s.mode] }));
  let version = 0, bits = null;
  for (let v = 1; v <= 40; v++) {
    const cc = Math.floor((v + 7) / 17);
    if (parts.some((p) => p.count >= 1 << p.mode.count[cc])) continue;
    const total = parts.reduce((n, p) => n + 4 + p.mode.count[cc] + p.bits.length, 0);
    if (total <= dataCodewords(v, e) * 8) { version = v; break; }
  }
  if (!version) return null;
  const cc = Math.floor((version + 7) / 17), cap = dataCodewords(version, e) * 8;
  bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  for (const p of parts) { put(p.mode.bits, 4); put(p.count, p.mode.count[cc]); bits.push(...p.bits); }
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Split into blocks, add each block's error correction, and interleave.
  const nBlocks = BLOCKS[e][version], eccLen = ECC_PER_BLOCK[e][version], raw = Math.floor(rawModules(version) / 8);
  const nShort = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks), div = divisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = remainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) codewords.push(b[i]); });
  }

  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => Array(size).fill(false));
  const fn = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
  // timing, finders, alignment, then format and version areas
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (x, y) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = [];
  if (version > 1) {
    const n = Math.floor(version / 7) + 2, step = Math.floor((version * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    for (let pos = size - 7; align.length < n - 1; pos -= step) align.unshift(pos);
    align.unshift(6);
  }
  align.forEach((ay, i) => align.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const format = (mk) => {
    const d = (FORMAT_BITS[e] << 3) | mk;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (version >= 7) {
    let r = version;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (version << 12) | r;
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, dark); set(c, a, dark);
    }
  }
  // the data, in the zigzag
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const flip = (mk) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue;
      const inv = [(x + y) % 2, y % 2, x % 3, (x + y) % 3, (Math.floor(x / 3) + Math.floor(y / 2)) % 2,
        ((x * y) % 2) + ((x * y) % 3), (((x * y) % 2) + ((x * y) % 3)) % 2, (((x + y) % 2) + ((x * y) % 3)) % 2][mk] === 0;
      if (inv) m[y][x] = !m[y][x];
    }
  };
  if (mask < 0) {
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      flip(k); format(k);
      const p = penalty(m, size);
      if (p < best) { best = p; mask = k; }
      flip(k);
    }
  }
  flip(mask); format(mask);
  return { version, mask, size, modules: m };
}

/** ISO 18004's penalty: runs, 2×2 blocks, finder-like patterns, and the balance of dark and light. */
function penalty(m, size) {
  let score = 0;
  const lines = (get) => {
    for (let a = 0; a < size; a++) {
      let color = false, run = 0;
      const hist = [0, 0, 0, 0, 0, 0, 0];
      const add = (len) => { if (hist[0] === 0) len += size; hist.pop(); hist.unshift(len); };
      const count = () => {
        const n = hist[1], core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
        return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
      };
      for (let b = 0; b < size; b++) {
        if (get(a, b) === color) {
          run++;
          if (run === 5) score += 3; else if (run > 5) score++;
        } else {
          add(run);
          if (!color) score += count() * 40;
          color = get(a, b); run = 1;
        }
      }
      if (color) { add(run); run = 0; }
      run += size;
      add(run);
      score += count() * 40;
    }
  };
  lines((y, x) => m[y][x]);
  lines((x, y) => m[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (m[y][x]) dark++;
    if (y < size - 1 && x < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}
