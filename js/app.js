/* Readily v2 — Aplicación principal (orquestador de vistas, toolbar del lector y eventos) */
import { state, isMobile } from './state.js';
import { esc, ic, $, $$, toast, openModal, confirmBox } from './util.js';
import { LS, COLORS } from './config.js';
import { createClient, getSessionSafe, loadDocuments, loadDocCollections, saveProgress, getPdfBytes, installSyncListeners } from './data.js';
import { loadDays, markRead, openStreakPanel, stats } from './streak.js';
import * as V from './viewer.js';
import * as H from './highlights.js';
import * as E from './explain.js';
import * as Q from './quizzes.js';
import { renderLibrary } from './library.js';
import { mountSidebar, renderSidebar } from './sidebar.js';
import { ask, errorBox } from './ai.js';
import { buildDocContext } from './context.js';
import { STYLE_BLOCK } from './config.js';

let appRoot = null;

const LOCAL_FLAG = 'readily_local_mode';
const LOCAL_SESSION = () => ({ user: { id: 'local-user', email: 'local@device' }, local: true });

export const isLocalSession = () => !!state.session?.local || state.session?.user?.id === 'local-user';

/* Entrada explícita al modo local (sin cuenta). Se recuerda hasta que cierres sesión. */
export async function enterLocalMode() {
  localStorage.setItem(LOCAL_FLAG, '1');
  state.session = LOCAL_SESSION();
  state.view = 'library';
  await loadDays();
  await loadDocuments();
  render();
}

/* Cerrar sesión: sale de la cuenta (o del modo local) y vuelve a la pantalla de acceso. */
export async function signOut() {
  try { V.unmount(); } catch (_) {}
  try { await state.sb?.auth.signOut(); } catch (_) {}
  localStorage.removeItem(LOCAL_FLAG);
  localStorage.removeItem(LS.user);
  state.session = null;
  state.documents = [];
  state.docProgresses = {};
  state.currentDoc = null;
  state.pdf = null;
  state.authMode = 'login';
  state.view = (localStorage.getItem(LS.sbUrl) && localStorage.getItem(LS.sbKey)) ? 'auth' : 'connect';
  render();
  toast('Sesión cerrada', { emoji: '👋' });
}

export async function initApp(rootElement) {
  appRoot = rootElement;
  installSyncListeners();

  const url = localStorage.getItem(LS.sbUrl);
  const key = localStorage.getItem(LS.sbKey);
  const wantsLocal = !!localStorage.getItem(LOCAL_FLAG);

  if (url && key) {
    createClient(url, key);
    let session = null;
    try { session = await getSessionSafe(); } catch (_) {}
    if (session) state.session = session;
    else if (wantsLocal) state.session = LOCAL_SESSION();
  } else if (wantsLocal) {
    state.session = LOCAL_SESSION();
  }

  if (state.session) {
    state.view = 'library';
    await loadDays();
    await loadDocuments();
  } else {
    state.view = (url && key) ? 'auth' : 'connect';
  }
  render();
}

export function render() {
  if (!appRoot) return;

  switch (state.view) {
    case 'connect': renderConnect(appRoot); break;
    case 'auth':    renderAuth(appRoot); break;
    case 'library': renderLibraryView(appRoot); break;
    case 'reader':  renderReaderView(appRoot); break;
    default:        renderConnect(appRoot); break;
  }
}

