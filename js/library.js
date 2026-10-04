/* Readily v2 — Vista de Biblioteca: gestión de libros, categorías, modo sin conexión y subida */
import { state, userId } from './state.js';
import { esc, ic, $, $$, openModal, confirmBox, askText, toast } from './util.js';
import { CATEGORIES, CATEGORY_EMOJI } from './config.js';
import { loadDocuments, downloadForOffline, removeOffline, mutate, dbDelete, snap } from './data.js';
import { openStreakPanel, stats } from './streak.js';
import { openDocument } from './app.js';

export function renderLibrary(container) {
  const st = stats();
  const cats = ['all', ...new Set(state.documents.map(d => d.category || 'Sin categoría'))];
  const filtered = state.activeCategory === 'all'
    ? state.documents
    : state.documents.filter(d => (d.category || 'Sin categoría') === state.activeCategory);

  container.innerHTML = `
    <div class="lib-container">
      <header class="lib-header">
        <div class="lib-brand">
          <h1 class="lib-title">Readily</h1>
          <button class="streak-pill" id="lib-streak-btn" title="Ver racha y calendario de lectura">
            ${ic('flame', 18, 'fire')}
            <span>${st.current} día${st.current !== 1 ? 's' : ''}</span>
          </button>
        </div>
        <div class="lib-actions">
          <label class="btn primary small upload-btn">
            ${ic('plus', 16)} Subir PDF
            <input type="file" id="lib-file-input" accept="application/pdf" multiple style="display:none">
          </label>
          <button class="btn ghost small" id="lib-settings-btn" title="Ajustes de cuenta e IA">${ic('gear', 18)}</button>
        </div>
      </header>

      ${cats.length > 1 ? `
        <div class="cat-bar">
          ${cats.map(c => `
            <button class="cat-chip ${state.activeCategory === c ? 'on' : ''}" data-cat="${esc(c)}">
              ${c === 'all' ? '📚 Todos' : `${CATEGORY_EMOJI[c] || '📚'} ${esc(c)}`}
            </button>
          `).join('')}
        </div>
      ` : ''}

      <div class="upload-bar" id="lib-upload-progress" style="display:none"></div>

      <div class="doc-grid" id="lib-doc-grid">
        ${!filtered.length ? `
          <div class="empty-state lib-empty">
            ${ic('book', 48)}
            <h3>Tu biblioteca está vacía</h3>
            <p>Sube tus libros o documentos PDF para comenzar a leer con subrayados y chat IA.</p>
          </div>
        ` : filtered.map(d => renderDocCard(d)).join('')}
      </div>
    </div>
  `;

  // Handlers
  $('#lib-streak-btn', container).onclick = openStreakPanel;
  $('#lib-settings-btn', container).onclick = openSettingsModal;

  $$('.cat-chip', container).forEach(chip => {
    chip.onclick = () => {
      state.activeCategory = chip.dataset.cat;
      renderLibrary(container);
    };
  });

  const fileInp = $('#lib-file-input', container);
  fileInp.onchange = (e) => handleUploadFiles(e.target.files, container);

  $$('.doc-card', container).forEach(card => {
    const docId = card.dataset.id;
    const doc = state.documents.find(d => d.id === docId);
    if (!doc) return;

    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      openDocument(docId);
    };

    const editBtn = card.querySelector('.doc-act-edit');
    if (editBtn) editBtn.onclick = () => openEditBookModal(doc, container);

    const delBtn = card.querySelector('.doc-act-del');
    if (delBtn) delBtn.onclick = () => deleteBook(doc, container);

    const offBtn = card.querySelector('.doc-act-offline');
    if (offBtn) offBtn.onclick = () => toggleOfflineBook(doc, container);
  });
}

function renderDocCard(d) {
  const prog = state.docProgresses[d.id];
  const page = prog?.page || 1;
  const total = d.num_pages || 1;
  const pct = Math.min(100, Math.round((page / total) * 100));
  const cat = d.category || 'Sin categoría';
  const emoji = CATEGORY_EMOJI[cat] || '📚';
  const isOffline = state.offlineDocs.has(d.storage_path);

  return `
    <div class="doc-card" data-id="${d.id}">
      <div class="doc-card-top">
        <span class="doc-emoji">${emoji}</span>
        <span class="doc-cat-tag">${esc(cat)}</span>
      </div>
      <h3 class="doc-title">${esc(d.title)}</h3>
      <div class="doc-meta">
        <span>${total} págs.</span>
        ${isOffline ? `<span class="offline-badge" title="Disponible sin conexión">${ic('check', 12)} Offline</span>` : ''}
      </div>
      ${pct > 0 ? `
        <div class="doc-prog-wrap">
          <div class="doc-prog-bar" style="width:${pct}%"></div>
        </div>
        <div class="doc-prog-text">${pct}% · p. ${page}/${total}</div>
      ` : ''}
      <div class="doc-card-actions">
        <button class="btn primary small doc-act-open">Abrir ${ic('right', 14)}</button>
        <button class="btn ghost icon-only small doc-act-offline" title="${isOffline ? 'Quitar del dispositivo' : 'Guardar para leer sin conexión'}">
          ${ic(isOffline ? 'check' : 'download', 16)}
        </button>
        <button class="btn ghost icon-only small doc-act-edit" title="Editar libro">${ic('edit', 16)}</button>
        <button class="btn ghost icon-only small danger doc-act-del" title="Eliminar libro">${ic('trash', 16)}</button>
      </div>
    </div>
  `;
}

