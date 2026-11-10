import { TEAMS, DATA_BASE } from './config.js';
import { videoStatus, splitGames, summarize, dayLabel, timeLabel } from './games.js';
import { downloadedIds, gameSummary, totals } from './library.js';
import { $, h, toast, readSaved, save, formatBytes } from './ui.js';
import { isConnected, wasConnected } from './google.js';
import { setupHeader } from './header.js';
import { loadLeague, cachedTeamSnap, cachedRecord, combine, loadGoogle } from './data.js';
import { shortTournament, setToDownload, toDownloadGames } from './library.js';
import { saveLibrary } from './drive.js';
import { cacheRecord } from './data.js';
import { withRinks, watchUrl } from './rinks.js';
import { pickRink } from './rink-picker.js';

const RECENT_PAGE = 12;
const state = {
  kid: readSaved('fwp.kid', 'all'),
  league: [],
  teamsnap: cachedTeamSnap(),
  record: cachedRecord(),
  logos: new Map(),
  storage: null,
  shown: RECENT_PAGE,
  loaded: false,
  library: null,
};

const games = () => withRinks(combine(state.league, state.teamsnap), state.record);

const onList = (game) => Boolean((state.record.toDownload || {})[game.id]);

async function toggleList(game) {
  if (!isConnected() || !state.library) { toast('Connect Google first, so the list is saved where your phone and PC can both see it.'); return; }
  const on = !onList(game);
  try {
    state.record = setToDownload(state.record, game.id, on);
    state.library = await saveLibrary({ ...state.library, record: state.record });
    cacheRecord(state.record);
    toast(on ? `Added ${game.opponentLabel} (${dayLabel(game.date)}) to your To-download list.` : 'Taken off your To-download list.');
  } catch (err) { toast(`Couldn't save the list: ${err.message}`, 6000); }
  render();
}

function renderTodo(all) {
  const list = toDownloadGames(state.record, all);
  $('todoValue').textContent = list.length ? `${list.length} game${list.length === 1 ? '' : 's'}` : 'Nothing on it';
  $('todoList').replaceChildren(...list.slice(0, 4).map((g) => h('li', {},
    h('a', { href: `join.html?game=${encodeURIComponent(g.id)}#guideCard` }, `${dayLabel(g.date)} · ${g.kid} · ${g.opponentLabel}`),
    h('button', { type: 'button', class: 'chip-x', 'aria-label': `Take ${g.opponentLabel} off the list`, onclick: () => toggleList(g) }, '×'))));
  $('todoNote').textContent = list.length > 4 ? `and ${list.length - 4} more (marked ✓ below)` : list.length ? 'Open one for its download guide.' : 'Press ＋ on a game, here or on your phone, and it waits here for when you\'re at the PC.';
}

