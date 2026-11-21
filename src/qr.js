// A small QR code encoder, ISO/IEC 18004, for the join link on the organizer page.
// Byte and numeric mode, versions 1 to 10, all four error correction levels, all eight
// masks. Checked against the spec's test vectors in tests/qr.mjs.

// Per version and level: [error correction codewords per block, ...[block count, data codewords]].
const BLOCKS = {
  L: [[7, [1, 19]], [10, [1, 34]], [15, [1, 55]], [20, [1, 80]], [26, [1, 108]], [18, [2, 68]], [20, [2, 78]], [24, [2, 97]], [30, [2, 116]], [18, [2, 68], [2, 69]]],
  M: [[10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]], [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]],
  Q: [[13, [1, 13]], [22, [1, 22]], [18, [2, 17]], [26, [2, 24]], [18, [2, 15], [2, 16]], [24, [4, 19]], [18, [2, 14], [4, 15]], [22, [4, 18], [2, 19]], [20, [4, 16], [4, 17]], [24, [6, 19], [2, 20]]],
  H: [[17, [1, 9]], [28, [1, 16]], [22, [2, 13]], [16, [4, 9]], [22, [2, 11], [2, 12]], [28, [4, 15]], [26, [4, 13], [1, 14]], [26, [4, 14], [2, 15]], [24, [4, 12], [4, 13]], [28, [6, 15], [2, 16]]],
};
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
export const MAX_VERSION = 10;

// ---- Reed-Solomon over GF(256), x^8 + x^4 + x^3 + x^2 + 1 --------------------------------

function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Generator polynomial coefficients for `degree` codewords, highest power first, leading 1 left out. */
export function rsGenerator(degree) {
  const g = new Array(degree).fill(0);
  g[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      g[j] = mul(g[j], root);
      if (j + 1 < degree) g[j] ^= g[j + 1];
    }
    root = mul(root, 2);
  }
  return g;
}

export function rsRemainder(data, degree) {
  const g = rsGenerator(degree);
  const out = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    for (let i = 0; i < degree; i++) out[i] ^= mul(g[i], factor);
  }
  return out;
}

// ---- format and version information -----------------------------------------------------

/** 15 bits: level and mask, BCH(15,5), then the fixed XOR mask. */
export function formatBits(level, mask) {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18 bits for versions 7 and up: the version, then BCH(18,6). */
export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ---- data -------------------------------------------------------------------------------

const blocksFor = (version, level) => {
  const [ec, ...groups] = BLOCKS[level][version - 1];
  return { ec, sizes: groups.flatMap(([count, size]) => new Array(count).fill(size)) };
};
export const dataCapacity = (version, level) => blocksFor(version, level).sizes.reduce((a, b) => a + b, 0);

function segment(text, version) {
  const bits = [];
  const put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  if (/^[0-9]*$/.test(text)) {
    put(1, 4);
    put(text.length, version < 10 ? 10 : 12);
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      put(Number(chunk), chunk.length * 3 + 1);
    }
  } else {
    const bytes = new TextEncoder().encode(text);
    put(4, 4);
    put(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
  }
  return bits;
}

/** The data codewords for one version and level, padded, or null if the text does not fit. */
export function dataCodewords(text, version, level) {
  const capacity = dataCapacity(version, level) * 8;
  const bits = segment(text, version);
  if (bits.length > capacity) return null;
  bits.push(...new Array(Math.min(4, capacity - bits.length)).fill(0));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Split into blocks, add error correction to each, and interleave. */
export function allCodewords(data, version, level) {
  const { ec, sizes } = blocksFor(version, level);
  const blocks = [];
  let at = 0;
  for (const size of sizes) {
    const d = data.slice(at, at + size);
    at += size;
    blocks.push({ d, e: rsRemainder(d, ec) });
  }
  const out = [];
  for (let i = 0; i < Math.max(...sizes); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// ---- the symbol -------------------------------------------------------------------------

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function frame(version) {
  const size = version * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, on) => { dark[y][x] = on; fixed[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const pos = ALIGN[version - 1];
  const last = pos.length - 1;
  for (const [i, cy] of pos.entries()) {
    for (const [j, cx] of pos.entries()) {
      // The three corners overlap finder patterns. The ones on the timing lines still count.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // Reserve the format areas now, fill them once the mask is chosen.
  for (let i = 0; i < 9; i++) if (i !== 6) { set(8, i, false); set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const on = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, on);
      set(b, a, on);
    }
  }
  return { size, dark, fixed };
}

function drawFormat({ size, dark }, level, mask) {
  const bits = formatBits(level, mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) dark[i][8] = bit(i);
  dark[7][8] = bit(6);
  dark[8][8] = bit(7);
  dark[8][7] = bit(8);
  for (let i = 9; i < 15; i++) dark[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) dark[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) dark[size - 15 + i][8] = bit(i);
  dark[size - 8][8] = true;
}

function place({ size, dark, fixed }, codewords) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (fixed[y][x] || i >= codewords.length * 8) continue;
        dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

/** The spec's four penalty rules. Lower is easier to read. */
export function penalty(dark) {
  const size = dark.length;
  let score = 0;
  const lines = [...dark, ...dark.map((_, x) => dark.map((row) => row[x]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) { run++; continue; }
      if (run >= 5) score += run - 2;
      run = 1;
    }
    const s = line.map((d) => (d ? 1 : 0)).join('');
    const padded = `0000${s}0000`;
    for (const p of ['10111010000', '00001011101']) {
      for (let at = padded.indexOf(p); at >= 0; at = padded.indexOf(p, at + 1)) score += 40;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = dark[y][x];
      if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3;
    }
  }
  const darkCount = dark.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((darkCount * 20) / (size * size) - 10)) * 10;
  return score;
}

/** The smallest symbol that fits `text`, with the mask the penalty rules prefer. */
export function encode(text, { level = 'M' } = {}) {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const data = dataCodewords(text, version, level);
    if (!data) continue;
    const codewords = allCodewords(data, version, level);
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const sym = frame(version);
      place(sym, codewords);
      for (let y = 0; y < sym.size; y++) for (let x = 0; x < sym.size; x++) if (!sym.fixed[y][x] && MASKS[mask](x, y)) sym.dark[y][x] = !sym.dark[y][x];
      drawFormat(sym, level, mask);
      const score = penalty(sym.dark);
      if (!best || score < best.score) best = { version, level, mask, score, size: sym.size, modules: sym.dark };
    }
    return best;
  }
  throw new Error(`That is too long for a version ${MAX_VERSION} QR code.`);
}

/** An SVG of the symbol with the 4-module quiet zone the spec asks for. */
export function toSvg({ size, modules }, label = 'QR code') {
  const n = size + 8;
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + 4},${y + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
