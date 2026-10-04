/* Readily v2 — contexto del documento para la IA.
   En vez de enviar el libro entero en cada pregunta (lo que agotaba la cuota enseguida),
   se envían solo las páginas relevantes y únicamente hasta donde la persona ha leído. */
import { state, settings } from './state.js';
import { CTX_CHAR_BUDGET } from './config.js';
import { fold } from './util.js';

const STOP = new Set('de la que el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros es son fue ser era cual cuales explicame dime resumen explica que significa pagina capitulo libro'.split(' '));

export const frontier = () => settings.onlyRead ? Math.max(state.maxPage, state.pageNum, 1) : state.numPages;

function tokens(q) {
  return fold(q).replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}

function countOcc(hay, w) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(w, i)) !== -1) { n++; i += w.length; }
  return n;
}

export function buildDocContext(query, budget = CTX_CHAR_BUDGET) {
  const maxP = frontier();
  const pages = state.searchIndex.filter(p => p.page <= maxP);
  if (!pages.length) return { text: '', pageNums: [] };
  const N = pages.length;
  const words = tokens(query || '');
  const picks = new Map(); // página → prioridad (menor = más importante)

  const add = (n, pr) => { if (n >= 1 && n <= maxP && !picks.has(n)) picks.set(n, pr); };
  add(state.pageNum, 0);
  add(state.pageNum - 1, 1);

  if (words.length) {
    const df = words.map(w => pages.reduce((c, p) => c + (p.fold.includes(w) ? 1 : 0), 0));
    const scored = pages.map(p => {
      let s = 0;
      words.forEach((w, i) => { const tf = countOcc(p.fold, w); if (tf) s += (1 + Math.log(tf)) * Math.log(1 + N / (1 + df[i])); });
      return { page: p.page, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
    scored.forEach((x, i) => add(x.page, 2 + i));
  }
  if (picks.size < 4) for (let k = 2; k <= 3; k++) add(state.pageNum - k, 8 + k);

  const ordered = [...picks.entries()].sort((a, b) => a[1] - b[1]);
  let used = 0; const chosen = [];
  for (const [n, pr] of ordered) {
    const pg = pages.find(p => p.page === n); if (!pg) continue;
    const cap = pr === 0 ? 4500 : 2800;
    const t = pg.text.slice(0, cap);
    if (used + t.length > budget && chosen.length) continue;
    used += t.length; chosen.push({ n, t });
  }
  chosen.sort((a, b) => a.n - b.n);
  return { text: chosen.map(c => `[Página ${c.n}]\n${c.t}`).join('\n\n'), pageNums: chosen.map(c => c.n) };
}

export function knownTerms(limit = 40) {
  const seen = new Set(), out = [];
  for (const g of state.glossary) { const k = fold(g.term); if (!seen.has(k)) { seen.add(k); out.push(g.term); } }
  for (const f of state.flashcards) { const k = fold(f.front); if (!seen.has(k)) { seen.add(k); out.push(f.front); } }
  return out.slice(0, limit).map(t => t.length > 40 ? t.slice(0, 40) + '…' : t);
}

/* Texto de una página alrededor de un término (para definiciones) */
export function passageAround(pageNum, term, before = 320, after = 420) {
  const pd = state.searchIndex.find(p => p.page === pageNum);
  if (!pd) return '';
  const i = pd.fold.indexOf(fold(term));
  if (i === -1) return pd.text.slice(0, 700);
  return pd.text.slice(Math.max(0, i - before), Math.min(pd.text.length, i + term.length + after));
}
