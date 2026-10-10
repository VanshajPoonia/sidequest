// Snapshot the preset places from Overpass into data/places/. They make the demo work
// without sharing a location, and they are the fixtures tests/ run against, so a quest
// for "Lodhi Garden" is reproducible even after someone edits the map.
//
//   node scripts/freeze-places.mjs
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fetchAround } from '../src/osm.js';
import { PLACES } from '../src/places.js';

mkdirSync(new URL('../data/places/', import.meta.url), { recursive: true });
for (const p of PLACES) {
  const file = new URL(`../data/places/${p.id}.json`, import.meta.url);
  if (existsSync(file) && !process.argv.includes('--refresh')) continue;
  let json;
  for (let attempt = 1; !json; attempt++) {
    try { json = await fetchAround(p, 1500); } catch (err) {
      if (attempt === 4) throw err;
      console.log(`${p.id}: ${err.message}, retrying in ${attempt * 20}s`);
      await new Promise((r) => setTimeout(r, attempt * 20000));
    }
  }
  const elements = json.elements.map(({ type, id, lat, lon, center, tags }) => ({ type, id, lat, lon, center, tags }));
  writeFileSync(file, JSON.stringify({
    place: p, fetched: new Date().toISOString().slice(0, 10),
    attribution: '© OpenStreetMap contributors, ODbL', elements,
  }));
  console.log(`${p.id}: ${elements.length} elements`);
  await new Promise((r) => setTimeout(r, 10000)); // be polite to a free service
}
