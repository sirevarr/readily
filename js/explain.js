/* Readily v2 — "Explicar": solo el significado de la palabra, con definición general y de contexto.
   Si el término ya está en el glosario o en las tarjetas, solo se lo recuerda y muestra lo guardado (sin llamar a la IA). */
import { state, userId } from './state.js';
import { esc, uuid, termKey, fold, ic, $, toast } from './util.js';
import { ask, askJSON, errorBox, bindErrorBox, AIError } from './ai.js';
import { dbInsert, dbUpdate, persistGlossary, persistFlashcards } from './data.js';
import { passageAround } from './context.js';
import { openChatWith } from './chat.js';
import { addHighlight } from './highlights.js';
import { STYLE_BLOCK } from './config.js';

let ex = null;
let seq = 0;

const notifyGl = () => document.dispatchEvent(new CustomEvent('readily:glossary'));
const notifyFc = () => document.dispatchEvent(new CustomEvent('readily:cards'));

export function cleanTerm(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[\s.,;:!?¿¡()\[\]{}"“”«»'‘’—–-]+/, '').replace(/[\s.,;:!?¿¡()\[\]{}"“”«»'‘’—–-]+$/, '');
  return t;
}

/* Si se seleccionó solo un trozo de palabra, completa la palabra entera usando el texto de la página */
function expandPartial(t, page) {
  if (!t || t.length >= 20 || /\s/.test(t)) return t;
  const pd = state.searchIndex.find(p => p.page === page);
  if (!pd) return t;
  const i = pd.fold.indexOf(fold(t));
  if (i === -1) return t;
  let s = i, e = i + t.length;
  while (s > 0 && /[\p{L}\p{N}]/u.test(pd.text[s - 1])) s--;
  while (e < pd.text.length && /[\p{L}\p{N}]/u.test(pd.text[e])) e++;
  return pd.text.slice(s, e);
}

export function findExisting(term) {
  const k = termKey(term); if (!k) return null;
  const g = state.glossary.filter(x => termKey(x.term) === k);
  if (g.length) {
    const best = g.find(x => x.level === 'simple') || g.find(x => x.level === 'intermedio') || g[0];
    return { source: 'glossary', entry: best, general: best.definition, context: best.context_definition || '' };
  }
  const c = state.flashcards.find(f => termKey(f.front) === k);
  if (c) return { source: 'card', entry: c, general: c.back, context: '' };
  return null;
}

/* ---------- Entradas públicas ---------- */
export async function explain(raw, page, { force = false } = {}) {
  const term = cleanTerm(expandPartial(cleanTerm(raw), page));
  if (!term) return;
  if (!state.geminiKey) { toast('Activa tu clave de Gemini en Ajustes para usar Explicar', { emoji: '🔑' }); return; }
  const passage = term.split(/\s+/).length > 6;
  ex = { term, page, kind: passage ? 'passage' : 'term', status: 'loading', tab: 'general', general: '', context: '', source: 'new', entry: null, err: null, saved: false };
  if (!passage && !force) {
    const f = findExisting(term);
    if (f) { Object.assign(ex, f, { status: 'ready' }); render(); return; }
  }
  if (force) { const f = findExisting(term); if (f) ex.entry = f.entry, ex.source = f.source; }
  render();
  await generate();
}

export function openStored(entry, kind = 'glossary') {
  const isG = kind === 'glossary';
  ex = {
    term: isG ? entry.term : entry.front, page: entry.page || state.pageNum, kind: 'term', status: 'ready', tab: 'general',
    general: isG ? entry.definition : entry.back, context: isG ? (entry.context_definition || '') : '',
    source: isG ? 'glossary' : 'card', entry, err: null, saved: false,
  };
  render();
}

export function showVisual({ page, text = '', loading = false, err = null }) {
  ex = { term: `Elemento visual — p.${page}`, page, kind: 'visual', status: err ? 'error' : (loading ? 'loading' : 'ready'), tab: 'general', general: text, context: '', source: 'new', entry: null, err, saved: false, retry: null };
  render();
  return ex;
}
export function setVisualResult(text, err = null, retry = null) {
  if (!ex || ex.kind !== 'visual') return;
  ex.general = text || ''; ex.err = err; ex.status = err ? 'error' : 'ready'; ex.retry = retry; render();
}

export function closePanel() { $('#explain-panel')?.remove(); ex = null; seq++; }

/* ---------- Generación ---------- */
async function generate() {
  const my = ++seq;
  const e = ex;
  e.status = 'loading'; e.err = null; render();
  try {
    if (e.kind === 'passage') {
      const r = await ask({
        cacheKey: `ps:${state.currentDoc.id}:${termKey(e.term).slice(0, 80)}`,
        prompt: `Fragmento de "${state.currentDoc?.title || ''}" (página ${e.page}):\n"""${e.term}"""\n\nDi en 1 o 2 oraciones sencillas qué significa este fragmento. No agregues nada más. Español, sin negritas.`,
      });
      if (my !== seq) return;
      e.general = r.text; e.status = 'ready';
    } else {
      const ctx = passageAround(e.page, e.term);
      const prompt = `Término seleccionado: "${e.term}"
Libro: "${state.currentDoc?.title || ''}" · página ${e.page}
Pasaje donde aparece:
"""${ctx}"""

Devuelve SOLO un JSON con esta forma exacta:
{"general": "...", "contexto": "..."}

Reglas:
- "general": el significado general de la palabra o expresión, como lo daría un diccionario, en 1 o 2 oraciones. Nada más: sin ejemplos, sin historia, sin datos extra.
- "contexto": qué significa en este pasaje y capítulo, en 1 o 2 oraciones, usando solo lo que dice el pasaje. Si coincide con el significado general, deja "".
- Explica únicamente el significado del término. No resumas ni expliques el resto del texto.
- No menciones temas ni conceptos que aparezcan más adelante en el libro.
- Español claro y sencillo. Sin negritas.`;
      const { data } = await askJSON({
        cacheKey: `ex2:${state.currentDoc.id}:${termKey(e.term)}:${e.page}`,
        system: 'Eres un diccionario de lectura. Respondes siempre y solo con el JSON pedido.',
        prompt, temperature: 0.3,
      });
      if (my !== seq) return;
      e.general = String(data.general || '').trim();
      e.context = String(data.contexto ?? data.context ?? '').trim();
      if (!e.general) throw new AIError('other', 'Gemini no devolvió una definición. Intenta de nuevo.');
      e.status = 'ready';
      saveToGlossary(e);
    }
  } catch (err) {
    if (my !== seq) return;
    e.status = 'error'; e.err = err;
  }
  render();
}

function saveToGlossary(e) {
  if (e.entry && e.source === 'glossary') {
    e.entry.definition = e.general; e.entry.context_definition = e.context;
    dbUpdate('glossary', e.entry.id, { definition: e.general, context_definition: e.context });
  } else {
    const row = { id: uuid(), document_id: state.currentDoc.id, user_id: userId(), term: e.term, definition: e.general, context_definition: e.context, level: 'simple', page: e.page, created_at: new Date().toISOString() };
    state.glossary.unshift(row);
    dbInsert('glossary', row);
    e.entry = row; e.source = 'glossary'; e.saved = true;
  }
  persistGlossary(); notifyGl();
}

export function saveCardFrom(front, back) {
  const k = termKey(front);
  if (state.flashcards.some(f => termKey(f.front) === k)) return null;
  const row = { id: uuid(), document_id: state.currentDoc.id, user_id: userId(), front, back, created_at: new Date().toISOString() };
  state.flashcards.push(row);
  persistFlashcards(); dbInsert('flashcards', row); notifyFc();
  return row;
}

/* ---------- Panel ---------- */
function render() {
  if (!ex) return;
  let p = $('#explain-panel');
  if (!p) { p = document.createElement('div'); p.id = 'explain-panel'; p.className = 'explain-panel'; document.body.appendChild(p); }
  const e = ex;
  const hasCtx = !!e.context && e.kind === 'term';
  const text = e.tab === 'context' && hasCtx ? e.context : e.general;
  const cardExists = e.kind !== 'visual' && state.flashcards.some(f => termKey(f.front) === termKey(e.term));
  const chip = e.status === 'ready' && e.kind === 'term'
    ? (e.source === 'glossary' && !e.saved ? `<div class="ex-chip known">${ic('check', 14)} Ya la tenías en tu glosario</div>`
      : e.source === 'card' ? `<div class="ex-chip known">${ic('check', 14)} Ya está en tus tarjetas</div>`
      : e.saved ? `<div class="ex-chip saved">${ic('check', 14)} Guardada en tu glosario</div>` : '')
    : '';
  p.innerHTML = `
    <div class="ex-head">
      <div class="ex-title">
        <div class="ex-term">${esc(e.term.length > 70 ? e.term.slice(0, 70) + '…' : e.term)}</div>
        <div class="ex-sub">Página ${e.page} · ${esc(state.currentDoc?.title || '')}</div>
      </div>
      <button class="icon-btn" id="ex-close" aria-label="Cerrar">${ic('close')}</button>
    </div>
    ${hasCtx && e.status === 'ready' ? `<div class="seg" role="tablist">
      <button class="${e.tab === 'general' ? 'on' : ''}" data-tab="general">Significado</button>
      <button class="${e.tab === 'context' ? 'on' : ''}" data-tab="context">En este libro</button>
    </div>` : ''}
    <div class="ex-body">
      ${e.status === 'loading' ? `<div class="ex-loading"><div class="spinner sm"></div><span>${e.kind === 'visual' ? 'Analizando…' : 'Buscando el significado…'}</span></div>`
        : e.status === 'error' ? errorBox(e.err)
        : `<div class="ex-text">${esc(text)}</div>`}
      ${chip}
    </div>
    ${e.status === 'ready' ? `<div class="ex-foot">
      ${e.kind === 'visual' ? '' : `<button class="btn small" id="ex-chat">${ic('chat', 16)} Seguir en chat</button>`}
      <button class="btn small primary" id="ex-card" ${cardExists ? 'disabled' : ''}>${e.kind === 'visual' ? `${ic('note', 16)} Guardar nota visual` : (cardExists ? `${ic('check', 16)} Ya es tarjeta` : `${ic('cards', 16)} Guardar tarjeta`)}</button>
      ${e.kind === 'term' && e.source !== 'new' ? `<button class="btn small ghost" id="ex-regen" title="Pedir una nueva definición">${ic('refresh', 16)}</button>` : ''}
    </div>` : ''}`;

  $('#ex-close', p).onclick = closePanel;
  p.querySelectorAll('.seg button').forEach(b => b.onclick = () => { e.tab = b.dataset.tab; render(); });
  if (e.status === 'error') bindErrorBox(p, () => (e.kind === 'visual' && e.retry ? e.retry() : generate()), e.err);
  $('#ex-chat', p)?.addEventListener('click', () => {
    const t = e.term;
    openChatWith(`Quiero profundizar sobre "${t}" en el contexto de este libro.`, '');
  });
  $('#ex-regen', p)?.addEventListener('click', () => generate());
  $('#ex-card', p)?.addEventListener('click', () => {
    if (e.kind === 'visual') {
      const text = `📊 [Elemento visual p.${e.page}]\n${e.general}`;
      addHighlight({ page: e.page, rects: [{ x: 0.01, y: 0.01, w: 0.15, h: 0.03 }], text }, '#7DBDE8');
      toast('Nota visual guardada en Subrayados', { emoji: '📌' });
      $('#ex-card', p).disabled = true;
      return;
    }
    const back = e.context && e.kind === 'term' ? `${e.general}\n\nEn este libro: ${e.context}` : e.general;
    const r = saveCardFrom(e.term, back);
    if (r) toast('Tarjeta guardada', { emoji: '🗂️' });
    render();
  });
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#explain-panel')) closePanel(); });
