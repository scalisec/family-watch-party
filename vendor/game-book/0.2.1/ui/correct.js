// Correct a goal (or add one the sheet missed). The game sheet is never changed: the correction goes on top with the
// person's name, the time and an optional note, and can be undone.
import * as GB from '../core/index.js';
import { h, dialog, button, fill } from './dom.js';
import { ordinal, player, teamName, opponentName } from './format.js';

/**
 * o: { book, key, goalId (null = add a goal), by, kid }. Resolves with the new book, or null when cancelled.
 */
export function openCorrectGoal(o) {
  const eff = GB.effectiveGame(o.book, o.key);
  const g = o.goalId ? eff.goals.find((x) => x.id === o.goalId) : null;
  if (o.goalId && !g) return Promise.resolve(null);
  const adding = !g;
  const st = {
    side: g ? g.side : 'for', per: g ? g.per || 1 : 1, clock: g ? g.clock || '' : '',
    scorer: g ? g.scorer : '', assists: g ? g.assists.slice() : [], note: ''
  };
  const skaters = (o.book.roster || []).filter((p) => p.pos !== 'G');
  const us = teamName(o.book), them = opponentName(o.book, eff);

  return dialog((close) => {
    const body = h('div', { class: 'gbk-dlg-body' });
    const err = h('p', { class: 'gbk-error', role: 'alert', hidden: true });
    const fail = (e) => { err.textContent = e.message || String(e); err.hidden = false; };
    const save = (fn) => { try { close(fn()); } catch (e) { fail(e); } };

    const chips = (selected, max, onPick) => h('div', { class: 'gbk-chips', role: 'group' },
      skaters.map((p) => {
        const on = selected.includes(p.number);
        return h('button', { type: 'button', class: 'gbk-chip' + (on ? ' gbk-on' : ''), 'aria-pressed': on ? 'true' : 'false',
          onClick: () => { onPick(p.number); render(); } }, player(o.book, p.number, o.kid));
      }));
    const numberField = (label, value, onInput) => h('label', { class: 'gbk-field-row' }, h('span', { class: 'gbk-label' }, label),
      h('input', { class: 'gbk-input gbk-narrow', inputmode: 'numeric', maxlength: '2', value, placeholder: '#', onInput: (e) => onInput(e.target.value) }));

    function render() {
      fill(body,
        h('div', {}, h('h2', { id: 'gbk-cg-h' }, adding ? (eff.official ? 'Add a goal the game sheet missed' : 'Add a goal') : `Correct goal · ${ordinal(g.per)} period${g.clock ? ', ' + g.clock + ' left' : ''}`),
          g ? h('p', { class: 'gbk-muted gbk-small' }, `${g.side === 'for' ? us : them} goal that made it ${g.scoreAfter.for}–${g.scoreAfter.against}`) : null),
        g && (g.source !== 'tracked' || g.mark) ? h('div', { class: 'gbk-grid2' },
          g.source !== 'tracked' && eff.official ? h('div', { class: 'gbk-stat' }, h('span', { class: 'gbk-muted gbk-small' }, 'Game sheet (official)'),
            h('b', {}, officialOf(o.book, o.key, g.id, o.kid))) : null,
          g.mark ? h('div', { class: 'gbk-stat gbk-warnline' }, h('span', { class: 'gbk-muted gbk-small' }, 'Your mark on the video'),
            h('b', {}, `${player(o.book, g.mark.scorer, o.kid) || 'No scorer'} · ${g.mark.assists.length ? 'A ' + g.mark.assists.map((a) => player(o.book, a, o.kid)).join(', ') : 'no assists'}`),
            button('Use my mark', () => { st.scorer = g.mark.scorer; st.assists = g.mark.assists.slice(); render(); }, 'link')) : null) : null,
        g && g.notOnSheet ? h('p', { class: 'gbk-callout' }, h('b', {}, 'Not on the game sheet. '), 'A coach marked this goal, but the sheet doesn’t have it, so it isn’t counted. Count it if the sheet missed it, or remove it.') : null,
        adding ? h('div', { class: 'gbk-row' },
          h('div', { class: 'gbk-seg', role: 'group', 'aria-label': 'Team' },
            ['for', 'against'].map((s) => h('button', { type: 'button', class: st.side === s ? 'gbk-on' : '', 'aria-pressed': st.side === s ? 'true' : 'false', onClick: () => { st.side = s; st.scorer = ''; st.assists = []; render(); } }, s === 'for' ? us : them))),
          h('label', { class: 'gbk-field-row' }, h('span', { class: 'gbk-label' }, 'Period'),
            h('select', { class: 'gbk-input', onChange: (e) => { st.per = Number(e.target.value); } }, [1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: st.per === n }, ordinal(n))))),
          h('label', { class: 'gbk-field-row' }, h('span', { class: 'gbk-label' }, 'Time left'),
            h('input', { class: 'gbk-input gbk-narrow', placeholder: 'mm:ss', value: st.clock, onInput: (e) => { st.clock = e.target.value.trim(); } }))) : null,
        st.side === 'for'
          ? [h('div', { class: 'gbk-field' }, h('span', { class: 'gbk-label' }, 'Scored by'),
              chips(st.scorer ? [st.scorer] : [], 1, (n) => { st.scorer = st.scorer === n ? '' : n; st.assists = st.assists.filter((a) => a !== n); })),
             h('div', { class: 'gbk-field' }, h('span', { class: 'gbk-label' }, 'Assists ', h('span', { class: 'gbk-muted' }, '(up to 2)')),
              chips(st.assists, 2, (n) => {
                if (n === st.scorer) return;
                st.assists = st.assists.includes(n) ? st.assists.filter((a) => a !== n) : st.assists.concat([n]).slice(-2);
              }))]
          : h('div', { class: 'gbk-row' }, numberField('Scored by', st.scorer, (v) => { st.scorer = v; }),
              numberField('Assist', st.assists[0] || '', (v) => { st.assists = [v, st.assists[1] || ''].filter(Boolean); }),
              numberField('Assist', st.assists[1] || '', (v) => { st.assists = [st.assists[0] || '', v].filter(Boolean); })),
        h('label', { class: 'gbk-field' }, h('span', { class: 'gbk-label' }, 'Why ', h('span', { class: 'gbk-muted' }, '(optional, shown in History)')),
          h('input', { class: 'gbk-input', maxlength: '200', value: st.note, placeholder: 'e.g. Watched it twice: Park made the pass', onInput: (e) => { st.note = e.target.value; } })),
        h('p', { class: 'gbk-callout' }, eff.official ? 'The game sheet stays as imported. ' : '', 'Your correction goes on top with your name and the time, and can be undone from History. Both apps show it.'),
        err,
        h('div', { class: 'gbk-row gbk-spread' },
          h('div', { class: 'gbk-row' },
            g && g.source !== 'added' && g.corrections.length ? button(eff.official && g.source !== 'tracked' ? 'Back to the game sheet’s version' : 'Undo my changes', () => save(() => GB.revertGoal(o.book, o.key, g.id, { by: o.by })), 'link') : null,
            g && g.notOnSheet ? button('Remove this goal', () => save(() => GB.addCorrection(o.book, o.key, { kind: 'remove-goal', target: g.id, note: st.note }, { by: o.by }).book), 'link') : null,
            g && g.source === 'added' ? button('Remove this goal', () => save(() => GB.undoCorrection(o.book, o.key, g.id.replace(/^cg-/, ''), { by: o.by })), 'link') : null),
          h('div', { class: 'gbk-row' },
            button('Cancel', () => close(null), 'big'),
            g && g.notOnSheet ? button('Count this goal', () => save(() => confirmAndEdit(o, g, st)), 'big') : null,
            button(adding ? 'Add goal' : 'Save correction', () => save(() => (adding ? addGoal(o, st) : editGoal(o, g, st))), 'primary big')))
      );
    }
    render();
    return body;
  }, { label: adding ? 'Add a goal' : 'Correct a goal' });
}

