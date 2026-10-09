/* Readily v2 — Barra lateral: Subrayados, Índice, Tarjetas, Glosario, Quizzes y Chat IA */
import { state } from './state.js';
import { esc, ic, renderMarkdown, $, $$, confirmBox, askText, toast } from './util.js';
import { COLORS } from './config.js';
import * as H from './highlights.js';
import * as V from './viewer.js';
import * as E from './explain.js';
import * as Q from './quizzes.js';
import * as C from './chat.js';
import { errorBox, bindErrorBox } from './ai.js';
import { dbInsert, dbUpdate, dbDelete, persistFlashcards, persistGlossary } from './data.js';

let container = null;

export function mountSidebar(parent) {
  container = parent;
  renderSidebar();

  document.addEventListener('readily:highlights', () => { if (state.sidebarTab === 'highlights') renderTabContent(); });
  document.addEventListener('readily:cards',      () => { if (state.sidebarTab === 'cards') renderTabContent(); });
  document.addEventListener('readily:glossary',   () => { if (state.sidebarTab === 'glossary') renderTabContent(); });
  document.addEventListener('readily:quizzes',    () => { if (state.sidebarTab === 'quizzes') renderTabContent(); });
  document.addEventListener('readily:chat',       () => { if (state.sidebarTab === 'chat') renderTabContent(); });
}

