// Planner and checker: no model, runs in milliseconds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toFeatures, planWalk, bestLoop, metres, sketch, stopsFor } from '../src/plan.js';
import { problems, clean, fallback } from '../src/mission.js';
import { snap, SNAP } from '../src/osm.js';
import { PLACES } from '../src/places.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const load = (id) => toFeatures(JSON.parse(readFileSync(new URL(`../data/places/${id}.json`, import.meta.url))).elements);

check('haversine: one degree of latitude is ~111 km', () => assert.ok(Math.abs(metres({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 50));

for (const p of PLACES) {
  const features = load(p.id);
  for (const minutes of [20, 40, 60]) {
    check(`${p.id}, ${minutes} min: fits the budget, right number of stops, all real`, () => {
      const w = planWalk(features, p, minutes);
      assert.ok(w, 'no walk found');
      assert.ok(w.minutes <= minutes, `${w.minutes} min > ${minutes}`);
      assert.equal(w.stops.length, stopsFor(minutes));
      for (const s of w.stops) assert.ok(features.includes(s), `${s.title} is not from the map`);
      assert.equal(new Set(w.stops.map((s) => s.title)).size, w.stops.length);
    });
  }
}

check('a different seed gives a different walk, still within budget', () => {
  const f = load('centralpark');
  const a = planWalk(f, PLACES[3], 60, 0), b = planWalk(f, PLACES[3], 60, 7);
  assert.notDeepEqual(a.stops.map((s) => s.id).sort(), b.stops.map((s) => s.id).sort());
  assert.ok(b.minutes <= 60);
});

check('loop order is the shortest one', () => {
  const s = { lat: 0, lon: 0 };
  const pts = [{ lat: 0, lon: 0.01 }, { lat: 0.01, lon: 0.01 }, { lat: 0.01, lon: 0 }];
  const w = bestLoop(s, [pts[1], pts[0], pts[2]]);
  assert.ok(w.stops[1] === pts[1], 'the far corner should be the middle stop');
});

check('location is snapped to a coarse grid before it leaves the device', () => {
  const s = snap({ lat: 51.56341, lon: -0.16398 });
  assert.ok(metres(s, { lat: 51.56341, lon: -0.16398 }) < SNAP * 111000);
  assert.equal(Math.round(s.lat / SNAP), s.lat / SNAP);
});

check('sketch fits every point inside the box', () => {
  const w = planWalk(load('lodhi'), PLACES[0], 60);
  const { points } = sketch(w.start, w.stops, 320, 220);
  for (const p of points) assert.ok(p.x >= 0 && p.x <= 320 && p.y >= 0 && p.y <= 220);
});

const shish = { facts: [['Name', 'Shish Gumbad'], ['Historic type', 'tomb'], ['Dates from', '1489']] };
check('checker passes a grounded mission', () => assert.deepEqual(problems('Find the Shish Gumbad and count the blue tiles still left on its dome.', shish), []));
check('checker catches an invented date', () => assert.equal(problems('Shish Gumbad was built in 1540, so count its arches.', shish)[0].detail, '1540'));
check('checker catches an invented name', () => assert.equal(problems('Find the tomb where Sikandar Lodi rests and count its arches.', shish)[0].detail, 'Sikandar'));
check('a name inside a longer word in the tags is still invented', () => {
  // Gemma 3 1B really wrote this for Karl Marx's grave: "Red Tomb" leaked from a worked example.
  const grave = { facts: [['Name', 'Karl Marx Original Grave'], ['Historic type', 'tomb'], ['Inscription', 'AT THIS SPOT WERE FORMERLY BURIED']] };
  assert.equal(problems('Count the stones surrounding the Red Tomb.', grave)[0].detail, 'Red');
});
check('checker catches a question the map cannot answer', () => {
  const bara = { facts: [['Name', 'Bara Gumbad'], ['Historic type', 'tomb']] };
  assert.equal(problems('Follow the base of the Bara Gumbad and find a stone marker that shows the original construction date.', bara)[0].type, 'unanswerable');
  assert.deepEqual(problems('Find the Shish Gumbad and work out how many years ago 1489 was.', shish), []);
  assert.deepEqual(problems('Find the Bara Gumbad and guess how old it is from the stone.', bara), []);
});
check('"St." is an abbreviation, not the end of a sentence', () => {
  // Real Gemma output, wrongly rejected as narration before this test existed.
  const mast = { facts: [['Name', 'St Columba Radio Mast'], ['Structure', 'tower'], ['Description', 'LFB']] };
  assert.deepEqual(problems('Listen carefully to the faint hum emanating from the St. Columba Radio Mast.', mast), []);
  assert.equal(problems('Ascend the tower of the St. Columba Radio Mast and count the antennas.', mast)[0].type, 'unsafe');
});
check('unnamed things read naturally in a fallback', () => assert.match(fallback({ kind: 'thing', title: 'A stone' }), /^Find a stone /));
check('checker allows a year that is in the tags', () => assert.deepEqual(problems('Find the oldest-looking stone on a tomb that dates from 1489.', shish), []));
check('checker catches narration that is not a mission', () => {
  assert.equal(problems('The lion sculpture stands proudly.', shish)[0].type, 'narration');
  assert.equal(problems('Walk over while the adult watches the tomb.', shish)[0].type, 'narration');
});
check('checker catches a child who is not on the walk', () => {
  assert.equal(problems('Find the Shish Gumbad with your kid and count its arches.', shish, 'dog')[0].type, 'walker');
  assert.deepEqual(problems('Find the Shish Gumbad with your kid and count its arches.', shish, 'kids'), []);
});
check('a double space does not hide a second sentence', () => assert.equal(problems('Find the tomb.  Count the stones.', shish)[0].type, 'narration'));
check('checker catches unsafe verbs', () => assert.equal(problems('Climb the steps of the tomb and look for carvings at the top.', shish)[0].type, 'unsafe'));
check('clean strips labels, quotes and extra lines', () => assert.equal(clean('**Mission:** "Count the arches."\nHave fun!'), 'Count the arches.'));
check('every fallback passes the checker', () => {
  for (const id of ['lodhi', 'hampstead', 'goldengate', 'centralpark']) {
    for (const f of load(id)) assert.deepEqual(problems(fallback(f), f).filter((p) => p.type !== 'long'), [], `${f.kind}: ${fallback(f)}`);
  }
});

console.log(`\n${n} planner checks passed\n`);
