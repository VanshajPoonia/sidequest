// The rules engine for team events, over any synchronous key-value store. In the browser
// that is localStorage plus a BroadcastChannel (createLocalBackend). In the Worker it is
// one Durable Object's SQLite table, so both run exactly this code.
//
// One storage key per record (event, team, proof), the way a document database would
// hold them, so two tabs writing at once never overwrite each other's records.
import { makeCode } from './code.js';
import { LIMITS, checkCode, cleanName, cleanQuest, cleanMinutes, checkProof, fail } from './backend.js';

function secret(n = 16) {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => (b % 36).toString(36)).join('');
}

/** `storage` is Web Storage shaped (getItem, setItem, removeItem, length, key) and may add a faster keys(prefix). */
export function createStoreBackend({ storage, channel, now = Date.now, newCode = makeCode, kind = 'store' }) {
  const read = (k) => { const v = storage.getItem(k); return v == null ? null : JSON.parse(v); };
  const write = (k, v) => storage.setItem(k, JSON.stringify(v));
  const keys = (prefix) => {
    if (storage.keys) return storage.keys(prefix);
    const out = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k.startsWith(prefix)) out.push(k);
    }
    return out;
  };

  const listeners = new Map();
  function changed(code) {
    channel.postMessage({ code });
    tell(code);
  }
  function tell(code) {
    const fns = listeners.get(code);
    if (!fns?.size) return;
    const snap = snapshotNow(code);
    for (const fn of fns) fn(snap);
  }
  channel.addEventListener('message', (e) => tell(e.data?.code));

  function eventOr404(code) {
    return read(`wq:event:${code}`) ?? fail('not-found', 'No event with that code on this device.');
  }
  function host(code, hostKey) {
    const event = eventOr404(code);
    if (read(`wq:host:${code}`) !== hostKey) fail('forbidden', 'Only the organizer can do that.');
    return event;
  }
  function snapshotNow(code) {
    const event = read(`wq:event:${code}`);
    if (!event) return null;
    const teams = keys(`wq:team:${code}:`).map(read).sort((a, b) => a.joinedAt - b.joinedAt);
    const proofs = keys(`wq:proof:${code}:`).map(read).sort((a, b) => a.at - b.at);
    return { event, teams, proofs };
  }

  return {
    kind,

    async createEvent({ name, quest, minutes = null }) {
      const event = { name: cleanName(name, LIMITS.eventName), quest: cleanQuest(quest), minutes: cleanMinutes(minutes), createdAt: now(), startedAt: null, endedAt: null };
      let code = newCode();
      while (read(`wq:event:${code}`)) code = newCode();
      const hostKey = secret();
      write(`wq:event:${code}`, { code, ...event });
      write(`wq:host:${code}`, hostKey);
      changed(code);
      return { code, hostKey };
    },

    async getEvent(input) {
      return read(`wq:event:${checkCode(input)}`);
    },

    async joinEvent(input, teamName) {
      const code = checkCode(input);
      const event = eventOr404(code);
      if (event.endedAt != null) fail('not-live', 'This event is over.');
      const name = cleanName(teamName);
      const teams = keys(`wq:team:${code}:`).map(read);
      if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) fail('name-taken', 'Another team already has that name.');
      if (teams.length >= LIMITS.teams) fail('full', 'This event is full.');
      const team = { id: secret(8), name, joinedAt: now() };
      const key = secret();
      write(`wq:team:${code}:${team.id}`, team);
      write(`wq:teamkey:${code}:${team.id}`, key);
      changed(code);
      return { team, teamKey: `${team.id}.${key}` };
    },

    async startEvent(input, hostKey) {
      const code = checkCode(input);
      const event = host(code, hostKey);
      if (event.startedAt == null) {
        event.startedAt = now();
        write(`wq:event:${code}`, event);
        changed(code);
      }
      return event;
    },

    async endEvent(input, hostKey) {
      const code = checkCode(input);
      const event = host(code, hostKey);
      if (event.endedAt == null) {
        event.endedAt = now();
        write(`wq:event:${code}`, event);
        changed(code);
      }
      return event;
    },

    async submitProof(input, teamKey, proof) {
      const code = checkCode(input);
      const event = eventOr404(code);
      const [team, key] = String(teamKey ?? '').split('.');
      if (!team || read(`wq:teamkey:${code}:${team}`) !== key) fail('forbidden', 'This phone is not on that team.');
      const clean = checkProof(event, proof, now());
      const k = `wq:proof:${code}:${team}:${clean.stop}`;
      const existing = read(k);
      if (existing) return existing;
      const saved = { team, ...clean, at: now() };
      write(k, saved);
      changed(code);
      return saved;
    },

    async strikeProof(input, hostKey, team, stop) {
      const code = checkCode(input);
      host(code, hostKey);
      storage.removeItem(`wq:proof:${code}:${team}:${stop}`);
      changed(code);
    },

    async snapshot(input) {
      return snapshotNow(checkCode(input));
    },

    subscribe(input, fn) {
      const code = checkCode(input);
      if (!listeners.has(code)) listeners.set(code, new Set());
      listeners.get(code).add(fn);
      fn(snapshotNow(code));
      return () => listeners.get(code).delete(fn);
    },

    close() {
      channel.close();
    },
  };
}

/** Events in this browser only. Tabs hear each other over a BroadcastChannel. */
export const createLocalBackend = ({
  storage = globalThis.localStorage,
  channel = new BroadcastChannel('walkquest-events'),
  ...rest
} = {}) => createStoreBackend({ storage, channel, kind: 'local', ...rest });
