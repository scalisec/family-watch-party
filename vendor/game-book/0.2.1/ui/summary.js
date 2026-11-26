// One game's summary, shared by both apps. variant 'full' (coaches, Bulldogs Watch Party) or 'family' (Family Watch
// Party: leads with your kid, penalties and shots on one line each, no coach-only parts).
import * as GB from '../core/index.js';
import { h, clear, pill, button } from './dom.js';
import { ordinal, player, penaltyLabel, whenLabel, teamName, opponentName } from './format.js';
import { openCorrectGoal } from './correct.js';
import { openImportSheet } from './import.js';

const SOURCE = { official: ['Official', 'info'], corrected: ['Corrected', 'good'], tracked: ['Marked', ''], added: ['Added', 'good'] };

/**
 * root: an element to fill. o: {
 *   book, key, variant: 'full'|'family', kid: { number, name } (family), by: who is signed in,
 *   canEdit (default true), otherApp: the other app's name for "Same in …",
 *   onChange(newBook, what): the app saves it (merge + Drive); called after every import or correction,
 *   watch(goal): { label, onClick } | null — the app's link to that moment in its own video, or null,
 *   readPdf(file): text items (for importing a sheet), teamNames: our names as they may appear on a sheet,
 *   aside: [Node] (full only: the app's own cards, e.g. coach's notes, export buttons) }.
 * Returns { update(book), destroy() }.
 */
