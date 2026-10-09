/* Readily v2 — capa de datos: Supabase + caché local + cola de sincronización (modo sin conexión) */
import { state, userId } from './state.js';
import { LS } from './config.js';
import * as idb from './idb.js';

/* Columnas añadidas en v2. Si la migración aún no se ejecutó, se reintenta sin ellas. */
const V2_COLS = {
  reading_progress: ['max_page'],
  glossary: ['context_definition'],
};

const isMissingTable = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /Could not find the table|does not exist/i.test(e.message || ''));
const isMissingCol   = e => e && (e.code === 'PGRST204' || e.code === '42703' || /Could not find the .* column/i.test(e.message || ''));

export function isNetErr(e) {
  if (!e) return false;
  if (!navigator.onLine) return true;
  if (e.code || e.status) return false;
  return /fetch|network|load failed|timeout|abort|offline/i.test(e.message || String(e));
}

/* Clave de caché por usuario */
export const ck = (...parts) => `${userId() || 'anon'}:${parts.join(':')}`;
export const snap = (key, value) => idb.set(ck(key), value);

/* ---------- Cliente y sesión ---------- */
export function createClient(url, key) {
  state.sb = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return state.sb;
}

export async function getSessionSafe() {
  try {
    const { data, error } = await state.sb.auth.getSession();
    if (data?.session) {
      localStorage.setItem(LS.user, JSON.stringify({ id: data.session.user.id, email: data.session.user.email }));
      return data.session;
    }
    if (error && isNetErr(error)) throw error;
    return null;
  } catch (e) {
    // Sin conexión y sin poder refrescar el token: usar el usuario recordado.
    try {
      const u = JSON.parse(localStorage.getItem(LS.user) || 'null');
      if (u?.id && !navigator.onLine) return { user: u, offline: true };
    } catch (_) {}
    return null;
  }
}

/* ---------- Lecturas con caché ---------- */
export async function fetchCached(cacheKey, queryFn, empty = []) {
  if (navigator.onLine && state.sb) {
    try {
      const { data, error } = await queryFn();
      if (error) throw error;
      await idb.set(cacheKey, data);
      return data ?? empty;
    } catch (e) {
      if (isMissingTable(e)) state.missingTables.add(e.message || 'tabla');
    }
  }
  const c = await idb.get(cacheKey);
  return c ?? empty;
}

/* ---------- Escrituras: siempre pasan por la cola (IndexedDB) y se envían en cuanto hay red ---------- */
let flushing = false;
let flushAgain = false;

function applyMatch(q, match) {
  if (!match) return q;
  for (const [k, v] of Object.entries(match)) {
    if (Array.isArray(v)) q = q.in(k, v); else q = q.eq(k, v);
  }
  return q;
}

function strip(row, cols) {
  const r = { ...row }; cols.forEach(c => delete r[c]); return r;
}

async function exec(op) {
  try {
    let row = op.row;
    for (let attempt = 0; attempt < 2; attempt++) {
      const q = state.sb.from(op.t);
      let req;
      if (op.k === 'insert') req = q.insert(row);
      else if (op.k === 'upsert') req = q.upsert(row, { onConflict: op.conflict });
      else if (op.k === 'update') {
        if (!row || !Object.keys(row).length) return 'ok';
        req = applyMatch(q.update(row), op.match);
      } else if (op.k === 'delete') req = applyMatch(q.delete(), op.match);
      else return 'drop';
      const { error } = await req;
      if (!error) return 'ok';
      if (isNetErr(error)) return 'net';
      if (isMissingCol(error) && V2_COLS[op.t] && attempt === 0) {
        row = Array.isArray(row) ? row.map(r => strip(r, V2_COLS[op.t])) : strip(row, V2_COLS[op.t]);
        continue;
      }
      if (isMissingTable(error)) { state.missingTables.add(op.t); return 'drop'; }
      if (error.code === '23505') return 'ok'; // ya existía
      state.lastSyncError = `${op.t}: ${error.message}`;
      console.warn('[sync] operación descartada', op, error);
      return 'drop';
    }
  } catch (e) { return 'net'; }
  return 'drop';
}

export async function refreshPending() {
  const all = await idb.outboxAll();
  state.pending = all.length;
  document.dispatchEvent(new CustomEvent('readily:sync'));
  return all.length;
}

export async function flush() {
  if (!state.sb || !navigator.onLine) return;
  if (flushing) { flushAgain = true; return; }
  flushing = true;
  try {
    do {
      flushAgain = false;
      const ops = await idb.outboxAll();
      for (const op of ops) {
        const r = await exec(op);
        if (r === 'net') { flushAgain = false; break; }
        await idb.outboxRemove(op.seq);
      }
    } while (flushAgain);
  } finally {
    flushing = false;
    await refreshPending();
  }
}

