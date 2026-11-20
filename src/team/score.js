// Points and the leaderboard. Pure, tested in tests/team.mjs.
//
// Every phone and the organizer's dashboard compute the table from the same raw
// proofs, so nobody's screen can disagree about who is winning.

export const RULES = { perStop: 100, first: 25, finish: 50 };

/** When proofs stop counting: the time limit or the organizer pressing End, whichever is first. */
export function closesAt(event) {
  const limit = event.startedAt != null && event.minutes ? event.startedAt + event.minutes * 60000 : Infinity;
  return Math.min(limit, event.endedAt ?? Infinity);
}

export function status(event, now = Date.now()) {
  if (event.startedAt == null) return 'lobby';
  return now >= closesAt(event) ? 'ended' : 'live';
}

/** Proofs that count: for a real stop and team, inside the event window, earliest per stop. */
export function countable({ event, teams, proofs }) {
  const ids = new Set(teams.map((t) => t.id));
  const end = closesAt(event);
  const best = new Map();
  for (const p of proofs) {
    if (!ids.has(p.team) || !Number.isInteger(p.stop) || p.stop < 0 || p.stop >= event.quest.stops.length) continue;
    if (event.startedAt == null || p.at < event.startedAt || p.at > end) continue;
    const k = `${p.team}:${p.stop}`;
    if (!best.has(k) || p.at < best.get(k).at) best.set(k, p);
  }
  return [...best.values()];
}

/**
 * One row per team, best first. 100 a stop, 25 for being first to a stop, 50 for
 * proving every stop. Ties on points go to whoever got their last proof in first.
 * Teams level on both share a rank.
 */
export function leaderboard(snap, rules = snap.event.rules ?? RULES) {
  const n = snap.event.quest.stops.length;
  const proofs = countable(snap);
  const firstAt = new Array(n).fill(Infinity);
  for (const p of proofs) firstAt[p.stop] = Math.min(firstAt[p.stop], p.at);

  const rows = snap.teams.map((t) => {
    const mine = proofs.filter((p) => p.team === t.id);
    const stops = new Array(n).fill(null);
    for (const p of mine) stops[p.stop] = p;
    const firsts = mine.filter((p) => p.at === firstAt[p.stop]).length;
    const done = mine.length === n;
    const last = mine.length ? Math.max(...mine.map((p) => p.at)) : null;
    const points = mine.length * rules.perStop + firsts * rules.first + (done ? rules.finish : 0);
    return { team: t.id, name: t.name, points, proven: mine.length, firsts, done, last, stops };
  });

  rows.sort((a, b) => b.points - a.points || (a.last ?? Infinity) - (b.last ?? Infinity) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.points === r.points && prev.last === r.last ? prev.rank : i + 1;
  });
  return rows;
}
