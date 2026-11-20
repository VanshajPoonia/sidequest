// Photo proof at a stop, measured with the real model on labelled photos from Wikimedia
// Commons. Reproduces the proof numbers in the README. No mocks.
//
// 83 photos of real stops in the four preset parks, labelled with the kind of stop
// WalkQuest gives them (src/plan.js). 95 photos that should never count: indoors, desks
// and screens. And every stop photo pasted onto 12 real photos of screens.
// Photos are downloaded on first run into tests/.cache (credits in tests/proof-fixtures.json
// and vendor/touchgrass-judge/frames.json).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rank } from '../vendor/touchgrass-judge/core.js';
import { embedImage, onScreen, RawImage } from '../vendor/touchgrass-judge/node.mjs';
import { ACCEPT, verdict } from '../src/proof.js';
import { buildProof } from '../scripts/build-proof-classes.mjs';

const here = (p) => new URL(p, import.meta.url);
const json = (p) => JSON.parse(readFileSync(here(p)));
const FIXTURES = json('./proof-fixtures.json');
const FRAMES = json('../vendor/touchgrass-judge/frames.json');
mkdirSync(here('./.cache/img/'), { recursive: true });

const cacheFile = here('./.cache/proof-embeddings.json');
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile)) : {};
async function download(f) {
  const local = here(`./.cache/img/${f.title.replace(/\W+/g, '_')}.jpg`);
  if (!existsSync(local)) {
    const res = await fetch(f.url, { headers: { 'User-Agent': 'sidequest-tests/1.0 (github.com/VanshajPoonia/sidequest)' } });
    if (!res.ok) throw new Error(`${res.status} fetching ${f.title}`);
    writeFileSync(local, Buffer.from(await res.arrayBuffer()));
  }
  return fileURLToPath(local);
}
async function embedOnce(key, image) {
  if (cache[key]) return;
  cache[key] = await embedImage(await image());
  process.stdout.write('.');
}

const stops = FIXTURES.filter((f) => !f.label.startsWith('none'));
const never = FIXTURES.filter((f) => f.label.startsWith('none'));
for (const f of FIXTURES) await embedOnce(f.title, () => download(f));
const onScreens = [];
for (const fr of FRAMES) {
  const frame = await RawImage.read(await download(fr));
  for (const f of stops) {
    const key = `screen|${fr.title}|${f.title}`;
    await embedOnce(key, async () => onScreen(frame, await RawImage.read(await download(f)), fr.rect));
    onScreens.push({ key, label: f.label });
  }
}
writeFileSync(cacheFile, JSON.stringify(cache));

const classes = await buildProof();
const KINDS = Object.keys(ACCEPT);
const STRICT = KINDS.filter((k) => ACCEPT[k]);

function measure(name, options) {
  const ok = (key, kind) => verdict(rank(cache[key], classes), kind, options).ok;
  const right = stops.filter((f) => ok(f.title, f.label));
  let pairs = 0, wrong = 0;
  for (const f of stops) {
    for (const k of STRICT) {
      if (k === f.label) continue;
      pairs++;
      if (ok(f.title, k)) wrong++;
    }
  }
  const leaks = never.filter((f) => KINDS.some((k) => ok(f.title, k)));
  const screened = onScreens.filter((c) => ok(c.key, c.label)).length;
  console.log(`${name.padEnd(34)} ${String(right.length).padStart(2)}/${stops.length} right kind   ` +
    `${String(leaks.length).padStart(2)}/${never.length} indoor or screen photos pass at any stop   ` +
    `${String(screened).padStart(3)}/${onScreens.length} stop photos on a screen pass   ` +
    `wrong kind ${wrong}/${pairs}`);
  return { right, leaks, screened, wrong, pairs, ok };
}

console.log(`\n${stops.length} stop photos, ${never.length} that should never count, ${onScreens.length} stop photos on a screen\n`);
measure('no screen check', { screenK: 0 });
measure('looser: top 3, p >= 0.10', { topK: 3, minP: 0.1 });
const shipped = measure('judge defaults  (shipped)', {});

console.log('\nby kind of stop (shipped):');
for (const k of [...new Set(stops.map((f) => f.label))]) {
  const mine = stops.filter((f) => f.label === k);
  const n = mine.filter((f) => shipped.ok(f.title, k)).length;
  console.log(`  ${k.padEnd(10)} ${n}/${mine.length}${ACCEPT[k] ? '' : '  (any outdoor photo counts)'}`);
}
const missed = stops.filter((f) => !shipped.right.includes(f));
console.log('\nturned away at their own stop:', missed.length ? '\n  ' + missed.map((f) => `${f.label}  ${f.title}  -> ${rank(cache[f.title], classes).slice(0, 3).map((r) => `${r.id} ${(r.p * 100).toFixed(0)}%`).join(', ')}`).join('\n  ') : 'none');
console.log('should never count, but passed:', shipped.leaks.length ? '\n  ' + shipped.leaks.map((f) => `${f.label}  ${f.title}`).join('\n  ') : 'none');

// ---- the shipped data file must be what we just measured ----------------------------
const disk = json('../data/proof-classes.json');
const same = disk.classes.length === classes.length &&
  disk.classes.every((c, i) => c.id === classes[i].id && c.vec.reduce((s, x, j) => s + x * classes[i].vec[j], 0) > 0.9999);
console.log(`\ndata/proof-classes.json: ${same ? 'matches' : 'out of date, run npm run build-proof'}`);

const pass = same && shipped.leaks.length === 0 && shipped.right.length / stops.length >= 0.85 && shipped.screened / onScreens.length < 0.1;
console.log(pass ? '\nPASS' : '\nFAIL');
process.exit(pass ? 0 : 1);