function officialOf(book, key, id, kid) {
  const s = ((book.games[key] || {}).official || { goals: [] }).goals.find((x) => x.id === id);
  if (!s) return '—';
  return `${player(book, s.scorer, kid) || 'No scorer'} · ${s.assists.length ? 'A ' + s.assists.map((a) => player(book, a, kid)).join(', ') : 'no assists'}`;
}

const cleanList = (a) => [...new Set(a.map((x) => String(x).trim()).filter(Boolean))];
const same = (a, b) => [...a].sort().join() === [...b].sort().join();

function editGoal(o, g, st) {
  const set = {};
  if (st.scorer !== g.scorer) set.scorer = st.scorer;
  if (!same(cleanList(st.assists), g.assists)) set.assists = cleanList(st.assists);
  if (!Object.keys(set).length) return o.book;   // nothing changed
  return GB.addCorrection(o.book, o.key, { kind: 'edit-goal', target: g.id, set, note: st.note }, { by: o.by }).book;
}

function confirmAndEdit(o, g, st) {
  const b = GB.addCorrection(o.book, o.key, { kind: 'confirm-goal', target: g.id, note: st.note }, { by: o.by }).book;
  return editGoal(Object.assign({}, o, { book: b }), g, st);
}

function addGoal(o, st) {
  if (st.clock && !/^\d{1,2}:\d{2}$/.test(st.clock)) throw new Error('Time left looks like 08:41');
  return GB.addCorrection(o.book, o.key, { kind: 'add-goal', set: { side: st.side, per: st.per, clock: st.clock || null, scorer: st.scorer, assists: cleanList(st.assists) }, note: st.note }, { by: o.by }).book;
}
