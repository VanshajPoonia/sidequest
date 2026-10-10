// Offline support. A quest is written at home on wifi and walked where the signal is
// worst, so the saved quest (localStorage) and this app shell must open with no network.
// Gemma's weights live in transformers.js's own Cache Storage; the library build from
// jsDelivr is cached here the first time it is fetched.
const SHELL = 'sq-shell-v1';
const RUNTIME = 'sq-runtime-v1';
const FILES = [
  './', 'index.html', 'assets/styles.css', 'manifest.webmanifest',
  'src/app.js', 'src/gemma.js', 'src/mission.js', 'src/osm.js', 'src/places.js', 'src/plan.js',
  'data/places/lodhi.json', 'data/places/goldengate.json', 'data/places/hampstead.json', 'data/places/centralpark.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sq-') && k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && url.hostname !== 'cdn.jsdelivr.net') return; // model files: transformers.js caches those itself

  // Network first for our own files (so deploys show up), cache when offline.
  // Cache first for the pinned, immutable library build.
  e.respondWith((async () => {
    const cache = await caches.open(sameOrigin ? SHELL : RUNTIME);
    if (!sameOrigin) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || (await caches.match('index.html'));
    }
  })());
});
