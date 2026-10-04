/* Readily v2 — estado global y ajustes */
import { LS } from './config.js';

const DEFAULT_SETTINGS = {
  autoQuiz: true,        // ofrecer una pausa de comprensión cada N páginas
  chapterPreview: false, // vista previa al empezar una sección (gasta cuota de IA)
  onlyRead: true,        // la IA solo usa lo que ya leíste
};

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS.settings) || '{}') }; }
  catch (_) { return { ...DEFAULT_SETTINGS }; }
}

export const settings = loadSettings();
export const saveSettings = () => localStorage.setItem(LS.settings, JSON.stringify(settings));

export const isTouch = () => matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
export const isMobile = () => window.innerWidth <= 720;

export const state = {
  view: 'connect',
  sb: null,
  session: null,
  authMode: 'login',
  authError: '',
  online: navigator.onLine,
  pending: 0,                 // operaciones sin sincronizar
  missingTables: new Set(),   // tablas que aún no existen en Supabase (falta migración v2)

  documents: [],
  docProgresses: {},
  offlineDocs: new Set(),     // storage_path de PDFs guardados en el dispositivo
  activeCategory: 'all',

  currentDoc: null,
  pdf: null,
  numPages: 0,
  pageNum: 1,
  maxPage: 1,                 // hasta dónde has leído (frontera de la IA)
  highlights: [],
  flashcards: [],
  glossary: [],
  quizzes: [],
  threads: [],
  currentThreadId: null,
  chatMessages: [],
  chatCitation: '',
  drafts: {},                 // borradores del chat por conversación

  searchIndex: [],            // [{ page, text, fold }]
  indexProgress: 0,
  indexDone: false,
  docFullText: '',
  tocEntries: [],

  geminiKey: localStorage.getItem(LS.gemini) || '',
  sidebarOpen: false,
  sidebarTab: 'highlights',
  activeColor: '#F2C94C',
  quickHighlight: false,      // modo "bolígrafo": subraya al soltar la selección
  visualMode: false,

  searchOpen: false,
  searchQuery: '',
  searchResults: [],
  searchIdx: -1,

  quizLastPage: 0,
  glossaryFilter: '',
  fcFilter: '',
  expandedCards: new Set(),

  days: {},                   // { 'YYYY-MM-DD': páginas }
};

export const userId = () => state.session?.user?.id || null;
