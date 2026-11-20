// The backend contract as checks. Every adapter runs these: today the local one
// (tests/backend.mjs), later a hosted one, so the game behaves the same on both.
//
// `setup()` returns two clients that share one store (two tabs, or two phones), a clock
// the test can move, and `close()`.
import assert from 'node:assert/strict';
import { BackendError } from '../src/team/backend.js';
import { isValidCode, makeCode, formatCode } from '../src/team/code.js';
import { leaderboard } from '../src/team/score.js';

const stop = (i) => ({ title: `Stop ${i}`, kind: 'historic', osm: `node/${i}`, lat: 51.5 + i / 1000, lon: -0.16, mission: `Find stop ${i}.`, facts: [['Name', 'x']], rejected: [] });
export const QUEST = { title: 'Heath loop', place: 'Hampstead Heath', metres: 2100, start: { lat: 51.5, lon: -0.16 }, stops: [stop(0), stop(1), stop(2)] };

const rejects = async (promise, code) => {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof BackendError, `expected a BackendError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
};
const until = async (pred, ms = 1000) => {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error('timed out waiting for a change');
    await new Promise((r) => setTimeout(r, 5));
  }
};

export async function contract(name, setup) {
  let n = 0;
  const check = async (title, fn) => {
    const ctx = setup();
    try { await fn(ctx); } finally { ctx.close(); }
    n++;
    console.log(`ok  ${name}: ${title}`);
  };
  const live = async ({ a, clock }, minutes = 30) => {
    const { code, hostKey } = await a.createEvent({ name: 'Freshers walk', quest: QUEST, minutes });
    const ants = await a.joinEvent(code, 'Ants');
    clock.t += 1000;
    await a.startEvent(code, hostKey);
    return { code, hostKey, ants };
  };

  await check('creating an event gives a valid code and a host key', async ({ a }) => {
    const { code, hostKey } = await a.createEvent({ name: '  Freshers   walk ', quest: QUEST, minutes: 45 });
    assert.ok(isValidCode(code));
    assert.ok(hostKey.length >= 12);
    const e = await a.getEvent(formatCode(code).toLowerCase());
    assert.equal(e.name, 'Freshers walk');
    assert.equal(e.minutes, 45);
    assert.equal(e.startedAt, null);
    assert.equal(e.quest.stops.length, 3);
  });

  await check('teams get the missions, not the drafts or the map facts', async ({ a }) => {
    const { code } = await a.createEvent({ name: 'x', quest: QUEST });
    const s = (await a.getEvent(code)).quest.stops[0];
    assert.deepEqual(Object.keys(s).sort(), ['kind', 'lat', 'lon', 'mission', 'osm', 'title']);
  });

  await check('bad events are refused', async ({ a }) => {
    await rejects(a.createEvent({ name: '', quest: QUEST }), 'bad-name');
    await rejects(a.createEvent({ name: 'x', quest: { ...QUEST, stops: [] } }), 'bad-quest');
    await rejects(a.createEvent({ name: 'x', quest: { ...QUEST, stops: [{ ...stop(0), mission: null }] } }), 'bad-quest');
    await rejects(a.createEvent({ name: 'x', quest: QUEST, minutes: 2 }), 'bad-minutes');
  });

  await check('a code with a typo is refused, an unknown one finds nothing', async ({ a }) => {
    const { code } = await a.createEvent({ name: 'x', quest: QUEST });
    const typo = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
    await rejects(a.getEvent(typo), 'bad-code');
    await rejects(a.joinEvent(typo, 'Ants'), 'bad-code');
    let unknown = code;
    while (unknown === code) unknown = makeCode();
    assert.equal(await a.getEvent(unknown), null);
    await rejects(a.joinEvent(unknown, 'Ants'), 'not-found');
  });

  await check('team names are unique per event, ignoring case and spacing', async ({ a, b }) => {
    const { code } = await a.createEvent({ name: 'x', quest: QUEST });
    const { team, teamKey } = await a.joinEvent(code, 'Night Owls');
    assert.equal(team.name, 'Night Owls');
    assert.ok(teamKey.length > 8);
    await rejects(b.joinEvent(code, '  night   owls '), 'name-taken');
    await rejects(b.joinEvent(code, '   '), 'bad-name');
    await rejects(b.joinEvent(code, 'x'.repeat(40)), 'bad-name');
    const other = await a.createEvent({ name: 'y', quest: QUEST });
    await b.joinEvent(other.code, 'Night Owls');
  });

  await check('only the host key starts or ends an event, and the backend stamps the time', async ({ a, b, clock }) => {
    const { code, hostKey } = await a.createEvent({ name: 'x', quest: QUEST });
    await rejects(b.startEvent(code, 'nope'), 'forbidden');
    clock.t = 5000;
    assert.equal((await b.startEvent(code, hostKey)).startedAt, 5000);
    clock.t = 9000;
    assert.equal((await a.startEvent(code, hostKey)).startedAt, 5000, 'starting twice keeps the first start');
    await rejects(a.endEvent(code, 'nope'), 'forbidden');
    assert.equal((await a.endEvent(code, hostKey)).endedAt, 9000);
  });

  await check('no proofs before the start', async ({ a }) => {
    const { code } = await a.createEvent({ name: 'x', quest: QUEST });
    const { teamKey } = await a.joinEvent(code, 'Ants');
    await rejects(a.submitProof(code, teamKey, { stop: 0 }), 'not-live');
  });

  await check('a proof is stamped by the backend and the first one per stop stands', async ({ a, b, clock }) => {
    const { code, ants } = await live({ a, clock });
    clock.t += 60000;
    const p = await b.submitProof(code, ants.teamKey, { stop: 1, thumb: 'data:image/jpeg;base64,AAAA', top: [{ id: 'monument', name: 'a monument', p: 0.6 }], at: 1 });
    assert.equal(p.at, clock.t);
    assert.equal(p.team, ants.team.id);
    clock.t += 60000;
    const again = await a.submitProof(code, ants.teamKey, { stop: 1, thumb: 'data:other' });
    assert.equal(again.at, p.at);
    assert.equal(again.thumb, p.thumb);
    assert.equal((await a.snapshot(code)).proofs.length, 1);
  });

  await check('a team key only proves for its own team, in its own event', async ({ a, clock }) => {
    const { code, ants } = await live({ a, clock });
    const other = await a.createEvent({ name: 'y', quest: QUEST });
    await rejects(a.submitProof(code, 'nope', { stop: 0 }), 'forbidden');
    await rejects(a.submitProof(code, `${ants.team.id}.wrong`, { stop: 0 }), 'forbidden');
    await rejects(a.submitProof(other.code, ants.teamKey, { stop: 0 }), 'forbidden');
  });

  await check('bad proofs are refused', async ({ a, clock }) => {
    const { code, ants } = await live({ a, clock });
    await rejects(a.submitProof(code, ants.teamKey, { stop: 3 }), 'bad-stop');
    await rejects(a.submitProof(code, ants.teamKey, { stop: '0' }), 'bad-stop');
    await rejects(a.submitProof(code, ants.teamKey, { stop: 0, thumb: 'x'.repeat(70000) }), 'too-big');
  });

  await check('no proofs after the time limit or after End', async ({ a, clock }) => {
    const { code, ants } = await live({ a, clock }, 30);
    clock.t += 31 * 60000;
    await rejects(a.submitProof(code, ants.teamKey, { stop: 0 }), 'not-live');
    const second = await live({ a, clock }, null);
    await a.endEvent(second.code, second.hostKey);
    await rejects(a.submitProof(second.code, second.ants.teamKey, { stop: 0 }), 'not-live');
    await rejects(a.joinEvent(second.code, 'Late'), 'not-live');
  });

  await check('the organizer can strike a proof, and the team can prove that stop again', async ({ a, b, clock }) => {
    const { code, hostKey, ants } = await live({ a, clock });
    await a.submitProof(code, ants.teamKey, { stop: 0 });
    await rejects(b.strikeProof(code, 'nope', ants.team.id, 0), 'forbidden');
    await b.strikeProof(code, hostKey, ants.team.id, 0);
    assert.equal((await a.snapshot(code)).proofs.length, 0);
    clock.t += 1000;
    assert.equal((await a.submitProof(code, ants.teamKey, { stop: 0 })).at, clock.t);
  });

  await check('a snapshot lists teams in join order and never carries a key', async ({ a, b, clock }) => {
    const { code, hostKey, ants } = await live({ a, clock });
    clock.t += 1000;
    const bees = await b.joinEvent(code, 'Bees');
    await b.submitProof(code, bees.teamKey, { stop: 2 });
    const snap = await a.snapshot(code);
    assert.deepEqual(snap.teams.map((t) => t.name), ['Ants', 'Bees']);
    const text = JSON.stringify(snap);
    for (const k of [hostKey, ants.teamKey.split('.')[1], bees.teamKey.split('.')[1]]) assert.ok(!text.includes(k), 'a key leaked into the snapshot');
  });

  await check('events do not see each other', async ({ a, clock }) => {
    const one = await live({ a, clock });
    const two = await live({ a, clock });
    await a.submitProof(one.code, one.ants.teamKey, { stop: 0 });
    const snap = await a.snapshot(two.code);
    assert.equal(snap.teams.length, 1);
    assert.equal(snap.proofs.length, 0);
  });

  await check('subscribers hear changes made by the other client, until they unsubscribe', async ({ a, b, clock }) => {
    const { code, ants } = await live({ a, clock });
    const seen = [];
    const off = a.subscribe(code, (snap) => seen.push(snap));
    assert.equal(seen.length, 1, 'called once straight away');
    await b.joinEvent(code, 'Bees');
    await until(() => seen.at(-1).teams.length === 2);
    await b.submitProof(code, ants.teamKey, { stop: 0 });
    await until(() => seen.at(-1).proofs.length === 1);
    off();
    const count = seen.length;
    await b.joinEvent(code, 'Crows');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(seen.length, count);
  });

  await check('a whole event, end to end, gives the right leaderboard', async ({ a, b, clock }) => {
    const { code, hostKey, ants } = await live({ a, clock });
    const bees = await b.joinEvent(code, 'Bees');
    for (const [team, s] of [[ants, 0], [bees, 0], [bees, 1], [ants, 1], [ants, 2]]) {
      clock.t += 60000;
      await (team === ants ? a : b).submitProof(code, team.teamKey, { stop: s });
    }
    await a.endEvent(code, hostKey);
    const rows = leaderboard(await b.snapshot(code));
    assert.deepEqual(rows.map((r) => [r.name, r.points, r.rank]), [['Ants', 3 * 100 + 2 * 25 + 50, 1], ['Bees', 2 * 100 + 25, 2]]);
  });

  return n;
}
