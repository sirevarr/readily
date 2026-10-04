/* Readily v2 — Chat con IA por hilo, citas interactivas, edición de mensajes y tolerancia a fallos */
import { state, userId } from './state.js';
import { uuid, esc, ic, renderMarkdown, toast, confirmBox, askText, $ } from './util.js';
import { ask, errorText, AIError } from './ai.js';
import { dbInsert, dbUpdate, dbDelete, loadThreadMessages, persistThreads, persistMessages } from './data.js';
import { buildDocContext, knownTerms } from './context.js';
import { STYLE_BLOCK, MAX_CHAT_HISTORY } from './config.js';
import * as V from './viewer.js';

const notifyChat = () => document.dispatchEvent(new CustomEvent('readily:chat'));

export async function createThread(title = '') {
  if (!state.currentDoc) return;
  const tTitle = title || `Chat ${state.threads.length + 1}`;
  const row = {
    id: uuid(),
    document_id: state.currentDoc.id,
    user_id: userId(),
    title: tTitle,
    created_at: new Date().toISOString()
  };
  state.threads.push(row);
  state.currentThreadId = row.id;
  state.chatMessages = [];
  persistThreads();
  persistMessages();
  dbInsert('chat_threads', row);
  notifyChat();
  return row;
}

export async function switchThread(threadId) {
  if (state.currentThreadId === threadId) return;
  // Guardar borrador actual
  const ci = $('#chat-input');
  if (ci && state.currentThreadId) {
    state.drafts[state.currentThreadId] = ci.value;
  }
  state.currentThreadId = threadId;
  await loadThreadMessages(threadId);
  notifyChat();
}

export async function renameThread(threadId) {
  const th = state.threads.find(t => t.id === threadId);
  if (!th) return;
  const newTitle = await askText({ title: 'Renombrar conversación', value: th.title, okLabel: 'Guardar' });
  if (!newTitle || newTitle === th.title) return;
  th.title = newTitle;
  persistThreads();
  dbUpdate('chat_threads', threadId, { title: newTitle });
  notifyChat();
}

export async function deleteThread(threadId) {
  if (state.threads.length <= 1) {
    toast('Debes conservar al menos una conversación.', { emoji: '💬' });
    return;
  }
  const ok = await confirmBox({ title: '¿Eliminar esta conversación?', message: 'Se borrarán todos sus mensajes de chat.', okLabel: 'Eliminar', danger: true });
  if (!ok) return;

  state.threads = state.threads.filter(t => t.id !== threadId);
  dbDelete('chat_threads', { id: threadId });
  dbDelete('chat_messages', { thread_id: threadId });
  persistThreads();

  state.currentThreadId = state.threads[0].id;
  await loadThreadMessages(state.currentThreadId);
  notifyChat();
}

export function openChatWith(userQuestion, citeText = '') {
  state.sidebarTab = 'chat';
  state.sidebarOpen = true;
  document.dispatchEvent(new CustomEvent('readily:sidebarToggle'));
  if (citeText) state.chatCitation = citeText;
  notifyChat();

  setTimeout(() => {
    const ci = $('#chat-input');
    if (ci) {
      if (userQuestion) {
        sendMessage(userQuestion, citeText);
      } else {
        ci.focus();
        if (citeText) ci.placeholder = `Preguntar sobre "${citeText.slice(0, 30)}..."`;
      }
    }
  }, 100);
}

export async function sendMessage(text, explicitCite = '') {
  const query = text.trim();
  if (!query) return;

  const cite = explicitCite || state.chatCitation;
  state.chatCitation = '';

  let userText = query;
  let rawContent = query;
  if (cite) {
    rawContent = `> "${cite.trim()}"\n\n${query}`;
  }

  const userMsg = {
    id: uuid(),
    thread_id: state.currentThreadId,
    document_id: state.currentDoc.id,
    user_id: userId(),
    role: 'user',
    text: rawContent,
    created_at: new Date().toISOString()
  };

  state.chatMessages.push(userMsg);
  persistMessages();
  dbInsert('chat_messages', { id: userMsg.id, document_id: userMsg.document_id, thread_id: userMsg.thread_id, user_id: userMsg.user_id, role: 'user', content: userMsg.text });
  
  // Limpiar borrador
  delete state.drafts[state.currentThreadId];
  notifyChat();

  await generateAiResponse(userMsg);
}

