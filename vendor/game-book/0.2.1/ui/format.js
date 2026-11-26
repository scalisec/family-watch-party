// Words for numbers: periods, players, penalties, dates. Canadian English, sentence case.

export const ordinal = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n ? 'OT' + (n > 4 ? n - 3 : '') : '—');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function dateLabel(iso, { year = false, day = true } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${day ? DAYS[d.getDay()] + ' ' : ''}${MONTHS[d.getMonth()]} ${d.getDate()}${year ? ', ' + m[1] : ''}`;
}
export function whenLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const h = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "#7 S. Smith", the kid's own name in the family view, or just "#7". */
export function player(book, n, kid) {
  if (!n) return '';
  if (kid && kid.number === n && kid.name) return `#${n} ${kid.name}`;
  const p = (book.roster || []).find((x) => x.number === n);
  return p && p.name ? `#${n} ${p.name}` : `#${n}`;
}

const PENALTIES = { body_checking: 'Body checking', checking_behind: 'Checking from behind', cross_checking: 'Cross-checking', delay_of_game: 'Delay of game',
  head_contact: 'Head contact', high_sticking: 'High sticking', holding_stick: 'Holding the stick', too_many: 'Too many players', unsportsmanlike: 'Unsportsmanlike conduct', other: 'Penalty' };
export const penaltyLabel = (type) => PENALTIES[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ') : 'Penalty');

export const teamName = (book) => (book.team && book.team.name) || 'Us';
export const opponentName = (book, eff) => (eff.schedule && eff.schedule.opponent) || 'Them';