/* op: { t: tabla, k: 'insert'|'upsert'|'update'|'delete', row, match, conflict, ck } */
export async function mutate(op) {
  if (op.ck) {
    // Evita acumular escrituras repetidas sobre lo mismo (progreso, días…): conserva solo la última.
    const all = await idb.outboxAll();
    for (const o of all) if (o.ck === op.ck) await idb.outboxRemove(o.seq);
  }
  await idb.outboxAdd(op);
  await refreshPending();
  flush();
}

export async function flushBeforeLoad(maxMs = 3500) {
  if (!navigator.onLine) return;
  await Promise.race([flush(), new Promise(r => setTimeout(r, maxMs))]);
}

export function installSyncListeners() {
  const upd = () => { state.online = navigator.onLine; document.dispatchEvent(new CustomEvent('readily:sync')); };
  window.addEventListener('online',  () => { upd(); flush(); });
  window.addEventListener('offline', upd);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  setInterval(() => flush(), 30000);
  refreshPending();
}

/* ---------- Biblioteca ---------- */
export async function loadDocuments() {
  if (state.sb) {
    await flushBeforeLoad();
    const docs = await fetchCached(ck('docs'), () => state.sb.from('documents').select('*').order('created_at', { ascending: false }));
    state.documents = docs || [];
  } else {
    const localDocs = (await idb.get(ck('docs'))) || (await idb.get('readily_docs')) || [];
    state.documents = localDocs;
  }
  const ids = state.documents.map(d => d.id);
  let progs = [];
  if (ids.length) {
    if (state.sb) progs = await fetchCached(ck('prog'), () => state.sb.from('reading_progress').select('*').in('document_id', ids));
    else progs = (await idb.get(ck('prog'))) || [];
  }
  state.docProgresses = {};
  (progs || []).forEach(p => { state.docProgresses[p.document_id] = { page: p.page, max_page: p.max_page || p.page, updated_at: p.updated_at }; });
  await refreshOfflineSet();
}

export async function refreshOfflineSet() {
  const ks = await idb.keys('blobs');
  const validSet = new Set();
  for (const k of ks) {
    try {
      const val = await idb.get(k, 'blobs');
      let len = 0;
      if (val instanceof Blob) len = val.size;
      else if (val instanceof ArrayBuffer) len = val.byteLength;
      else if (val?.buffer instanceof ArrayBuffer) len = val.byteLength || val.buffer.byteLength;

      if (len > 100) {
        validSet.add(k);
      } else {
        await idb.del(k, 'blobs');
      }
    } catch (_) {
      await idb.del(k, 'blobs');
    }
  }
  state.offlineDocs = validSet;
}

export async function saveProgress(docId, page, maxPage) {
  const now = new Date().toISOString();
  state.docProgresses[docId] = { page, max_page: maxPage, updated_at: now };
  snap('prog', Object.entries(state.docProgresses).map(([document_id, v]) => ({ document_id, ...v })));
  await mutate({
    t: 'reading_progress', k: 'upsert', conflict: 'document_id,user_id', ck: 'rp:' + docId,
    row: { document_id: docId, user_id: userId(), page, max_page: maxPage, updated_at: now },
  });
}

/* ---------- PDFs guardados en el dispositivo ---------- */
function withTimeout(promise, ms = 6000, errorMsg = 'Tiempo de espera agotado') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
  ]);
}