async function handleUploadFiles(files, container) {
  if (!files || !files.length) return;
  const prog = $('#lib-upload-progress', container);
  prog.style.display = 'block';

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    prog.textContent = `Subiendo ${i + 1}/${files.length}: ${f.name}...`;

    // Sanitización estricta de nombres para Supabase Storage
    const safeName = f.name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId()}/${Date.now()}_${safeName}`;

    try {
      const { error } = await state.sb.storage.from('pdfs').upload(path, f);
      if (error) throw error;

      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

      const row = {
        title: f.name.replace(/\.pdf$/i, ''),
        storage_path: path,
        num_pages: pdf.numPages,
        user_id: userId(),
        category: 'Sin categoría'
      };

      const { data, error: dbErr } = await state.sb.from('documents').insert(row).select().single();
      if (dbErr) throw dbErr;

      state.documents.unshift(data);
    } catch (err) {
      toast(`Error al subir ${f.name}: ${err.message}`, { emoji: '⚠️' });
    }
  }

  prog.style.display = 'none';
  await loadDocuments();
  renderLibrary(container);
  toast('Libros añadidos correctamente', { emoji: '📚' });
}

async function openEditBookModal(doc, container) {
  const m = openModal(`
    <div class="modal-title">Editar libro</div>
    <div class="field">
      <label>Título</label>
      <input id="edit-doc-title" class="input" value="${esc(doc.title)}">
    </div>
    <div class="field">
      <label>Categoría</label>
      <select id="edit-doc-cat" class="input select">
        ${CATEGORIES.map(c => `<option value="${esc(c)}" ${(doc.category || 'Sin categoría') === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="edit-cancel">Cancelar</button>
      <button class="btn primary" id="edit-save">Guardar</button>
    </div>
  `);

  $('#edit-cancel', m.el).onclick = () => m.close();
  $('#edit-save', m.el).onclick = async () => {
    const title = $('#edit-doc-title', m.el).value.trim();
    const cat = $('#edit-doc-cat', m.el).value;
    if (!title) return;

    doc.title = title;
    doc.category = cat;
    m.close();

    mutate({ t: 'documents', k: 'update', row: { title, category: cat }, match: { id: doc.id } });
    snap('docs', state.documents);
    renderLibrary(container);
    toast('Libro actualizado', { emoji: '✏️' });
  };
}

async function deleteBook(doc, container) {
  const ok = await confirmBox({
    title: `¿Eliminar "${doc.title}"?`,
    message: 'Se borrará el archivo PDF, todos los subrayados, notas y chats asociados.',
    okLabel: 'Eliminar permanentemente',
    danger: true
  });
  if (!ok) return;

  try {
    await state.sb.storage.from('pdfs').remove([doc.storage_path]);
  } catch (_) {}

  dbDelete('documents', { id: doc.id });
  dbDelete('highlights', { document_id: doc.id });
  dbDelete('reading_progress', { document_id: doc.id });
  dbDelete('chat_threads', { document_id: doc.id });
  dbDelete('flashcards', { document_id: doc.id });
  dbDelete('glossary', { document_id: doc.id });
  dbDelete('quiz_attempts', { document_id: doc.id });

  removeOffline(doc.storage_path);
  state.documents = state.documents.filter(d => d.id !== doc.id);
  delete state.docProgresses[doc.id];
  snap('docs', state.documents);

  renderLibrary(container);
  toast('Libro eliminado', { emoji: '🗑️' });
}

async function toggleOfflineBook(doc, container) {
  const isOffline = state.offlineDocs.has(doc.storage_path);
  if (isOffline) {
    await removeOffline(doc.storage_path);
    toast('Removido de almacenamiento local', { emoji: '🗑️' });
  } else {
    toast('Guardando libro en tu dispositivo...', { emoji: '💾' });
    try {
      await downloadForOffline(doc);
      toast('Disponible sin conexión', { emoji: '✅' });
    } catch (err) {
      toast(err.message, { emoji: '⚠️' });
    }
  }
  renderLibrary(container);
}

function openSettingsModal() {
  const key = state.geminiKey || '';
  const m = openModal(`
    <div class="modal-title">Ajustes & Clave Gemini IA</div>
    <div class="field">
      <label>Clave API de Gemini</label>
      <input id="set-key" class="input" type="password" value="${esc(key)}" placeholder="AIzaSy...">
      <small style="color:var(--ink-soft);display:block;margin-top:4px">
        Consigue una clave gratuita en <a href="https://aistudio.google.com/apikey" target="_blank" style="color:var(--accent)">Google AI Studio</a>.
      </small>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="set-close">Cerrar</button>
      <button class="btn primary" id="set-save">Guardar clave</button>
    </div>
  `);

  $('#set-close', m.el).onclick = () => m.close();
  $('#set-save', m.el).onclick = () => {
    const val = $('#set-key', m.el).value.trim();
    state.geminiKey = val;
    localStorage.setItem('readily_gemini_key', val);
    m.close();
    toast('Clave de Gemini guardada', { emoji: '🔑' });
  };
}
