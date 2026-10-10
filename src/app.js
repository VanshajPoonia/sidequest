import { PLACES } from './places.js';
import { fetchAround } from './osm.js';
import { toFeatures, planWalk, sketch, SPEED, DETOUR } from './plan.js';
import { writeMission, writeTitle } from './mission.js';
import * as gemma from './gemma.js';

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

const choice = { where: null, minutes: 40, who: 'solo', seed: 0 };

$('#places').innerHTML = PLACES.map((p) => `<button class="chip" data-place="${p.id}">${p.name}<small>${p.city}</small></button>`).join('');

function pick(group, value) {
  document.querySelectorAll(`[data-group="${group}"] button`).forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === String(value)));
}
document.querySelectorAll('[data-group] button').forEach((b) => b.addEventListener('click', () => {
  const g = b.closest('[data-group]').dataset.group;
  choice[g] = g === 'minutes' ? Number(b.dataset.value) : b.dataset.value;
  pick(g, b.dataset.value);
}));
pick('minutes', 40);
pick('who', 'solo');

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
$('#go').addEventListener('click', () => make(0));
$('#again').addEventListener('click', () => make(choice.seed + 1));

async function make(seed) {
  if (busy || !choice.where) return;
  busy = true;
  choice.seed = seed;
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
  $('#map').innerHTML = mapSvg(q);
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
        </div>
        ${why}
      </div>
    </li>`;
  }).join('');
  const done = q.stops.filter((s) => s.done).length;
  $('#progress').textContent = done === q.stops.length ? 'Quest complete. Go home the long way.' : done ? `${done} of ${q.stops.length} done` : '';
}

$('#stops').addEventListener('change', (e) => {
  const i = e.target.dataset.done;
  if (i == null || !current) return;
  current.stops[i].done = e.target.checked;
  store.set('sq:last', current);
  show(current);
});

$('#share').addEventListener('click', async () => {
  const q = current;
  const text = `${q.title || 'Sidequest'}: ${(q.metres / 1000).toFixed(1)} km, ${q.stops.length} stops\n` +
    q.stops.map((s, i) => `${i + 1}. ${s.title}: ${s.mission}`).join('\n') + `\n${location.origin}${location.pathname}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); status('Copied to clipboard.'); }
  } catch { /* dismissed */ }
});

function mapSvg(q) {
  const W = 340, H = 230;
  const { points, scaleBar } = sketch(q.start, q.stops, W, H);
  const [s, ...ps] = points;
  const d = `M${s.x},${s.y} ` + ps.map((p) => `L${p.x},${p.y}`).join(' ') + ` L${s.x},${s.y}`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sketch map of the loop">
    <path d="${d}" class="route"/>
    <g class="start"><circle cx="${s.x}" cy="${s.y}" r="9"/><text x="${s.x}" y="${s.y + 4}">S</text></g>
    ${ps.map((p, i) => `<g class="pin${q.stops[i].done ? ' done' : ''}"><circle cx="${p.x}" cy="${p.y}" r="11"/><text x="${p.x}" y="${p.y + 4}">${i + 1}</text></g>`).join('')}
    <g class="north" transform="translate(${W - 20},24)"><path d="M0,-12 L6,6 L0,2 L-6,6 Z"/><text y="18">N</text></g>
    <g class="scale" transform="translate(14,${H - 14})"><path d="M0,0 H${scaleBar.px}"/><text x="${scaleBar.px / 2}" y="-6">${scaleBar.metres} m</text></g>
  </svg>`;
}

// ---------- boot ----------------------------------------------------------------------

const last = store.get('sq:last', null);
if (last) show(last);
$('#size').textContent = `${gemma.SIZE_MB} MB`;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
