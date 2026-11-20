// The backend contract for team events. The game only talks to an object with these
// methods, so moving from one device to a hosted backend means writing one adapter.
// tests/backend.mjs runs the same contract checks against every adapter.
//
//   createEvent({ name, quest, minutes })              -> { code, hostKey }
//   getEvent(code)                                     -> event, or null
//   joinEvent(code, teamName)                          -> { team, teamKey }
//   startEvent(code, hostKey), endEvent(code, hostKey) -> event
//   submitProof(code, teamKey, { stop, thumb, top })   -> proof
//   strikeProof(code, hostKey, teamId, stop)           -> undefined
//   snapshot(code)                                     -> { event, teams, proofs }
//   subscribe(code, onSnapshot)                        -> unsubscribe()
//
// Rules every adapter enforces, a hosted one on its server and not in the page:
// - the backend stamps every time (at, startedAt, endedAt), never the phone
// - only the host key can start, end or strike, and a team key only proves for its own team
// - team names are unique per event, ignoring case
// - one proof per team per stop, and the first one stands
import { isValidCode, normalizeCode } from './code.js';
import { status } from './score.js';

export const LIMITS = { teams: 50, name: 24, eventName: 60, stops: 8, thumb: 60000, minutes: [5, 240] };

export class BackendError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => { throw new BackendError(code, message); };

export function checkCode(input) {
  const code = normalizeCode(input);
  if (!isValidCode(code)) fail('bad-code', 'That event code has a typo in it.');
  return code;
}

export function cleanName(input, max = LIMITS.name) {
  const name = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!name) fail('bad-name', 'Give it a name.');
  if (name.length > max) fail('bad-name', `Keep the name under ${max + 1} characters.`);
  return name;
}

/** Only what a team needs to walk the quest. Drafts, facts and scores stay with the organizer. */
export function cleanQuest(quest) {
  const stops = quest?.stops;
  if (!Array.isArray(stops) || !stops.length || stops.length > LIMITS.stops) fail('bad-quest', 'A quest needs 1 to 8 stops.');
  const num = (x) => (Number.isFinite(x) ? x : fail('bad-quest', 'A stop is missing its position.'));
  return {
    title: String(quest.title || 'WalkQuest').slice(0, 80),
    place: String(quest.place || '').slice(0, 80),
    metres: Number(quest.metres) || 0,
    start: { lat: num(quest.start?.lat), lon: num(quest.start?.lon) },
    stops: stops.map((s) => ({
      title: String(s.title || '').slice(0, 120) || fail('bad-quest', 'A stop has no title.'),
      kind: String(s.kind || ''),
      osm: String(s.osm || ''),
      lat: num(s.lat),
      lon: num(s.lon),
      mission: String(s.mission || '').slice(0, 400) || fail('bad-quest', 'Write the missions before starting an event.'),
    })),
  };
}

export function cleanMinutes(m) {
  if (m == null) return null;
  const [lo, hi] = LIMITS.minutes;
  if (!Number.isInteger(m) || m < lo || m > hi) fail('bad-minutes', `A time limit is ${lo} to ${hi} minutes.`);
  return m;
}

export function checkProof(event, input, now) {
  if (status(event, now) !== 'live') fail('not-live', event.startedAt == null ? 'The organizer has not started yet.' : 'Time is up.');
  const { stop, thumb = '', top = [] } = input;
  if (!Number.isInteger(stop) || stop < 0 || stop >= event.quest.stops.length) fail('bad-stop', 'There is no such stop.');
  if (typeof thumb !== 'string' || thumb.length > LIMITS.thumb) fail('too-big', 'That photo is too big to send.');
  return {
    stop,
    thumb,
    top: top.slice(0, 3).map((t) => ({ id: String(t.id), name: String(t.name ?? t.id), p: Number(t.p) || 0 })),
  };
}

export { fail };