/* ==================== 1. CONEXIÓN SUPABASE ==================== */
function renderConnect(root) {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <h1 class="auth-logo">Readily</h1>
        <p class="auth-tagline">Tu lector personal de PDFs con IA</p>
        <h2>Conecta tu base de datos</h2>
        <p class="auth-hint">Pega los datos de tu proyecto Supabase o continúa en modo local sin servidor.</p>
        <div class="field">
          <label>URL del Proyecto</label>
          <input id="sb-url" class="input" placeholder="https://xxxx.supabase.co" value="${esc(localStorage.getItem(LS.sbUrl) || '')}">
        </div>
        <div class="field">
          <label>Anon Public Key</label>
          <input id="sb-key" class="input" placeholder="eyJhbGci..." value="${esc(localStorage.getItem(LS.sbKey) || '')}">
        </div>
        <button class="btn primary full" id="conn-btn">Conectar y Continuar</button>
        <button class="btn ghost full" id="local-btn" style="margin-top:10px; background:var(--accent-soft); color:var(--accent); font-weight:600;">📂 Entrar en Modo Lectura Local</button>
      </div>
    </div>
  `;

  $('#conn-btn', root).onclick = async () => {
    const url = $('#sb-url', root).value.trim();
    const key = $('#sb-key', root).value.trim();
    if (!url || !key) { toast('Completa ambos campos', { emoji: '⚠️' }); return; }

    localStorage.setItem(LS.sbUrl, url);
    localStorage.setItem(LS.sbKey, key);
    createClient(url, key);

    const session = await getSessionSafe();
    if (session) {
      state.session = session;
      state.view = 'library';
      await loadDays();
      await loadDocuments();
    } else {
      state.view = 'auth';
    }
    render();
  };

  $('#local-btn', root).onclick = () => enterLocalMode();
}

/* ==================== 2. AUTENTICACIÓN ==================== */
function renderAuth(root) {
  const isLogin = state.authMode === 'login';
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <h1 class="auth-logo">Readily</h1>
        <h2>${isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}</h2>
        <p class="auth-hint">Accede a tu biblioteca de PDFs y anotaciones.</p>
        <div class="field">
          <label>Correo Electrónico</label>
          <input id="auth-email" class="input" type="email" placeholder="tu@correo.com">
        </div>
        <div class="field">
          <label>Contraseña</label>
          <input id="auth-pass" class="input" type="password" placeholder="••••••••">
        </div>
        <button class="btn primary full" id="auth-btn">${isLogin ? 'Entrar' : 'Registrarse'}</button>
        <button class="btn ghost full" id="local-mode-btn" style="margin-top:10px; background:var(--accent-soft); color:var(--accent); font-weight:600;">📂 Entrar en Modo Lectura Local</button>
        <button class="btn ghost full" id="auth-switch" style="margin-top:6px">
          ${isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
        </button>
      </div>
    </div>
  `;

  $('#auth-switch', root).onclick = () => {
    state.authMode = isLogin ? 'signup' : 'login';
    renderAuth(root);
  };

  $('#local-mode-btn', root).onclick = () => enterLocalMode();

  $('#auth-btn', root).onclick = async () => {
    const email = $('#auth-email', root).value.trim();
    const password = $('#auth-pass', root).value;
    if (!email || !password) { toast('Introduce correo y contraseña', { emoji: '⚠️' }); return; }

    try {
      const method = isLogin ? 'signInWithPassword' : 'signUp';
      const { data, error } = await state.sb.auth[method]({ email, password });

      if (error) throw error;

      if (!isLogin && !data.session) {
        toast('Cuenta creada. Por favor, confirma tu correo.', { emoji: '📧' });
        state.authMode = 'login';
        renderAuth(root);
        return;
      }

      state.session = data.session;
      state.view = 'library';
      await loadDays();
      await loadDocuments();
      render();
    } catch (err) {
      const offline = !navigator.onLine || /fetch|network/i.test(err.message || '');
      toast(offline ? 'Sin conexión con el servidor. Puedes usar el Modo Lectura Local.' : `No se pudo entrar: ${err.message}`, { emoji: '⚠️', duration: 4000 });
    }
  };
}

/* ==================== 3. BIBLIOTECA ==================== */
function renderLibraryView(root) {
  renderLibrary(root);
}