export function renderGameSummary(root, o) {
  const st = { book: o.book, showAllPens: false, showHistory: false };
  const full = o.variant !== 'family';
  const canEdit = o.canEdit !== false;

  async function change(nb, what) {
    if (!nb || nb === st.book) return;
    st.book = nb;
    draw();
    if (o.onChange) await o.onChange(nb, what);
  }
  const correct = async (goalId) => change(await openCorrectGoal({ book: st.book, key: o.key, goalId, by: o.by, kid: o.kid }), 'correction');
  const importSheet = async () => {
    const r = await openImportSheet({ book: st.book, key: o.key, readPdf: o.readPdf, teamNames: o.teamNames, by: o.by, kid: o.kid });
    if (r) await change(r.book, 'game sheet');
  };

  function draw() {
    const book = st.book;
    const eff = GB.effectiveGame(book, o.key);
    const sum = GB.gameSummary(eff, book.roster);
    const us = teamName(book), them = opponentName(book, eff);
    const kidN = o.kid && o.kid.number;
    const P = (n) => player(book, n, o.kid);
    const watchBtn = (g) => { const w = o.watch && o.watch(g); return w ? button(w.label || '▶ Watch', w.onClick, 'small') : null; };
    const res = GB.result(eff.score);
    const activeCorrections = eff.corrections.filter((c) => !c.undone);

    // the strip: where this came from
    const statusPill = eff.status === 'official' ? pill('Official game sheet', 'good') : eff.status === 'tracked' ? pill('Coaches’ marks', 'work') : eff.status === 'score' ? pill('Score only') : pill('Nothing yet');
    const statusText = eff.status === 'official'
      ? [eff.official.number, `imported ${whenLabel(eff.official.importedAt) ? whenLabel(eff.official.importedAt).replace(/,.*$/, '') : ''} by ${eff.official.importedBy || 'someone'}`, activeCorrections.length ? `${activeCorrections.length} correction${activeCorrections.length === 1 ? '' : 's'}` : '', full && eff.differs ? `${eff.differs} mark${eff.differs === 1 ? '' : 's'} differ${eff.differs === 1 ? 's' : ''}` : '', eff.notOnSheet ? `${eff.notOnSheet} marked goal${eff.notOnSheet === 1 ? '' : 's'} not on the sheet` : ''].filter(Boolean).join(' · ')
      : eff.status === 'tracked' ? 'No game sheet yet: goals come from the coaches’ marks' : eff.status === 'score' ? 'The league score, nothing else yet' : 'No score or game sheet yet';
    const strip = h('div', { class: 'gbk-strip' }, h('span', { class: 'gbk-name' }, 'GAME BOOK'), statusPill, h('span', { class: 'gbk-small' }, statusText),
      h('span', { class: 'gbk-grow' }), o.otherApp ? h('span', { class: 'gbk-small gbk-muted' }, 'Same in ' + o.otherApp) : null,
      eff.history.length ? button(`History (${eff.history.length})`, () => { st.showHistory = !st.showHistory; draw(); }, '', { 'aria-expanded': st.showHistory ? 'true' : 'false' }) : null,
      canEdit && o.readPdf ? button(eff.official ? 'Replace game sheet' : 'Import game sheet', importSheet, eff.official ? '' : 'primary') : null);

    // score card
    const periods = eff.periods;
    const scoreCard = eff.score ? h('section', { class: 'gbk-card gbk-scorecard' },
      h('div', { class: 'gbk-col' }, h('div', { class: 'gbk-row gbk-big' }, h('span', { class: 'gbk-us' }, String(eff.score.for)), h('span', { class: 'gbk-muted' }, '–'), h('span', {}, String(eff.score.against))),
        h('div', { class: 'gbk-row' }, pill(res === 'W' ? 'Win' : res === 'L' ? 'Loss' : 'Tie', res === 'W' ? 'good' : res === 'L' ? 'bad' : ''))),
      eff.status === 'official' || eff.status === 'tracked' ? h('table', { class: 'gbk-table gbk-grow' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), periods.map((n) => h('th', { class: 'gbk-num' }, ordinal(n))), h('th', { class: 'gbk-num' }, 'Total'),
          full && sum.shots ? h('th', { class: 'gbk-num' }, 'Shots') : null, full ? h('th', { class: 'gbk-num' }, 'PIM') : null)),
        h('tbody', {}, [['for', us, 'us'], ['against', them, 'them']].map(([side, name, team]) => h('tr', {}, h('td', {}, name),
          periods.map((n) => h('td', { class: 'gbk-num' }, String(sum.byPeriod[side][n] || 0))), h('td', { class: 'gbk-num' }, h('b', {}, String(eff.score[side]))),
          full && sum.shots ? h('td', { class: 'gbk-num' }, String(sum.shots[side])) : null, full ? h('td', { class: 'gbk-num' }, String(sum.pim[team])) : null)))) : null) : null;

    // the kid's card (family)
    let kidCard = null;
    if (!full && kidN && (eff.status === 'official' || eff.status === 'tracked')) {
      const k = sum.players.get(kidN) || { g: 0, a: 0, pim: 0 };
      const kidGoals = eff.goals.filter((g) => g.counted && g.side === 'for' && g.scorer === kidN);
      const watchable = kidGoals.map((g) => o.watch && o.watch(g)).filter(Boolean);
      kidCard = h('section', { class: 'gbk-card gbk-kidcard' },
        h('div', { class: 'gbk-row gbk-spread' }, h('h2', {}, `${o.kid.name || '#' + kidN} this game`), pill('#' + kidN, 'info')),
        h('div', { class: 'gbk-grid4' }, [['Goals', k.g], ['Assists', k.a], ['Points', k.g + k.a], ['PIM', k.pim]].map(([l, v]) => h('div', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, l), h('b', {}, String(v))))),
        watchable.length ? h('div', { class: 'gbk-row' }, button(`▶ Watch ${watchable.length === 1 ? 'the goal' : `the ${watchable.length} goals`}`, () => watchable[0].onClick(), 'primary')) : null);
    }

    // goals
    const goalsCard = h('section', { class: 'gbk-card' },
      h('div', { class: 'gbk-row gbk-spread' }, h('h2', {}, 'Goals'), h('span', { class: 'gbk-small gbk-muted' },
        eff.status === 'official' ? 'The game sheet wins; corrections go on top.' : eff.status === 'tracked' ? 'From the coaches’ marks until a game sheet is imported.' : '')),
      eff.goals.length ? h('table', { class: 'gbk-table' },
        h('thead', {}, h('tr', {}, ['Period', 'Team', 'Scorer', 'Assists', full ? '' : null, 'Score', 'Source', ''].filter((x) => x !== null).map((t) => h('th', { class: t === 'Team' ? 'gbk-wide-only' : '' }, t)))),
        h('tbody', {}, eff.goals.map((g) => {
          const ours = g.side === 'for';
          const kidRow = kidN && ours && (g.scorer === kidN || g.assists.includes(kidN));
          const strength = sum.strength.get(g.id);
          const src = g.notOnSheet && !g.counted ? pill('Not on the game sheet', 'work') : pill(...SOURCE[g.source]);
          return h('tr', { class: (kidRow ? 'gbk-kid' : '') + (g.counted ? '' : ' gbk-uncounted') },
            h('td', {}, ordinal(g.per), g.clock ? h('span', { class: 'gbk-small gbk-muted gbk-block' }, g.clock + ' left') : null),
            h('td', { class: 'gbk-wide-only ' + (ours ? 'gbk-us' : 'gbk-them') }, ours ? us : them),
            h('td', { class: ours ? 'gbk-us' : 'gbk-them' }, ours ? h('b', {}, P(g.scorer) || '—') : [h('span', { class: 'gbk-narrow-only' }, them + ' '), g.scorer ? '#' + g.scorer : '—']),
            h('td', {}, g.assists.length ? g.assists.map((a) => (ours ? P(a) : '#' + a)).join(', ') : h('span', { class: 'gbk-muted' }, 'Unassisted'),
              full && !ours && g.onIce.length ? h('span', { class: 'gbk-small gbk-muted' }, ' · on ice ' + g.onIce.map((n) => '#' + n).join(' ')) : null),
            full ? h('td', {}, strength === 'pp' ? pill('PP', 'info') : strength === 'sh' ? pill('SH', 'good') : null) : null,
            h('td', { class: 'gbk-num' }, g.counted ? `${g.scoreAfter.for}–${g.scoreAfter.against}` : '—'),
            h('td', {}, src, full && g.mark ? h('span', { class: 'gbk-block' }, pill(`Mark: ${[g.mark.scorer && '#' + g.mark.scorer, g.mark.assists.length && 'A ' + g.mark.assists.map((a) => '#' + a).join(' ')].filter(Boolean).join(' · ')}`, 'work')) : null,
              g.corrections.length && g.source !== 'official' ? h('span', { class: 'gbk-small gbk-muted gbk-block' }, `by ${g.corrections[g.corrections.length - 1].by}`) : null),
            h('td', { class: 'gbk-right gbk-nowrap' }, canEdit ? button('Correct', () => correct(g.id), 'small') : null, ' ', watchBtn(g)));
        })))
        : h('p', { class: 'gbk-muted' }, eff.status === 'score' ? 'The league has the score but no goal details. Import the game sheet to add them.' : 'No goals yet.'),
      canEdit && (eff.status === 'official' || eff.status === 'tracked') ? h('div', { class: 'gbk-row' }, button(eff.status === 'official' ? '+ Add a goal the sheet missed' : '+ Add a goal', () => correct(null)), h('span', { class: 'gbk-small gbk-muted' }, 'Adds a correction, logged with your name.')) : null);

    // penalties
    const pens = eff.penalties;
    let pensCard = null;
    if (pens.length) {
      if (full) {
        const shown = st.showAllPens ? pens : pens.slice(0, 6);
        pensCard = h('section', { class: 'gbk-card' },
          h('div', { class: 'gbk-row gbk-spread' }, h('h2', {}, 'Penalties'), h('span', { class: 'gbk-small gbk-muted' }, `PIM: ${us} ${sum.pim.us} · ${them} ${sum.pim.them}`)),
          h('table', { class: 'gbk-table' }, h('thead', {}, h('tr', {}, ['Period', 'Player', 'Infraction', 'Min', 'Source'].map((t, i) => h('th', { class: i === 3 ? 'gbk-num' : '' }, t)))),
            h('tbody', {}, shown.map((p) => h('tr', {}, h('td', {}, ordinal(p.per), p.clock ? h('span', { class: 'gbk-small gbk-muted' }, ' · ' + p.clock) : null),
              h('td', {}, p.team === 'us' ? (p.player ? P(p.player) : 'Bench') : `${them} ${p.player ? '#' + p.player : 'bench'}`), h('td', {}, penaltyLabel(p.type)),
              h('td', { class: 'gbk-num' }, String(p.minutes)), h('td', {}, pill(...SOURCE[p.source] || SOURCE.official)))))),
          pens.length > 6 ? button(st.showAllPens ? 'Show fewer' : `Show all ${pens.length}`, () => { st.showAllPens = !st.showAllPens; draw(); }, 'link') : null);
      } else {
        const kidPens = pens.filter((p) => p.team === 'us' && p.player === kidN);
        pensCard = h('section', { class: 'gbk-card' }, h('h3', {}, 'Penalties'), h('p', {}, `${us} ${sum.pim.us} min · ${them} ${sum.pim.them} min`),
          kidPens.map((p) => h('p', { class: 'gbk-small' }, h('b', {}, `${o.kid.name || '#' + kidN}: `), `${penaltyLabel(p.type)}, ${ordinal(p.per)} period, ${p.minutes} min`)));
      }
    }

    // shots and goalies
    let shotsCard = null;
    if (full && sum.shots) {
      const shooters = [...sum.players.entries()].filter(([, v]) => v.sog || v.g).sort((a, b) => b[1].sog - a[1].sog);
      shotsCard = h('section', { class: 'gbk-card' }, h('div', { class: 'gbk-row gbk-spread' }, h('h2', {}, 'Shots and goalies'), h('span', { class: 'gbk-small gbk-muted' }, 'From marks on the video (game sheets don’t record shots)')),
        h('div', { class: 'gbk-grid2' },
          h('table', { class: 'gbk-table' }, h('thead', {}, h('tr', {}, ['Shooter', 'SOG', 'G'].map((t, i) => h('th', { class: i ? 'gbk-num' : '' }, t)))),
            h('tbody', {}, shooters.map(([n, v]) => h('tr', {}, h('td', {}, P(n)), h('td', { class: 'gbk-num' }, String(v.sog)), h('td', { class: 'gbk-num' }, String(v.g)))))),
          h('table', { class: 'gbk-table' }, h('thead', {}, h('tr', {}, ['Goalie', 'SA', 'GA', 'SV%', 'Decision'].map((t, i) => h('th', { class: i && i < 4 ? 'gbk-num' : '' }, t)))),
            h('tbody', {}, sum.goalies.map((k) => h('tr', {}, h('td', {}, P(k.number)), h('td', { class: 'gbk-num' }, k.sa == null ? '—' : String(k.sa)), h('td', { class: 'gbk-num' }, String(k.ga)),
              h('td', { class: 'gbk-num' }, k.sa ? ((k.sa - k.ga) / k.sa).toFixed(3).replace(/^0/, '') : '—'), h('td', {}, k.decision ? pill(k.decision, k.decision === 'W' ? 'good' : k.decision === 'L' ? 'bad' : '') : '')))))));
    } else if (!full && sum.shots) {
      const k = sum.goalies[sum.goalies.length - 1];
      shotsCard = h('section', { class: 'gbk-card' }, h('h3', {}, 'Shots on goal'), h('p', {}, `${us} ${sum.shots.for} · ${them} ${sum.shots.against}`),
        h('p', { class: 'gbk-small gbk-muted' }, 'Marked by the coaches on the video.', k ? ` Goalie ${P(k.number)}: ${k.ga} GA${k.decision ? ', ' + (k.decision === 'W' ? 'win' : k.decision === 'L' ? 'loss' : 'tie') : ''}.` : ''));
    }

    // points this game
    const pts = [...sum.players.entries()].filter(([, v]) => v.g || v.a || v.pim).sort((a, b) => (b[1].g + b[1].a) - (a[1].g + a[1].a) || b[1].g - a[1].g);
    const pointsCard = pts.length ? h('section', { class: 'gbk-card' }, h(full ? 'h2' : 'h3', {}, 'Points this game'),
      full ? h('table', { class: 'gbk-table' }, h('tbody', {}, pts.map(([n, v]) => h('tr', {}, h('td', {}, P(n)),
        h('td', { class: 'gbk-num' }, [v.g || v.a ? `${v.g} G · ${v.a} A` : '', v.pim ? `${v.pim} PIM` : ''].filter(Boolean).join(' · '))))))
        : h('p', { class: 'gbk-small' }, pts.filter(([, v]) => v.g + v.a).map(([n, v], i) => [i ? ' · ' : '', n === kidN ? h('b', {}, `${P(n)} ${v.g + v.a}`) : `${P(n)} ${v.g + v.a}`]))) : null;

    // history
    const historyCard = st.showHistory ? h('section', { class: 'gbk-card' }, h('h2', {}, 'History'),
      activeCorrections.length ? h('div', { class: 'gbk-col' }, h('h3', {}, 'Corrections in effect'), activeCorrections.slice().reverse().map((c) => h('div', { class: 'gbk-row gbk-spread' },
        h('span', { class: 'gbk-small' }, h('b', {}, c.by || 'Someone'), ` · ${whenLabel(c.at)} · `, describe(book, c, o.kid)),
        canEdit ? button('Undo', () => change(GB.undoCorrection(st.book, o.key, c.id, { by: o.by }), 'undo'), 'link') : null))) : null,
      h('h3', {}, 'Everything that happened'),
      h('ul', { class: 'gbk-history' }, eff.history.map((x) => h('li', {}, h('b', {}, x.by || 'Someone'), h('span', { class: 'gbk-small gbk-muted' }, ` · ${whenLabel(x.at)}`), h('div', { class: 'gbk-small' }, x.what))))) : null;

    const main = h('div', { class: 'gbk-col' }, full ? scoreCard : h('div', { class: 'gbk-grid2' }, scoreCard, kidCard), historyCard, goalsCard,
      full ? [pensCard, shotsCard] : h('div', { class: 'gbk-grid3' }, pensCard, shotsCard, pointsCard));
    const view = full
      ? h('div', { class: 'gbk gbk-summary' }, strip, h('div', { class: 'gbk-layout' }, main, h('aside', { class: 'gbk-col' }, pointsCard, o.aside || null)))
      : h('div', { class: 'gbk gbk-summary' }, strip, main);
    clear(root).append(view);
  }

  draw();
  return { update(book) { st.book = book; draw(); }, destroy() { clear(root); } };
}

function describe(book, c, kid) {
  const s = c.set || {};
  const who = (n) => player(book, n, kid);
  const parts = [];
  if ('scorer' in s) parts.push('scorer ' + (who(s.scorer) || 'none'));
  if ('assists' in s) parts.push(s.assists.length ? 'assists ' + s.assists.map(who).join(', ') : 'no assists');
  const what = { 'edit-goal': 'Corrected a goal', 'add-goal': 'Added a goal', 'remove-goal': 'Removed a goal', 'confirm-goal': 'Counted a marked goal', 'edit-penalty': 'Corrected a penalty', 'add-penalty': 'Added a penalty', 'remove-penalty': 'Removed a penalty' }[c.kind] || 'Changed';
  return `${what}${parts.length ? ': ' + parts.join(', ') : ''}${c.note ? ` (“${c.note}”)` : ''}`;
}
