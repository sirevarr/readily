/* Readily v2 — racha de lectura y calendario completo.
   Antes la racha se calculaba con la fecha de la última página de cada libro, por eso siempre decía 1.
   Ahora se guarda un registro por día leído (tabla reading_days) y también en el dispositivo. */
import { state, userId } from './state.js';
import { dayKey, parseDayKey, esc, ic, openModal, debounce } from './util.js';
import { mutate, ck, snap, fetchCached } from './data.js';
import * as idb from './idb.js';

const syncDay = debounce(() => {
  const k = dayKey();
  mutate({ t: 'reading_days', k: 'upsert', conflict: 'user_id,day', ck: 'rd:' + k, row: { user_id: userId(), day: k, pages: state.days[k] || 1 } });
}, 4000);

export async function loadDays() {
  const rows = await fetchCached(ck('days_srv'), () => state.sb.from('reading_days').select('day,pages').order('day'));
  const local = (await idb.get(ck('days'))) || {};
  const map = { ...local };
  for (const r of rows || []) map[r.day] = Math.max(map[r.day] || 0, r.pages || 0);

  // Primera vez: reconstruye lo que se pueda con las fechas de lectura que ya existían.
  const flag = ck('days_backfilled');
  if (!(await idb.get(flag)) && navigator.onLine) {
    let added = 0;
    for (const p of Object.values(state.docProgresses)) {
      if (!p.updated_at) continue;
      const k = dayKey(new Date(p.updated_at));
      if (!(k in map)) { map[k] = 0; added++; mutate({ t: 'reading_days', k: 'upsert', conflict: 'user_id,day', ck: 'rd:' + k, row: { user_id: userId(), day: k, pages: 0 } }); }
    }
    await idb.set(flag, true);
  }
  state.days = map;
  snap('days', map);
}

/* Se llama cada vez que lees una página. Un día cuenta en cuanto lees algo. */
export function markRead() {
  const k = dayKey();
  const before = k in state.days;
  state.days[k] = (state.days[k] || 0) + 1;
  snap('days', state.days);
  syncDay();
  if (!before) document.dispatchEvent(new CustomEvent('readily:streak'));
}

export function stats() {
  const keys = Object.keys(state.days).sort();
  const set = new Set(keys);
  let current = 0;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const todayRead = set.has(dayKey(d));
  if (!todayRead) d.setDate(d.getDate() - 1); // la racha no se rompe hasta que termina el día
  while (set.has(dayKey(d))) { current++; d.setDate(d.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const dt = parseDayKey(k);
    run = (prev && Math.round((dt - prev) / 864e5) === 1) ? run + 1 : 1;
    if (run > best) best = run;
    prev = dt;
  }
  return { current, best, total: keys.length, set, todayRead };
}

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

export function openStreakPanel() {
  const s = stats();
  let view = new Date(); view.setDate(1); view.setHours(0, 0, 0, 0);

  const m = openModal(`
    <div class="streak-head">
      <div class="modal-title" style="margin:0">${ic('flame', 22, 'fire')} Racha de lectura</div>
      <button class="icon-btn" id="sp-close" aria-label="Cerrar">${ic('close')}</button>
    </div>
    <div class="streak-stats">
      <div class="stat"><div class="stat-num fire">${s.current}</div><div class="stat-label">días seguidos</div></div>
      <div class="stat"><div class="stat-num">${s.best}</div><div class="stat-label">mejor racha</div></div>
      <div class="stat"><div class="stat-num">${s.total}</div><div class="stat-label">días leídos</div></div>
    </div>
    ${s.current > 0 && !s.todayRead ? `<div class="streak-nudge">Todavía no has leído hoy. Lee unas páginas para mantener tu racha de ${s.current} día${s.current !== 1 ? 's' : ''}.</div>` : ''}
    <div class="cal-nav">
      <button class="icon-btn" id="cal-prev" aria-label="Mes anterior">${ic('back')}</button>
      <div class="cal-title" id="cal-title"></div>
      <button class="icon-btn" id="cal-next" aria-label="Mes siguiente">${ic('right')}</button>
    </div>
    <div class="cal-week">${['L','M','X','J','V','S','D'].map(d => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid" id="cal-grid"></div>
    <div class="cal-info" id="cal-info"></div>
    <button class="btn ghost small" id="cal-today" style="margin-top:6px">Ir a hoy</button>
  `, { cls: 'streak-modal' });

  const grid = m.el.querySelector('#cal-grid');
  const title = m.el.querySelector('#cal-title');
  const info = m.el.querySelector('#cal-info');

  function draw() {
    const y = view.getFullYear(), mo = view.getMonth();
    title.textContent = `${MONTHS[mo]} ${y}`;
    const first = new Date(y, mo, 1);
    const offset = (first.getDay() + 6) % 7; // lunes = 0
    const dim = new Date(y, mo + 1, 0).getDate();
    const todayK = dayKey();
    let html = '', readCount = 0;
    for (let i = 0; i < offset; i++) html += '<div class="cal-cell"></div>';
    for (let d = 1; d <= dim; d++) {
      const dt = new Date(y, mo, d);
      const k = dayKey(dt);
      const read = s.set.has(k) || k in state.days;
      if (read) readCount++;
      const col = (offset + d - 1) % 7;
      const prevRead = col > 0 && d > 1 && (dayKey(new Date(y, mo, d - 1)) in state.days);
      const nextRead = col < 6 && d < dim && (dayKey(new Date(y, mo, d + 1)) in state.days);
      html += `<button class="cal-cell ${read ? 'read' : ''} ${prevRead && read ? 'run-prev' : ''} ${nextRead && read ? 'run-next' : ''} ${k === todayK ? 'today' : ''}" data-k="${k}"><span class="cal-dot">${d}</span></button>`;
    }
    grid.innerHTML = html;
    info.textContent = `${readCount} día${readCount !== 1 ? 's' : ''} leído${readCount !== 1 ? 's' : ''} este mes`;
    grid.querySelectorAll('.cal-cell[data-k]').forEach(b => b.onclick = () => {
      const k = b.dataset.k, pages = state.days[k];
      const label = parseDayKey(k).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
      info.textContent = pages === undefined ? `${label}: sin lectura` : (pages > 0 ? `${label}: ${pages} página${pages !== 1 ? 's' : ''} leída${pages !== 1 ? 's' : ''}` : `${label}: leíste`);
    });
  }
  m.el.querySelector('#cal-prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); draw(); };
  m.el.querySelector('#cal-next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); draw(); };
  m.el.querySelector('#cal-today').onclick = () => { view = new Date(); view.setDate(1); draw(); };
  m.el.querySelector('#sp-close').onclick = m.close;
  draw();
}