export function renderSidebar() {
  if (!container) return;
  const tab = state.sidebarTab || 'highlights';
  const hlCount = (state.highlights || []).length;
  const fcCount = (state.flashcards || []).length;
  const glCount = (state.glossary || []).length;
  const qzCount = (state.quizzes || []).length;

  container.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-tabs" role="tablist">
        <button class="sb-tab ${tab === 'highlights' ? 'on' : ''}" data-tab="highlights">
          Notas ${hlCount ? `<span class="badge">${hlCount}</span>` : ''}
        </button>
        <button class="sb-tab ${tab === 'toc' ? 'on' : ''}" data-tab="toc">Índice</button>
        <button class="sb-tab ${tab === 'cards' ? 'on' : ''}" data-tab="cards">
          Tarjetas ${fcCount ? `<span class="badge">${fcCount}</span>` : ''}
        </button>
        <button class="sb-tab ${tab === 'glossary' ? 'on' : ''}" data-tab="glossary">
          Glosario ${glCount ? `<span class="badge">${glCount}</span>` : ''}
        </button>
        <button class="sb-tab ${tab === 'quizzes' ? 'on' : ''}" data-tab="quizzes">
          Quizzes ${qzCount ? `<span class="badge">${qzCount}</span>` : ''}
        </button>
        <button class="sb-tab ${tab === 'chat' ? 'on' : ''}" data-tab="chat">Chat IA</button>
      </div>
      <button class="icon-btn sb-close-btn" id="sb-close" aria-label="Cerrar barra lateral">${ic('close')}</button>
    </div>
    <div class="sidebar-body" id="sb-body"></div>
  `;

  container.querySelectorAll('.sb-tab').forEach(b => {
    b.onclick = () => {
      state.sidebarTab = b.dataset.tab;
      renderSidebar();
    };
  });

  $('#sb-close', container).onclick = () => {
    state.sidebarOpen = false;
    document.dispatchEvent(new CustomEvent('readily:sidebarToggle'));
  };

  renderTabContent();
}

function renderTabContent() {
  const body = $('#sb-body', container);
  if (!body) return;

  switch (state.sidebarTab) {
    case 'highlights': renderHighlights(body); break;
    case 'toc':        renderToc(body); break;
    case 'cards':      renderCards(body); break;
    case 'glossary':   renderGlossary(body); break;
    case 'quizzes':    renderQuizzes(body); break;
    case 'chat':       renderChat(body); break;
    default:           renderHighlights(body); break;
  }
}

/* ==================== 1. HIGHLIGHTS ==================== */
function renderHighlights(body) {
  const list = H.highlightsSorted();
  if (!list.length) {
    body.innerHTML = `
      <div class="empty-state">
        ${ic('pen', 32)}
        <p>Aún no has hecho subrayados en este documento.</p>
        <small>Selecciona cualquier texto en el PDF para subrayar, agregar notas o pedir explicaciones a la IA.</small>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="hl-list">
      ${list.map(h => `
        <div class="hl-card" data-id="${h.id}">
          <div class="hl-color-bar" style="background:${h.color}"></div>
          <div class="hl-main">
            <div class="hl-meta">
              <span class="hl-page-tag">Pág. ${h.page}</span>
              <div class="hl-color-picker">
                ${COLORS.map(c => `<button class="swatch-mini ${h.color === c.hex ? 'on' : ''}" data-c="${c.hex}" style="background:${c.hex}" title="${c.name}"></button>`).join('')}
              </div>
            </div>
            <div class="hl-quote">"${esc(h.text)}"</div>
            <textarea class="input hl-note-input" placeholder="Escribe una nota aquí..." rows="1">${esc(h.note || '')}</textarea>
            <div class="hl-actions">
              <button class="btn ghost xsmall hl-go">${ic('right', 14)} Ir a página</button>
              <button class="btn ghost xsmall danger hl-del">${ic('trash', 14)} Eliminar</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Event handlers
  body.querySelectorAll('.hl-card').forEach(card => {
    const id = card.dataset.id;
    const h = state.highlights.find(x => x.id === id);
    if (!h) return;

    card.querySelector('.hl-quote').onclick = () => H.scrollToHighlight(h);
    card.querySelector('.hl-go').onclick = () => H.scrollToHighlight(h);

    card.querySelector('.hl-del').onclick = () => {
      const deleted = H.deleteHighlight(id);
      if (deleted) {
        toast('Subrayado eliminado', {
          emoji: '🗑️',
          action: { label: 'Deshacer', fn: () => H.restoreHighlight(deleted) }
        });
      }
    };

    const noteInp = card.querySelector('.hl-note-input');
    noteInp.oninput = () => {
      noteInp.style.height = 'auto';
      noteInp.style.height = noteInp.scrollHeight + 'px';
    };
    noteInp.onchange = () => H.setNote(id, noteInp.value.trim());

    card.querySelectorAll('.swatch-mini').forEach(sw => {
      sw.onclick = (e) => {
        e.stopPropagation();
        H.setColor(id, sw.dataset.c);
      };
    });
  });
}

/* ==================== 2. TOC ==================== */
function renderToc(body) {
  if (!state.tocEntries || !state.tocEntries.length) {
    body.innerHTML = `
      <div class="empty-state">
        ${ic('list', 32)}
        <p>Este PDF no contiene índice estructurado.</p>
      </div>
    `;
    return;
  }

  function flatten(items, depth = 0) {
    let out = [];
    for (const item of items) {
      out.push({ title: item.title, dest: item.dest || item.url, depth });
      if (item.items && item.items.length) {
        out = out.concat(flatten(item.items, depth + 1));
      }
    }
    return out;
  }

  const flat = flatten(state.tocEntries);

  body.innerHTML = `
    <div class="toc-list">
      ${flat.map((item, idx) => `
        <button class="toc-item depth-${Math.min(item.depth, 3)}" data-idx="${idx}">
          <span class="toc-title">${esc(item.title)}</span>
        </button>
      `).join('')}
    </div>
  `;

  body.querySelectorAll('.toc-item').forEach(btn => {
    btn.onclick = async () => {
      const item = flat[+btn.dataset.idx];
      if (!item.dest) return;

      try {
        let pageNum = null;
        if (Array.isArray(item.dest) && item.dest[0]) {
          pageNum = (await state.pdf.getPageIndex(item.dest[0])) + 1;
        } else if (typeof item.dest === 'string') {
          const d = await state.pdf.getDestination(item.dest);
          if (d) pageNum = (await state.pdf.getPageIndex(d[0])) + 1;
        }
        if (pageNum) V.goTo(pageNum);
      } catch (_) {}
    };
  });
}

/* ==================== 3. TARJETAS (FLASHCARDS) ==================== */
function renderCards(body) {
  const q = (state.fcFilter || '').toLowerCase();
  const list = q
    ? state.flashcards.filter(f => f.front.toLowerCase().includes(q) || f.back.toLowerCase().includes(q))
    : state.flashcards;

  body.innerHTML = `
    <div class="fc-head-bar">
      <div class="search-box">
        ${ic('search', 16)}
        <input id="fc-search" class="input small" placeholder="Buscar tarjetas..." value="${esc(state.fcFilter)}">
      </div>
      <button class="btn primary small" id="fc-add-btn">${ic('plus', 16)} Nueva</button>
    </div>
    <div class="fc-list" id="fc-list-container"></div>
  `;

  const searchInp = $('#fc-search', body);
  searchInp.oninput = () => {
    state.fcFilter = searchInp.value;
    renderCardItems($('#fc-list-container', body));
  };

  $('#fc-add-btn', body).onclick = () => openCreateCardModal();

  renderCardItems($('#fc-list-container', body));
}

function renderCardItems(container) {
  const q = (state.fcFilter || '').toLowerCase();
  const list = q
    ? state.flashcards.filter(f => f.front.toLowerCase().includes(q) || f.back.toLowerCase().includes(q))
    : state.flashcards;

  if (!list.length) {
    container.innerHTML = `
      <div class="empty-state">
        ${ic('cards', 32)}
        <p>${state.flashcards.length ? 'No hay tarjetas que coincidan con la búsqueda.' : 'Aún no tienes tarjetas de estudio.'}</p>
        <small>Crea una nueva tarjeta o guarda explicaciones generadas por la IA.</small>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(fc => {
    const isFlipped = state.expandedCards.has(fc.id);
    return `
      <div class="fc-item" data-id="${fc.id}">
        <div class="fc-card-3d ${isFlipped ? 'flipped' : ''}">
          <div class="fc-face fc-front">
            <div class="fc-term">${esc(fc.front)}</div>
            <div class="fc-hint">Toca para voltear ${ic('refresh', 12)}</div>
          </div>
          <div class="fc-face fc-back">
            <div class="fc-ans">${esc(fc.back)}</div>
          </div>
        </div>
        <div class="fc-item-actions">
          <button class="btn ghost xsmall fc-rename">${ic('edit', 14)} Renombrar</button>
          <button class="btn ghost xsmall danger fc-del">${ic('trash', 14)} Eliminar</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.fc-card-3d').forEach(card => {
    card.onclick = () => {
      const item = card.closest('.fc-item');
      const id = item.dataset.id;
      if (state.expandedCards.has(id)) {
        state.expandedCards.delete(id);
        card.classList.remove('flipped');
      } else {
        state.expandedCards.add(id);
        card.classList.add('flipped');
      }
    };
  });

  container.querySelectorAll('.fc-rename').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.closest('.fc-item').dataset.id;
      const fc = state.flashcards.find(f => f.id === id);
      if (!fc) return;

      const newFront = await askText({ title: 'Editar término frontal', value: fc.front });
      if (!newFront || newFront === fc.front) return;

      fc.front = newFront;
      persistFlashcards();
      dbUpdate('flashcards', id, { front: newFront });
      renderTabContent();
    };
  });

  container.querySelectorAll('.fc-del').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.closest('.fc-item').dataset.id;
      const ok = await confirmBox({ title: '¿Eliminar esta tarjeta?', okLabel: 'Eliminar', danger: true });
      if (!ok) return;

      state.flashcards = state.flashcards.filter(f => f.id !== id);
      state.expandedCards.delete(id);
      persistFlashcards();
      dbDelete('flashcards', { id });
      renderTabContent();
    };
  });
}

async function openCreateCardModal() {
  const front = await askText({ title: 'Nueva Tarjeta (Frente)', placeholder: 'Ej: Fotosíntesis' });
  if (!front) return;
  const back = await askText({ title: 'Respuesta (Reverso)', placeholder: 'Ej: Proceso mediante el cual...', multiline: true });
  if (!back) return;

  E.saveCardFrom(front, back);
  toast('Tarjeta creada', { emoji: '🗂️' });
}

/* ==================== 4. GLOSARIO ==================== */
function renderGlossary(body) {
  const q = (state.glossaryFilter || '').toLowerCase();
  const list = q
    ? state.glossary.filter(g => g.term.toLowerCase().includes(q) || g.definition.toLowerCase().includes(q))
    : state.glossary;

  body.innerHTML = `
    <div class="gl-head-bar">
      <div class="search-box">
        ${ic('search', 16)}
        <input id="gl-search" class="input small" placeholder="Buscar en glosario..." value="${esc(state.glossaryFilter)}">
      </div>
    </div>
    <div class="gl-list">
      ${!list.length ? `
        <div class="empty-state">
          ${ic('book', 32)}
          <p>${state.glossary.length ? 'Sin resultados para la búsqueda.' : 'Aún no hay términos en el glosario.'}</p>
          <small>Selecciona cualquier palabra en el PDF y pulsa "✨ Explicar" para definirla y guardarla automáticamente.</small>
        </div>
      ` : list.map(g => `
        <div class="gl-card" data-id="${g.id}">
          <div class="gl-head">
            <span class="gl-term">${esc(g.term)}</span>
            <span class="gl-page-tag">Pág. ${g.page || 1}</span>
          </div>
          <div class="gl-def">${esc(g.definition)}</div>
          ${g.context_definition ? `<div class="gl-ctx"><strong>En este libro:</strong> ${esc(g.context_definition)}</div>` : ''}
          <div class="gl-actions">
            <button class="btn ghost xsmall gl-open">${ic('spark', 14)} Ver detalles</button>
            <button class="btn ghost xsmall gl-to-card">${ic('cards', 14)} Convertir a Tarjeta</button>
            <button class="btn ghost xsmall danger gl-del">${ic('trash', 14)} Eliminar</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const searchInp = $('#gl-search', body);
  searchInp.oninput = () => {
    state.glossaryFilter = searchInp.value;
    renderGlossary(body);
  };

  body.querySelectorAll('.gl-card').forEach(card => {
    const id = card.dataset.id;
    const g = state.glossary.find(x => x.id === id);
    if (!g) return;

    card.querySelector('.gl-open').onclick = () => E.openStored(g, 'glossary');

    card.querySelector('.gl-to-card').onclick = () => {
      const back = g.context_definition ? `${g.definition}\n\nEn este libro: ${g.context_definition}` : g.definition;
      const res = E.saveCardFrom(g.term, back);
      if (res) toast('Convertido a Tarjeta', { emoji: '🗂️' });
      else toast('Ya existía una tarjeta con este nombre', { emoji: 'ℹ️' });
    };

    card.querySelector('.gl-del').onclick = async () => {
      const ok = await confirmBox({ title: `¿Eliminar "${g.term}" del glosario?`, okLabel: 'Eliminar', danger: true });
      if (!ok) return;

      state.glossary = state.glossary.filter(x => x.id !== id);
      persistGlossary();
      dbDelete('glossary', { id });
      renderGlossary(body);
    };
  });
}

/* ==================== 5. QUIZZES ==================== */
function renderQuizzes(body) {
  const list = Q.quizzesSorted();

  if (!list.length) {
    body.innerHTML = `
      <div class="empty-state">
        ${ic('quiz', 32)}
        <p>Aún no has respondido quizzes en este libro.</p>
        <small>A medida que leas, se activarám pausas de comprensión para afianzar lo aprendido.</small>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="qz-list">
      ${list.map(q => `
        <div class="qz-item">
          <div class="qz-meta">
            <span class="qz-pages">Págs. ${q.from_page || 1}–${q.to_page || 1}</span>
            <span class="qz-score ${q.score >= 70 ? 'high' : 'low'}">${q.score != null ? `${q.score}%` : 'Respondido'}</span>
          </div>
          <div class="qz-question">${esc(q.question)}</div>
          <div class="qz-ans-box">
            <strong>Tu respuesta:</strong> ${esc(q.answer)}
          </div>
          <div class="qz-feedback-mini">${esc(q.feedback)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

/* ==================== 6. CHAT IA ==================== */
function renderChat(body) {
  const currentTh = state.threads.find(t => t.id === state.currentThreadId) || state.threads[0];
  const draft = state.drafts[state.currentThreadId] || '';

  body.innerHTML = `
    <div class="chat-thread-bar">
      <select class="input select-small" id="th-select">
        ${state.threads.map(t => `<option value="${t.id}" ${t.id === state.currentThreadId ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}
      </select>
      <button class="icon-btn" id="th-new" title="Nuevo chat">${ic('plus')}</button>
      <button class="icon-btn" id="th-edit" title="Renombrar chat">${ic('edit')}</button>
      <button class="icon-btn danger" id="th-del" title="Eliminar chat">${ic('trash')}</button>
    </div>

    <div class="chat-messages-container" id="chat-msgs-box">
      ${!state.chatMessages.length ? `
        <div class="empty-state">
          ${ic('chat', 32)}
          <p>Conversación vacía.</p>
          <small>Pregunta lo que quieras sobre el libro o selecciona texto para aclararlo.</small>
        </div>
      ` : state.chatMessages.map(m => renderChatMessageHtml(m)).join('')}
    </div>

    <div class="chat-input-container">
      ${state.chatCitation ? `
        <div class="chat-citation-preview">
          <span>Sobre: "${esc(state.chatCitation.slice(0, 45))}..."</span>
          <button class="icon-btn xsmall" id="cite-cancel">${ic('close', 14)}</button>
        </div>
      ` : ''}
      <div class="chat-input-row">
        <textarea id="chat-input" class="input chat-textarea" placeholder="${state.chatCitation ? `Preguntar sobre cita...` : 'Pregunta sobre el documento...'}" rows="1">${esc(draft)}</textarea>
        <button id="chat-send-btn" class="btn primary icon-only" title="Enviar">${ic('send', 18)}</button>
      </div>
    </div>
  `;

  // Handlers del chat
  const msgsBox = $('#chat-msgs-box', body);
  msgsBox.scrollTop = msgsBox.scrollHeight;

  $('#th-select', body).onchange = (e) => C.switchThread(e.target.value);
  $('#th-new', body).onclick = () => C.createThread();
  $('#th-edit', body).onclick = () => C.renameThread(state.currentThreadId);
  $('#th-del', body).onclick = () => C.deleteThread(state.currentThreadId);

  if ($('#cite-cancel', body)) {
    $('#cite-cancel', body).onclick = () => {
      state.chatCitation = '';
      renderChat(body);
    };
  }

  const input = $('#chat-input', body);
  const sendBtn = $('#chat-send-btn', body);

  input.oninput = () => {
    state.drafts[state.currentThreadId] = input.value;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  };

  const submitMsg = () => {
    const val = input.value.trim();
    if (!val) return;
    input.value = '';
    input.style.height = 'auto';
    C.sendMessage(val);
  };

  sendBtn.onclick = submitMsg;

  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitMsg();
    }
  };

  // Clicks dentro de mensajes (citas clickeables, borrar, reintentar, editar, consultar web)
  msgsBox.onclick = (e) => {
    const citeEl = e.target.closest('[data-cite]');
    if (citeEl) {
      C.handleCiteClick(citeEl.dataset.cite);
      return;
    }

    const delBtn = e.target.closest('[data-chat-del]');
    if (delBtn) {
      C.deleteMessage(delBtn.dataset.chatDel);
      return;
    }

    const editBtn = e.target.closest('[data-chat-edit]');
    if (editBtn) {
      startInlineEditMsg(editBtn.dataset.chatEdit);
      return;
    }

    const webBtn = e.target.closest('[data-chat-web]');
    if (webBtn) {
      C.lookupWebInChat(webBtn.dataset.chatWeb);
      return;
    }
  };
}

function renderChatMessageHtml(m) {
  if (m.ephemeral && m.status === 'loading') {
    return `
      <div class="chat-msg-row model">
        <div class="chat-bubble model loading">
          <div class="spinner sm"></div>
          <span>Analizando...</span>
        </div>
      </div>
    `;
  }

  if (m.err) {
    return `
      <div class="chat-msg-row model">
        <div class="chat-bubble model error">
          ${errorBox(m.err, 'Reintentar mensaje')}
          <div style="margin-top:8px; text-align:center;">
            <button class="btn ghost xsmall" data-chat-web="${esc(m.id)}">🌐 Consultar en Wikipedia / Wikcionario</button>
          </div>
        </div>
      </div>
    `;
  }

  const isUser = m.role === 'user';
  let bodyHtml = '';

  if (isUser && m.text.startsWith('> "')) {
    const parts = m.text.split('"\n\n');
    if (parts.length >= 2) {
      const cite = parts[0].substring(3);
      const rest = parts.slice(1).join('"\n\n');
      bodyHtml = `
        <div class="chat-cite-card" data-cite="${esc(cite)}">
          ${ic('chat', 14)} "${esc(cite)}"
        </div>
        <div class="chat-txt">${renderMarkdown(rest)}</div>
      `;
    } else {
      bodyHtml = `<div class="chat-txt">${renderMarkdown(m.text)}</div>`;
    }
  } else {
    bodyHtml = `<div class="chat-txt">${renderMarkdown(m.text)}</div>`;
  }

  return `
    <div class="chat-msg-row ${m.role}">
      <div class="chat-bubble ${m.role}">
        ${bodyHtml}
        <div class="chat-msg-actions">
          ${isUser ? `<button class="icon-btn xsmall" data-chat-edit="${m.id}" title="Editar">${ic('edit', 12)}</button>` : ''}
          <button class="icon-btn xsmall danger" data-chat-del="${m.id}" title="Eliminar">${ic('trash', 12)}</button>
        </div>
      </div>
    </div>
  `;
}

async function startInlineEditMsg(msgId) {
  const msg = state.chatMessages.find(m => m.id === msgId);
  if (!msg) return;

  let raw = msg.text;
  if (raw.startsWith('> "')) {
    const idx = raw.indexOf('"\n\n');
    if (idx !== -1) raw = raw.slice(idx + 3);
  }

  const updated = await askText({ title: 'Editar mensaje', value: raw, multiline: true });
  if (updated && updated !== raw) {
    C.editMessage(msgId, updated);
  }
}