/* ==================== 4. LECTOR DE PDF CONTINUO ==================== */
export async function openDocument(docId) {
  const doc = state.documents.find(d => String(d.id) === String(docId));
  if (!doc) {
    toast('No se encontró el documento especificado.', { emoji: '⚠️' });
    state.view = 'library';
    render();
    return;
  }

  state.currentDoc = doc;
  state.sidebarOpen = false;
  toast(`Abriendo "${doc.title}"...`, { emoji: '📖' });

  try {
    let buf;
    try {
      buf = await getPdfBytes(doc, { onStatus: msg => toast(msg, { emoji: '⏳' }) });
    } catch (dlErr) {
      buf = await promptLocalPdfFallback(doc, dlErr.message);
      if (!buf) {
        state.view = 'library';
        render();
        return;
      }
    }

    const bytes = buf instanceof Uint8Array ? buf : (buf?.buffer ? new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength || buf.buffer.byteLength) : new Uint8Array(buf));
    
    if (!bytes || bytes.byteLength < 100) {
      toast('El archivo PDF no tiene datos válidos.', { emoji: '⚠️' });
      state.view = 'library';
      render();
      return;
    }

    let pdfObj = null;
    let pdfTask = null;
    try {
      pdfTask = pdfjsLib.getDocument({ data: bytes });
      pdfObj = await Promise.race([
        pdfTask.promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('worker_timeout')), 3000))
      ]);
    } catch (wErr) {
      console.warn('[pdf] fallback a modo sin worker:', wErr);
      try { if (pdfTask?.destroy) pdfTask.destroy(); } catch (_) {}
      try {
        const syncTask = pdfjsLib.getDocument({ data: bytes, disableWorker: true });
        pdfObj = await Promise.race([
          syncTask.promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('no_sync_parse')), 3500))
        ]);
      } catch (parseErr) {
        console.error('[pdf] error crítico leyendo PDF:', parseErr);
        toast(`No se pudo interpretar el PDF "${doc.title}". El archivo puede estar corrupto.`, { emoji: '⚠️', duration: 4000 });
        state.view = 'library';
        render();
        return;
      }
    }

    state.pdf = pdfObj;
    state.numPages = state.pdf.numPages;

    if (state.sb) {
      try {
        await Promise.race([
          loadDocCollections(doc.id),
          new Promise(r => setTimeout(r, 2000))
        ]);
      } catch (_) {}
    }

    const prog = state.docProgresses[doc.id];
    state.pageNum = prog?.page || 1;
    state.maxPage = prog?.max_page || state.pageNum;

    // Indexado de texto en segundo plano
    extractIndexInBackground();

    // Cargar outline (TOC)
    try {
      state.tocEntries = (await Promise.race([
        state.pdf.getOutline(),
        new Promise(r => setTimeout(() => r([]), 1500))
      ])) || [];
    } catch (_) { state.tocEntries = []; }

    state.view = 'reader';
    render();

    // Banner de reanudación si la página guardada > 3
    if (state.pageNum > 3 && state.geminiKey) {
      showResumeBanner(doc, state.pageNum);
    }
  } catch (err) {
    console.error('Error al abrir documento:', err);
    toast(`No se pudo abrir: ${err.message}`, { emoji: '⚠️', duration: 4000 });
    state.view = 'library';
    render();
  }
}

async function promptLocalPdfFallback(doc, errorMsg) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };

    const m = openModal(`
      <div class="modal-title" style="color:var(--warn);">⚠️ No se pudo descargar el PDF remoto</div>
      <p style="font-size:13px; color:var(--ink-soft); line-height:1.5; margin-bottom:14px;">
        ${esc(errorMsg)}
      </p>
      <p style="font-size:13px; font-weight:600; margin-bottom:12px;">
        Selecciona el archivo PDF de <strong>"${esc(doc.title)}"</strong> desde tu equipo para abrirlo y guardarlo:
      </p>
      <div class="field">
        <input type="file" id="fallback-pdf-file" accept="application/pdf" class="input">
      </div>
      <div class="modal-actions">
        <button class="btn ghost" id="fb-cancel">Cancelar</button>
        <button class="btn primary" id="fb-confirm">Cargar y Abrir</button>
      </div>
    `);

    m.overlay.addEventListener('mousedown', (e) => { if (e.target === m.overlay) { m.close(); finish(null); } });
    $('#fb-cancel', m.el).onclick = () => { m.close(); finish(null); };
    $('#fb-confirm', m.el).onclick = async () => {
      const fileInp = $('#fallback-pdf-file', m.el);
      const file = fileInp?.files?.[0];
      if (!file) { toast('Selecciona un archivo PDF', { emoji: '⚠️' }); return; }
      try {
        const buf = await file.arrayBuffer();
        const { idb } = await import('./idb.js');
        await idb.set(doc.storage_path, buf.slice(0), 'blobs');
        state.offlineDocs.add(doc.storage_path);
        toast('PDF guardado en el dispositivo', { emoji: '✅' });
        m.close();
        finish(buf);
      } catch (e) {
        toast(`Error al leer archivo: ${e.message}`, { emoji: '⚠️' });
        m.close();
        finish(null);
      }
    };
  });
}

async function extractIndexInBackground() {
  const pdf = state.pdf;
  if (!pdf) return;
  state.searchIndex = [];
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    if (state.pdf !== pdf) return; // cambió de libro
    try {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map(it => it.str).join(' ');
      const fold = text.toLowerCase();
      state.searchIndex.push({ page: i, text, fold });
      fullText += `\n[Pág ${i}] ${text}`;
    } catch (_) {}
  }
  state.docFullText = fullText;
}

