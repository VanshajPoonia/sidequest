// Proof distance: no browser, runs in milliseconds.
import assert from 'node:assert/strict';
import { distance, far, position, FAR } from '../src/locate.js';

let n = 0;
const check = async (name, fn) => { await fn(); n++; console.log(`ok  ${name}`); };
const stop = { lat: 51.5634, lon: -0.164 };

await check('distance is in whole metres, with the reading\'s accuracy', () => {
  const d = distance(stop, { latitude: 51.5634 + 0.0009, longitude: -0.164, accuracy: 12.4 });
  assert.ok(Math.abs(d.metres - 100) <= 1, `${d.metres}`);
  assert.equal(d.accuracy, 12);
});

await check('no coordinates, or broken ones, give no distance', () => {
  assert.deepEqual(distance(stop, null), { metres: null, accuracy: null });
  assert.deepEqual(distance(stop, { latitude: NaN, longitude: 1 }), { metres: null, accuracy: null });
  assert.equal(distance(stop, { latitude: 51.5634, longitude: -0.164 }).accuracy, null);
});

await check('without a geolocation API the position is null, not an error', async () => {
  assert.equal(await position(10), null);
});

await check('a refused or slow location resolves to null and never throws', async () => {
  const real = globalThis.navigator;
  const fake = (impl) => Object.defineProperty(globalThis, 'navigator', { value: { geolocation: { getCurrentPosition: impl } }, configurable: true });
  fake((ok, fail) => fail({ code: 1, message: 'User denied Geolocation' }));
  assert.equal(await position(10), null);
  fake(() => {});
  assert.equal(await position(10), null);
  fake((ok) => ok({ coords: { latitude: 1, longitude: 2, accuracy: 3 } }));
  assert.deepEqual(await position(10), { latitude: 1, longitude: 2, accuracy: 3 });
  Object.defineProperty(globalThis, 'navigator', { value: real, configurable: true });
});

await check('distances read naturally, and 150 m is where it gets flagged', () => {
  assert.equal(far(null), 'no location');
  assert.equal(far(42), '42 m');
  assert.equal(far(1234), '1.2 km');
  assert.equal(FAR, 150);
});

console.log(`\n${n} location checks passed\n`);