async function openPicker(game) {
  const out = await pickRink({ game, games: games(), record: state.record, library: state.library });
  if (out) { state.record = out.record; state.library = out.library; render(); }
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

function soon(what) {
  toast(`${what} arrives in a later update.`);
}

function actionFor(game, status) {
  const page = `join.html?game=${encodeURIComponent(game.id)}`;
  const link = (text, href) => h('a', { class: 'small action-link', href }, text);
  const lb = game.liveBarn && status.key !== 'upcoming' && status.key !== 'expired'
    ? h('a', { class: 'small action-link', href: watchUrl(game), target: '_blank', rel: 'noopener' }, 'Open in LiveBarn ↗') : null;
  const change = game.liveBarn && game.liveBarn.picked
    ? h('button', { type: 'button', class: 'linkish small action-link', onclick: () => openPicker(game) }, 'Change rink') : null;
  if (status.key === 'downloaded') {
    return gameSummary(state.record, game.id).toJoin
      ? h('a', { class: 'btn btn-primary btn-small', href: page }, 'Mark start & end')
      : h('a', { class: 'btn btn-small', href: page }, 'Open');
  }
  if (status.key === 'ready' || status.key === 'leaves-soon') {
    return [h('a', { class: 'btn btn-primary btn-small', href: `${page}#guideCard` }, 'Download guide'), lb, link('Import files', page), change];
  }
  if (status.key === 'no-link') {
    return [h('button', { type: 'button', class: 'btn btn-small', onclick: () => openPicker(game) }, 'Pick rink'), link('Import files', page)];
  }
  if (status.key === 'today') return [h('a', { class: 'btn btn-small', href: page }, 'Import files'), lb];
  if (status.key === 'expired') return h('a', { class: 'btn btn-small', href: page }, 'Import files');
  return null;
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

function gameTag(game) {
  if (game.tournament) return h('span', { class: 'sub tag' }, shortTournament(game.tournament));
  if (game.type === 'tournament') return h('span', { class: 'sub tag' }, 'Tournament');
  if (game.source === 'teamsnap') return h('span', { class: 'sub' }, 'From TeamSnap');
  return h('span', { class: 'sub' }, game.type === 'regular' ? 'League' : game.type);
}

function statusDetail(game, status) {
  if (status.key !== 'downloaded') return [status.detail, game.liveBarn && game.liveBarn.picked ? 'rink picked by you' : ''].filter(Boolean).join(' · ');
  const s = gameSummary(state.record, game.id);
  const parts = [s.joined ? 'Full game' : `${s.full} part${s.full === 1 ? '' : 's'}`];
  if (s.views.length) parts.push(s.views.join(' + '));
  if (s.clips) parts.push(`${s.clips} clip${s.clips === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function gameRow(game, now, downloaded) {
  const status = videoStatus(game, now, downloaded);
  const selectable = ['ready', 'leaves-soon', 'no-link', 'today'].includes(status.key);
  const result = game.result
    ? h('span', { class: `result result-${game.result.outcome}` }, `${game.result.outcome} ${game.result.us}–${game.result.them}`)
    : h('span', { class: 'result result-none' }, status.key === 'today' ? 'Today' : 'Score to come');
  return h('tr', {},
    h('td', { class: 'col-check c-check' }, selectable || onList(game) ? h('button', {
      type: 'button', class: `todo-btn${onList(game) ? ' on' : ''}`, 'aria-pressed': String(onList(game)),
      'aria-label': `${onList(game) ? 'Take off' : 'Add to'} the To-download list: ${game.opponentLabel}, ${dayLabel(game.date)}`,
      title: onList(game) ? 'On your To-download list' : 'Add to your To-download list',
      onclick: () => toggleList(game),
    }, onList(game) ? '✓' : '＋') : null),
    h('td', { class: 'c-when' }, h('span', { class: 'nowrap' }, dayLabel(game.date)), h('span', { class: 'sub' }, timeLabel(game.time))),
    h('td', { class: 'c-kid' }, h('span', { class: `kid-${game.kid.toLowerCase()}` }, game.kid), h('span', { class: 'sub nowrap' }, game.teamLabel)),
    h('td', { class: 'c-game' }, h('div', { class: 'game-cell' }, logoFor(game), h('div', {}, h('strong', {}, game.opponentLabel), gameTag(game)))),
    h('td', { class: 'c-result' }, result),
    h('td', { class: 'c-rink' }, game.rink || h('span', { class: 'muted' }, '—')),
    h('td', { class: 'c-video' }, h('span', { class: `pill ${PILL[status.key]}` }, status.label), h('span', { class: 'sub' }, statusDetail(game, status))),
    h('td', { class: 'c-action' }, actionFor(game, status)),
  );
}

function renderDriveCard() {
  const box = $('driveCard');
  if (!isConnected()) {
    const t = totals(state.record);
    box.replaceChildren(
      h('h2', { id: 'drive-h', class: 'card-label' }, 'Google Drive'),
      h('strong', { class: 'stat' }, t.games ? `${t.games} game${t.games === 1 ? '' : 's'} saved` : 'Not connected'),
      h('span', { class: 'small muted' }, wasConnected() ? 'Press Reconnect Google to see what\'s in Drive and import downloads.' : 'Connect Google to keep games and clips in your Family Hockey folder and import what\'s on this computer.'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: 'import.html' }, 'Import downloads')),
    );
    return;
  }
  const t = totals(state.record);
  const q = state.storage;
  const used = q ? Number(q.usage) : NaN;
  const limit = q ? Number(q.limit) : NaN;
  const pct = Number.isFinite(used) && Number.isFinite(limit) && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  box.replaceChildren(
    h('h2', { id: 'drive-h', class: 'card-label' }, 'Google Drive'),
    h('strong', { class: 'stat' }, Number.isFinite(used) ? `${formatBytes(used)} of ${Number.isFinite(limit) ? formatBytes(limit) : 'unlimited'}` : 'Connected'),
    h('div', { class: 'meter', role: 'img', 'aria-label': `Drive ${pct}% full` }, h('div', { class: 'meter-fill meter-good', style: `width: ${pct}%` })),
    h('span', { class: 'small muted' }, `Family Hockey: ${t.games} game${t.games === 1 ? '' : 's'}, ${t.clips} clip${t.clips === 1 ? '' : 's'}, ${formatBytes(t.bytes)}`),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: 'import.html' }, 'Import downloads')),
  );
}

function render() {
  const now = Date.now();
  const all = games();
  const downloaded = downloadedIds(state.record);
  renderKidFilter();
  renderDriveCard();
  const { recent, upcoming } = splitGames(all, state.kid, now);
  if (state.loaded) {
    $('recentBody').replaceChildren(...recent.slice(0, state.shown).map((g) => gameRow(g, now, downloaded)));
  }
  $('showMore').hidden = recent.length <= state.shown;

  $('upcoming').replaceChildren(...upcoming.slice(0, 6).map((g) => {
    const status = videoStatus(g, now, downloaded);
    return h('div', { class: 'upcoming-card' }, logoFor(g),
      h('div', {},
        h('span', { class: 'small muted' }, `${dayLabel(g.date)} · ${timeLabel(g.time)} · `, h('span', { class: `kid-${g.kid.toLowerCase()}` }, g.kid)),
        h('strong', {}, g.opponentLabel),
        h('span', { class: 'small muted' }, [g.tournament ? shortTournament(g.tournament) : '', g.rink, g.liveBarn ? 'on LiveBarn' : 'no LiveBarn link yet'].filter(Boolean).join(' · ')),
        status.key === 'today' ? h('span', { class: 'small' }, status.detail) : null));
  }));
  if (!upcoming.length && state.loaded) $('upcoming').replaceChildren(h('p', { class: 'muted' }, 'No games scheduled yet.'));

  const mine = state.kid === 'all' ? all : all.filter((g) => g.kid === state.kid);
  const s = summarize(mine, now, downloaded);
  $('readyValue').textContent = s.ready ? `${s.ready} game${s.ready === 1 ? '' : 's'}` : 'Nothing waiting';
  const ready = mine.filter((g) => ['ready', 'leaves-soon'].includes(videoStatus(g, now, downloaded).key)).sort((a, b) => a.startMs - b.startMs);
  $('nextGuide').hidden = !ready.length;
  if (ready.length) {
    $('nextGuide').href = `join.html?game=${encodeURIComponent(ready[0].id)}#guideCard`;
    $('readyNote').textContent = `Oldest first: ${dayLabel(ready[0].date)} · ${ready[0].kid} · ${ready[0].opponentLabel}. Each game uses up to about 90 minutes of LiveBarn time.`;
  } else $('readyNote').textContent = '';
  renderTodo(all);

  const needs = [];
  if (s.leavesSoon) needs.push(`${s.leavesSoon} game${s.leavesSoon === 1 ? ' leaves' : 's leave'} LiveBarn in the next 3 days.`);
  if (s.noLink) needs.push(`${s.noLink} game${s.noLink === 1 ? ' has' : 's have'} no LiveBarn link in the schedule: press Pick rink on ${s.noLink === 1 ? 'it' : 'one'}, and you can use the same rink for the other games there.`);
  $('needsYou').hidden = needs.length === 0;
  $('needsText').textContent = needs.join(' ');
}

// ---------- loading ----------
async function refreshGoogle() {
  $('googleNote').hidden = true;
  const out = await loadGoogle();
  if (!out) return;
  if (out.about) state.storage = out.about.storageQuota;
  if (out.library) { state.record = out.library.record; state.library = out.library; }
  if (out.teamsnap) state.teamsnap = out.teamsnap;
  if (out.problems.length) { $('googleNote').textContent = out.problems.join(' '); $('googleNote').hidden = false; }
  render();
}

async function start() {
  setupHeader(refreshGoogle);
  render();
  try {
    const league = await loadLeague();
    state.league = league.games;
    state.logos = league.logos;
    state.loaded = true;
    const when = league.updatedAt ? new Date(league.updatedAt).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    const tsNote = state.teamsnap.length ? ' · tournaments from TeamSnap' : ' · connect Google to add tournaments from TeamSnap';
    $('updated').textContent = `League schedules and scores${when ? ` · updated ${when}` : ''}${tsNote}${league.failed.length ? ` · couldn't load ${league.failed.join(' and ')}'s games` : ''}`;
    if (!league.games.length) throw new Error('empty');
    render();
  } catch {
    $('recentBody').replaceChildren(h('tr', {}, h('td', { colspan: 8 },
      h('div', { class: 'error-box' }, "Couldn't load the league schedules. Check your connection and reload the page."))));
  }
  if (isConnected()) await refreshGoogle();
}

$('showMore').addEventListener('click', () => { state.shown += RECENT_PAGE; render(); });

start();
