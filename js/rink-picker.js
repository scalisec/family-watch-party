// The "Pick the LiveBarn rink" window, shared by the home screen and the game page.
import { DATA_BASE } from './config.js';
import { dayLabel, parseLiveBarn } from './games.js';
import { h, toast } from './ui.js';
import { isConnected } from './google.js';
import { saveLibrary } from './drive.js';
import { cacheRecord, loadGoogle } from './data.js';
import { loadRinkDirectory, suggest, parseRinkInput, setRink, clearRink, sameRinkGames, rinkKey } from './rinks.js';

const MAX_LIST = 40;

/**
 * Opens the window; when the person saves, writes the pick to the Drive record.
 * @returns {Promise<{record, library}|null>} the updated record and library, or null if nothing changed
 */
export async function pickRink({ game, games, record, library }) {
  if (!isConnected()) { toast('Connect Google first, so the rink is saved in your Family Hockey record.'); return null; }
  const current = (record.rinks || {})[game.id] || null;
  const others = sameRinkGames(games, game).filter((g) => !(record.rinks || {})[g.id] || (record.rinks[g.id].surfaceId === (current && current.surfaceId)));
  let directory = [];
  let chosen = current ? { surfaceId: current.surfaceId, name: current.name } : null;

  const search = h('input', { type: 'search', class: 'field-input', placeholder: 'Search rinks', 'aria-label': 'Search rinks' });
  const list = h('div', { class: 'rink-list', role: 'radiogroup', 'aria-label': 'LiveBarn rinks' }, h('p', { class: 'small muted' }, 'Loading the rinks…'));
  const paste = h('input', { type: 'text', class: 'field-input', placeholder: 'https://watch.livebarn.com/en/video/…', 'aria-label': 'LiveBarn link for this rink' });
  const pasteNote = h('p', { class: 'small muted' }, 'In LiveBarn, open this rink (any day is fine) and copy the address from the top of the browser.');
  const alsoBox = h('input', { type: 'checkbox' });
  const also = others.length
    ? h('label', { class: 'check-line' }, alsoBox, h('span', {}, `Also use it for the ${others.length} other game${others.length === 1 ? '' : 's'} at ${game.rink || game.venue} with no LiveBarn link`))
    : null;
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Save rink');
  const cancelBtn = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const removeBtn = current ? h('button', { type: 'button', class: 'btn' }, 'Remove the rink') : null;
  const status = h('p', { class: 'small muted', role: 'status' });

  const dialog = h('dialog', { class: 'rink-dialog', 'aria-labelledby': 'rinkDialogTitle' },
    h('div', { class: 'stack' },
      h('h2', { id: 'rinkDialogTitle' }, 'Pick the LiveBarn rink'),
      h('p', { class: 'muted' }, `${dayLabel(game.date)} · ${game.kid} · ${game.opponentLabel}${game.rink ? ` · at ${game.rink}` : ''}`),
      search, list,
      h('div', { class: 'stack-tight' }, h('strong', { class: 'small' }, 'Not in the list? Paste the LiveBarn link for this rink'), paste, pasteNote),
      also, status,
      h('div', { class: 'row dialog-buttons' }, saveBtn, cancelBtn, removeBtn)));

  function paintList() {
    const q = search.value.trim().toLowerCase();
    const suggested = suggest(directory, game.venue);
    const rest = directory.filter((d) => !suggested.includes(d));
    const match = (d) => !q || d.name.toLowerCase().includes(q) || d.venue.toLowerCase().includes(q) || d.surfaceId.includes(q);
    const rows = [];
    const add = (d, tag) => rows.push(h('label', { class: `rink-option${chosen && chosen.surfaceId === d.surfaceId ? ' picked' : ''}` },
      h('input', { type: 'radio', name: 'rink', checked: Boolean(chosen && chosen.surfaceId === d.surfaceId), onchange: () => { chosen = { surfaceId: d.surfaceId, name: d.name }; paste.value = ''; paintList(); paint(); } }),
      h('span', {}, h('strong', {}, d.name), h('span', { class: 'small muted' }, ` · LiveBarn #${d.surfaceId}${tag ? ` · ${tag}` : ''}`))));
    const sug = suggested.filter(match);
    if (sug.length) { rows.push(h('p', { class: 'small muted list-label' }, 'Best matches')); sug.slice(0, 6).forEach((d) => add(d, d.key === rinkKey(game.venue) ? 'same rink, from another schedule' : '')); }
    const others_ = rest.filter(match);
    if (others_.length) { rows.push(h('p', { class: 'small muted list-label' }, q ? 'Other rinks' : 'All rinks in the league schedules')); others_.slice(0, MAX_LIST).forEach((d) => add(d, '')); }
    if (!rows.length) rows.push(h('p', { class: 'small muted' }, directory.length ? 'No rinks match. Paste the LiveBarn link below instead.' : 'No rinks found in the schedules. Paste the LiveBarn link below.'));
    list.replaceChildren(...rows);
  }

  function paint() {
    saveBtn.disabled = !chosen;
    status.textContent = chosen ? `Using LiveBarn rink #${chosen.surfaceId}${chosen.name ? ` (${chosen.name})` : ''}.` : '';
  }

  search.addEventListener('input', paintList);
  paste.addEventListener('input', () => {
    const id = parseRinkInput(paste.value);
    if (paste.value.trim() && !id) { pasteNote.textContent = "That doesn't look like a LiveBarn rink link. It should look like watch.livebarn.com/en/video/1234/…"; pasteNote.classList.add('warn-text'); return; }
    pasteNote.classList.remove('warn-text');
    pasteNote.textContent = 'In LiveBarn, open this rink (any day is fine) and copy the address from the top of the browser.';
    if (id) {
      const known = directory.find((d) => d.surfaceId === id);
      chosen = { surfaceId: id, name: known ? known.name : (game.rink || game.venue || '') };
      paintList();
    }
    paint();
  });

  document.body.append(dialog);
  dialog.showModal();
  paint();
  loadRinkDirectory(DATA_BASE, parseLiveBarn)
    .then((d) => { directory = d; paintList(); })
    .catch(() => { list.replaceChildren(h('p', { class: 'small muted' }, "Couldn't load the rink list. Paste the LiveBarn link below instead.")); });

  const answer = await new Promise((resolve) => {
    saveBtn.addEventListener('click', () => resolve({ kind: 'save' }));
    cancelBtn.addEventListener('click', () => resolve(null));
    if (removeBtn) removeBtn.addEventListener('click', () => resolve({ kind: 'remove' }));
    dialog.addEventListener('cancel', () => resolve(null));
  });
  if (!answer) { dialog.close(); dialog.remove(); return null; }

  saveBtn.disabled = true;
  status.textContent = 'Saving…';
  try {
    let lib = library;
    if (!lib) {
      const out = await loadGoogle();
      if (!out || !out.library) throw new Error("Couldn't open the Family Hockey folder in Drive.");
      lib = out.library;
      record = out.library.record;
    }
    let next;
    if (answer.kind === 'remove') next = clearRink(record, game.id);
    else {
      const ids = [game.id, ...(alsoBox.checked ? others.map((g) => g.id) : [])];
      next = setRink(record, ids, chosen);
    }
    const saved = await saveLibrary({ ...lib, record: next });
    cacheRecord(next);
    dialog.close();
    dialog.remove();
    const count = answer.kind === 'remove' ? 0 : 1 + (alsoBox.checked ? others.length : 0);
    toast(answer.kind === 'remove' ? 'Rink removed.' : `Rink saved for ${count} game${count === 1 ? '' : 's'}.`);
    return { record: next, library: saved };
  } catch (err) {
    status.textContent = `Couldn't save: ${err.message}`;
    saveBtn.disabled = false;
    await new Promise((resolve) => { cancelBtn.addEventListener('click', resolve, { once: true }); dialog.addEventListener('cancel', resolve, { once: true }); });
    dialog.close();
    dialog.remove();
    return null;
  }
}
