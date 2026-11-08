import { DATA_BASE, TEAMS } from './config.js';
import {
  normalizeGame, videoStatus, splitGames, summarize, dayLabel, timeLabel,
} from './games.js';
import { pingHelper } from './helper-client.js';

const $ = (id) => document.getElementById(id);
const RECENT_PAGE = 12;

const state = {
  kid: readSaved('fwp.kid', 'all'),
  games: [],
  logos: new Map(),     // "divisionId|team name" -> logo path
  downloaded: new Set(),
  shown: RECENT_PAGE,
};

function readSaved(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private window: fine */ }
}

// Small element builder: h('td', { class: 'x' }, child, 'text', …)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- data ----------
async function getJson(rel) {
  const res = await fetch(DATA_BASE + rel, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${rel}: ${res.status}`);
  return res.json();
}

async function loadLogos() {
  const [teams, clubs] = await Promise.all([
    getJson('data/teams.json').catch(() => []),
    getJson('data/clubs.json').catch(() => []),
  ]);
  for (const t of [...teams, ...clubs]) {
    if (t && t.name && t.logo) state.logos.set(`${t.divisionId}|${t.name}`, t.logo);
  }
}

async function load() {
  const results = await Promise.allSettled(TEAMS.map(async (team) => {
    const rows = await getJson(team.feed);
    return rows
      .filter((r) => r.home === team.feedName || r.away === team.feedName)
      .map((r) => ({ ...normalizeGame(r, team), divisionId: r.divisionId }));
  }));
  const failed = TEAMS.filter((_, i) => results[i].status === 'rejected').map((t) => t.kid);
  state.games = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  await loadLogos();

  let updated = '';
  try {
    const meta = await getJson('data/meta.json');
    const when = new Date(meta.updatedAt);
    updated = `League schedules and scores · updated ${when.toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
  } catch { updated = 'League schedules and scores'; }
  $('updated').textContent = updated + (failed.length ? ` · couldn't load ${failed.join(' and ')}'s games` : '');
  if (state.games.length === 0) showLoadError();
  render();
}

function showLoadError() {
  $('recentBody').replaceChildren(h('tr', {}, h('td', { colspan: 8 },
    h('div', { class: 'error-box' }, "Couldn't load the league schedules. Check your connection and reload the page."))));
}

// ---------- rendering ----------
function renderKidFilter() {
  const options = [{ key: 'all', label: 'Both kids' }, ...TEAMS.map((t) => ({ key: t.kid, label: `${t.kid} · ${t.label}`, logo: t.logo }))];
  $('kidFilter').replaceChildren(...options.map((o) => h('button', {
    type: 'button',
    class: `kid-chip${o.logo ? '' : ' no-logo'}`,
    'aria-pressed': String(state.kid === o.key),
    onclick: () => { state.kid = o.key; state.shown = RECENT_PAGE; save('fwp.kid', o.key); render(); },
  }, o.logo ? h('img', { src: DATA_BASE + o.logo, alt: '' }) : null, o.label)));
}

const PILL = {
  downloaded: 'pill-good', ready: 'pill-info', 'leaves-soon': 'pill-work', today: 'pill-none',
  'no-link': 'pill-work', expired: 'pill-bad', upcoming: 'pill-none',
};

function actionFor(game, status) {
  if (status.key === 'ready' || status.key === 'leaves-soon') {
    return h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: () => soon('Downloading') }, 'Download');
  }
  if (status.key === 'no-link') {
    return h('button', { type: 'button', class: 'btn btn-small', onclick: () => soon('Picking the rink') }, 'Pick rink');
  }
  return h('button', { type: 'button', class: 'btn btn-small', onclick: () => soon('The game page') }, 'Open');
}

function soon(what) {
  toast(`${what} arrives in a later update. This screen is for checking the list and the look.`);
}

function initials(name) {
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter((w) => w && !/^(Jr|of|the|and|vs|at)$/i.test(w));
  return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?';
}

function logoFor(game) {
  const path = state.logos.get(`${game.divisionId}|${game.opponent}`);
  if (path) return h('img', { class: 'logo', src: DATA_BASE + path, alt: '' });
  return h('span', { class: 'logo logo-initials', 'aria-hidden': 'true' }, initials(game.opponent));
}

