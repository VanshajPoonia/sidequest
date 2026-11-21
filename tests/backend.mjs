// The backend contract, run against the local adapter. Two clients share one store and
// talk over a real BroadcastChannel, the same way two tabs in one browser do.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalBackend } from '../src/team/local.js';
import { contract } from './backend-contract.mjs';

// The slice of the Web Storage API the adapter uses, backed by a Map.
function memoryStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

let run = 0;
const n = await contract('local', () => {
  const storage = memoryStorage();
  const clock = { t: 1000 };
  const name = `walkquest-test-${run++}`;
  const a = createLocalBackend({ storage, channel: new BroadcastChannel(name), now: () => clock.t });
  const b = createLocalBackend({ storage, channel: new BroadcastChannel(name), now: () => clock.t });
  return { a, b, clock, close: () => { a.close(); b.close(); } };
});

// The switch in src/team/index.js: empty means this browser only, anything else is a deployed Worker.
const url = readFileSync(new URL('../src/team/index.js', import.meta.url), 'utf8').match(/^export const BACKEND_URL = '([^']*)';$/m)?.[1];
assert.ok(url === '' || /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(url), `BACKEND_URL must be empty or an https URL, not "${url}"`);
console.log(`ok  backend switch: ${url ? `hosted at ${url}` : 'this browser only'}`);

console.log(`\n${n} backend contract checks passed\n`);
