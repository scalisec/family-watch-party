// The game page's Summary tab: the Game Book's family summary for this game (shared screen from Game Book 0.2.1).
// The Video tab is the page as it was: download, join, save to Drive.
import { renderGameSummary } from '../vendor/game-book/0.2.1/ui/index.js';
import { $, h, toast } from './ui.js';
import { isConnected } from './google.js';
import { downloadedIds } from './library.js';
import {
  hasBook, bookOf, bookState, cached, syncBook, changeBook, ensureLocalBook, withSchedule, keyOf, kidFor, onBookChange,
  pickBook, pickerReady, readPdf, who, bookName,
} from './game-book.js';

const TAB_KEY = 'fwp.gameTab';

export function setupSummary({ game, team, allGames, record }) {
  const key = keyOf(game);
  if (!hasBook(team) || !key) return { connected() {}, refresh() {} };
  const st = { screen: null, record };

  // ---------- tabs: Video until the full game is in Drive, then Summary (a tab picked here is remembered for this game) ----------
  $('gameTabs').hidden = false;
  const remembered = (() => { try { return JSON.parse(sessionStorage.getItem(TAB_KEY) || '{}')[game.id]; } catch { return null; } })();
  let tab = (location.hash === '#download' || location.hash === '#guideCard') ? 'video' : remembered || (downloadedIds(record).has(game.id) ? 'summary' : 'video');
  function showTab(t, rememberIt) {
    tab = t;
    $('tabSummary').setAttribute('aria-pressed', String(t === 'summary'));
    $('tabVideo').setAttribute('aria-pressed', String(t === 'video'));
    $('summaryTab').hidden = t !== 'summary';
    $('videoTab').hidden = t !== 'video';
    if (rememberIt) {
      try { const all = JSON.parse(sessionStorage.getItem(TAB_KEY) || '{}'); all[game.id] = t; sessionStorage.setItem(TAB_KEY, JSON.stringify(all)); } catch { /* fine */ }
    }
    if (t === 'summary') draw();
  }
  $('tabSummary').addEventListener('click', () => showTab('summary', true));
  $('tabVideo').addEventListener('click', () => showTab('video', true));

  // ---------- the card above the summary: where the Game Book is ----------
  function card() {
    const s = cached(team.key);
    const state = bookState(team.key);
    const actions = [];
    let text;
    if (state === 'connect' && team.gameBook.shared) text = `Connect Google to open the ${team.gameBook.team} Game Book, the coaches' record of every game.`;
    else if (state === 'connect') text = 'Connect Google to keep this Game Book in your Family Hockey folder. What you add here is kept on this device until then.';
    else if (state === 'pick') {
      text = `${team.kid}'s game stats come from the coaches' Game Book in the Bulldogs team folder. Connect it once this season: Google's file picker opens, you tap “${bookName(team)}”, then Select.`;
      if (pickerReady()) actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: pick }, 'Connect the Bulldogs Game Book'));
      else text += ' (The file picker isn’t set up yet: the picker key from Google Cloud still needs to be added to the app.)';
    } else if (s.err) text = `Couldn’t reach the Game Book in Drive: ${s.err}`;
    else if (s.readOnly) text = 'This Game Book was saved by a newer version of the Game Book, so it’s view only here. Update the app in Settings.';
    else if (s.dirty) text = isConnected() ? 'Saving to Drive…' : 'Saved on this device. It goes to Drive when you connect Google.';
    else text = '';
    const kid = kidFor(team, st.record);
    if (!kid && state !== 'pick') {
      text = [text, `Add ${team.kid}'s jersey number in Settings to see ${team.kid}'s points here.`].filter(Boolean).join(' ');
      actions.push(h('a', { class: 'btn', href: 'settings.html#gamebook-h' }, 'Settings'));
    }
    $('bookCard').hidden = !text;
    $('bookText').textContent = text;
    $('bookActions').replaceChildren(...actions);
  }

  async function pick() {
    try {
      const picked = await pickBook(team.key);
      if (!picked) { toast('Nothing picked. Open the Bulldogs team folder in the picker and tap the Game Book file.', 7000); return; }
      toast(`Connected: ${picked.name}`);
      await syncBook(team.key, allGames);
    } catch (e) { toast(e.message, 8000); }
    draw();
  }

  // ---------- the summary ----------
  function draw() {
    card();
    if (tab !== 'summary') return;
    let book = bookOf(team.key) || ensureLocalBook(team.key, allGames);
    if (!book) { if (st.screen) { st.screen.destroy(); st.screen = null; } return; }
    book = withSchedule(book, [game]);        // shown even before the game is saved in the book
    if (st.screen) { st.screen.update(book); return; }
    st.screen = renderGameSummary($('summaryRoot'), {
      book, key, variant: 'family', kid: kidFor(team, st.record), by: who(),
      canEdit: !cached(team.key).readOnly,
      otherApp: team.gameBook.shared ? 'Bulldogs Watch Party' : '',
      onChange: async (next, what) => {
        try {
          const res = await changeBook(team.key, next);
          toast(isConnected() ? `Saved to the Game Book (${what}).` : `Saved on this device (${what}). It goes to Drive when you connect Google.`);
          if (res && res.conflicts && res.conflicts.length) toast(`Someone else changed the same thing at the same time (${res.conflicts.join(', ')}). Their version was kept.`, 9000);
        } catch (e) { toast(e.message, 8000); }
        card();
      },
      watch: () => null,
      readPdf,
      teamNames: team.gameBook.sheetNames,
    });
  }

  onBookChange((teamKey) => { if (teamKey === team.key) draw(); });
  showTab(tab, false);

  return {
    async connected(record2) {
      if (record2) { st.record = record2; if (st.screen) { st.screen.destroy(); st.screen = null; } }
      try { await syncBook(team.key, allGames); } catch (e) { /* shown on the card */ }
      draw();
    },
    refresh() { draw(); },
  };
}