function gameRow(game, now) {
  const status = videoStatus(game, now, state.downloaded);
  const selectable = status.key === 'ready' || status.key === 'leaves-soon';
  const result = game.result
    ? h('span', { class: `result result-${game.result.outcome}` }, `${game.result.outcome} ${game.result.us}–${game.result.them}`)
    : h('span', { class: 'result result-none' }, status.key === 'today' ? 'Today' : 'Score to come');
  return h('tr', {},
    h('td', { class: 'col-check c-check' }, h('input', { type: 'checkbox', 'aria-label': `Select ${game.opponentLabel}, ${dayLabel(game.date)}`, disabled: !selectable, 'data-id': game.id })),
    h('td', { class: 'c-when' }, h('span', { class: 'nowrap' }, dayLabel(game.date)), h('span', { class: 'sub' }, timeLabel(game.time))),
    h('td', { class: 'c-kid' }, h('span', { class: `kid-${game.kid.toLowerCase()}` }, game.kid), h('span', { class: 'sub nowrap' }, game.teamLabel)),
    h('td', { class: 'c-game' }, h('div', { class: 'game-cell' }, logoFor(game),
      h('div', {}, h('strong', {}, game.opponentLabel),
        game.type === 'tournament' ? h('span', { class: 'sub tag' }, 'Tournament') : h('span', { class: 'sub' }, game.type === 'regular' ? 'League' : game.type)))),
    h('td', { class: 'c-result' }, result),
    h('td', { class: 'c-rink' }, game.rink || h('span', { class: 'muted' }, '—')),
    h('td', { class: 'c-video' }, h('span', { class: `pill ${PILL[status.key]}` }, status.label), status.detail ? h('span', { class: 'sub' }, status.detail) : null),
    h('td', { class: 'c-action' }, actionFor(game, status)),
  );
}

function render() {
  const now = Date.now();
  renderKidFilter();
  const { recent, upcoming } = splitGames(state.games, state.kid, now);
  if (state.games.length) {
    $('recentBody').replaceChildren(...recent.slice(0, state.shown).map((g) => gameRow(g, now)));
  }
  $('showMore').hidden = recent.length <= state.shown;

  $('upcoming').replaceChildren(...upcoming.slice(0, 6).map((g) => {
    const status = videoStatus(g, now, state.downloaded);
    return h('div', { class: 'upcoming-card' }, logoFor(g),
      h('div', {},
        h('span', { class: 'small muted' }, `${dayLabel(g.date)} · ${timeLabel(g.time)} · `, h('span', { class: `kid-${g.kid.toLowerCase()}` }, g.kid)),
        h('strong', {}, g.opponentLabel),
        h('span', { class: 'small muted' }, [g.rink, g.type === 'tournament' ? 'Tournament' : '', g.liveBarn ? 'on LiveBarn' : 'no LiveBarn link yet'].filter(Boolean).join(' · ')),
        status.key === 'today' ? h('span', { class: 'small' }, status.detail) : null));
  }));
  if (!upcoming.length && state.games.length) $('upcoming').replaceChildren(h('p', { class: 'muted' }, 'No games scheduled yet.'));

  const s = summarize(state.kid === 'all' ? state.games : state.games.filter((g) => g.kid === state.kid), now, state.downloaded);
  $('readyValue').textContent = s.ready ? `${s.ready} game${s.ready === 1 ? '' : 's'} · about ${s.ready} hour${s.ready === 1 ? '' : 's'}` : 'Nothing waiting';

  const needs = [];
  if (s.leavesSoon) needs.push(`${s.leavesSoon} game${s.leavesSoon === 1 ? ' leaves' : 's leave'} LiveBarn in the next 3 days.`);
  if (s.noLink) needs.push(`${s.noLink} game${s.noLink === 1 ? ' has' : 's have'} no LiveBarn link in the schedule; pick the rink once and it's remembered.`);
  $('needsYou').hidden = needs.length === 0;
  $('needsText').textContent = needs.join(' ');
}

// ---------- buttons and helper status ----------
$('showMore').addEventListener('click', () => { state.shown += RECENT_PAGE; render(); });
$('downloadAll').addEventListener('click', () => soon('Downloading'));
$('downloadSelected').addEventListener('click', () => {
  const n = document.querySelectorAll('#recentBody input[type="checkbox"]:checked').length;
  if (!n) { toast('Tick the games you want first.'); return; }
  soon('Downloading');
});

pingHelper().then((version) => {
  const chip = $('helperChip');
  chip.textContent = version ? '● LiveBarn helper connected' : 'LiveBarn helper not installed';
  chip.className = `chip ${version ? 'chip-good' : 'chip-muted'}`;
});

load().catch(() => showLoadError());
