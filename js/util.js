/* Readily v2 — utilidades: DOM, iconos, diálogos, toasts */

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

/* Texto sin tildes ni mayúsculas, conservando la longitud (permite mapear posiciones). */
export function fold(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const n = s[i].normalize('NFD');
    o += (n[0] || s[i]).toLowerCase()[0] || s[i];
  }
  return o;
}

/* Clave para saber si dos términos son "el mismo": sin tildes, puntuación ni plural simple. */
export function termKey(t) {
  return fold(String(t || ''))
    .replace(/[^a-z0-9ñ\s-]/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map(w => (w.length > 3 && w.endsWith('s')) ? w.slice(0, -1) : w)
    .join(' ');
}

export function dayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function parseDayKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }

export function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' }); } catch (_) { return ''; }
}

/* ---------- Iconos (trazo, 24x24) ---------- */
const PATHS = {
  back:    '<path d="M15 18l-6-6 6-6"/>',
  search:  '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  panel:   '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  dots:    '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
  plus:    '<path d="M12 5v14M5 12h14"/>',
  minus:   '<path d="M5 12h14"/>',
  pen:     '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  flame:   '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  close:   '<path d="M18 6L6 18M6 6l12 12"/>',
  down:    '<path d="M6 9l6 6 6-6"/>',
  up:      '<path d="M6 15l6-6 6 6"/>',
  right:   '<path d="M9 6l6 6-6 6"/>',
  trash:   '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit:    '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  send:    '<path d="M12 19V5M5 12l7-7 7 7"/>',
  chat:    '<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/>',
  book:    '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/>',
  list:    '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  cards:   '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 7V5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2h-2"/>',
  quiz:    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01"/>',
  offline: '<path d="M2 2l20 20M8.5 8.8A9 9 0 003 11.5M5.5 14.7a6 6 0 014.4-2.2M12 20h.01M16.4 12.7A6 6 0 0118.5 14.7M20.5 11.5A14 14 0 0014 7.3"/>',
  download:'<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>',
  check:   '<path d="M5 13l4 4L19 7"/>',
  gear:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  scan:    '<path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  fit:     '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  spark:   '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  copy:    '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  cal:     '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  refresh: '<path d="M20 11a8 8 0 00-14.5-3.5M4 4v4h4M4 13a8 8 0 0014.5 3.5M20 20v-4h-4"/>',
  sync:    '<path d="M21 12a9 9 0 01-15.5 6.2M3 12a9 9 0 0115.5-6.2M18 3v4h-4M6 21v-4h4"/>',
  note:    '<path d="M5 3h14v18l-4-3-3 3-3-3-4 3z"/><path d="M9 8h6M9 12h4"/>',
  home:    '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
};
export function ic(name, size = 20, extra = '') {
  return `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

/* ---------- Toast (con acción opcional) ---------- */
let toastTimer;
export function toast(message, { emoji = '', action = null, ms = 3200 } = {}) {
  document.getElementById('toast')?.remove();
  clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `${emoji ? `<span class="toast-emoji">${emoji}</span>` : ''}<span class="toast-msg">${esc(message)}</span>${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}`;
  document.body.appendChild(t);
  if (action) t.querySelector('.toast-act').onclick = () => { t.remove(); action.fn(); };
  toastTimer = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- Diálogos propios (en vez de prompt/confirm del navegador) ---------- */
export function openModal(innerHTML, { cls = '', dismissible = true } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-card ${cls}" role="dialog" aria-modal="true">${innerHTML}</div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.classList.add('out'); setTimeout(() => overlay.remove(), 160); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && dismissible) close(); };
  document.addEventListener('keydown', onKey);
  if (dismissible) overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  return { el: overlay.firstElementChild, overlay, close };
}

export function confirmBox({ title, message = '', okLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise(resolve => {
    const m = openModal(`
      <div class="modal-title">${esc(title)}</div>
      ${message ? `<p class="modal-text">${esc(message).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="modal-actions">
        <button class="btn ghost" data-r="0">${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(okLabel)}</button>
      </div>`);
    let done = false;
    const fin = v => { if (done) return; done = true; m.close(); resolve(v); };
    m.el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => fin(b.dataset.r === '1'));
    m.overlay.addEventListener('mousedown', e => { if (e.target === m.overlay) fin(false); });
    m.el.querySelector('[data-r="1"]').focus();
  });
}

export function askText({ title, value = '', placeholder = '', okLabel = 'Guardar', multiline = false }) {
  return new Promise(resolve => {
    const field = multiline
      ? `<textarea class="input" id="ask-field" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" id="ask-field" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
    const m = openModal(`
      <div class="modal-title">${esc(title)}</div>
      ${field}
      <div class="modal-actions">
        <button class="btn ghost" data-r="0">Cancelar</button>
        <button class="btn primary" data-r="1">${esc(okLabel)}</button>
      </div>`);
    const inp = m.el.querySelector('#ask-field');
    let done = false;
    const fin = v => { if (done) return; done = true; m.close(); resolve(v); };
    m.el.querySelector('[data-r="0"]').onclick = () => fin(null);
    m.el.querySelector('[data-r="1"]').onclick = () => fin(inp.value.trim() || null);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !multiline) fin(inp.value.trim() || null); });
    m.overlay.addEventListener('mousedown', e => { if (e.target === m.overlay) fin(null); });
    setTimeout(() => { inp.focus(); inp.select?.(); }, 40);
  });
}

/* ---------- Markdown mínimo y seguro para el chat ---------- */
export function renderMarkdown(raw) {
  const lines = String(raw ?? '').split('\n');
  let html = '', inPre = false, inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const line of lines) {
    if (line.startsWith('```')) { closeList(); inPre = !inPre; html += inPre ? '<pre>' : '</pre>'; continue; }
    if (inPre) { html += esc(line) + '\n'; continue; }
    if (/^\s*[-*•] /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(line.replace(/^\s*[-*•] /, '')) + '</li>'; continue; }
    closeList();
    if (/^#{1,3} /.test(line)) { html += '<p class="md-h">' + inline(line.replace(/^#{1,3} /, '')) + '</p>'; continue; }
    if (!line.trim()) { html += '<div class="md-gap"></div>'; continue; }
    html += '<p>' + inline(line) + '</p>';
  }
  closeList();
  if (inPre) html += '</pre>';
  return html;
}
