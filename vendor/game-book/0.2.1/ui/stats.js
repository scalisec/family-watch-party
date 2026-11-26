// Season stats, shared by both apps. variant 'full' (coaches) or 'family' (leads with your kid: their line, their games
// one by one with watch buttons, and the team table with their row highlighted).
import * as GB from '../core/index.js';
import { h, clear, pill, button } from './dom.js';
import { dateLabel, player } from './format.js';

const TYPES = [['league', 'League'], ['tournament', 'Tournament'], ['playoff', 'Playoff'], ['all', 'All games']];

/**
 * root, o: { book, variant: 'full'|'family', kid: { number, name }, type (default 'league'),
 *   openGame(key): show that game's summary, watchGoals(key, goalIds): play the kid's goals (family), or null,
 *   importSheet(key): open the import panel for a game without a sheet (full), or null }.
 * Returns { update(book), destroy() }.
 */
export function renderSeasonStats(root, o) {
  const st = { book: o.book, type: o.type || 'league', allTeam: false };
  const full = o.variant !== 'family';

  function draw() {
    const book = st.book;
    const s = GB.seasonStats(book, st.type);
    const kidN = o.kid && o.kid.number;
    const P = (n) => player(book, n, o.kid);
    const seg = h('div', { class: 'gbk-seg', role: 'group', 'aria-label': 'Games' }, TYPES.map(([id, label]) =>
      h('button', { type: 'button', class: st.type === id ? 'gbk-on' : '', 'aria-pressed': st.type === id ? 'true' : 'false', onClick: () => { st.type = id; draw(); } }, label)));
    const rec = `${s.record.w}–${s.record.l}–${s.record.t}`;
    const missing = Object.keys(book.games).map((k) => GB.effectiveGame(book, k)).filter((e) => (st.type === 'all' || e.schedule.type === st.type) && (e.status === 'tracked' || e.status === 'score'))
      .sort((a, b) => String(b.schedule.date).localeCompare(String(a.schedule.date)));
    const played = s.sources.official + s.sources.tracked + s.sources.scoreOnly;
    const strip = h('div', { class: 'gbk-strip' }, h('span', { class: 'gbk-name' }, 'GAME BOOK'),
      h('span', { class: 'gbk-small' }, `${played} game${played === 1 ? '' : 's'} played: `, h('b', {}, `${s.sources.official} from game sheets`), ` · ${s.sources.tracked} from coaches’ marks · ${s.sources.scoreOnly} score only`),
      h('span', { class: 'gbk-grow' }),
      full && missing.length && o.importSheet ? [h('span', { class: 'gbk-small gbk-muted' }, `${dateLabel(missing[0].schedule.date)} vs ${missing[0].schedule.opponent || 'opponent'} has no game sheet yet`),
        button('Import its game sheet', () => o.importSheet(missing[0].key))] : null);

    let view;
    if (full) {
      view = h('div', { class: 'gbk gbk-stats' },
        h('div', { class: 'gbk-row gbk-spread' }, h('h2', {}, 'Season stats'), seg), strip,
        h('div', { class: 'gbk-grid4' },
          tile('Record', rec), tile('Goals for / against', `${s.gf} / ${s.ga}`), tile('Our penalty minutes', String(s.pim)),
          tile(s.shots ? `Shots for / against (${s.shots.games} game${s.shots.games === 1 ? '' : 's'} marked)` : 'Shots', s.shots ? `${s.shots.for} / ${s.shots.against}` : '—')),
        h('section', { class: 'gbk-card' }, s.players.length ? h('table', { class: 'gbk-table' },
          h('thead', {}, h('tr', {}, ['Player', 'GP', 'G', 'A', 'PTS', 'PIM', 'PPG', 'SHG', 'SOG', 'S%'].map((t, i) => h('th', { class: i ? 'gbk-num' : '' }, t)))),
          h('tbody', {}, s.players.map((p) => h('tr', {}, h('td', {}, P(p.number)), [p.gp, p.g, p.a].map((v) => h('td', { class: 'gbk-num' }, String(v))),
            h('td', { class: 'gbk-num' }, h('b', {}, String(p.pts))), [p.pim, p.ppg, p.shg].map((v) => h('td', { class: 'gbk-num' }, String(v))),
            h('td', { class: 'gbk-num' }, s.shots ? String(p.sog) : '—'), h('td', { class: 'gbk-num' }, s.shots && p.sog ? Math.round((p.g / p.sog) * 100) + '%' : '—')))))
          : h('p', { class: 'gbk-muted' }, 'No games with goal details yet.')),
        s.goalies.length ? h('section', { class: 'gbk-card' }, h('table', { class: 'gbk-table' },
          h('thead', {}, h('tr', {}, ['Goalie', 'GP', 'W', 'L', 'T', 'GA', 'GAA', 'SA', 'SV%'].map((t, i) => h('th', { class: i ? 'gbk-num' : '' }, t)))),
          h('tbody', {}, s.goalies.map((g) => h('tr', {}, h('td', {}, P(g.number)), [g.gp, g.w, g.l, g.t, g.ga, g.gaa.toFixed(2), g.sa == null ? '—' : g.sa, g.svPct == null ? '—' : g.svPct.toFixed(3).replace(/^0/, '')]
            .map((v) => h('td', { class: 'gbk-num' }, String(v)))))))) : null,
        h('p', { class: 'gbk-small gbk-muted' }, 'Goals, assists and penalties come from the game sheet where there is one, with corrections on top; otherwise from the coaches’ marks. Shots and SV% cover only games marked on video.'));
    } else {
      const me = s.players.find((p) => p.number === kidN) || { gp: 0, g: 0, a: 0, pts: 0, pim: 0 };
      const rank = s.players.filter((p) => p.pts > me.pts).length + 1;
      const tied = s.players.filter((p) => p.pts === me.pts).length > 1;
      const games = GB.playerGames(book, kidN, st.type);
      const allGoals = games.flatMap((g) => g.goalIds.map((id) => ({ key: g.key, id })));
      const team = st.allTeam ? s.players : s.players.slice(0, 6).concat(s.players.slice(6).filter((p) => p.number === kidN));
      view = h('div', { class: 'gbk gbk-stats' },
        h('section', { class: 'gbk-card gbk-kidcard gbk-kidrow' },
          h('div', { class: 'gbk-col' }, h('h2', {}, `${o.kid.name || '#' + kidN} `, pill('#' + kidN, 'info')),
            h('p', { class: 'gbk-small gbk-muted' }, me.pts ? `${tied ? 'Tied ' : ''}${ord(rank)} on the team in points` : 'No points yet this season')),
          h('div', { class: 'gbk-grid5 gbk-grow' }, [['Games', me.gp], ['Goals', me.g], ['Assists', me.a], ['Points', me.pts], ['PIM', me.pim]].map(([l, v]) => tile(l, String(v)))),
          o.watchGoals && allGoals.length ? button(`▶ Watch all ${allGoals.length === 1 ? 'the goal' : `${allGoals.length} goals`}`, () => o.watchGoals(null, allGoals), 'primary big') : null),
        h('section', { class: 'gbk-card' }, h('div', { class: 'gbk-row gbk-spread' }, h('h2', {}, 'Game by game'), seg),
          games.length ? h('table', { class: 'gbk-table' },
            h('thead', {}, h('tr', {}, ['Date', 'Game', 'Result', 'G', 'A', 'PTS', 'PIM', 'Game Book', ''].map((t, i) => h('th', { class: (i >= 3 && i <= 6 ? 'gbk-num' : '') + (i === 6 || i === 7 ? ' gbk-wide-only' : '') }, t)))),
            h('tbody', {}, games.map((g) => h('tr', {}, h('td', {}, dateLabel(g.date)), h('td', {}, `${g.homeAway === 'away' ? '@' : 'vs'} ${g.opponent}`),
              h('td', { class: g.result === 'W' ? 'gbk-us' : g.result === 'L' ? 'gbk-them' : '' }, h('b', {}, `${g.result} ${g.score.for}–${g.score.against}`)),
              [g.g, g.a].map((v) => h('td', { class: 'gbk-num' }, String(v))), h('td', { class: 'gbk-num' }, h('b', {}, String(g.pts))), h('td', { class: 'gbk-num gbk-wide-only' }, String(g.pim)),
              h('td', { class: 'gbk-wide-only' }, g.status === 'official' ? pill('Official', 'good') : pill('Coaches’ marks', 'work')),
              h('td', { class: 'gbk-right gbk-nowrap' }, o.watchGoals && g.goalIds.length ? button(g.goalIds.length === 1 ? '▶ The goal' : `▶ ${g.goalIds.length} goals`, () => o.watchGoals(g.key, g.goalIds.map((id) => ({ key: g.key, id }))), 'small') : null, ' ',
                o.openGame ? button('Summary', () => o.openGame(g.key), 'small') : null)))))
            : h('p', { class: 'gbk-muted' }, 'No games with goal details yet.')),
        h('div', { class: 'gbk-grid21' },
          h('section', { class: 'gbk-card' }, h('div', { class: 'gbk-row gbk-spread' }, h('h2', {}, 'Team'), h('span', { class: 'gbk-small gbk-muted' }, 'From the team’s Game Book')),
            h('table', { class: 'gbk-table' }, h('thead', {}, h('tr', {}, ['Player', 'GP', 'G', 'A', 'PTS', 'PIM'].map((t, i) => h('th', { class: i ? 'gbk-num' : '' }, t)))),
              h('tbody', {}, team.map((p) => h('tr', { class: p.number === kidN ? 'gbk-kid' : '' }, h('td', {}, p.number === kidN ? h('b', {}, P(p.number)) : P(p.number)),
                [p.gp, p.g, p.a].map((v) => h('td', { class: 'gbk-num' }, String(v))), h('td', { class: 'gbk-num' }, h('b', {}, String(p.pts))), h('td', { class: 'gbk-num' }, String(p.pim)))))),
            s.players.length > team.length || st.allTeam ? button(st.allTeam ? 'Show fewer' : `Show all ${s.players.length} players`, () => { st.allTeam = !st.allTeam; draw(); }, 'link') : null),
          h('section', { class: 'gbk-card' }, h('h2', {}, 'Season'), tile('Record', rec), tile('Goals for / against', `${s.gf} / ${s.ga}`))));
    }
    clear(root).append(view);
  }
  draw();
  return { update(book) { st.book = book; draw(); }, destroy() { clear(root); } };
}

const tile = (label, value) => h('div', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, label), h('b', {}, value));
const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
