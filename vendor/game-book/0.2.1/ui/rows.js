// The Game Book status on each app's game rows: Official / Coaches' marks / Score only, plus the kid's points.
import * as GB from '../core/index.js';
import { h, pill } from './dom.js';

/** { label, kind, note } for a game: e.g. { label: 'Official', kind: 'good', note: '1 correction · 1 mark differs' }. */
export function gameBookStatus(book, key, { full = true } = {}) {
  if (!book || !(book.games || {})[key]) return { label: '', kind: '', note: '' };
  const eff = GB.effectiveGame(book, key);
  const corrections = eff.corrections.filter((c) => !c.undone).length;
  const note = [corrections ? `${corrections} correction${corrections === 1 ? '' : 's'}` : '', full && eff.differs ? `${eff.differs} mark${eff.differs === 1 ? '' : 's'} differ${eff.differs === 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  if (eff.status === 'official') return { label: 'Official', kind: 'good', note };
  if (eff.status === 'tracked') return { label: 'Coaches’ marks', kind: 'work', note };
  if (eff.status === 'score') return { label: 'Score only', kind: '', note: '' };
  return { label: '', kind: '', note: '' };
}

/** A small element for a table cell: the pill and its note. */
export function statusChip(book, key, opts) {
  const s = gameBookStatus(book, key, opts);
  if (!s.label) return h('span', { class: 'gbk-muted' }, '—');
  return h('span', { class: 'gbk gbk-inline' }, pill(s.label, s.kind), s.note ? h('span', { class: 'gbk-small gbk-muted' }, ' ' + s.note) : null);
}

/** "2 G · 0 A" for one player in one game, or '' when the game has no goal details. */
export function playerLine(book, key, number) {
  if (!book || !(book.games || {})[key]) return '';
  const eff = GB.effectiveGame(book, key);
  if (eff.status !== 'official' && eff.status !== 'tracked') return '';
  const v = GB.gameSummary(eff, book.roster).players.get(String(number)) || { g: 0, a: 0 };
  return `${v.g} G · ${v.a} A`;
}
