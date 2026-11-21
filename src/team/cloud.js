// The hosted backend: the Worker in worker/, one Durable Object per event. It runs the
// same rules as the local adapter, so this file only moves calls over HTTP and listens
// for pushed snapshots on a WebSocket. Passes tests/backend-contract.mjs (tests/cloud.mjs).
import { BackendError, checkCode } from './backend.js';

const PING_MS = 25000;

/** `headers` adds request headers; the tests use it to move the server's test clock. */
export function createCloudBackend({ url, headers = () => ({}) }) {
  const base = url.replace(/\/+$/, '');
  const subscriptions = new Set();

  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers() },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new BackendError('offline', 'Could not reach the event server. Check your signal and try again.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new BackendError(data?.error?.code ?? 'server', data?.error?.message ?? `The event server said ${res.status}.`);
    return data;
  }

  const post = async (input, action, body) => call('POST', `/events/${checkCode(input)}/${action}`, body);

  return {
    kind: 'cloud',
    createEvent: async (event) => call('POST', '/events', event),
    getEvent: async (input) => call('GET', `/events/${checkCode(input)}`),
    joinEvent: async (input, teamName) => post(input, 'join', { teamName }),
    startEvent: async (input, hostKey) => post(input, 'start', { hostKey }),
    endEvent: async (input, hostKey) => post(input, 'end', { hostKey }),
    submitProof: async (input, teamKey, proof) => post(input, 'proof', { teamKey, proof }),
    strikeProof: async (input, hostKey, team, stop) => { await post(input, 'strike', { hostKey, team, stop }); },
    snapshot: async (input) => call('GET', `/events/${checkCode(input)}/snapshot`),

    /** Calls `fn` with the current snapshot as soon as the socket opens, then on every change. Reconnects on its own. */
    subscribe(input, fn) {
      const code = checkCode(input);
      let ws = null;
      let done = false;
      let tries = 0;
      let retry = null;
      const open = () => {
        ws = new WebSocket(`${base.replace(/^http/, 'ws')}/events/${code}/ws`);
        ws.addEventListener('open', () => { tries = 0; });
        ws.addEventListener('message', (e) => { if (!done && e.data !== 'pong') fn(JSON.parse(e.data)); });
        ws.addEventListener('close', () => { if (!done) retry = setTimeout(open, Math.min(30000, 1000 * 2 ** tries++)); });
      };
      const ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, PING_MS);
      open();
      const off = () => {
        done = true;
        clearInterval(ping);
        clearTimeout(retry);
        ws.close();
        subscriptions.delete(off);
      };
      subscriptions.add(off);
      return off;
    },

    close() {
      for (const off of [...subscriptions]) off();
    },
  };
}