async function generateAiResponse(triggerUserMsg) {
  const pendingMsg = {
    id: 'pending-' + Date.now(),
    role: 'model',
    text: '',
    ephemeral: true,
    status: 'loading'
  };

  state.chatMessages.push(pendingMsg);
  notifyChat();

  try {
    const { text: docCtx, pageNums } = buildDocContext(triggerUserMsg.text);
    const terms = knownTerms(30);

    const system = `Eres el asistente de lectura inteligente dentro de Readily para "${state.currentDoc?.title || ''}".
Estás en la página ${state.pageNum} de ${state.numPages}.

Fragmento del documento disponible:
"""${docCtx}"""

${terms.length ? `Términos en el glosario/tarjetas del usuario: ${terms.join(', ')}` : ''}

${STYLE_BLOCK}

Reglas adicionales:
- Si el usuario te pregunta por algo del documento, apóyate en el contexto proporcionado.
- Cita la página si es relevante (ej: "[Página X]").
- Responde directo, sin formalismos vacíos, en español claro.`;

    const history = state.chatMessages
      .filter(m => !m.ephemeral && !m.err)
      .slice(-MAX_CHAT_HISTORY)
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));

    const res = await ask({
      system,
      contents: history,
      temperature: 0.5
    });

    // Remover mensaje temporal y guardar respuesta real
    state.chatMessages = state.chatMessages.filter(m => m.id !== pendingMsg.id);

    const aiMsg = {
      id: uuid(),
      thread_id: state.currentThreadId,
      document_id: state.currentDoc.id,
      user_id: userId(),
      role: 'model',
      text: res.text,
      modelUsed: res.model,
      created_at: new Date().toISOString()
    };

    state.chatMessages.push(aiMsg);
    persistMessages();
    dbInsert('chat_messages', { id: aiMsg.id, document_id: aiMsg.document_id, thread_id: aiMsg.thread_id, user_id: aiMsg.user_id, role: 'model', content: aiMsg.text });
    notifyChat();

  } catch (err) {
    state.chatMessages = state.chatMessages.filter(m => m.id !== pendingMsg.id);
    const errMsg = {
      id: uuid(),
      thread_id: state.currentThreadId,
      document_id: state.currentDoc.id,
      user_id: userId(),
      role: 'model',
      text: '',
      err,
      created_at: new Date().toISOString()
    };
    state.chatMessages.push(errMsg);
    notifyChat();
  }
}

export async function retryLastMessage() {
  const last = state.chatMessages[state.chatMessages.length - 1];
  if (last && last.err) {
    state.chatMessages.pop();
    const lastUser = [...state.chatMessages].reverse().find(m => m.role === 'user');
    if (lastUser) {
      await generateAiResponse(lastUser);
    }
  }
}

export async function deleteMessage(msgId) {
  const idx = state.chatMessages.findIndex(m => m.id === msgId);
  if (idx === -1) return;
  const msg = state.chatMessages[idx];
  state.chatMessages.splice(idx, 1);
  persistMessages();
  if (!msg.ephemeral) {
    dbDelete('chat_messages', { id: msgId });
  }
  notifyChat();
}

export async function editMessage(msgId, newText) {
  const msg = state.chatMessages.find(m => m.id === msgId);
  if (!msg || msg.role !== 'user') return;

  msg.text = newText;
  persistMessages();
  dbUpdate('chat_messages', msgId, { content: newText });

  // Eliminar mensajes posteriores producidos por este
  const idx = state.chatMessages.findIndex(m => m.id === msgId);
  const removed = state.chatMessages.splice(idx + 1);
  removed.forEach(r => {
    if (!r.ephemeral) dbDelete('chat_messages', { id: r.id });
  });

  notifyChat();
  await generateAiResponse(msg);
}

/* Manejo de clicks en citas dentro del chat */
export function handleCiteClick(citeText) {
  if (!citeText) return;
  const clean = citeText.trim();
  // Buscar en qué página se encuentra la cita
  const match = state.searchIndex.find(p => p.fold.includes(clean.toLowerCase().slice(0, 40)));
  if (match) {
    V.flashText(match.page, clean);
    toast(`Navegando a p. ${match.page}`, { emoji: '📖' });
  } else {
    toast(`Cita: "${clean.slice(0, 50)}..."`, { emoji: '💬' });
  }
}
