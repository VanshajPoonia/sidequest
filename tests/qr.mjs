// The QR encoder against the spec's test vectors (ISO/IEC 18004). No model, milliseconds.
// scripts/qr-roundtrip.mjs reads whole symbols back with macOS CoreImage as a second check.
import assert from 'node:assert/strict';
import { encode, toSvg, rsGenerator, rsRemainder, dataCodewords, allCodewords, formatBits, versionBits, MAX_VERSION } from '../src/qr.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

// Generator polynomials are printed in the spec as powers of alpha.
const EXP = [];
for (let i = 0, x = 1; i < 255; i++, x = ((x << 1) ^ (x & 0x80 ? 0x11d : 0)) & 0xff) EXP.push(x);
const asPowers = (poly) => poly.map((c) => EXP.indexOf(c));

check('generator polynomials for 7 and 10 codewords', () => {
  assert.deepEqual(asPowers(rsGenerator(7)), [87, 229, 146, 149, 238, 102, 21]);
  assert.deepEqual(asPowers(rsGenerator(10)), [251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
});

check('the spec example: "01234567" as version 1-M', () => {
  const data = dataCodewords('01234567', 1, 'M');
  assert.deepEqual(data, [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17]);
  assert.deepEqual(rsRemainder(data, 10), [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  assert.deepEqual(allCodewords(data, 1, 'M').slice(16), [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
});

check('format information for every mask at L and M, and mask 0 at Q and H', () => {
  const bits = (level, mask) => formatBits(level, mask).toString(2).padStart(15, '0');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((m) => bits('L', m)), [
    '111011111000100', '111001011110011', '111110110101010', '111100010011101',
    '110011000101111', '110001100011000', '110110001000001', '110100101110110']);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((m) => bits('M', m)), [
    '101010000010010', '101000100100101', '101111001111100', '101101101001011',
    '100010111111001', '100000011001110', '100111110010111', '100101010100000']);
  assert.equal(bits('Q', 0), '011010101011111');
  assert.equal(bits('H', 0), '001011010001001');
});

check('version information for versions 7 to 10', () => {
  assert.deepEqual([7, 8, 9, 10].map((v) => versionBits(v).toString(2).padStart(18, '0')), [
    '000111110010010100', '001000010110111100', '001001101010011001', '001010010011010011']);
});

check('byte capacity at level M matches the spec table for versions 1 to 10', () => {
  const capacity = (v) => { let k = 0; while (dataCodewords('a'.repeat(k + 1), v, 'M')) k++; return k; };
  assert.deepEqual(Array.from({ length: MAX_VERSION }, (_, i) => capacity(i + 1)), [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
});

const at = (qr, x, y) => qr.modules[y][x];

check('a join link fits version 5-M, with finders, timing and the dark module in place', () => {
  const qr = encode('https://vanshajpoonia.github.io/sidequest/event.html#code=K7QM4D');
  assert.equal(qr.version, 5);
  assert.equal(qr.size, 37);
  for (const [x0, y0] of [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]]) {
    for (let i = 0; i < 7; i++) {
      assert.ok(at(qr, x0 + i, y0) && at(qr, x0 + i, y0 + 6) && at(qr, x0, y0 + i) && at(qr, x0 + 6, y0 + i), 'finder ring');
    }
    assert.ok(at(qr, x0 + 3, y0 + 3), 'finder centre');
  }
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(at(qr, i, 6), i % 2 === 0);
    assert.equal(at(qr, 6, i), i % 2 === 0);
  }
  assert.ok(at(qr, 8, qr.size - 8), 'dark module');
});

check('version 7 and up draw the alignment patterns that sit on the timing lines', () => {
  const qr = encode('x'.repeat(110));
  assert.equal(qr.version, 7);
  for (const [x, y] of [[6, 22], [22, 6], [22, 22], [38, 22], [22, 38], [38, 38]]) {
    assert.ok(at(qr, x, y) && at(qr, x - 2, y - 2) && !at(qr, x - 1, y), `alignment at ${x},${y}`);
  }
});

check('the same text always gives the same symbol', () => {
  const a = encode('http://localhost:8000/event.html#code=AAAAAD');
  const b = encode('http://localhost:8000/event.html#code=AAAAAD');
  assert.deepEqual(a.modules, b.modules);
  assert.equal(a.mask, b.mask);
});

check('the SVG has the 4-module quiet zone and a white background', () => {
  const svg = toSvg(encode('01234567'), 'Join link');
  assert.match(svg, /viewBox="0 0 29 29"/);
  assert.match(svg, /<rect width="29" height="29" fill="#fff"\/>/);
  assert.match(svg, /aria-label="Join link"/);
});

check('text too long for version 10 is refused', () => {
  assert.throws(() => encode('x'.repeat(300)), /too long/);
});

console.log(`\n${n} QR checks passed\n`);
