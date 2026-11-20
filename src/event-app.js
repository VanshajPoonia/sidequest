// The team event page: join with a code, walk the quest, prove each stop with a photo,
// watch the leaderboard. The organizer gets the same page with a dashboard.
//
// event.html#code=ABC2DE            a team
// event.html#code=ABC2DE&host=KEY   the organizer
import { backend } from './team/index.js';
import { normalizeCode, isValidCode, formatCode } from './team/code.js';
import { leaderboard, status, closesAt } from './team/score.js';
import { mapSvg } from './map-svg.js';
import * as photo from './photo.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const keep = (area) => ({
  get(k) { try { return JSON.parse(area.getItem(k)); } catch { return null; } },
  set(k, v) { try { area.setItem(k, JSON.stringify(v)); } catch { /* private mode: this tab still works */ } },
});
// Team identity is per tab, so two tabs can play as two teams. The local copy lets a
// phone that closed the tab rejoin as the same team.
const tab = keep(sessionStorage);
const device = keep(localStorage);

const hash = new URLSearchParams(location.hash.slice(1));
let code = normalizeCode(hash.get('code'));
let hostKey = null;
let me = null;
let snap = null;
let shown = null;
const notes = {}; // per-stop message from the judge, kept across renders

// ---------- boot -----------------------------------------------------------------------

$('.note').hidden = backend.kind !== 'local';
addEventListener('hashchange', () => location.reload());

function boot() {
  if (!isValidCode(code)) return showJoin(hash.get('code') ? 'That event code has a typo in it.' : '');
  // Only the organizer link opens the dashboard, so a team tab on the same device still joins.
  hostKey = hash.get('host');
  if (hostKey) device.set(`wq:host:${code}`, hostKey);
  me = hostKey ? null : tab.get(`wq:me:${code}`);
  if (!hostKey && !me) return showJoin('');
  backend.subscribe(code, (s) => {
    snap = s;
    render();
  });
  setInterval(tick, 1000);
}

function showJoin(message) {
  $('#join').hidden = false;
  $('#code').value = isValidCode(code) ? formatCode(code) : hash.get('code') || '';
  $('#join-status').textContent = message;
  const remembered = isValidCode(code) && device.get(`wq:me:${code}`);
  $('#rejoin').hidden = !remembered;
  if (remembered) $('#rejoin-btn').textContent = `Carry on as ${remembered.team.name}`;
  const ownKey = isValidCode(code) && device.get(`wq:host:${code}`);
  $('#host-link').hidden = !ownKey;
  if (ownKey) $('#host-link a').href = `#code=${code}&host=${ownKey}`;
  ($('#code').value ? $('#team-name') : $('#code')).focus();
}

$('#rejoin-btn').addEventListener('click', () => {
  tab.set(`wq:me:${code}`, device.get(`wq:me:${code}`));
  location.reload();
});

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const typed = normalizeCode($('#code').value);
  $('#join-status').textContent = 'Joining…';
  try {
    const joined = await backend.joinEvent(typed, $('#team-name').value);
    tab.set(`wq:me:${typed}`, joined);
    device.set(`wq:me:${typed}`, joined);
    location.hash = `code=${typed}`;
    location.reload();
  } catch (err) {
    $('#join-status').textContent = err.message;
  }
});

// ---------- rendering ------------------------------------------------------------------

function clockText(event) {
  const st = status(event);
  if (st === 'lobby') return 'Waiting for the organizer to start the clock.';
  if (st === 'ended') return event.endedAt != null && event.endedAt < closesAt({ ...event, endedAt: null }) ? 'The organizer ended the event.' : 'Time is up.';
  const left = closesAt(event) - Date.now();
  if (!Number.isFinite(left)) return 'Live. No time limit.';
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  return `Live. ${m}:${String(s).padStart(2, '0')} left.`;
}

function tick() {
  if (!snap) return;
  const st = status(snap.event);
  if (st !== shown) return render();
  $('#clock').textContent = clockText(snap.event);
  $('#clock-host').textContent = clockText(snap.event);
}

