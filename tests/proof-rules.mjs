// The photo proof rules, without the model: runs in milliseconds. tests/proof.mjs
// measures them on real photos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toFeatures } from '../src/plan.js';
import { PLACES } from '../src/places.js';
import { PLACES as CLASSES, ACCEPT, THING, verdict } from '../src/proof.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const ranked = (...rows) => rows.map(([id, kind, p]) => ({ id, kind, p, cos: 0 }));

const kinds = new Set();
for (const p of PLACES) {
  for (const f of toFeatures(JSON.parse(readFileSync(new URL(`../data/places/${p.id}.json`, import.meta.url))).elements)) kinds.add(f.kind);
}

check('every kind of stop in the preset parks has a proof rule', () => {
  for (const k of kinds) assert.ok(k in ACCEPT, `no rule for ${k}`);
});

check('every rule names classes that exist, and says what to get in the frame', () => {
  const ids = new Set(CLASSES.map((c) => c.id));
  for (const [kind, list] of Object.entries(ACCEPT)) {
    if (!list) continue;
    for (const id of list) assert.ok(ids.has(id), `${kind} accepts unknown class ${id}`);
    assert.ok(THING[kind], `no wording for ${kind}`);
  }
});

check('a statue passes at a memorial and fails at a bench', () => {
  const r = ranked(['statue', 'item', 0.6], ['monument', 'item', 0.3], ['tree', 'item', 0.1]);
  assert.equal(verdict(r, 'memorial').ok, true);
  assert.equal(verdict(r, 'bench').ok, false);
});

check('a viewpoint or an unknown kind takes any outdoor photo', () => {
  const r = ranked(['street', 'item', 0.7], ['field', 'item', 0.3]);
  assert.equal(verdict(r, 'viewpoint').ok, true);
  assert.equal(verdict(r, 'something-new').ok, true);
});

check('indoors and screens fail at every kind of stop', () => {
  const room = ranked(['room', 'elsewhere', 0.6], ['statue', 'item', 0.4]);
  const screen = ranked(['statue', 'item', 0.8], ['screen-photo', 'screen', 0.2]);
  for (const k of Object.keys(ACCEPT)) {
    assert.equal(verdict(room, k).reason, 'elsewhere');
    assert.equal(verdict(screen, k).reason, 'screen');
  }
});

console.log(`\n${n} proof rule checks passed\n`);