function renderReaderView(root) {
  root.innerHTML = `
    <div class="reader-shell">
      <header class="reader-toolbar" id="reader-tb"></header>
      <div class="reader-workspace">
        <div class="reader-stage" id="reader-stage"></div>
        <div class="reader-sidebar ${state.sidebarOpen ? 'open' : ''}" id="reader-sidebar"></div>
        <div class="reader-float-dock" id="dock-bar">
          <button class="icon-btn" id="dock-prev" title="Página anterior">${ic('back', 16)}</button>
          <span class="dock-page" id="dock-page-str">${state.pageNum} / ${state.numPages}</span>
          <button class="icon-btn" id="dock-next" title="Página siguiente">${ic('right', 16)}</button>
          <div class="tb-divider"></div>
          <button class="icon-btn" id="dock-zoom-out" title="Alejar">${ic('minus', 16)}</button>
          <button class="btn ghost xsmall" id="dock-zoom-lbl" style="color:#fff; border-color:rgba(255,255,255,0.2);">100%</button>
          <button class="icon-btn" id="dock-zoom-in" title="Acercar">${ic('plus', 16)}</button>
          <div class="tb-divider"></div>
          <button class="icon-btn ${state.quickHighlight ? 'active' : ''}" id="dock-pen" title="Modo Bolígrafo">${ic('pen', 16)}</button>
          <button class="icon-btn" id="dock-sidebar" title="Notas / Chat">${ic('panel', 16)}</button>
        </div>
      </div>
    </div>
  `;

  try { renderToolbar($('#reader-tb', root)); } catch (err) { console.error('Error al renderizar toolbar:', err); }
  try { mountSidebar($('#reader-sidebar', root)); } catch (err) { console.error('Error al montar barra lateral:', err); }

  const stage = $('#reader-stage', root);
  if (stage && state.pdf) {
    V.mount(stage, state.pdf, state.pageNum).catch(err => {
      console.error('Error al visualizar páginas del PDF:', err);
      toast(`Error al mostrar el PDF: ${err.message}`, { emoji: '⚠️', duration: 5000 });
    });
  }

  const updateDockUI = () => {
    const ps = $('#dock-page-str', root);
    if (ps) ps.textContent = `${state.pageNum} / ${state.numPages}`;
  };

  // Escuchar eventos del visor PDF
  V.on('page', (num) => {
    const prev = state.pageNum;
    state.pageNum = num;
    if (num > state.maxPage) state.maxPage = num;

    markRead();
    saveProgress(state.currentDoc.id, state.pageNum, state.maxPage);
    Q.checkQuizTrigger(prev, num);
    updatePageInputUI();
    updateDockUI();
  });

  V.on('scale', (scale, mode) => {
    const lbl = $('#dock-zoom-lbl', root);
    if (lbl) lbl.textContent = mode === 'fit-width' ? 'Ancho' : mode === 'fit-page' ? 'Pág' : `${Math.round(scale * 100)}%`;
  });

  V.on('selection', (sel) => {
    handleSelectionChanged(sel);
  });

  V.on('highlightTap', (hl, pos) => {
    E.openStored({ term: hl.text, definition: hl.note || 'Subrayado', page: hl.page }, 'glossary');
  });

  // Eventos del Dock Flotante estilo Acrobat
  $('#dock-prev', root).onclick = () => V.goTo(state.pageNum - 1);
  $('#dock-next', root).onclick = () => V.goTo(state.pageNum + 1);
  $('#dock-zoom-out', root).onclick = () => V.stepZoom(-1);
  $('#dock-zoom-in', root).onclick = () => V.stepZoom(1);
  $('#dock-zoom-lbl', root).onclick = openZoomMenu;
  $('#dock-pen', root).onclick = () => {
    state.quickHighlight = !state.quickHighlight;
    $('#dock-pen', root).classList.toggle('active', state.quickHighlight);
    $('#tb-quick-hl')?.classList.toggle('active', state.quickHighlight);
    toast(state.quickHighlight ? 'Modo Bolígrafo activado' : 'Modo Bolígrafo desactivado', { emoji: '✏️' });
  };
  $('#dock-sidebar', root).onclick = () => {
    state.sidebarOpen = !state.sidebarOpen;
    document.dispatchEvent(new CustomEvent('readily:sidebarToggle'));
  };

  document.addEventListener('readily:sidebarToggle', () => {
    const sb = $('#reader-sidebar', root);
    if (sb) sb.classList.toggle('open', state.sidebarOpen);
    setTimeout(() => {
      if (V.getZoomMode() === 'fit-width') V.setZoomMode('fit-width');
    }, 280);
  });
}