function render() {
  if (!snap) {
    $('#ev-name').textContent = 'No such event here';
    $('#ev-meta').textContent = 'This event is not in this browser. Events live on the device that made them until a shared backend is switched on.';
    return;
  }
  const { event } = snap;
  shown = status(event);
  document.title = `${event.name}: WalkQuest`;
  $('#ev-name').textContent = event.name;
  const limit = event.minutes ? `${event.minutes} min` : 'no time limit';
  $('#ev-meta').textContent = `${event.quest.title} · ${event.quest.stops.length} stops · ${(event.quest.metres / 1000).toFixed(1)} km · ${limit} · ${event.quest.place}`;
  const rows = leaderboard(snap);
  if (hostKey) renderHost(rows); else renderTeam(rows);
  renderBoard(rows);
  tick();
}

function renderBoard(rows) {
  $('#board').hidden = false;
  const n = snap.event.quest.stops.length;
  $('#rows').innerHTML = rows.map((r) => `<li class="${me && r.team === me.team.id ? 'mine' : ''}">
    <span class="rank">${r.rank}</span>
    <span class="who">${esc(r.name)}<small>${r.proven} of ${n} stops${r.firsts ? `, first to ${r.firsts}` : ''}${r.done ? ', all done' : ''}</small></span>
    <span class="pts">${r.points}</span>
  </li>`).join('') || '<li class="empty">No teams yet.</li>';
}

function renderHost(rows) {
  $('#host').hidden = false;
  const { event } = snap;
  const st = status(event);
  $('#big-code').textContent = formatCode(code);
  $('#team-tab').href = joinLink();
  $('#start').disabled = st !== 'lobby';
  $('#end').disabled = st !== 'live';
  const stops = event.quest.stops;
  $('#grid').innerHTML = `<thead><tr><th>#</th><th>Team</th>${stops.map((s, i) => `<th title="${esc(s.title)}">${i + 1}</th>`).join('')}<th>Pts</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${r.rank}</td><td class="team">${esc(r.name)}</td>
      ${r.stops.map((p, i) => `<td>${p ? `<button class="cell" data-team="${esc(r.team)}" data-stop="${i}" aria-label="${esc(r.name)}, stop ${i + 1}"><img src="${esc(p.thumb)}" alt=""></button>` : '<span class="dot">·</span>'}</td>`).join('')}
      <td class="pts">${r.points}</td>
    </tr>`).join('') || `<tr><td colspan="${stops.length + 3}" class="empty">No teams yet. Share the code.</td></tr>`}</tbody>`;
}

function renderTeam(rows) {
  const { event } = snap;
  const mine = rows.find((r) => r.team === me.team.id);
  if (!mine) {
    tab.set(`wq:me:${code}`, null);
    $('#play').hidden = true;
    return showJoin('Your team is not in this event any more. Join again.');
  }
  $('#play').hidden = false;
  const st = status(event);
  $('#team-label').textContent = `Team ${me.team.name}`;
  $('#q-title').textContent = event.quest.title;
  $('#map').innerHTML = mapSvg(event.quest.start, event.quest.stops, mine.stops.map(Boolean));
  $('#judge').hidden = photo.ready() || st === 'ended';
  $('#stops').innerHTML = event.quest.stops.map((s, i) => {
    const from = i ? event.quest.stops[i - 1] : event.quest.start;
    const dir = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${s.lat},${s.lon}&travelmode=walking`;
    const p = mine.stops[i];
    const note = notes[i];
    let action = '';
    if (p) action = `<p class="proven"><img src="${esc(p.thumb)}" alt="Your proof photo"> Proven${p.at === Math.min(...rows.map((r) => r.stops[i]?.at ?? Infinity)) ? ', first team here' : ''}.</p>`;
    else if (st === 'live') action = `<label class="primary camera"><input type="file" accept="image/*" capture="environment" data-prove="${i}">📷 Prove it</label>`;
    else if (st === 'lobby') action = '<p class="small">Proof opens when the clock starts.</p>';
    return `<li class="stop${p ? ' done' : ''}">
      <span class="num">${i + 1}</span>
      <div>
        <h3>${esc(s.title)}</h3>
        <p class="mission">${esc(s.mission)}</p>
        <div class="row"><a href="${dir}" target="_blank" rel="noopener">Walk there ↗</a></div>
        ${action}
        ${note && !p ? `<p class="verdict ${note.kind}">${esc(note.text)}</p>` : ''}
      </div>
    </li>`;
  }).join('');
}

