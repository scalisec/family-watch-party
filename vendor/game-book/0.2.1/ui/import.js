// Import a game sheet: the same panel in either app. Reads the PDF on this computer, works out which side we are and
// which game it is, compares it with the coaches' marks, then saves it to the Game Book once.
import * as GB from '../core/index.js';
import { h, dialog, button, pill, fill } from './dom.js';
import { dateLabel, ordinal, player } from './format.js';

/**
 * o: { book, key (the game, when opened from a game; else matched by date), readPdf(file) -> text items, teamNames: [our names],
 *   by, kid }. Resolves with { book, key } or null.
 */
export function openImportSheet(o) {
  const st = { step: 'pick', file: null, parsed: null, side: null, facts: null, key: o.key || '', useMark: new Set(), error: '', busy: false };
  const games = Object.values(o.book.games || {}).map((g) => ({ key: g.key, date: g.schedule.date, opponent: g.schedule.opponent, homeAway: g.schedule.homeAway }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return dialog((close) => {
    const body = h('div', { class: 'gbk-dlg-body' });

    async function read(file) {
      st.busy = true; st.error = ''; render();
      try {
        st.file = file;
        st.parsed = GB.parseGameSheet(await o.readPdf(file));
        st.side = GB.sheetSide(st.parsed, o.teamNames || [o.book.team.name]);
        if (st.side) finishRead();
        else st.step = 'side';
      } catch (e) { st.error = e.message || String(e); st.step = 'pick'; }
      st.busy = false;
      render();
    }
    function finishRead() {
      st.facts = GB.sheetFacts(st.parsed, st.side);
      if (!st.key) {
        const sameDay = games.filter((g) => g.date === st.facts.date);
        const named = sameDay.find((g) => g.opponent && st.facts.them.toLowerCase().includes(g.opponent.toLowerCase().split(' ').pop()));
        st.key = (named || sameDay[0] || {}).key || '';
      }
      st.step = 'check';
    }

    function render() {
      const parts = [h('div', { class: 'gbk-row gbk-spread' }, h('div', {}, h('span', { class: 'gbk-name' }, 'GAME BOOK'), h('h2', {}, 'Import a game sheet')))];
      // 1 · the PDF
      parts.push(h('section', { class: 'gbk-card' }, h('h3', {}, '1 · The PDF'),
        st.file && st.parsed
          ? h('div', { class: 'gbk-drop' }, pill('✓ Read on this computer', 'good'), h('span', {}, h('b', {}, st.file.name), h('span', { class: 'gbk-muted gbk-small' }, ' · nothing uploaded, no player names kept')),
              h('span', { class: 'gbk-grow' }), button('Pick another PDF', () => pick()))
          : h('div', { class: 'gbk-drop' }, h('span', {}, st.busy ? 'Reading the game sheet…' : 'Download the game sheet from GameSheet as a PDF, then pick it here. It’s read on this computer and never uploaded.'),
              h('span', { class: 'gbk-grow' }), button('Pick the PDF', () => pick(), 'primary', { disabled: st.busy })),
        st.error ? h('p', { class: 'gbk-error', role: 'alert' }, st.error) : null));
      if (st.step === 'side') {
        parts.push(h('section', { class: 'gbk-card' }, h('h3', {}, 'Which team are you on this game sheet?'),
          h('p', { class: 'gbk-muted' }, `The names on the sheet don’t match ${o.book.team.name || 'your team'}.`),
          h('div', { class: 'gbk-row' }, ['home', 'visitor'].map((s) => button(`${st.parsed[s].name || (s === 'home' ? 'Home team' : 'Visiting team')} (${s === 'home' ? 'home' : 'visitor'})`, () => { st.side = s; finishRead(); render(); })))));
      }
      if (st.step === 'check') {
        const f = st.facts;
        parts.push(h('section', { class: 'gbk-card' }, h('h3', {}, '2 · Which game it is'),
          h('div', { class: 'gbk-grid3' },
            h('div', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, 'On the sheet'), h('b', {}, `${f.us} ${f.score.for}–${f.score.against} ${f.them}`),
              h('span', { class: 'gbk-muted gbk-small' }, [f.number ? 'Game ' + f.number : '', dateLabel(f.date, { year: true })].filter(Boolean).join(' · '))),
            h('div', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, 'We are'), h('b', {}, st.side === 'home' ? 'Home' : 'Visitor'),
              button('Change', () => { st.side = st.side === 'home' ? 'visitor' : 'home'; st.facts = GB.sheetFacts(st.parsed, st.side); render(); }, 'link')),
            h('label', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, 'Goes with'),
              h('select', { class: 'gbk-input', disabled: !!o.key, onChange: (e) => { st.key = e.target.value; render(); } },
                h('option', { value: '' }, 'Pick the game…'),
                games.map((g) => h('option', { value: g.key, selected: g.key === st.key }, `${dateLabel(g.date)} ${g.homeAway === 'away' ? '@' : 'vs'} ${g.opponent || g.key}`)))))));
        if (st.key) {
          const c = GB.compareSheet(o.book, st.key, f);
          parts.push(h('section', { class: 'gbk-card' }, h('h3', {}, '3 · Compared with what’s already in the Game Book'),
            h('div', { class: 'gbk-grid4' },
              h('div', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, 'Goals that match the marks'), h('b', { class: 'gbk-us' }, String(c.matches))),
              h('div', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, 'Goals that differ'), h('b', { class: c.differs.length ? 'gbk-worktext' : '' }, String(c.differs.length))),
              h('div', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, 'Only on the sheet'), h('b', {}, `${c.sheetOnly.goals} goals · ${c.sheetOnly.penalties} penalties`)),
              h('div', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, 'Only in the marks'), h('b', {}, String(c.trackedOnly.length)))),
            c.differs.length ? h('table', { class: 'gbk-table' },
              h('thead', {}, h('tr', {}, ['Goal', 'Game sheet', 'The mark', 'What happens', ''].map((t) => h('th', {}, t)))),
              h('tbody', {}, c.differs.map((d) => h('tr', {},
                h('td', {}, `${ordinal(d.sheet.per)} · ${d.sheet.time} left`),
                h('td', {}, line(o, d.sheet.scorer, d.sheet.assists)),
                h('td', {}, line(o, d.tracked.scorer, d.tracked.assists)),
                h('td', {}, st.useMark.has(d.sheet.id) ? 'The mark is used, as a correction on top of the sheet.' : 'The sheet is used. The mark keeps its video link and shows as “mark differs”.'),
                h('td', { class: 'gbk-right' }, button(st.useMark.has(d.sheet.id) ? 'Use the sheet' : 'Use the mark (correction)', () => { if (st.useMark.has(d.sheet.id)) st.useMark.delete(d.sheet.id); else st.useMark.add(d.sheet.id); render(); }, 'small'))))))
              : null,
            c.trackedOnly.length ? h('p', { class: 'gbk-muted gbk-small' }, `${c.trackedOnly.length} marked goal${c.trackedOnly.length === 1 ? ' isn’t' : 's aren’t'} on the sheet: shown as “Not on the game sheet” and left out of the totals until someone confirms ${c.trackedOnly.length === 1 ? 'it' : 'them'}.`) : null,
            c.replacing ? h('p', { class: 'gbk-callout' }, h('b', {}, 'This game already has a game sheet. '), 'Importing replaces it; corrections stay on top.') : null));
        }
      }
      parts.push(h('div', { class: 'gbk-row gbk-spread' },
        h('span', { class: 'gbk-muted gbk-small' }, 'Saved once. Both apps, and everyone the Game Book is shared with, see it.'),
        h('div', { class: 'gbk-row' }, button('Cancel', () => close(null), 'big'),
          button('Save to Game Book', () => {
            try {
              let b = GB.importSheet(o.book, st.key, st.facts, { by: o.by, file: st.file && st.file.name });
              const c = GB.compareSheet(o.book, st.key, st.facts);
              for (const d of c.differs.filter((x) => st.useMark.has(x.sheet.id))) {
                b = GB.addCorrection(b, st.key, { kind: 'edit-goal', target: d.sheet.id, set: { scorer: d.tracked.scorer, assists: d.tracked.assists }, note: 'Used the mark from the video' }, { by: o.by }).book;
              }
              close({ book: b, key: st.key });
            } catch (e) { st.error = e.message; render(); }
          }, 'primary big', { disabled: st.step !== 'check' || !st.key }))));
      fill(body, parts);
    }

    function pick() {
      const inp = h('input', { type: 'file', accept: '.pdf,application/pdf', hidden: true, onChange: () => { const f = inp.files[0]; inp.remove(); if (f) read(f); } });
      body.append(inp);
      inp.click();
    }
    render();
    if (o.file) read(o.file);
    return body;
  }, { label: 'Import a game sheet', wide: true });
}

const line = (o, scorer, assists) => `${player(o.book, scorer, o.kid) || 'No scorer'} · ${assists.length ? 'A ' + assists.map((a) => player(o.book, a, o.kid)).join(', ') : 'no assists'}`;
