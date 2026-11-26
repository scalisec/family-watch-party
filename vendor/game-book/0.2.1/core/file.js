// The Drive file: "Game Book – <team> <season>.json". Each file carries a schema version. An app with older Game
// Book code reads a newer file but won't write to it, and asks for an update instead of risking the data.
import { APP, SCHEMA, normalizeBook } from './book.js';

export function bookFileName(book) {
  const t = (book.team && book.team.name) || 'Team';
  const s = (book.team && book.team.season) || '';
  return `Game Book – ${t}${s ? ' ' + s : ''}.json`.replace(/[\\/:*?"<>|]+/g, '-');
}

export function bookFileText(book, { by = '', at = new Date().toISOString() } = {}) {
  const b = normalizeBook(book);
  return JSON.stringify(Object.assign({}, b, { app: APP, schema: SCHEMA, updatedAt: at, updatedBy: by }), null, 2);
}

/** Returns { book, readOnly }. readOnly: the file was written by newer Game Book code than this app has. */
export function parseBookFile(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('The Game Book file is damaged'); }
  if (!d || d.app !== APP) throw new Error('That file isn’t a Game Book');
  const schema = Number(d.schema) || 0;
  if (schema < 1) throw new Error('That Game Book file has no version');
  return { book: normalizeBook(d), readOnly: schema > SCHEMA, schema };
}

export const canWrite = (parsed) => !parsed.readOnly;
