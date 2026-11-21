// Encodes a set of texts with src/qr.js, every version 1 to 10 at every level plus real
// join links, writes them as PNGs and reads them back with macOS CoreImage
// (scripts/qr-decode.swift). macOS only, which is why this is not part of npm test.
//
//   node scripts/qr-roundtrip.mjs
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode, dataCodewords, MAX_VERSION } from '../src/qr.js';

function png({ size, modules }, scale = 6) {
  const n = (size + 8) * scale;
  const rows = [];
  for (let y = 0; y < n; y++) {
    const row = Buffer.alloc(n + 1);
    for (let x = 0; x < n; x++) {
      const mx = Math.floor(x / scale) - 4, my = Math.floor(y / scale) - 4;
      row[x + 1] = mx >= 0 && my >= 0 && mx < size && my < size && modules[my][mx] ? 0 : 255;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(n, 0);
  head.writeUInt32BE(n, 4);
  head.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// The longest text of this kind that still fits a version, so each version gets used.
const fill = (version, level, make) => {
  let n = 1;
  while (dataCodewords(make(n + 1), version, level)) n++;
  return make(n);
};
const letters = (n) => Array.from({ length: n }, (_, i) => 'WalkQuest event code ABC2DE '[i % 28]).join('');

const cases = [];
for (const level of ['L', 'M', 'Q', 'H']) {
  for (let v = 1; v <= MAX_VERSION; v++) cases.push({ text: fill(v, level, letters), level, want: v });
}
cases.push({ text: '01234567', level: 'M', want: 1 });
for (const code of ['K7QM4D', 'AAAAAD', '23456X']) {
  cases.push({ text: `https://vanshajpoonia.github.io/sidequest/event.html#code=${code}`, level: 'M' });
  cases.push({ text: `http://localhost:8000/event.html#code=${code}`, level: 'M' });
}

const dir = mkdtempSync(join(tmpdir(), 'walkquest-qr-'));
const files = cases.map((c, i) => {
  const qr = encode(c.text, { level: c.level });
  if (c.want && qr.version !== c.want) throw new Error(`expected version ${c.want}, got ${qr.version}`);
  c.version = qr.version;
  c.mask = qr.mask;
  const file = join(dir, `${i}.png`);
  writeFileSync(file, png(qr));
  return file;
});
const swift = fileURLToPath(new URL('./qr-decode.swift', import.meta.url));
const out = execFileSync('swift', [swift, ...files], { encoding: 'utf8' }).trim().split('\n');
const read = new Map(out.map((line) => line.split('\t')));
let ok = 0;
for (const [i, c] of cases.entries()) {
  const got = read.get(files[i]) ?? '';
  const pass = got === c.text;
  if (pass) ok++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  v${String(c.version).padEnd(2)} ${c.level} mask ${c.mask}  ${c.text.length} chars  ${c.text.slice(0, 60)}`);
}
rmSync(dir, { recursive: true, force: true });
console.log(`\n${ok}/${cases.length} read back by CoreImage exactly`);
process.exit(ok === cases.length ? 0 : 1);
