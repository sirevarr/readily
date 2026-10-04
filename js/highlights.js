/* Readily v2 — operaciones sobre subrayados */
import { state, userId } from './state.js';
import { uuid } from './util.js';
import { dbInsert, dbUpdate, dbDelete, persistHighlights } from './data.js';
import * as V from './viewer.js';

const notify = () => document.dispatchEvent(new CustomEvent('readily:highlights'));

export function highlightsSorted() {
  return [...state.highlights].sort((a, b) => a.page - b.page || (a.rects[0]?.y || 0) - (b.rects[0]?.y || 0) || (a.rects[0]?.x || 0) - (b.rects[0]?.x || 0));
}

/* piece: { page, rects, text }. Si ya existe un subrayado con el mismo texto en esa página, solo cambia su color. */
export function addHighlight(piece, color) {
  const dup = state.highlights.find(h => h.page === piece.page && h.text === piece.text);
  if (dup) { setColor(dup.id, color); return dup; }
  const h = { id: uuid(), page: piece.page, rects: piece.rects, color, text: piece.text, note: '', created_at: new Date().toISOString() };
  state.highlights.push(h);
  persistHighlights();
  V.drawHighlights(h.page);
  dbInsert('highlights', { id: h.id, document_id: state.currentDoc.id, user_id: userId(), page: h.page, rects: h.rects, color: h.color, text: h.text, note: '' });
  notify();
  return h;
}

export function setColor(id, color) {
  const h = state.highlights.find(x => x.id === id); if (!h) return;
  h.color = color; persistHighlights(); V.drawHighlights(h.page);
  dbUpdate('highlights', id, { color }); notify();
}

export function setNote(id, note) {
  const h = state.highlights.find(x => x.id === id); if (!h) return;
  h.note = note; persistHighlights(); dbUpdate('highlights', id, { note });
  document.dispatchEvent(new CustomEvent('readily:highlights', { detail: { silent: true } }));
}

export function deleteHighlight(id) {
  const h = state.highlights.find(x => x.id === id); if (!h) return;
  state.highlights = state.highlights.filter(x => x.id !== id);
  persistHighlights(); V.drawHighlights(h.page);
  dbDelete('highlights', { id }); notify();
  return h;
}

/* Deshacer un borrado reciente */
export function restoreHighlight(h) {
  state.highlights.push(h); persistHighlights(); V.drawHighlights(h.page);
  dbInsert('highlights', { id: h.id, document_id: state.currentDoc.id, user_id: userId(), page: h.page, rects: h.rects, color: h.color, text: h.text, note: h.note || '' });
  notify();
}
