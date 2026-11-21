// The hosted backend, for real: starts the Worker under `wrangler dev` (local, no account),
// runs the backend contract through src/team/cloud.js, then checks what only a server
// can get wrong. Needs network the first time, to fetch the pinned wrangler.
//
//   npm run test:cloud
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudBackend } from '../src/team/cloud.js';
import { leaderboard } from '../src/team/score.js';
import { contract, QUEST } from './backend-contract.mjs';

export const WRANGLER = 'wrangler@4.158.0';
const PORT = 8790 + Math.floor(Math.random() * 100);
const URL_ = `http://127.0.0.1:${PORT}`;
const state = mkdtempSync(join(tmpdir(), 'walkquest-worker-'));

const server = spawn('npx', ['--yes', WRANGLER, 'dev', '--ip', '127.0.0.1', '--port', String(PORT), '--var', 'TEST_CLOCK:1', '--persist-to', state, '--log-level', 'warn'], {
  cwd: new URL('../worker/', import.meta.url), detached: true, stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
});
const stop = () => {
  try { process.kill(-server.pid); } catch (err) { if (err.code !== 'ESRCH') throw err; }
  rmSync(state, { recursive: true, force: true });
};
process.on('exit', stop);

const until = async (pred, ms = 10000, what = 'a change') => {
  const t = Date.now();
  while (!(await pred())) {
    if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
await until(async () => (await fetch(`${URL_}/events/AAAAAA`).catch(() => null)) !== null, 240000, 'wrangler dev to start');

let n = await contract('cloud', () => {
  const clock = { t: 1000 };
  const headers = () => ({ 'x-test-now': String(clock.t) });
  const a = createCloudBackend({ url: URL_, headers });
  const b = createCloudBackend({ url: URL_, headers });
  return { a, b, clock, close: () => { a.close(); b.close(); } };
});

const check = async (name, fn) => { await fn(); n++; console.log(`ok  cloud: ${name}`); };
const photo = `data:image/jpeg;base64,${Buffer.from('not really a jpeg, but bytes all the same').toString('base64')}`;

await check('team A proves a stop and it shows up on team B and on the organizer view', async () => {
  const host = createCloudBackend({ url: URL_ });
  const phoneA = createCloudBackend({ url: URL_ });
  const phoneB = createCloudBackend({ url: URL_ });
  const { code, hostKey } = await host.createEvent({ name: 'Two phones', quest: QUEST, minutes: 30 });
  const ants = await phoneA.joinEvent(code, 'Ants');
  await phoneB.joinEvent(code, 'Bees');
  const seen = { host: null, b: null };
  host.subscribe(code, (s) => { seen.host = s; });
  phoneB.subscribe(code, (s) => { seen.b = s; });
  await until(() => seen.host && seen.b, 10000, 'both screens to connect');
  await host.startEvent(code, hostKey);
  await phoneA.submitProof(code, ants.teamKey, { stop: 0, thumb: photo, top: [{ id: 'statue', name: 'a statue', p: 0.7 }] });
  await until(() => seen.b.proofs.length === 1 && seen.host.proofs.length === 1, 10000, 'the proof to reach B and the organizer');
  for (const s of [seen.b, seen.host]) {
    const [row] = leaderboard(s);
    assert.deepEqual([row.name, row.points], ['Ants', 125]);
  }
  const res = await fetch(seen.b.proofs[0].thumb);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString('base64'), photo.split(',')[1]);
  for (const c of [host, phoneA, phoneB]) c.close();
});

await check('pushed snapshots carry photo links, not photos or keys', async () => {
  const host = createCloudBackend({ url: URL_ });
  const { code, hostKey } = await host.createEvent({ name: 'Small', quest: QUEST });
  const team = await host.joinEvent(code, 'Ants');
  await host.startEvent(code, hostKey);
  await host.submitProof(code, team.teamKey, { stop: 1, thumb: photo });
  const text = JSON.stringify(await host.snapshot(code));
  assert.ok(!text.includes('data:image'));
  assert.ok(!text.includes(hostKey) && !text.includes(team.teamKey.split('.')[1]));
});

await check('only the Pages site and localhost may call it from a browser', async () => {
  const bad = await fetch(`${URL_}/events`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`${URL_}/events`, { method: 'OPTIONS', headers: { origin: 'https://vanshajpoonia.github.io', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://vanshajpoonia.github.io');
  const ok = await fetch(`${URL_}/events/AAAAAA`, { headers: { origin: 'http://localhost:8000' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:8000');
});

await check('oversized requests are refused before they reach an event', async () => {
  const res = await fetch(`${URL_}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', quest: QUEST, pad: 'x'.repeat(100000) }) });
  assert.equal(res.status, 413);
  const typo = await fetch(`${URL_}/events/AAAAAB`);
  assert.equal(typo.status, 400);
  assert.equal((await typo.json()).error.code, 'bad-code');
});

await check('the socket answers ping and closes on anything else', async () => {
  const host = createCloudBackend({ url: URL_ });
  const { code } = await host.createEvent({ name: 'Sockets', quest: QUEST });
  const ws = new WebSocket(`${URL_.replace('http', 'ws')}/events/${code}/ws`);
  const got = [];
  ws.addEventListener('message', (e) => got.push(e.data));
  await new Promise((r) => ws.addEventListener('open', r));
  await until(() => got.length === 1, 5000, 'the first snapshot');
  ws.send('ping');
  await until(() => got.includes('pong'), 5000, 'pong');
  const closed = new Promise((r) => ws.addEventListener('close', (e) => r(e.code)));
  ws.send('x'.repeat(5000));
  assert.equal(await closed, 1008);
});

console.log(`\n${n} cloud checks passed\n`);
stop();
process.exit(0);
