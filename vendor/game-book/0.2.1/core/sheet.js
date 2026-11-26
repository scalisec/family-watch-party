// GameSheet PDF reader, moved from Bulldogs Watch Party core.js (v2.7.1) unchanged except: ES module exports,
// and sheetFacts no longer stamps importedAt (the Game Book records who imported it and when).

export const PENALTY_MINUTES = [2, 4, 5, 10];

// GameSheet infraction codes -> this app's penalty types
export const SHEET_CODES = {
  TR: 'tripping', HKG: 'hooking', HK: 'hooking', SL: 'slashing', SLA: 'slashing', HO: 'holding', HLD: 'holding', HS: 'high_sticking', HST: 'high_sticking',
  HHS: 'holding_stick', INT: 'interference', RO: 'roughing', RGH: 'roughing', CC: 'cross_checking', XC: 'cross_checking', BC: 'body_checking',
  CFB: 'checking_behind', CB: 'checking_behind', HC: 'head_contact', HD: 'head_contact', EL: 'elbowing', ELB: 'elbowing', KN: 'kneeing', KNE: 'kneeing',
  BD: 'boarding', BRD: 'boarding', CH: 'charging', CHG: 'charging', SP: 'spearing', SPR: 'spearing', DG: 'delay_of_game', DOG: 'delay_of_game',
  TM: 'too_many', TMM: 'too_many', USC: 'unsportsmanlike', UC: 'unsportsmanlike', FI: 'fighting', FT: 'fighting'
};

/** "BC-MIN" -> { type: 'body_checking', minutes: 2, code: 'BC-MIN' }. */
export function sheetInfraction(text, mins) {
  const code = String(text || '').trim().toUpperCase();
  const base = code.split(/[-\s]/)[0];
  const m = Number(mins);
  const minutes = /MISC|GM|GMSC/.test(code) ? 10 : /MAJ/.test(code) ? 5 : /DBL|DM/.test(code) ? 4 : PENALTY_MINUTES.includes(m) ? m : 2;
  return { type: SHEET_CODES[base] || 'other', minutes, code };
}

/**
 * Read a GameSheet PDF's text (one page) into the game's facts. items: [{ s, x, y, w }] in page points, y measured
 * down from the top (pdf.js text items; a multi-word item is split into words here). Returns
 * { number, date, location, periods: { 1: 10, … }, home: { name, goals, penalties }, visitor: { … } }, where each goal is
 * { per, time, g, a: [] } and each penalty { per, no, minutes, type, code, off, on } (jersey numbers only: no names).
 * Throws when the page doesn't look like a GameSheet game sheet.
 */
