import { PLACES } from './places.js';
import { fetchAround } from './osm.js';
import { toFeatures, planWalk, SPEED, DETOUR } from './plan.js';
import { mapSvg } from './map-svg.js';
import { writeMission, writeTitle } from './mission.js';
import * as gemma from './gemma.js';
import * as photo from './photo.js';
import { backend } from './team/index.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const ICON = {
  viewpoint: '🔭', historic: '🏛️', landmark: '🗼', memorial: '🕯️', hide: '🐦', artwork: '🎨', plaque: '🔵',
  bench: '🪑', tree: '🌳', water: '💧', garden: '🌷', fountain: '⛲', nature: '🪨', attraction: '⭐', bridge: '🌉', picnic: '🧺',
};

// ---------- choices -----------------------------------------------------------------

const choice = { where: null, minutes: 40, who: 'solo', seed: 0, limit: 45 };

$('#places').innerHTML = PLACES.map((p) => `<button class="chip" data-place="${p.id}">${p.name}<small>${p.city}</small></button>`).join('');

function pick(group, value) {
  document.querySelectorAll(`[data-group="${group}"] button`).forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === String(value)));
}
document.querySelectorAll('[data-group] button').forEach((b) => b.addEventListener('click', () => {
  const g = b.closest('[data-group]').dataset.group;
  choice[g] = g === 'minutes' || g === 'limit' ? Number(b.dataset.value) : b.dataset.value;
  pick(g, b.dataset.value);
}));
pick('minutes', 40);
pick('who', 'solo');
pick('limit', 45);

function setWhere(where, label) {
  choice.where = where;
  document.querySelectorAll('#places .chip, #here').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  (where.id ? $(`[data-place="${where.id}"]`) : $('#here')).setAttribute('aria-pressed', 'true');
  $('#where-label').textContent = label;
  $('#go').disabled = false;
}

$('#places').addEventListener('click', (e) => {
  const b = e.target.closest('[data-place]');
  if (b) { const p = PLACES.find((x) => x.id === b.dataset.place); setWhere(p, `Starting at ${p.name}, ${p.city}.`); }
});

$('#here').addEventListener('click', () => {
  $('#where-label').textContent = 'Finding you…';
  navigator.geolocation.getCurrentPosition(
    (pos) => setWhere({ lat: pos.coords.latitude, lon: pos.coords.longitude }, 'Starting where you are. Only a ~500 m square of that is sent to OpenStreetMap.'),
    (err) => { $('#where-label').textContent = `No location (${err.message}). Pick a park above instead.`; },
    { enableHighAccuracy: true, timeout: 15000 },
  );
});

// ---------- making a quest -----------------------------------------------------------

async function featuresFor(where, minutes) {
  if (where.id) {
    const d = await (await fetch(`data/places/${where.id}.json`)).json();
    return toFeatures(d.elements);
  }
  const reach = (minutes * SPEED) / (2 * DETOUR);
  return toFeatures((await fetchAround(where, reach)).elements);
}

let busy = false;
let notes = {}; // per-stop message from the photo judge, kept across renders
$('#go').addEventListener('click', () => make(0));
$('#again').addEventListener('click', () => make(choice.seed + 1));

async function make(seed) {
  if (busy || !choice.where) return;
  busy = true;
  choice.seed = seed;
  notes = {};
  $('#go').disabled = true;
  $('#again').disabled = true;
  status('Reading the map…');
  try {
    const features = await featuresFor(choice.where, choice.minutes);
    const walk = planWalk(features, choice.where, choice.minutes, seed);
    if (!walk) throw new Error('Nothing on the map close enough for that much time. Try a longer walk.');

    const quest = {
      made: Date.now(), who: choice.who, minutes: choice.minutes, title: null,
      start: walk.start, metres: walk.metres, estimate: walk.minutes,
      place: choice.where.id ? `${choice.where.name}, ${choice.where.city}` : 'near you',
      stops: walk.stops.map((s) => ({ ...s, mission: null, rejected: [], fallback: false, done: false })),
    };
    show(quest); // the route is real before a single word is written

    if (!gemma.ready()) {
      status(`Downloading Gemma (${gemma.SIZE_MB} MB, once)…`, 0);
      await gemma.load((f) => status(`Downloading Gemma (${gemma.SIZE_MB} MB, once)…`, f));
    }
    for (const [i, s] of quest.stops.entries()) {
      status(`Gemma is writing stop ${i + 1} of ${quest.stops.length}…`);
      const m = await writeMission(gemma.generate, s, choice.who);
      Object.assign(s, { mission: m.text, rejected: m.rejected, fallback: m.fallback });
      show(quest);
    }
    status('Naming it…');
    quest.title = await writeTitle(gemma.generate, quest.stops);
    store.set('sq:last', quest);
    show(quest);
    status('');
  } catch (err) {
    status(err.message);
  } finally {
    busy = false;
    $('#go').disabled = false;
    $('#again').disabled = false;
  }
}

function status(text, frac) {
  $('#status').textContent = text;
  $('#status-bar').hidden = frac == null;
  if (frac != null) $('#status-bar').value = frac;
}

// ---------- the quest card ------------------------------------------------------------

let current = null;

const reason = (p) => ({
  invented: `“${p.detail}” is not on the map`,
  unsafe: `asks you to ${p.detail}`,
  unanswerable: `asks for a ${p.detail} the map does not have`,
  walker: `mentions a ${p.detail} who is not on this walk`,
  narration: 'describes the place instead of giving you something to do',
  long: `too long (${p.detail})`,
  short: 'too short',
  empty: 'empty',
})[p.type] || p.type;

