// Scoring and the leaderboard: pure functions, runs in milliseconds.
import assert from 'node:assert/strict';
import { leaderboard, countable, status, closesAt, RULES } from '../src/team/score.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

const T0 = Date.UTC(2026, 10, 20, 10, 0);
const min = (m) => T0 + m * 60000;
const quest = { stops: [{}, {}, {}] };
const event = (extra = {}) => ({ quest, startedAt: T0, endedAt: null, minutes: 60, ...extra });
const teams = [{ id: 'a', name: 'Ants' }, { id: 'b', name: 'Bees' }, { id: 'c', name: 'Crows' }];
const proof = (team, stop, m) => ({ team, stop, at: min(m) });

check('100 a stop, 25 for being first there, 50 for proving every stop', () => {
  assert.deepEqual(RULES, { perStop: 100, first: 25, finish: 50 });
  const rows = leaderboard({ event: event(), teams, proofs: [proof('a', 0, 5), proof('b', 0, 6), proof('a', 1, 9), proof('a', 2, 14)] });
  const a = rows.find((r) => r.team === 'a'), b = rows.find((r) => r.team === 'b');
  assert.equal(a.points, 3 * 100 + 3 * 25 + 50);
  assert.equal(a.done, true);
  assert.equal(b.points, 100);
  assert.equal(b.firsts, 0);
  assert.deepEqual(rows.map((r) => r.team), ['a', 'b', 'c']);
});

check('level on points: whoever got their last proof in first ranks higher', () => {
  const rows = leaderboard({ event: event(), teams, proofs: [proof('b', 1, 6), proof('a', 0, 5)] });
  // One stop and one first each.
  assert.equal(rows[0].points, 125);
  assert.equal(rows[1].points, 125);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.team), ['a', 'b']);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
});

check('teams with nothing proven share the last rank', () => {
  const rows = leaderboard({ event: event(), teams, proofs: [proof('c', 0, 3)] });
  assert.deepEqual(rows.map((r) => [r.team, r.rank]), [['c', 1], ['a', 2], ['b', 2]]);
});

check('a tie for first at a stop gives both teams the bonus', () => {
  const rows = leaderboard({ event: event(), teams, proofs: [proof('a', 0, 4), proof('b', 0, 4)] });
  assert.equal(rows.find((r) => r.team === 'a').firsts, 1);
  assert.equal(rows.find((r) => r.team === 'b').firsts, 1);
});

check('a second proof of the same stop never counts twice', () => {
  const rows = leaderboard({ event: event(), teams, proofs: [proof('a', 0, 4), proof('a', 0, 2), proof('a', 0, 9)] });
  const a = rows.find((r) => r.team === 'a');
  assert.equal(a.proven, 1);
  assert.equal(a.stops[0].at, min(2));
});

check('proofs before the start, after the time limit, or after End do not count', () => {
  const proofs = [proof('a', 0, -1), proof('a', 1, 61), proof('b', 0, 10), proof('b', 1, 25)];
  assert.deepEqual(countable({ event: event(), teams, proofs }).map((p) => `${p.team}${p.stop}`), ['b0', 'b1']);
  assert.deepEqual(countable({ event: event({ endedAt: min(20) }), teams, proofs }).map((p) => `${p.team}${p.stop}`), ['b0']);
  assert.deepEqual(countable({ event: event({ startedAt: null }), teams, proofs }), []);
});

check('proofs for unknown teams or stops are ignored', () => {
  const proofs = [proof('zz', 0, 3), proof('a', 3, 3), proof('a', -1, 3), { team: 'a', stop: '1', at: min(3) }];
  assert.deepEqual(countable({ event: event(), teams, proofs }), []);
});

check('no time limit means the event runs until the organizer ends it', () => {
  assert.equal(closesAt(event({ minutes: null })), Infinity);
  assert.equal(closesAt(event({ minutes: null, endedAt: min(90) })), min(90));
  assert.equal(closesAt(event({ minutes: 30, endedAt: min(90) })), min(30));
});

check('status goes lobby, live, ended', () => {
  assert.equal(status(event({ startedAt: null }), min(0)), 'lobby');
  assert.equal(status(event(), min(59)), 'live');
  assert.equal(status(event(), min(60)), 'ended');
  assert.equal(status(event({ endedAt: min(10) }), min(11)), 'ended');
});

check('custom rules per event', () => {
  const rows = leaderboard({ event: event({ rules: { perStop: 10, first: 0, finish: 0 } }), teams, proofs: [proof('a', 0, 1)] });
  assert.equal(rows[0].points, 10);
});

check('every row has one slot per stop', () => {
  const rows = leaderboard({ event: event(), teams, proofs: [proof('a', 2, 1)] });
  for (const r of rows) assert.equal(r.stops.length, 3);
  assert.deepEqual(rows[0].stops.map(Boolean), [false, false, true]);
});

console.log(`\n${n} scoring checks passed\n`);
