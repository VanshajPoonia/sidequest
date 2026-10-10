// Map data in, a walkable loop out. Pure functions, no model: tested in tests/plan.mjs.
//
// The division of labour is the whole design. Gemma never chooses where you go, never
// estimates a distance, never orders the stops. A 1B model will happily send you to a
// fountain that does not exist, 400 m in the wrong direction. Code does the navigating;
// the model only gets to write, and only about places this file has already verified.

export const SPEED = 75;   // metres per minute, an unhurried walk
export const DETOUR = 1.3; // paths are not straight lines
export const DWELL = 3;    // minutes spent at each stop

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function metres(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---- OSM elements -> features -------------------------------------------------------

const KIND_SCORE = {
  viewpoint: 5, historic: 5, landmark: 4, memorial: 4, hide: 4, artwork: 4, plaque: 3,
  bench: 3, tree: 3, water: 3, garden: 3, fountain: 3, nature: 3, attraction: 2, bridge: 2, picnic: 2,
};

function kindOf(t) {
  if (t.amenity === 'bench') return 'bench';
  if (/plaque/.test(t.memorial || '')) return 'plaque';
  if (t.historic === 'memorial' || t.memorial) return 'memorial';
  if (t.tourism === 'artwork') return 'artwork';
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.natural === 'tree') return 'tree';
  if (t.historic) return 'historic';
  if (t.amenity === 'fountain') return 'fountain';
  if (t.leisure === 'bird_hide') return 'hide';
  if (t.natural === 'water' || t.water) return 'water';
  if (t.leisure) return 'garden';
  if (t.natural) return 'nature';
  if (t.man_made) return 'landmark';
  if (t.bridge) return 'bridge';
  if (t.tourism === 'picnic_site') return 'picnic';
  if (t.tourism === 'attraction') return 'attraction';
  return null;
}

// Only tags a person standing there could see, check, or care about. These lines are
// the *entire* world as far as the model is concerned (src/prompts.js).
const FACT_KEYS = [
  ['name', 'Name'], ['name:en', 'English name'],
  ['tourism', 'Type'], ['historic', 'Historic type'], ['memorial', 'Memorial type'],
  ['artwork_type', 'Artwork type'], ['artist_name', 'Artist'], ['material', 'Material'],
  ['natural', 'Natural feature'], ['species', 'Species'], ['species:en', 'Common name'], ['taxon:en', 'Common name'],
  ['genus', 'Genus'], ['leaf_type', 'Leaf type'], ['leaf_cycle', 'Leaf cycle'],
  ['leisure', 'Type'], ['amenity', 'Type'], ['man_made', 'Structure'], ['water', 'Water type'],
  ['inscription', 'Inscription'], ['description', 'Description'], ['start_date', 'Dates from'],
  ['height', 'Height (m)'], ['ele', 'Elevation (m)'], ['erected_by', 'Erected by'],
];

const BAD_NAME = /\b(unknown|untitled|fuck|shit)\b|^\?|^\d+$/i;

