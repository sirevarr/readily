/* Readily v2 — Quizzes de comprobación y guardado de respuestas */
import { state, userId } from './state.js';
import { uuid, esc, ic, openModal, toast } from './util.js';
import { ask, askJSON, errorBox, bindErrorBox } from './ai.js';
import { dbInsert, persistQuizzes } from './data.js';
import { buildDocContext } from './context.js';
import { STYLE_BLOCK, QUIZ_EVERY_N } from './config.js';

export function quizzesSorted() {
  return [...state.quizzes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function checkQuizTrigger(prevPage, nextPage) {
  if (nextPage <= prevPage) return;
  if (nextPage - state.quizLastPage >= QUIZ_EVERY_N) {
    const from = Math.max(1, nextPage - QUIZ_EVERY_N + 1);
    state.quizLastPage = nextPage;
    triggerQuiz(from, nextPage);
  }
}

export async function triggerQuiz(fromPage, toPage) {
  const qz = {
    id: uuid(),
    document_id: state.currentDoc?.id,
    fromPage, toPage,
    question: '',
    answer: '',
    feedback: '',
    score: null,
    status: 'loading',
    created_at: new Date().toISOString()
  };
  openQuizModal(qz);

  try {
    const { text: ctxText } = buildDocContext(`preguntas de las páginas ${fromPage} a ${toPage}`, 6000);
    const prompt = `El usuario ha leído de la página ${fromPage} a la ${toPage} de "${state.currentDoc?.title || ''}".
Contexto leído:
"""${ctxText}"""

${STYLE_BLOCK}

Genera UNA SOLA pregunta abierta de comprensión de lectura directa sobre lo leído.
Reglas:
- No hagas preguntas de memoria trivial. Pregunta por la causa, el porqué o la consecuencia directa.
- No uses opción múltiple.
- Debe poder responderse en 1 o 2 oraciones.
- Sin negritas ("**").`;

    const res = await ask({
      prompt,
      system: 'Eres un tutor de lectura exigente pero claro. Generas preguntas de comprensión directas.',
      temperature: 0.5
    });

    qz.question = res.text;
    qz.status = 'ready';
    renderQuizModal(qz);
  } catch (err) {
    qz.status = 'error';
    qz.err = err;
    renderQuizModal(qz);
  }
}

let currentModal = null;

function openQuizModal(qz) {
  if (currentModal) currentModal.close();
  const m = openModal(`
    <div id="quiz-modal-content"></div>
  `, { cls: 'quiz-modal', dismissible: false });
  currentModal = m;
  renderQuizModal(qz);
}

function renderQuizModal(qz) {
  const content = document.getElementById('quiz-modal-content');
  if (!content) return;

  if (qz.status === 'loading') {
    content.innerHTML = `
      <div class="quiz-head">
        <span class="quiz-badge">🧠 Pausa de lectura · Págs. ${qz.fromPage}–${qz.toPage}</span>
      </div>
      <div class="quiz-body loading">
        <div class="spinner sm"></div>
        <span>Generando pregunta de comprensión...</span>
      </div>
    `;
    return;
  }

  if (qz.status === 'error') {
    content.innerHTML = `
      <div class="quiz-head">
        <span class="quiz-badge">🧠 Pausa de lectura · Págs. ${qz.fromPage}–${qz.toPage}</span>
        <button class="icon-btn" id="qz-close">${ic('close')}</button>
      </div>
      <div class="quiz-body">
        ${errorBox(qz.err)}
      </div>
    `;
    document.getElementById('qz-close').onclick = () => currentModal?.close();
    bindErrorBox(content, () => triggerQuiz(qz.fromPage, qz.toPage), qz.err);
    return;
  }

  if (qz.status === 'ready') {
    content.innerHTML = `
      <div class="quiz-head">
        <span class="quiz-badge">🧠 Pausa de lectura · Págs. ${qz.fromPage}–${qz.toPage}</span>
        <button class="icon-btn" id="qz-close">${ic('close')}</button>
      </div>
      <div class="quiz-q">${esc(qz.question)}</div>
      <div class="quiz-body">
        <textarea id="qz-ans-input" class="input quiz-input" placeholder="Escribe tu respuesta aquí..." rows="3"></textarea>
      </div>
      <div class="quiz-foot">
        <button class="btn ghost small" id="qz-skip">Saltar por ahora</button>
        <button class="btn primary small" id="qz-submit">${ic('check', 16)} Evaluar respuesta</button>
      </div>
    `;

    document.getElementById('qz-close').onclick = () => currentModal?.close();
    document.getElementById('qz-skip').onclick = () => currentModal?.close();
    
    const inp = document.getElementById('qz-ans-input');
    inp.focus();

    document.getElementById('qz-submit').onclick = () => submitAnswer(qz, inp.value.trim());
    return;
  }

  if (qz.status === 'evaluating') {
    content.innerHTML = `
      <div class="quiz-head">
        <span class="quiz-badge">🧠 Pausa de lectura · Págs. ${qz.fromPage}–${qz.toPage}</span>
      </div>
      <div class="quiz-q">${esc(qz.question)}</div>
      <div class="quiz-user-ans"><strong>Tu respuesta:</strong> ${esc(qz.answer)}</div>
      <div class="quiz-body loading">
        <div class="spinner sm"></div>
        <span>Evaluando tu respuesta...</span>
      </div>
    `;
    return;
  }

  if (qz.status === 'done') {
    content.innerHTML = `
      <div class="quiz-head">
        <span class="quiz-badge">🧠 Pausa de lectura · Págs. ${qz.fromPage}–${qz.toPage}</span>
        <button class="icon-btn" id="qz-close">${ic('close')}</button>
      </div>
      <div class="quiz-q">${esc(qz.question)}</div>
      <div class="quiz-user-ans"><strong>Tu respuesta:</strong> ${esc(qz.answer)}</div>
      <div class="quiz-feedback-box ${qz.score >= 70 ? 'good' : 'improvement'}">
        <div class="quiz-fb-head">
          <span class="fb-score">${qz.score >= 70 ? '✅ Buena comprensión' : '💡 Por repasar'}</span>
        </div>
        <div class="quiz-fb-text">${esc(qz.feedback)}</div>
      </div>
      <div class="quiz-foot">
        <button class="btn primary small" id="qz-done">Continuar leyendo</button>
      </div>
    `;
    document.getElementById('qz-close').onclick = () => currentModal?.close();
    document.getElementById('qz-done').onclick = () => currentModal?.close();
  }
}

async function submitAnswer(qz, userAns) {
  if (!userAns) {
    toast('Escribe una respuesta antes de evaluar', { emoji: '✏️' });
    return;
  }

  qz.answer = userAns;
  qz.status = 'evaluating';
  renderQuizModal(qz);

  try {
    const prompt = `Pregunta realizada: "${qz.question}"
Respuesta del usuario: "${userAns}"

${STYLE_BLOCK}

Evalúa la respuesta del usuario. Responde en JSON con este formato exacto:
{
  "score": 85, // número de 0 a 100
  "feedback": "..." // Retroalimentación breve de 2 oraciones. Si está bien, confirma directo. Si faltó algo, señala qué faltó exactamente sin rodeos. Sin negritas.
}`;

    const { data } = await askJSON({
      prompt,
      system: 'Eres un evaluador preciso que analiza si la respuesta demuestra comprensión.',
      temperature: 0.2
    });

    qz.score = typeof data.score === 'number' ? data.score : 75;
    qz.feedback = data.feedback || 'Respuesta registrada correctamente.';
    qz.status = 'done';

    // Guardar en el estado local y Supabase/IndexedDB
    const row = {
      id: qz.id,
      document_id: state.currentDoc.id,
      user_id: userId(),
      from_page: qz.fromPage,
      to_page: qz.toPage,
      question: qz.question,
      answer: qz.answer,
      feedback: qz.feedback,
      score: qz.score,
      created_at: qz.created_at
    };

    state.quizzes.unshift(row);
    persistQuizzes();
    dbInsert('quiz_attempts', row);

    document.dispatchEvent(new CustomEvent('readily:quizzes'));
    renderQuizModal(qz);
  } catch (err) {
    qz.status = 'ready';
    renderQuizModal(qz);
    toast('No se pudo evaluar la respuesta. Inténtalo de nuevo.', { emoji: '⚠️' });
  }
}