/* ---------- Toolbar del Lector estilo Acrobat ---------- */
function renderToolbar(tb) {
  const doc = state.currentDoc;
  const st = stats();

  tb.innerHTML = `
    <div class="tb-left">
      <button class="btn ghost icon-only" id="tb-back" title="Volver a la biblioteca">${ic('back', 20)}</button>
      <div class="tb-divider"></div>
      <span class="tb-doc-title" title="${esc(doc?.title)}">${esc(doc?.title)}</span>
    </div>

    <div class="tb-center">
      <button class="btn ghost icon-only" id="tb-prev-page" title="Página anterior">${ic('back', 16)}</button>
      <div class="tb-page-box">
        <input id="tb-page-input" class="input small page-inp" type="number" min="1" max="${state.numPages}" value="${state.pageNum}">
        <span class="tb-total">/ ${state.numPages}</span>
      </div>
      <button class="btn ghost icon-only" id="tb-next-page" title="Página siguiente">${ic('right', 16)}</button>
      
      <div class="tb-divider"></div>

      <button class="btn ghost icon-only" id="tb-zoom-out" title="Alejar (A-)">${ic('minus', 16)}</button>
      <button class="btn ghost small" id="tb-zoom-label" title="Modos de visualización">100%</button>
      <button class="btn ghost icon-only" id="tb-zoom-in" title="Acercar (A+)">${ic('plus', 16)}</button>

      <div class="tb-divider"></div>

      <button class="btn ghost icon-only ${state.quickHighlight ? 'active' : ''}" id="tb-quick-hl" title="Modo Bolígrafo (subrayado rápido)">${ic('pen', 18)}</button>
    </div>

    <div class="tb-right">
      <button class="streak-pill mini" id="tb-streak-btn" title="Racha de lectura">
        ${ic('flame', 16, 'fire')} <span>${st.current}</span>
      </button>
      <button class="btn ghost icon-only" id="tb-sidebar-toggle" title="Abrir notas y chat">${ic('panel', 20)}</button>
    </div>
  `;

  $('#tb-back', tb).onclick = () => {
    V.unmount();
    state.view = 'library';
    render();
  };

  $('#tb-prev-page', tb).onclick = () => V.goTo(state.pageNum - 1);
  $('#tb-next-page', tb).onclick = () => V.goTo(state.pageNum + 1);

  const pageInp = $('#tb-page-input', tb);
  pageInp.onchange = () => V.goTo(parseInt(pageInp.value) || 1);

  $('#tb-zoom-out', tb).onclick = () => V.stepZoom(-1);
  $('#tb-zoom-in', tb).onclick = () => V.stepZoom(1);
  $('#tb-zoom-label', tb).onclick = openZoomMenu;

  $('#tb-quick-hl', tb).onclick = () => {
    state.quickHighlight = !state.quickHighlight;
    $('#tb-quick-hl', tb).classList.toggle('active', state.quickHighlight);
    toast(state.quickHighlight ? 'Modo Bolígrafo activado: al seleccionar texto se subrayará directamente' : 'Modo Bolígrafo desactivado', { emoji: '✏️' });
  };

  $('#tb-streak-btn', tb).onclick = openStreakPanel;

  $('#tb-sidebar-toggle', tb).onclick = () => {
    state.sidebarOpen = !state.sidebarOpen;
    document.dispatchEvent(new CustomEvent('readily:sidebarToggle'));
  };

  V.on('scale', (scale, mode) => {
    const lbl = $('#tb-zoom-label', tb);
    if (lbl) {
      lbl.textContent = mode === 'fit-width' ? 'Ancho' : mode === 'fit-page' ? 'Página' : `${Math.round(scale * 100)}%`;
    }
  });
}

function updatePageInputUI() {
  const inp = $('#tb-page-input');
  if (inp) inp.value = state.pageNum;
}