export function parseGameSheet(items) {
  const words = [];
  for (const it of items || []) {
    const str = String(it.s == null ? it.str : it.s);
    const parts = str.split(/(\s+)/);
    const per = str.length ? (Number(it.w) || 0) / str.length : 0;
    let off = 0;
    for (const p of parts) {
      if (p.trim()) words.push({ t: p, x0: Number(it.x) + off * per, x1: Number(it.x) + (off + p.length) * per, y: Number(it.y) });
      off += p.length;
    }
  }
  const cx = (w) => (w.x0 + w.x1) / 2;
  const near = (a, b, d) => Math.abs(a - b) <= (d || 2.5);
  const infr = words.filter((w) => /^Infraction$/i.test(w.t)).sort((a, b) => a.x0 - b.x0);
  if (infr.length < 2) throw new Error('This doesn’t look like a GameSheet game sheet (no penalty and scoring tables found).');
  const headY = infr[0].y;
  const head = words.filter((w) => near(w.y, headY)).sort((a, b) => a.x0 - b.x0);
  const totalY = Math.min(...words.filter((w) => /^(Total|List)$/i.test(w.t) && w.y > headY).map((w) => w.y).concat([headY + 400]));
  const COLS = ['per', 'no', 'min', 'code', 'infraction', 'off', 'start', 'on', 'gper', 'time', 'g', 'a1', 'a2'];
  const sides = infr.slice(0, 2).map((inf) => {
    // the 13 headers of this side: the 4 before "Infraction" and the 8 after it
    const i = head.indexOf(inf);
    const cols = head.slice(i - 4, i + 9);
    if (cols.length !== 13 || !/^PER$/i.test(cols[0].t) || !/^TIME$/i.test(cols[9].t)) throw new Error('The game sheet’s tables aren’t in the usual layout.');
    return { cols, lo: cols[0].x0 - 8, hi: cols[12].x1 + 10 };
  });
  const readSide = (side) => {
    const data = words.filter((w) => w.y > headY + 4 && w.y < totalY - 2 && cx(w) >= side.lo && cx(w) <= side.hi);
    const rows = [];
    for (const w of data.sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
      const r = rows.find((x) => near(x.y, w.y));
      if (r) r.words.push(w); else rows.push({ y: w.y, words: [w] });
    }
    const goals = [], penalties = [];
    for (const r of rows) {
      const cell = {};
      for (const w of r.words) {
        let best = 0, bd = Infinity;
        side.cols.forEach((c, k) => { const d = Math.abs(cx(c) - cx(w)); if (d < bd) { bd = d; best = k; } });
        let key = COLS[best];
        if (key === 'code') key = 'infraction';
        cell[key] = cell[key] ? cell[key] + ' ' + w.t : w.t;
      }
      if (/^\d$/.test(cell.per || '') && cell.min) {
        const inf = sheetInfraction(cell.infraction, cell.min);
        penalties.push({ per: Number(cell.per), no: /^\d{1,2}$/.test(cell.no || '') ? cell.no : '', minutes: inf.minutes, type: inf.type, code: inf.code, off: cell.off || '', on: cell.on || '' });
      }
      if (/^\d$/.test(cell.gper || '') && /^\d{1,2}:\d{2}$/.test(cell.time || '')) {
        goals.push({ per: Number(cell.gper), time: cell.time, g: /^\d{1,2}$/.test(cell.g || '') ? cell.g : '', a: [cell.a1, cell.a2].filter((x) => /^\d{1,2}$/.test(x || '')) });
      }
    }
    return { goals, penalties };
  };
  // team names: under the first "HOME" / "VISITOR" labels above the tables
  const teamName = (label) => {
    const lab = words.filter((w) => w.t.toUpperCase() === label && w.y < headY && w.y > headY - 25).sort((a, b) => a.x0 - b.x0)[0];
    if (!lab) return '';
    return words.filter((w) => w.y > lab.y + 3 && w.y < lab.y + 15 && w.x0 >= lab.x0 - 3 && w.x0 < lab.x0 + 170 && w.y < headY - 0.5)
      .sort((a, b) => a.x0 - b.x0).map((w) => w.t).join(' ').trim();
  };
  const rowText = (pred) => words.filter(pred).sort((a, b) => a.x0 - b.x0).map((w) => w.t).join(' ');
  const after = (label, stop) => {
    const l = words.find((w) => w.t === label && w.y < headY);
    if (!l) return '';
    const t = rowText((w) => near(w.y, l.y, 3) && w.x0 > l.x1);
    return (stop ? t.split(stop)[0] : t).trim();
  };
  const months = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const dm = /([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(after('Date', 'Division'));
  const date = dm && months[dm[1]] ? dm[3] + '-' + String(months[dm[1]]).padStart(2, '0') + '-' + dm[2].padStart(2, '0') : '';
  const periods = {};
  for (const w of words.filter((x) => /^(1st|2nd|3rd)$/.test(x.t) && x.y < headY)) {
    const n = words.find((x) => near(x.y, w.y, 2) && x.x0 > w.x1 && x.x0 < w.x1 + 30 && /^\d{1,2}$/.test(x.t));
    if (n) periods[{ '1st': 1, '2nd': 2, '3rd': 3 }[w.t]] = Number(n.t);
  }
  const loc = words.find((w) => w.t === 'Location' && w.y < headY);
  const location = loc ? rowText((w) => near(w.y, loc.y, 3) && w.x0 > loc.x1 + 30).split(' League')[0].trim() : '';
  const home = Object.assign({ name: teamName('HOME') }, readSide(sides[0]));
  const visitor = Object.assign({ name: teamName('VISITOR') }, readSide(sides[1]));
  return { number: after('No:').split(' ')[0] || '', date, location, periods, home, visitor };
}

const nameWords = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !/^(u\d+|jr|the|of|aa|a|b|bb|team)$/.test(w));
/** Which side of a parsed sheet is us: 'home', 'visitor' or null (can't tell). names: our names (team, league team). */
export function sheetSide(sheet, names) {
  const ours = new Set((names || []).flatMap(nameWords));
  const score = (n) => nameWords(n).filter((w) => ours.has(w)).length / Math.max(1, nameWords(n).length);
  const h = score(sheet.home.name), v = score(sheet.visitor.name);
  if (h === v) return null;
  return h > v ? 'home' : 'visitor';
}

/** "mm:ss" left on the clock -> seconds into a period of `len` minutes (sheet clocks count down). */
export function clockElapsed(time, len) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!m) return 0;
  return Math.max(0, (Number(len) || 0) * 60 - (Number(m[1]) * 60 + Number(m[2])));
}

/**
 * What the app keeps from a sheet, from our side: { number, date, location, periods, side, us, them,
 * score: { for, against }, goals: [{ side: 'for'|'against', per, time, scorer, assists }], penalties: [{ team: 'us'|'them', per, player, minutes, type, code }] },
 * goals and penalties in game order. No player names are kept.
 */
export function sheetFacts(parsed, side) {
  const us = side === 'home' ? parsed.home : parsed.visitor;
  const them = side === 'home' ? parsed.visitor : parsed.home;
  const len = (n) => parsed.periods[n] || 0;
  const order = (a, b) => a.per - b.per || clockElapsed(a.time, len(a.per)) - clockElapsed(b.time, len(b.per));
  const goals = us.goals.map((g) => ({ side: 'for', per: g.per, time: g.time, scorer: g.g, assists: g.a.slice(0, 2) }))
    .concat(them.goals.map((g) => ({ side: 'against', per: g.per, time: g.time, scorer: g.g, assists: g.a.slice(0, 2) }))).sort(order);
  const pOrder = (a, b) => a.per - b.per || clockElapsed(a.time, len(a.per)) - clockElapsed(b.time, len(b.per));
  const penalties = us.penalties.map((p) => ({ team: 'us', per: p.per, time: p.off, player: p.no, minutes: p.minutes, type: p.type, code: p.code }))
    .concat(them.penalties.map((p) => ({ team: 'them', per: p.per, time: p.off, player: p.no, minutes: p.minutes, type: p.type, code: p.code }))).sort(pOrder);
  return { number: parsed.number, date: parsed.date, location: parsed.location, periods: parsed.periods, side, us: us.name, them: them.name,
    score: { for: us.goals.length, against: them.goals.length }, goals, penalties };
}