function show(q) {
  current = q;
  $('#quest').hidden = false;
  $('#q-title').textContent = q.title || (q.stops.every((s) => s.mission) ? 'Your sidequest' : 'Your sidequest, being written…');
  $('#q-meta').textContent = `${(q.metres / 1000).toFixed(1)} km loop · about ${q.estimate} min · ${q.stops.length} stops · ${q.place}`;
  $('#map').innerHTML = mapSvg(q.start, q.stops, q.stops.map((st) => st.done));
  $('#stops').innerHTML = q.stops.map((s, i) => {
    const from = i ? q.stops[i - 1] : q.start;
    const dir = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${s.lat},${s.lon}&travelmode=walking`;
    const why = s.mission ? `<details class="why"><summary>Why this mission?</summary>
        <p>Everything Gemma knew about this place, straight from <a href="https://www.openstreetmap.org/${s.osm}" target="_blank" rel="noopener">OpenStreetMap</a>:</p>
        <ul>${s.facts.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ul>
        ${s.rejected.map((r) => `<p class="rejected">Draft rejected: “${esc(r.text)}” <span>${esc(r.problems.map(reason).join('; '))}</span></p>`).join('')}
        ${s.fallback ? '<p class="rejected">Gemma could not write one that passed, so this is a plain template. Boring beats invented.</p>' : ''}
      </details>` : '';
    return `<li class="stop${s.done ? ' done' : ''}">
      <span class="num">${i + 1}</span>
      <div>
        <h3>${ICON[s.kind] || '📍'} ${esc(s.title)}</h3>
        <p class="mission">${s.mission ? esc(s.mission) : '<span class="writing">Gemma is writing…</span>'}</p>
        <div class="row">
          <a href="${dir}" target="_blank" rel="noopener">Walk there ↗</a>
          <label><input type="checkbox" data-done="${i}"${s.done ? ' checked' : ''}> Done</label>
          ${s.mission && !s.proof ? `<label class="camera"><input type="file" accept="image/*" capture="environment" data-prove="${i}">📷 Prove it</label>` : ''}
        </div>
        ${s.proof ? `<p class="proven"><img src="${esc(s.proof.thumb)}" alt="Your proof photo"> Proven with a photo.</p>` : ''}
        ${notes[i] && !s.proof ? `<p class="verdict ${notes[i].kind}" data-note="${i}">${esc(notes[i].text)}</p>` : ''}
        ${why}
      </div>
    </li>`;
  }).join('');
  const done = q.stops.filter((s) => s.done).length;
  $('#progress').textContent = done === q.stops.length ? 'Quest complete. Go home the long way.' : done ? `${done} of ${q.stops.length} done` : '';
  $('#host-event').disabled = !q.stops.every((s) => s.mission);
}

$('#stops').addEventListener('change', (e) => {
  const i = e.target.dataset.done;
  if (i == null || !current) return;
  current.stops[i].done = e.target.checked;
  store.set('sq:last', current);
  show(current);
});

// Photo proof: the judge runs on this phone, and the photo never leaves it.
$('#stops').addEventListener('change', async (e) => {
  const i = e.target.dataset.prove;
  const file = e.target.files?.[0];
  if (i == null || !current) return;
  e.target.value = '';
  if (!file) return;
  const q = current;
  const s = q.stops[i];
  const loading = `Downloading the photo judge (${photo.SIZE_MB} MB, once)…`;
  notes[i] = { kind: 'pending', text: photo.ready() ? 'Checking the photo…' : loading };
  show(q);
  try {
    const say = (text) => { const el = document.querySelector(`[data-note="${i}"]`); if (el) el.textContent = text; };
    await photo.load((f) => say(`${loading} ${Math.round(f * 100)}%`));
    say('Checking the photo…');
    const v = await photo.prove(file, s);
    if (v.ok) {
      Object.assign(s, { proof: { thumb: v.thumb, top: v.top }, done: true });
      delete notes[i];
      store.set('sq:last', q);
    } else {
      notes[i] = { kind: 'no', text: photo.explain(v, s) };
    }
  } catch (err) {
    notes[i] = { kind: 'no', text: err.message };
  }
  if (current === q) show(q);
});

// A team event: every team walks this quest, and the organizer gets a code and a dashboard.
$('#host-event').addEventListener('click', async () => {
  if (!current) return;
  $('#host-status').textContent = '';
  try {
    const name = $('#event-name').value.trim() || current.title || 'WalkQuest team event';
    const { code, hostKey } = await backend.createEvent({ name, quest: current, minutes: choice.limit || null });
    location.href = `event.html#code=${code}&host=${hostKey}`;
  } catch (err) {
    $('#host-status').textContent = err.message;
  }
});

$('#share').addEventListener('click', async () => {
  const q = current;
  const text = `${q.title || 'WalkQuest'}: ${(q.metres / 1000).toFixed(1)} km, ${q.stops.length} stops\n` +
    q.stops.map((s, i) => `${i + 1}. ${s.title}: ${s.mission}`).join('\n') + `\n${location.origin}${location.pathname}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); status('Copied to clipboard.'); }
  } catch { /* dismissed */ }
});

// ---------- boot ----------------------------------------------------------------------

const last = store.get('sq:last', null);
if (last) show(last);
$('#size').textContent = `${gemma.SIZE_MB} MB`;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
