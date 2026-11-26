// A tiny DOM builder (never innerHTML: names and notes are people's text) and a dialog helper.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

/** Show a modal dialog. build(close) returns its content; resolves with whatever close() is given (null on Escape). */
export function dialog(build, { label = 'Dialog', wide = false } = {}) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'gbk gbk-dialog' + (wide ? ' gbk-wide' : ''), 'aria-label': label });
    let done = false;
    const close = (value = null) => {
      if (done) return;
      done = true;
      d.close();
      d.remove();
      resolve(value);
    };
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    d.append(build(close));
    document.body.append(d);
    d.showModal();
  });
}

const kinds = (kind) => String(kind || '').split(/\s+/).filter(Boolean).map((k) => ' gbk-' + k).join('');
export function pill(text, kind = '') { return h('span', { class: 'gbk-pill' + kinds(kind) }, text); }
export function button(text, onClick, kind = '', attrs = {}) {
  return h('button', Object.assign({ type: 'button', class: 'gbk-btn' + kinds(kind), onClick }, attrs), text);
}

/** Replace an element's children; takes the same children as h() (nested arrays, null skipped). */
export function fill(el, ...children) { clear(el); append(el, children); return el; }