export function toFeatures(elements) {
  const out = [];
  const seen = new Set();
  for (const e of elements) {
    const t = e.tags || {};
    const pos = e.lat != null ? { lat: e.lat, lon: e.lon } : e.center;
    const kind = kindOf(t);
    if (!pos || !kind) continue;
    if (t.name && BAD_NAME.test(t.name)) continue;
    if (kind === 'bench' && !t.inscription) continue;

    const facts = [];
    for (const [k, label] of FACT_KEYS) {
      if (!t[k] || facts.some(([l, v]) => l === label && v === t[k])) continue;
      const v = String(t[k]).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
      facts.push([label, v]);
    }
    if (t.wikipedia) facts.push(['Wikipedia article', t.wikipedia.replace(/^\w+:/, '')]);

    const title = t['name:en'] || t.name || label(kind, t);
    const key = `${title}|${pos.lat.toFixed(4)}|${pos.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let score = KIND_SCORE[kind];
    if (t.name) score += 1;
    if (t.inscription) score += 2;
    if (t.description) score += 1;
    if (t.wikipedia || t.wikidata) score += 1;
    if (t.start_date) score += 1;
    if (!t.name && !t.inscription && kind !== 'viewpoint') score -= 2; // "a memorial" is not much of a destination
    if (t.artwork_type === 'mural') score -= 1; // there are 40 of them in Lodhi alone

    out.push({ id: `${e.type[0]}${e.id}`, osm: `${e.type}/${e.id}`, kind, title, lat: pos.lat, lon: pos.lon, facts, score });
  }
  return out;
}

function label(kind, t) {
  if (kind === 'tree') return t['species:en'] || t['taxon:en'] || t.species || t.genus || 'A notable tree';
  if (kind === 'bench') return 'A memorial bench';
  if (kind === 'fountain') return 'A fountain';
  if (kind === 'viewpoint') return 'A viewpoint';
  if (kind === 'artwork') return `A ${(t.artwork_type || 'artwork').replace(/_/g, ' ')}`;
  if (kind === 'plaque') return 'A plaque';
  if (kind === 'memorial') return 'A memorial';
  if (kind === 'nature') return `A ${t.natural.replace(/_/g, ' ')}`;
  if (kind === 'historic') return `A ${t.historic.replace(/_/g, ' ')}`;
  if (kind === 'landmark') return `A ${t.man_made.replace(/_/g, ' ')}`;
  return `A ${kind}`;
}

// ---- features -> a loop ---------------------------------------------------------------

export function stopsFor(minutes) {
  return minutes <= 20 ? 2 : minutes <= 40 ? 3 : 4;
}

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/** Shortest start -> stops -> start loop. At most 4 stops, so brute force is exact and instant. */
export function bestLoop(start, stops) {
  let best = null;
  for (const order of permutations(stops)) {
    const pts = [start, ...order, start];
    let m = 0;
    for (let i = 1; i < pts.length; i++) m += metres(pts[i - 1], pts[i]);
    if (!best || m < best.straight) best = { order, straight: m };
  }
  const walkM = best.straight * DETOUR;
  return { stops: best.order, metres: Math.round(walkM), minutes: Math.round(walkM / SPEED + DWELL * stops.length) };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick the most interesting stops that still fit the time budget as a loop.
 * `seed` jitters the ranking a little, so "another one" gives a different walk
 * from the same map without ever choosing something that does not fit.
 */
export function planWalk(features, start, minutes, seed = 0) {
  const want = stopsFor(minutes);
  const maxReach = (minutes * SPEED) / (2 * DETOUR); // no stop further than half the walk
  const rand = rng(seed);
  const pool = features
    .map((f) => ({ f, d: metres(start, f), s: f.score + (seed ? rand() * 2.5 : 0) }))
    .filter((c) => c.d <= maxReach && c.d >= 30)
    .sort((a, b) => b.s - a.s || a.d - b.d);

  // Greedy from each of the top few candidates, keep the best result. Pure greedy from
  // the single best-scoring stop can commit to something 1.2 km away and leave no time
  // for anything else.
  let best = null;
  for (const first of pool.slice(0, 12)) {
    if (bestLoop(start, [first.f]).minutes > minutes) continue;
    const picks = [first.f];
    for (const allowRepeat of [false, true]) {
      for (const { f } of pool) {
        if (picks.length === want) break;
        if (picks.includes(f)) continue;
        if (!allowRepeat && picks.some((p) => p.kind === f.kind)) continue;
        if (picks.some((p) => p.title === f.title || metres(p, f) < 60)) continue;
        if (bestLoop(start, [...picks, f]).minutes <= minutes) picks.push(f);
      }
    }
    const value = picks.length * 100 + picks.reduce((a, f) => a + pool.find((c) => c.f === f).s, 0);
    if (!best || value > best.value) best = { value, picks };
  }
  const picks = best?.picks ?? [];
  if (!picks.length) return null;
  return { start, ...bestLoop(start, picks) };
}

// ---- a sketch map, no tiles, so it works offline -------------------------------------

/** Local metres east/north of the start, then fit into a w x h box with padding. */
export function sketch(start, stops, w = 320, h = 220, pad = 26) {
  const k = Math.cos(rad(start.lat));
  const xy = (p) => ({ x: (p.lon - start.lon) * 111320 * k, y: (p.lat - start.lat) * 110540 });
  const pts = [start, ...stops].map(xy);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((w - 2 * pad) / (maxX - minX || 1), (h - 2 * pad) / (maxY - minY || 1));
  const ox = (w - (maxX - minX) * scale) / 2, oy = (h - (maxY - minY) * scale) / 2;
  const place = (p) => ({ x: +(ox + (p.x - minX) * scale).toFixed(1), y: +(h - (oy + (p.y - minY) * scale)).toFixed(1) });
  const scaleBar = [50, 100, 200, 250, 500, 1000].find((m) => m * scale >= 50) || 1000;
  return { points: pts.map(place), metresPerPx: 1 / scale, scaleBar: { metres: scaleBar, px: +(scaleBar * scale).toFixed(1) } };
}
