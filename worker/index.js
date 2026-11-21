// The hosted backend for team events: a Cloudflare Worker with one Durable Object per
// event. The object runs the same rules engine as the local adapter (src/team/local.js),
// owns the clock and the keys, and pushes every change to every phone over a WebSocket.
import { DurableObject } from 'cloudflare:workers';
import { createStoreBackend } from '../src/team/local.js';
import { BackendError, checkCode } from '../src/team/backend.js';
import { makeCode } from '../src/team/code.js';

const MAX_BODY = 80000; // a 60,000 character thumbnail plus room for the rest
const MAX_SOCKETS = 200;
const KEEP_DAYS = 30;
const STATUS = { 'not-found': 404, forbidden: 403, taken: 409, 'too-big': 413, origin: 403 };

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
const problem = (code, message) => json({ error: { code, message } }, STATUS[code] ?? 400);

function cors(origin) {
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  } : {};
}

const withHeaders = (res, headers) => {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
};

export default {
  async fetch(request, env) {
    // Browsers always send Origin across sites. Requests without one (curl, tests) pass.
    const origin = request.headers.get('origin');
    const allowed = env.ALLOWED_ORIGINS.split(/\s+/);
    if (origin && !allowed.includes(origin)) return problem('origin', 'This site may not use the event server.');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    const [, root, rawCode] = url.pathname.split('/');
    if (root !== 'events') return problem('not-found', 'Nothing here.');
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BODY) return withHeaders(problem('too-big', 'That request is too big.'), cors(origin));

    const room = (code) => env.EVENTS.get(env.EVENTS.idFromName(code));
    const forward = (code, path) => {
      const headers = new Headers(request.headers);
      headers.set('x-event-code', code);
      return room(code).fetch(new Request(`${url.origin}/events/${code}${path}`, { method: request.method, headers, body: request.body }));
    };

    let res;
    if (!rawCode && request.method === 'POST') {
      const body = await request.text();
      for (let i = 0; i < 5; i++) {
        const code = makeCode();
        res = await room(code).fetch(`${url.origin}/events/${code}/create`, {
          method: 'POST', body, headers: { 'x-event-code': code, 'x-test-now': request.headers.get('x-test-now') ?? '' },
        });
        if (res.status !== 409) break;
      }
    } else {
      let code;
      try { code = checkCode(rawCode); } catch (err) { return withHeaders(problem(err.code, err.message), cors(origin)); }
      res = await forward(code, url.pathname.slice(`/events/${rawCode}`.length));
    }
    return res.status === 101 ? res : withHeaders(res, cors(origin));
  },
};

// SQLite rows as the small synchronous store the rules engine expects.
function sqlStore(sql) {
  // Cursors run lazily, so every statement is read to the end.
  sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)').toArray();
  return {
    getItem: (k) => sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray()[0]?.v ?? null,
    setItem: (k, v) => { sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v)).toArray(); },
    removeItem: (k) => { sql.exec('DELETE FROM kv WHERE k = ?', k).toArray(); },
    keys: (prefix) => sql.exec('SELECT k FROM kv WHERE k >= ? AND k < ? ORDER BY k', prefix, `${prefix}￿`).toArray().map((r) => r.k),
  };
}

export class EventRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.clock = Date.now();
    this.dirty = false;
    this.code = null;
    this.rules = createStoreBackend({
      storage: sqlStore(ctx.storage.sql),
      channel: { postMessage: () => { this.dirty = true; }, addEventListener() {}, close() {} },
      now: () => this.clock,
      newCode: () => this.code,
      kind: 'cloud',
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    this.code = request.headers.get('x-event-code');
    // Tests move the clock with a header, and only when wrangler dev runs with TEST_CLOCK=1.
    const testNow = this.env.TEST_CLOCK === '1' && Number(request.headers.get('x-test-now'));
    this.clock = testNow || Date.now();
    this.dirty = false;
    const url = new URL(request.url);
    const [action, ...rest] = url.pathname.split('/').slice(3);
    if (action === 'ws') return this.connect(request);
    if (action === 'thumb') return this.thumb(rest);
    try {
      const out = await this.run(action, request.method, request.method === 'POST' ? await this.body(request) : null, url.origin);
      if (this.dirty) await this.push(url.origin);
      return json(out ?? null);
    } catch (err) {
      if (err instanceof BackendError) return problem(err.code, err.message);
      throw err;
    }
  }

  async body(request) {
    const text = await request.text();
    if (text.length > MAX_BODY) throw new BackendError('too-big', 'That request is too big.');
    try { return JSON.parse(text || '{}') ?? {}; } catch { throw new BackendError('bad-request', 'That request is not JSON.'); }
  }

  async run(action, method, body, base) {
    const { rules, code } = this;
    const get = method === 'GET';
    if (action === undefined && get) return rules.getEvent(code);
    if (action === 'snapshot' && get) return this.publicSnapshot(base);
    if (method !== 'POST') throw new BackendError('not-found', 'Nothing here.');
    switch (action) {
      case 'create': {
        if (await rules.getEvent(code)) throw new BackendError('taken', 'That code is taken.');
        const made = await rules.createEvent(body);
        await this.ctx.storage.setAlarm(Date.now() + KEEP_DAYS * 86400000);
        return made;
      }
      case 'join': return rules.joinEvent(code, body.teamName);
      case 'start': return rules.startEvent(code, body.hostKey);
      case 'end': return rules.endEvent(code, body.hostKey);
      case 'proof': return this.publicProof(await rules.submitProof(code, body.teamKey, body.proof), base);
      case 'strike': return rules.strikeProof(code, body.hostKey, body.team, body.stop);
      default: throw new BackendError('not-found', 'Nothing here.');
    }
  }

  // Photos are served by URL, so a snapshot pushed to every phone stays small.
  publicProof(p, base) {
    return { ...p, thumb: p.thumb ? `${base}/events/${this.code}/thumb/${p.team}/${p.stop}?v=${p.at}` : '' };
  }

  async publicSnapshot(base) {
    const snap = await this.rules.snapshot(this.code);
    return snap && { ...snap, proofs: snap.proofs.map((p) => this.publicProof(p, base)) };
  }

  async push(base) {
    const message = JSON.stringify(await this.publicSnapshot(base));
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(message); } catch { ws.close(1011, 'Could not send'); }
    }
  }

  async thumb([team, stop]) {
    const snap = await this.rules.snapshot(this.code);
    const p = snap?.proofs.find((x) => x.team === team && x.stop === Number(stop));
    if (!p?.thumb) return problem('not-found', 'No photo.');
    const [, type, data] = p.thumb.match(/^data:([^;]+);base64,(.*)$/);
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' } });
  }

  async connect(request) {
    if (request.headers.get('upgrade') !== 'websocket') return problem('bad-request', 'Expected a WebSocket.');
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return problem('full', 'Too many screens are watching this event.');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(await this.publicSnapshot(new URL(request.url).origin)));
    return new Response(null, { status: 101, webSocket: client });
  }

  // Phones only send "ping", which the runtime answers without waking this object.
  webSocketMessage(ws) {
    ws.close(1008, 'Only ping is accepted here');
  }

  webSocketClose(ws, code) {
    ws.close(code === 1005 || code === 1006 ? 1000 : code, 'Bye');
  }

  // Events are cleared 30 days after they are made. The empty table stays for this instance.
  alarm() {
    for (const ws of this.ctx.getWebSockets()) ws.close(1001, 'This event has been cleared');
    this.ctx.storage.sql.exec('DELETE FROM kv').toArray();
  }
}
