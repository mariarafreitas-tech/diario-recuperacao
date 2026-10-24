// Helpers de interface: criação de elementos, folhas (modais), avisos e formulários.
import { toInputValue, fromInputValue } from './time.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  // append/replaceChildren tolerantes: achatam arrays e ignoram null/false
  const flat = (list) => list.flat(Infinity).filter((c) => c != null && c !== false).map((c) => (c instanceof Node ? c : document.createTextNode(String(c))));
  const nativeAppend = el.append.bind(el), nativeReplace = el.replaceChildren.bind(el);
  el.append = (...k) => nativeAppend(...flat(k));
  el.replaceChildren = (...k) => nativeReplace(...flat(k));
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

export function toast(msg, action) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast' }, h('span', {}, msg),
    action && h('button', { class: 'link', onclick: () => { t.remove(); action.fn(); } }, action.label));
  box.append(t);
  setTimeout(() => t.remove(), action ? 7000 : 3500);
}

/** Folha inferior. build(close) devolve o conteúdo. */
export function sheet(title, build, { onClose } = {}) {
  let closed = false;
  const close = () => { if (closed) return; closed = true; overlay.remove(); if (!document.querySelector('.overlay')) document.body.classList.remove('modal-open'); onClose && onClose(); };
  const body = h('div', { class: 'sheet-body' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, '✕')), body);
  const overlay = h('div', { class: 'overlay no-print', onmousedown: (e) => { if (e.target === overlay) close(); } }, panel);
  document.body.append(overlay);
  document.body.classList.add('modal-open');
  body.append(build(close, panel));
  return { close, el: panel, body };
}

export function confirmBox(message, { ok = 'Confirmar', danger = false, title = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v, close) => { done = true; close(); resolve(v); };
    sheet(title, (close) => h('div', {},
      h('p', { class: 'big-p' }, message),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => fin(false, close) }, 'Cancelar'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => fin(true, close) }, ok))),
    { onClose: () => { if (!done) resolve(false); } });
  });
}

const parseNum = (s) => { const t = String(s).trim().replace(',', '.'); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };

/**
 * Formulário declarativo. fields: {key,label,type,options,hint,suffix,required,show(vals),computed(vals)}
 * Tipos: text, tel, number, textarea, date, datetime, select, chips, multi, toggle, photo, static, computed
 */
export function buildForm(fields, vals = {}) {
  const root = h('div', { class: 'form' });
  const getters = {}, rows = {}, computedEls = [];
  const read = () => { const o = {}; for (const k in getters) o[k] = getters[k](); return o; };
  const refresh = () => {
    const v = read();
    for (const f of fields) {
      const key = f.key || f.id;
      if (f.show && rows[key]) rows[key].hidden = !f.show(v);
    }
    computedEls.forEach(({ el, f }) => { el.textContent = f.computed(v); });
  };
  const chipRow = (f, multi) => {
    let sel = multi ? new Set(vals[f.key] || []) : (vals[f.key] ?? null);
    const row = h('div', { class: 'chips', role: multi ? 'group' : 'radiogroup' });
    const paint = () => row.querySelectorAll('button').forEach((b) => {
      const on = multi ? sel.has(b.dataset.v) : String(sel) === b.dataset.v;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    for (const o of f.options) {
      row.append(h('button', {
        type: 'button', class: `chip ${o.cls || ''}`, 'data-v': String(o.v),
        onclick: () => {
          if (multi) { sel.has(String(o.v)) ? sel.delete(String(o.v)) : sel.add(String(o.v)); }
          else sel = String(sel) === String(o.v) && !f.required ? null : o.v;
          paint(); refresh();
        },
      }, o.l));
    }
    paint();
    getters[f.key] = multi ? () => [...sel] : () => sel;
    return row;
  };

  for (const f of fields) {
    const key = f.key || f.id;
    let control;
    if (f.type === 'static') { control = h('p', { class: 'hint', html: f.html }); }
    else if (f.type === 'computed') { const el = h('output', { class: 'computed' }); computedEls.push({ el, f }); control = el; }
    else if (f.type === 'chips') control = chipRow(f, false);
    else if (f.type === 'multi') control = chipRow(f, true);
    else if (f.type === 'toggle') {
      const cb = h('input', { type: 'checkbox', checked: !!vals[f.key], onchange: refresh });
      control = h('label', { class: 'toggle' }, cb, h('span', {}, f.label));
      getters[f.key] = () => cb.checked;
    } else if (f.type === 'select') {
      const s = h('select', { onchange: refresh }, f.options.map((o) => h('option', { value: o.v, selected: String(o.v) === String(vals[f.key] ?? f.default ?? '') }, o.l)));
      getters[f.key] = () => s.value; control = s;
    } else if (f.type === 'textarea') {
      const t = h('textarea', { rows: f.rows || 3, placeholder: f.placeholder || '', oninput: refresh }); t.value = vals[f.key] ?? '';
      getters[f.key] = () => t.value.trim(); control = t;
    } else if (f.type === 'datetime') {
      const i = h('input', { type: 'datetime-local', value: toInputValue(vals[f.key] ?? Date.now()), onchange: refresh });
      getters[f.key] = () => fromInputValue(i.value); control = i;
    } else if (f.type === 'date') {
      const i = h('input', { type: 'date', value: vals[f.key] || '', onchange: refresh });
      getters[f.key] = () => i.value || null; control = i;
    } else if (f.type === 'photo') {
      const i = h('input', { type: 'file', accept: 'image/*', onchange: refresh });
      getters[f.key] = () => (i.files && i.files[0]) || null; control = i;
    } else {
      const num = f.type === 'number';
      const i = h('input', {
        type: num ? 'text' : (f.type || 'text'), inputmode: num ? 'decimal' : f.inputmode, placeholder: f.placeholder || '', autocomplete: 'off',
        value: vals[f.key] ?? f.default ?? '', oninput: refresh,
      });
      getters[f.key] = num ? () => parseNum(i.value) : () => i.value.trim();
      control = f.suffix ? h('div', { class: 'with-suffix' }, i, h('span', {}, f.suffix)) : i;
    }
    const row = h('div', { class: `field ${f.type === 'toggle' ? 'field-toggle' : ''}` },
      f.type !== 'toggle' && f.label && h('label', {}, f.label, f.required && h('b', { class: 'req', 'aria-label': 'obrigatório' }, ' *')), control,
      f.hint && f.type !== 'static' && h('small', { class: 'hint' }, f.hint));
    rows[key] = row;
    root.append(row);
  }
  refresh();
  return { el: root, read, refresh };
}

/** Reduz uma foto (máx. 1280 px, JPEG) antes de guardar. */
export async function compressImage(file, max = 1280) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
}

export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const telHref = (s) => 'tel:' + String(s || '').replace(/[^\d+]/g, '');
