// Stats: each kid's season from their team's Game Book (the shared family stats screen from Game Book 0.2.1).
import { TEAMS } from './config.js';
import { $, h, toast, readSaved, save } from './ui.js';
import { isConnected } from './google.js';
import { setupHeader } from './header.js';
import { loadLeague, cachedTeamSnap, cachedRecord, combine, loadGoogle } from './data.js';
import { renderSeasonStats } from '../vendor/game-book/0.2.1/ui/index.js';
import { hasBook, bookOf, bookState, cached, syncBook, ensureLocalBook, keyOf, kidFor, onBookChange, pickBook, pickerReady, bookName } from './game-book.js';

const teams = TEAMS.filter(hasBook);
const state = { teamKey: readSaved('fwp.statsKid', teams[0] && teams[0].key), record: cachedRecord(), games: [], screen: null };
if (!teams.some((t) => t.key === state.teamKey)) state.teamKey = teams[0].key;
const team = () => teams.find((t) => t.key === state.teamKey);

function tabs() {
  $('kidTabs').replaceChildren(...teams.map((t) => h('button', {
    type: 'button', class: 'tab', 'aria-pressed': String(t.key === state.teamKey),
    onclick: () => { state.teamKey = t.key; save('fwp.statsKid', t.key); if (state.screen) { state.screen.destroy(); state.screen = null; } draw(); },
  }, `${t.kid} · ${t.gameBook.team}`)));
}

function card(t) {
  const s = cached(t.key);
  const st = bookState(t.key);
  const actions = [];
  let text = '';
  if (st === 'connect' && t.gameBook.shared) text = `Connect Google to open the ${t.gameBook.team} Game Book.`;
  else if (st === 'pick') {
    text = `${t.kid}'s stats come from the coaches' Game Book in the Bulldogs team folder. Connect it once this season: tap “${bookName(t)}” in Google's file picker, then Select.`;
    if (pickerReady()) actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => pick(t) }, 'Connect the Bulldogs Game Book'));
  } else if (s.err) text = `Couldn’t reach the Game Book in Drive: ${s.err}`;
  if (!kidFor(t, state.record) && st !== 'pick') {
    text = [text, `Add ${t.kid}'s jersey number in Settings to see ${t.kid}'s line.`].filter(Boolean).join(' ');
    actions.push(h('a', { class: 'btn', href: 'settings.html#gamebook-h' }, 'Settings'));
  }
  $('bookCard').hidden = !text;
  $('bookText').textContent = text;
  $('bookActions').replaceChildren(...actions);
}

async function pick(t) {
  try {
    const picked = await pickBook(t.key);
    if (!picked) { toast('Nothing picked. Open the Bulldogs team folder in the picker and tap the Game Book file.', 7000); return; }
    await syncBook(t.key, state.games);
  } catch (e) { toast(e.message, 8000); }
  draw();
}

function draw() {
  tabs();
  const t = team();
  card(t);
  const book = bookOf(t.key) || ensureLocalBook(t.key, state.games);
  if (!book) { if (state.screen) { state.screen.destroy(); state.screen = null; } return; }
  const kid = kidFor(t, state.record) || { number: '', name: t.kid };
  if (state.screen) { state.screen.update(book); return; }
  const byKey = new Map(state.games.map((g) => [keyOf(g), g.id]));
  state.screen = renderSeasonStats($('statsRoot'), {
    book, variant: 'family', kid,
    openGame: (key) => { const id = byKey.get(key); if (id) location.href = `join.html?game=${encodeURIComponent(id)}`; else toast('That game isn’t in the schedule any more.'); },
    watchGoals: null,
  });
}

async function onConnected() {
  const out = await loadGoogle();
  if (out && out.library) state.record = out.library.record;
  if (out && out.teamsnap) state.games = combine(state.leagueGames || [], out.teamsnap);
  if (state.screen) { state.screen.destroy(); state.screen = null; }
  for (const t of teams) { try { await syncBook(t.key, state.games); } catch { /* shown on the card */ } }
  draw();
}

async function start() {
  setupHeader(onConnected);
  onBookChange((key) => { if (key === state.teamKey) draw(); });
  try {
    const league = await loadLeague();
    state.leagueGames = league.games;
    state.games = combine(league.games, cachedTeamSnap());
  } catch { /* the book still shows */ }
  draw();
  if (isConnected()) await onConnected();
}

start();
