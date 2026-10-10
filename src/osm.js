// OpenStreetMap, via the Overpass API. Runs in the browser and in Node (tests, scripts).
//
// Privacy detail: the query centre is snapped to a ~500 m grid and the radius padded to
// cover it, so Overpass learns which block you are near, never which doorstep. The
// exact position is only used locally, after the response arrives.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// overpass-api.de answers 406 to clients with no User-Agent. Browsers always send one
// (and will not let a page override it), so this only matters for the Node scripts.
const HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };
if (typeof window === 'undefined') HEADERS['User-Agent'] = 'sidequest/1.0 (github.com/VanshajPoonia/sidequest)';

export const SNAP = 0.005; // degrees, ~550 m of latitude

export function snap({ lat, lon }) {
  const r = (x) => Math.round(x / SNAP) * SNAP;
  return { lat: +r(lat).toFixed(4), lon: +r(lon).toFixed(4) };
}

export function overpassQuery({ lat, lon }, radius) {
  const a = `(around:${Math.round(radius)},${lat},${lon})`;
  return `[out:json][timeout:30];
(
  nwr${a}["tourism"~"^(viewpoint|artwork|picnic_site|attraction)$"];
  nwr${a}["historic"]["historic"!~"^(yes|district|boundary_stone)$"];
  nwr${a}["memorial"];
  node${a}["natural"="tree"]["name"];
  node${a}["natural"="tree"]["denotation"~"natural_monument|landmark"];
  nwr${a}["natural"~"^(spring|rock|stone|peak|cliff|cave_entrance|beach)$"];
  nwr${a}["natural"="water"]["name"];
  nwr${a}["water"]["name"];
  nwr${a}["leisure"~"^(garden|nature_reserve|bird_hide)$"]["name"];
  nwr${a}["amenity"="fountain"];
  nwr${a}["amenity"="bench"]["inscription"];
  nwr${a}["man_made"~"^(tower|obelisk|windmill|lighthouse|water_tower)$"];
  way${a}["bridge"]["name"]["highway"~"^(footway|path|pedestrian|cycleway)$"];
);
out center tags qt 300;
node${a}["natural"="tree"]["species"];
out tags qt 60;`;
}

export async function fetchAround(pos, radius, { signal } = {}) {
  const centre = snap(pos);
  const padded = radius + 400; // the snap moves the centre by up to ~390 m diagonally
  const body = 'data=' + encodeURIComponent(overpassQuery(centre, padded));
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body, signal, headers: HEADERS });
      if (res.ok) return await res.json();
      lastErr = new Error(`${new URL(url).host} said ${res.status}`);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}