const joinLink = () => `${location.origin}${location.pathname}#code=${code}`;

// ---------- team actions ---------------------------------------------------------------

async function ensureJudge() {
  if (photo.ready()) return;
  const bar = $('#judge progress');
  bar.hidden = false;
  $('#judge .load-label').textContent = `Downloading the photo judge, once. ${photo.SIZE_MB} MB.`;
  await photo.load((f) => { bar.value = f; });
  bar.hidden = true;
  $('#judge').hidden = true;
}

$('#judge-load').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try { await ensureJudge(); } catch (err) {
    $('#judge .load-label').textContent = `Could not load the judge: ${err.message}`;
    e.target.disabled = false;
  }
});

$('#stops').addEventListener('change', async (e) => {
  const i = Number(e.target.dataset.prove);
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || Number.isNaN(i)) return;
  const stop = snap.event.quest.stops[i];
  notes[i] = { kind: 'pending', text: photo.ready() ? 'Checking the photo…' : 'Downloading the photo judge first…' };
  render();
  try {
    await ensureJudge();
    const v = await photo.prove(file, stop);
    if (v.ok) {
      notes[i] = null;
      await backend.submitProof(code, me.teamKey, { stop: i, thumb: v.thumb, top: v.top });
    } else {
      notes[i] = { kind: 'no', text: photo.explain(v, stop) };
    }
  } catch (err) {
    notes[i] = { kind: 'no', text: err.message };
  }
  render();
});

// ---------- organizer actions ----------------------------------------------------------

async function hostAction(fn) {
  $('#host-status').textContent = '';
  try { await fn(); } catch (err) { $('#host-status').textContent = err.message; }
}

$('#start').addEventListener('click', () => hostAction(() => backend.startEvent(code, hostKey)));
$('#end').addEventListener('click', () => {
  if (confirm('End the event now? Proofs stop counting.')) hostAction(() => backend.endEvent(code, hostKey));
});

$('#copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(joinLink());
    $('#host-status').textContent = 'Join link copied.';
  } catch {
    $('#host-status').textContent = joinLink();
  }
});

let picked = null;
$('#grid').addEventListener('click', (e) => {
  const b = e.target.closest('.cell');
  if (!b) return;
  const team = snap.teams.find((t) => t.id === b.dataset.team);
  const stop = Number(b.dataset.stop);
  const p = snap.proofs.find((x) => x.team === team.id && x.stop === stop);
  picked = { team: team.id, stop };
  $('#photo-title').textContent = `${team.name} at stop ${stop + 1}`;
  $('#photo-img').src = p.thumb;
  const seen = p.top.map((t) => `${t.name} ${(t.p * 100).toFixed(0)}%`).join(', ');
  $('#photo-meta').textContent = `${snap.event.quest.stops[stop].title}. Proven at ${new Date(p.at).toLocaleTimeString()}. The judge saw: ${seen || 'nothing recorded'}.`;
  $('#photo').showModal();
});

$('#strike').addEventListener('click', () => hostAction(async () => {
  await backend.strikeProof(code, hostKey, picked.team, picked.stop);
  $('#photo').close();
}));

$('#photo').addEventListener('click', (e) => {
  if (e.target === $('#photo') || e.target.closest('[data-close]')) $('#photo').close();
});

boot();