export async function getPdfBytes(doc, { onStatus } = {}) {
  if (!doc || !doc.storage_path) throw new Error('El libro no contiene una ruta de archivo válida.');
  
  const cached = await idb.get(doc.storage_path, 'blobs');
  if (cached) {
    let buf = null;
    try {
      if (cached instanceof Blob) buf = await cached.arrayBuffer();
      else if (cached instanceof ArrayBuffer) buf = cached.slice(0);
      else if (cached?.buffer instanceof ArrayBuffer) {
        buf = cached.buffer.slice(cached.byteOffset || 0, (cached.byteOffset || 0) + (cached.byteLength || cached.buffer.byteLength));
      }
    } catch (_) {}

    if (buf && buf.byteLength > 100) {
      onStatus?.('Desde tu dispositivo…');
      return buf;
    }

    // Si la caché local es inválida, se elimina automáticamente
    await idb.del(doc.storage_path, 'blobs');
    state.offlineDocs.delete(doc.storage_path);
  }

  if (!state.sb || !navigator.onLine) throw new Error('Este libro todavía no está guardado en el dispositivo para leer offline.');
  onStatus?.('Descargando…');
  let buf;
  try {
    const { data: fd, error: dlE } = await withTimeout(state.sb.storage.from('pdfs').download(doc.storage_path), 6000, 'Descarga remota atascada');
    if (dlE) throw dlE;
    buf = await fd.arrayBuffer();
  } catch (_) {
    try {
      const { data: signed, error: signErr } = await withTimeout(state.sb.storage.from('pdfs').createSignedUrl(doc.storage_path, 300), 4000);
      if (signErr || !signed?.signedUrl) throw signErr || new Error('URL firmada no disponible');
      const res = await withTimeout(fetch(signed.signedUrl), 6000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = await res.arrayBuffer();
    } catch (_2) {
      try {
        const { data: pub } = state.sb.storage.from('pdfs').getPublicUrl(doc.storage_path);
        if (!pub?.publicUrl) throw new Error('URL pública no disponible');
        const res = await withTimeout(fetch(pub.publicUrl), 6000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = await res.arrayBuffer();
      } catch (_3) {
        throw new Error(`No se pudo descargar "${doc.title}". El archivo no fue encontrado en Supabase Storage.`);
      }
    }
  }

  if (!buf || buf.byteLength < 100) {
    throw new Error(`El archivo descargado para "${doc.title}" está dañado o vacío.`);
  }

  await idb.set(doc.storage_path, buf.slice(0), 'blobs');
  state.offlineDocs.add(doc.storage_path);
  return buf;
}

export async function downloadForOffline(doc) {
  if (state.offlineDocs.has(doc.storage_path)) return;
  await getPdfBytes(doc);
}
export async function removeOffline(path) {
  await idb.del(path, 'blobs');
  state.offlineDocs.delete(path);
}

/* ---------- Colecciones de un documento ---------- */
export async function loadDocCollections(docId) {
  const sb = () => state.sb;
  const [hl, fc, gl, th, qz] = await Promise.all([
    fetchCached(ck('hl', docId),  () => sb().from('highlights').select('*').eq('document_id', docId).order('created_at')),
    fetchCached(ck('fc', docId),  () => sb().from('flashcards').select('*').eq('document_id', docId).order('created_at')),
    fetchCached(ck('gl', docId),  () => sb().from('glossary').select('*').eq('document_id', docId).order('created_at', { ascending: false })),
    fetchCached(ck('th', docId),  () => sb().from('chat_threads').select('*').eq('document_id', docId).order('created_at')),
    fetchCached(ck('qz', docId),  () => sb().from('quiz_attempts').select('*').eq('document_id', docId).order('created_at', { ascending: false })),
  ]);
  state.highlights = (hl || []).map(h => ({ id: h.id, page: h.page, rects: h.rects || [], color: h.color, text: h.text || '', note: h.note || '', created_at: h.created_at }));
  state.flashcards = fc || [];
  state.glossary   = gl || [];
  state.threads    = th || [];
  state.quizzes    = qz || [];
}

export async function loadThreadMessages(threadId) {
  if (!threadId) { state.chatMessages = []; return; }
  const rows = await fetchCached(ck('msgs', threadId), () => state.sb.from('chat_messages').select('id,role,content,created_at').eq('thread_id', threadId).order('created_at'));
  state.chatMessages = (rows || []).map(m => ({ id: m.id, role: m.role, text: m.content, created_at: m.created_at }));
}

export const persistHighlights = () => snap('hl:' + state.currentDoc.id, state.highlights.map(h => ({ ...h, document_id: state.currentDoc.id })));
export const persistFlashcards = () => snap('fc:' + state.currentDoc.id, state.flashcards);
export const persistGlossary   = () => snap('gl:' + state.currentDoc.id, state.glossary);
export const persistThreads    = () => snap('th:' + state.currentDoc.id, state.threads);
export const persistQuizzes    = () => snap('qz:' + state.currentDoc.id, state.quizzes);
export const persistMessages   = () => snap('msgs:' + state.currentThreadId, state.chatMessages.filter(m => !m.ephemeral).map(m => ({ id: m.id, role: m.role, content: m.text, created_at: m.created_at })));

/* Atajos de escritura */
export const dbInsert = (t, row, extra = {}) => mutate({ t, k: 'insert', row, ...extra });
export const dbUpdate = (t, id, row) => mutate({ t, k: 'update', row, match: { id } });
export const dbDelete = (t, match) => mutate({ t, k: 'delete', match });