function openZoomMenu() {
  const m = openModal(`
    <div class="modal-title">Modos de Zoom</div>
    <div class="zoom-options">
      <button class="btn ghost full" id="zm-width">${ic('fit', 18)} Ajustar al ancho</button>
      <button class="btn ghost full" id="zm-page">${ic('scan', 18)} Página completa</button>
      <div class="tb-divider" style="margin:8px 0"></div>
      <button class="btn ghost full" id="zm-100">100%</button>
      <button class="btn ghost full" id="zm-125">125%</button>
      <button class="btn ghost full" id="zm-150">150%</button>
    </div>
  `);

  $('#zm-width', m.el).onclick = () => { V.setZoomMode('fit-width'); m.close(); };
  $('#zm-page', m.el).onclick = () => { V.setZoomMode('fit-page'); m.close(); };
  $('#zm-100', m.el).onclick = () => { V.zoomTo(1.0); m.close(); };
  $('#zm-125', m.el).onclick = () => { V.zoomTo(1.25); m.close(); };
  $('#zm-150', m.el).onclick = () => { V.zoomTo(1.50); m.close(); };
}

/* ---------- Toolbar Flotante de Selección ---------- */
function handleSelectionChanged(sel) {
  let bar = $('#sel-float-bar');

  if (!sel || !sel.text) {
    if (bar) bar.style.display = 'none';
    return;
  }

  // Si está activo el modo Bolígrafo, subraya inmediatamente con el color activo
  if (state.quickHighlight && sel.pieces.length) {
    sel.pieces.forEach(p => H.addHighlight(p, state.activeColor));
    V.clearSelection();
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'sel-float-bar';
    bar.className = 'sel-float-toolbar';
    document.body.appendChild(bar);
  }

  const r = sel.last;
  bar.style.left = `${r.left + r.width / 2}px`;
  bar.style.top = `${r.top - 46}px`;
  bar.style.display = 'flex';

  bar.innerHTML = `
    ${COLORS.map(c => `<button class="swatch-dot" data-c="${c.hex}" style="background:${c.hex}" title="${c.name}"></button>`).join('')}
    <div class="tb-divider"></div>
    <button class="btn small primary" id="sel-ex-btn">${ic('spark', 16)} Explicar</button>
    <button class="btn small ghost" id="sel-web-btn">${ic('search', 16)} 🌐 Web</button>
    <button class="btn small ghost" id="sel-ask-btn">${ic('chat', 16)} Preguntar</button>
  `;

  $$('.swatch-dot', bar).forEach(btn => {
    btn.onclick = () => {
      sel.pieces.forEach(p => H.addHighlight(p, btn.dataset.c));
      state.activeColor = btn.dataset.c;
      V.clearSelection();
    };
  });

  $('#sel-ex-btn', bar).onclick = () => {
    const p = sel.pieces[0];
    V.clearSelection();
    E.explain(sel.text, p.page);
  };

  $('#sel-web-btn', bar).onclick = () => {
    const p = sel.pieces[0];
    V.clearSelection();
    E.explainWeb(sel.text, p.page);
  };

  $('#sel-ask-btn', bar).onclick = () => {
    const cite = sel.text;
    V.clearSelection();
    E.closePanel();
    import('./chat.js').then(C => C.openChatWith('', cite));
  };
}

/* ---------- Banner "¿Dónde me quedé?" ---------- */
async function showResumeBanner(doc, savedPage) {
  const m = openModal(`
    <div class="resume-card">
      <div class="quiz-badge">¿Dónde me quedé?</div>
      <h3>${esc(doc.title)}</h3>
      <div id="resume-spinner" class="resume-loading">
        <div class="spinner sm"></div>
        <span>Recordando el hilo lógico...</span>
      </div>
      <div id="resume-summary" class="resume-text" style="display:none"></div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn ghost small" id="rb-restart">Ir al inicio</button>
        <button class="btn primary small" id="rb-continue">Continuar en p. ${savedPage}</button>
      </div>
    </div>
  `);

  $('#rb-continue', m.el).onclick = () => m.close();
  $('#rb-restart', m.el).onclick = () => { V.goTo(1); m.close(); };

  try {
    const { text: ctx } = buildDocContext('resumen de lectura reciente');
    const prompt = `El usuario reanuda "${doc.title}" en la página ${savedPage}.
Contexto reciente:
"""${ctx}"""

${STYLE_BLOCK}

En 2 oraciones, recuérdale la causa o lógica principal que estaba leyendo antes de pausar.`;

    const res = await ask({ prompt, temperature: 0.3 });
    $('#resume-spinner', m.el).style.display = 'none';
    const sumEl = $('#resume-summary', m.el);
    sumEl.style.display = 'block';
    sumEl.textContent = res.text;
  } catch (_) {
    m.close();
  }
}
