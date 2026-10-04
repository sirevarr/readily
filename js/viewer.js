/* Readily v2 — visor de PDF continuo (estilo Acrobat):
   desplazamiento vertical de todo el documento, zoom con pellizco / Ctrl+rueda, render nítido (HiDPI),
   selección precisa y subrayados calculados por línea. */
import { state, isTouch, isMobile } from './state.js';
import { MIN_SCALE, MAX_SCALE } from './config.js';
import { clamp, fold, sleep } from './util.js';

const pad = () => (isMobile() ? 8 : 22);
const gap = () => (isMobile() ? 8 : 14);

let viewer = null, pagesEl = null, pdf = null;
let pages = [];
let tops = [], scale = 1, zoomMode = 'fit-width';
let io = null, ro = null;
let queue = [], active = 0;
const want = new Set();
let destroyed = true;
let curPage = 1;
let cleanups = [];
const handlers = {};
export const on = (name, fn) => { handlers[name] = fn; };
const emit = (name, ...a) => handlers[name]?.(...a);

/* ============================ montaje ============================ */
export async function mount(container, pdfDoc, startPage = 1, savedZoom = 'fit-width') {
  unmount();
  destroyed = false;
  viewer = container;
  pdf = pdfDoc;
  viewer.innerHTML = '<div class="pages" id="pages"></div>';
  pagesEl = viewer.firstElementChild;
  zoomMode = savedZoom === 'fit-page' ? 'fit-page' : (typeof savedZoom === 'number' ? 'custom' : 'fit-width');

  const first = await pdf.getPage(1);
  const v1 = first.getViewport({ scale: 1 });
  pages = [];
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= pdf.numPages; i++) {
    const el = document.createElement('div');
    el.className = 'pg'; el.dataset.n = i;
    el.innerHTML = '<div class="pg-ph"><span>' + i + '</span></div>';
    frag.appendChild(el);
    pages.push({ num: i, el, w1: v1.width, h1: v1.height, token: 0, renderedScale: 0, inflightScale: 0, content: null, canvas: null, textLayer: null, hlLayer: null, srLayer: null, task: null });
  }
  pagesEl.appendChild(frag);

  scale = typeof savedZoom === 'number' ? savedZoom : computeFit(zoomMode, 0);
  layout();
  curPage = clamp(startPage, 1, pages.length);
  goTo(curPage, { instant: true });

  io = new IntersectionObserver(onIntersect, { root: viewer, rootMargin: '140% 0px 140% 0px' });
  pages.forEach(p => io.observe(p.el));

  viewer.addEventListener('scroll', onScroll, { passive: true });
  viewer.addEventListener('click', onClick);
  viewer.addEventListener('wheel', onWheel, { passive: false });
  viewer.addEventListener('touchstart', onTouchStart, { passive: false });
  viewer.addEventListener('touchmove', onTouchMove, { passive: false });
  viewer.addEventListener('touchend', onTouchEnd);
  viewer.addEventListener('touchcancel', onTouchEnd);
  viewer.addEventListener('pointerdown', onPointerDownText);
  document.addEventListener('pointerup', onPointerUpText);
  document.addEventListener('pointercancel', onPointerUpText);
  document.addEventListener('selectionchange', onSelChange);
  document.addEventListener('keydown', onKey);
  cleanups.push(() => {
    document.removeEventListener('pointerup', onPointerUpText);
    document.removeEventListener('pointercancel', onPointerUpText);
    document.removeEventListener('selectionchange', onSelChange);
    document.removeEventListener('keydown', onKey);
  });

  let roT;
  ro = new ResizeObserver(() => {
    clearTimeout(roT);
    roT = setTimeout(() => { if (!destroyed && zoomMode !== 'custom') applyScale(computeFit(zoomMode, curPage - 1), { keep: true }); }, 120);
  });
  ro.observe(viewer);

  prefetchSizes();
  emit('scale', scale, zoomMode);
}

export function unmount() {
  destroyed = true;
  cleanups.forEach(f => f()); cleanups = [];
  io?.disconnect(); ro?.disconnect(); io = ro = null;
  pages.forEach(p => { p.token++; try { p.task?.cancel(); } catch (_) {} });
  pages = []; queue = []; want.clear(); active = 0; tops = [];
  if (viewer) viewer.innerHTML = '';
  viewer = pagesEl = null;
}

async function prefetchSizes() {
  const n = pages.length;
  let dirty = false;
  for (let i = 2; i <= n; i++) {
    if (destroyed) return;
    try {
      const pg = await pdf.getPage(i);
      const v = pg.getViewport({ scale: 1 });
      const p = pages[i - 1];
      if (p && (Math.abs(p.w1 - v.width) > 0.5 || Math.abs(p.h1 - v.height) > 0.5)) { p.w1 = v.width; p.h1 = v.height; dirty = true; }
    } catch (_) {}
    if (i % 25 === 0 || i === n) { if (dirty) { relayoutKeepingAnchor(); dirty = false; } await sleep(0); }
  }
}

/* ============================ layout ============================ */
function layout() {
  const P = pad(), G = gap();
  let y = P; tops = [];
  pagesEl.style.padding = `${P}px ${P}px`;
  pagesEl.style.gap = G + 'px';
  for (const p of pages) {
    const w = Math.round(p.w1 * scale), h = Math.round(p.h1 * scale);
    p.el.style.width = w + 'px'; p.el.style.height = h + 'px';
    p.w = w; p.h = h;
    tops.push(y); y += h + G;
    if (p.content && p.renderedScale) {
      const k = scale / p.renderedScale;
      p.content.style.transform = Math.abs(k - 1) < 0.002 ? '' : `scale(${k})`;
    }
  }
}

function relayoutKeepingAnchor() {
  if (!viewer) return;
  const idx = pageIndexAt(viewer.scrollTop + viewer.clientHeight * 0.33);
  const frac = pages[idx] ? (viewer.scrollTop - tops[idx]) / pages[idx].h : 0;
  layout();
  viewer.scrollTop = tops[idx] + frac * pages[idx].h;
}

function computeFit(mode, idx) {
  const p = pages[clamp(idx, 0, pages.length - 1)] || pages[0];
  const availW = Math.max(100, viewer.clientWidth - pad() * 2 - (isMobile() ? 0 : 8));
  const sw = availW / p.w1;
  if (mode === 'fit-page') {
    const sh = Math.max(100, viewer.clientHeight - pad() * 2) / p.h1;
    return clamp(Math.min(sw, sh), MIN_SCALE, MAX_SCALE);
  }
  return clamp(sw, MIN_SCALE, MAX_SCALE);
}

function pageIndexAt(y) {
  let lo = 0, hi = tops.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}

export const getScale = () => scale;
export const getZoomMode = () => zoomMode;
export const currentPage = () => curPage;
export const pageCount = () => pages.length;
export const getContainer = () => viewer;
export function pageEl(n) { return pages[n - 1]?.el || null; }
export function getCanvas(n) { return pages[n - 1]?.canvas || null; }

/* ============================ navegación ============================ */
export function goTo(n, { frac = null, instant = false, rect = null } = {}) {
  if (!viewer || !pages.length) return;
  n = clamp(Math.round(n), 1, pages.length);
  const p = pages[n - 1];
  let top;
  if (rect) top = tops[n - 1] + rect.y * p.h - viewer.clientHeight * 0.32;
  else if (frac != null) top = tops[n - 1] + frac * p.h - viewer.clientHeight * 0.3;
  else top = tops[n - 1] - gap() / 2;
  const smooth = !instant && Math.abs(n - curPage) <= 2;
  viewer.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  setCurrent(n);
}

function setCurrent(n) {
  if (n === curPage) return;
  curPage = n;
  emit('page', n);
}

let scrollRaf = 0, lastTop = 0;
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (!viewer) return;
    const idx = pageIndexAt(viewer.scrollTop + viewer.clientHeight * 0.33);
    setCurrent(idx + 1);
    const dy = viewer.scrollTop - lastTop; lastTop = viewer.scrollTop;
    emit('scroll', { top: viewer.scrollTop, dy });
  });
}

/* ============================ render por demanda ============================ */
function onIntersect(entries) {
  for (const e of entries) {
    const p = pages[+e.target.dataset.n - 1];
    if (!p) continue;
    if (e.isIntersecting) { want.add(p); p.releaseAt = 0; request(p); }
    else { want.delete(p); if (p.content) p.releaseAt = Date.now() + 4000; scheduleRelease(); }
  }
}

let relT = 0;
function scheduleRelease() {
  clearTimeout(relT);
  relT = setTimeout(() => {
    const now = Date.now();
    for (const p of pages) if (p.content && !want.has(p) && p.releaseAt && p.releaseAt <= now) release(p);
  }, 4200);
}

function release(p) {
  p.token++;
  try { p.task?.cancel(); } catch (_) {}
  p.content?.remove(); p.content = p.canvas = p.textLayer = null;
  p.renderedScale = 0; p.el.classList.remove('done');
}

function request(p) {
  if (p.renderedScale === scale || p.inflightScale === scale) return;
  if (!queue.includes(p)) queue.push(p);
  pump();
}

function pump() {
  while (active < 2 && queue.length && !destroyed) {
    const c = viewer.scrollTop + viewer.clientHeight / 2;
    queue.sort((a, b) => Math.abs(tops[a.num - 1] + a.h / 2 - c) - Math.abs(tops[b.num - 1] + b.h / 2 - c));
    const p = queue.shift();
    if (!want.has(p) || p.renderedScale === scale) continue;
    active++;
    p.inflightScale = scale;
    renderPage(p).catch(() => {}).finally(() => { active--; p.inflightScale = 0; pump(); });
  }
}

function outScale(vp) {
  let o = Math.max(window.devicePixelRatio || 1, isTouch() ? 1 : 1.5);
  o = Math.min(o, 3);
  const maxPx = 16e6; // límite de memoria de canvas en iOS
  if (vp.width * vp.height * o * o > maxPx) o = Math.sqrt(maxPx / (vp.width * vp.height));
  return Math.max(o, 0.5);
}

async function renderPage(p) {
  const token = ++p.token;
  try { p.task?.cancel(); } catch (_) {}
  const target = scale;
  const page = await pdf.getPage(p.num);
  if (token !== p.token || destroyed) return;
  const vp = page.getViewport({ scale: target });
  if (Math.abs(vp.width / target - p.w1) > 0.5 || Math.abs(vp.height / target - p.h1) > 0.5) {
    p.w1 = vp.width / target; p.h1 = vp.height / target; relayoutKeepingAnchor();
  }
  const out = outScale(vp);
  const content = document.createElement('div');
  content.className = 'pg-c';
  content.style.width = vp.width + 'px'; content.style.height = vp.height + 'px';
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width * out); canvas.height = Math.floor(vp.height * out);
  canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
  content.appendChild(canvas);
  const task = page.render({
    canvasContext: canvas.getContext('2d', { alpha: false }),
    viewport: vp,
    transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined,
    background: 'rgb(255,255,255)',
  });
  p.task = task;
  try { await task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
  p.task = null;
  if (token !== p.token || destroyed) return;

  const tl = document.createElement('div');
  tl.className = 'textLayer';
  tl.style.setProperty('--scale-factor', target);
  content.appendChild(tl);
  const tc = await page.getTextContent();
  if (token !== p.token || destroyed) return;
  await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] }).promise;
  if (token !== p.token || destroyed) return;
  const eoc = document.createElement('div'); eoc.className = 'endOfContent'; tl.appendChild(eoc);

  p.content?.remove();
  p.el.insertBefore(content, p.el.firstChild);
  p.content = content; p.canvas = canvas; p.textLayer = tl; p.renderedScale = target;
  p.el.classList.add('done');
  const k = scale / target;
  content.style.transform = Math.abs(k - 1) < 0.002 ? '' : `scale(${k})`;
  drawHighlights(p.num);
  drawSearch(p.num);
  onPageRenderedInternal(p.num);
  emit('rendered', p.num);
}

/* ============================ zoom ============================ */
let gesture = null;

function beginGesture(ax, ay) {
  const vr = viewer.getBoundingClientRect();
  const idx = pageIndexAt(viewer.scrollTop + ay);
  const pr = pages[idx].el.getBoundingClientRect();
  const sr = pagesEl.getBoundingClientRect();
  gesture = {
    k: 1, startScale: scale, ax0: ax, ay0: ay, ax, ay, idx,
    fx: (vr.left + ax - pr.left) / pr.width,
    fy: (vr.top + ay - pr.top) / pr.height,
  };
  pagesEl.style.transformOrigin = `${vr.left + ax - sr.left}px ${vr.top + ay - sr.top}px`;
  pagesEl.classList.add('zooming');
}

function updateGesture(k, ax, ay) {
  if (!gesture) return;
  const target = clamp(gesture.startScale * k, MIN_SCALE, MAX_SCALE);
  gesture.k = target / gesture.startScale;
  gesture.ax = ax; gesture.ay = ay;
  pagesEl.style.transform = `translate(${ax - gesture.ax0}px, ${ay - gesture.ay0}px) scale(${gesture.k})`;
}

function commitGesture() {
  if (!gesture) return;
  const g = gesture; gesture = null;
  pagesEl.style.transform = ''; pagesEl.style.transformOrigin = '';
  pagesEl.classList.remove('zooming');
  const newScale = g.startScale * g.k;
  if (Math.abs(g.k - 1) < 0.01) return;
  zoomMode = 'custom';
  applyScale(newScale, { anchor: g });
}

function applyScale(s, { anchor = null, keep = false } = {}) {
  s = clamp(s, MIN_SCALE, MAX_SCALE);
  let idx, frac;
  if (keep && !anchor) { idx = pageIndexAt(viewer.scrollTop + viewer.clientHeight * 0.33); frac = (viewer.scrollTop - tops[idx]) / pages[idx].h; }
  if (Math.abs(s - scale) < 0.0005 && !anchor) { emit('scale', scale, zoomMode); return; }
  scale = s;
  for (const p of pages) if (p.inflightScale && p.inflightScale !== scale) { p.token++; try { p.task?.cancel(); } catch (_) {} }
  layout();
  if (anchor) {
    const vr = viewer.getBoundingClientRect();
    const pr = pages[anchor.idx].el.getBoundingClientRect();
    viewer.scrollTop += pr.top + anchor.fy * pr.height - (vr.top + anchor.ay);
    viewer.scrollLeft += pr.left + anchor.fx * pr.width - (vr.left + anchor.ax);
  } else if (keep) {
    viewer.scrollTop = tops[idx] + frac * pages[idx].h;
  }
  for (const p of want) request(p);
  emit('scale', scale, zoomMode);
  persistZoom();
}

function persistZoom() { emit('zoomSave', zoomMode === 'custom' ? scale : zoomMode); }

export function setZoomMode(mode) {
  zoomMode = mode;
  applyScale(computeFit(mode, curPage - 1), { keep: true });
}
export function zoomBy(factor, ax, ay) {
  if (!viewer) return;
  const vr = viewer.getBoundingClientRect();
  beginGesture(ax ?? vr.width / 2, ay ?? vr.height / 2);
  const g = gesture; gesture = null; pagesEl.classList.remove('zooming'); pagesEl.style.transformOrigin = '';
  zoomMode = 'custom';
  applyScale(g.startScale * factor, { anchor: g });
}
export function zoomTo(s) { zoomBy(clamp(s, MIN_SCALE, MAX_SCALE) / scale); }
export function stepZoom(dir) {
  const steps = [0.4, 0.55, 0.7, 0.85, 1, 1.15, 1.33, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
  const cur = scale;
  const next = dir > 0 ? steps.find(v => v > cur * 1.03) : [...steps].reverse().find(v => v < cur * 0.97);
  zoomTo(next ?? cur);
}

function onWheel(e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const vr = viewer.getBoundingClientRect();
  if (!gesture) beginGesture(e.clientX - vr.left, e.clientY - vr.top);
  updateGesture(gesture.k * Math.exp(-e.deltaY * 0.0025), gesture.ax0, gesture.ay0);
  clearTimeout(onWheel.t);
  onWheel.t = setTimeout(commitGesture, 140);
}

let pinch = null;
const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
function onTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const [a, b] = e.touches;
    const vr = viewer.getBoundingClientRect();
    pinch = { d0: dist(a, b) };
    if (gesture) commitGesture();
    beginGesture((a.clientX + b.clientX) / 2 - vr.left, (a.clientY + b.clientY) / 2 - vr.top);
    hideNativeSelection();
  }
}
function onTouchMove(e) {
  if (pinch && e.touches.length === 2) {
    e.preventDefault();
    const [a, b] = e.touches;
    const vr = viewer.getBoundingClientRect();
    updateGesture(dist(a, b) / pinch.d0, (a.clientX + b.clientX) / 2 - vr.left, (a.clientY + b.clientY) / 2 - vr.top);
  }
}
function onTouchEnd(e) {
  if (pinch && e.touches.length < 2) { pinch = null; commitGesture(); }
}
function hideNativeSelection() { try { getSelection().removeAllRanges(); } catch (_) {} emit('selection', null); }

function onKey(e) {
  if (!viewer) return;
  if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;

  if (e.ctrlKey || e.metaKey) {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1); }
    else if (e.key === '-') { e.preventDefault(); stepZoom(-1); }
    else if (e.key === '0') { e.preventDefault(); setZoomMode('fit-width'); }
    return;
  }

  if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
    e.preventDefault();
    viewer.scrollBy({ top: viewer.clientHeight * 0.85, behavior: 'smooth' });
  } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
    e.preventDefault();
    viewer.scrollBy({ top: -viewer.clientHeight * 0.85, behavior: 'smooth' });
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    goTo(curPage + 1);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    goTo(curPage - 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    goTo(1);
  } else if (e.key === 'End') {
    e.preventDefault();
    goTo(pages.length);
  }
}

/* ============================ resaltados ============================ */
function ensureLayer(p, key, cls) {
  if (!p[key]) { const d = document.createElement('div'); d.className = cls; p.el.appendChild(d); p[key] = d; }
  return p[key];
}

export function drawHighlights(num) {
  const p = pages[num - 1]; if (!p) return;
  const layer = ensureLayer(p, 'hlLayer', 'hl-layer');
  let html = '';
  for (const h of state.highlights) {
    if (h.page !== num) continue;
    for (const r of h.rects) html += `<i class="hl-rect" data-hid="${h.id}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;background:${h.color}"></i>`;
  }
  layer.innerHTML = html;
}
export function redrawAllHighlights() { pages.forEach(p => { if (p.hlLayer || state.highlights.some(h => h.page === p.num)) drawHighlights(p.num); }); }

export function flashHighlight(id) {
  const els = pagesEl?.querySelectorAll(`.hl-rect[data-hid="${id}"]`);
  els?.forEach(el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); });
}

export function scrollToHighlight(h) {
  const r = h.rects?.[0];
  goTo(h.page, r ? { rect: r } : {});
  setTimeout(() => flashHighlight(h.id), 350);
}

function onClick(e) {
  const sel = getSelection();
  if (sel && !sel.isCollapsed) return;
  const pg = e.target.closest?.('.pg'); if (!pg) return;
  const num = +pg.dataset.n;
  const b = pg.getBoundingClientRect();
  const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
  const tol = 0.004;
  const hit = state.highlights.find(h => h.page === num && h.rects.some(r => x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol));
  if (hit) emit('highlightTap', hit, { x: e.clientX, y: e.clientY });
  else emit('tapEmpty', e);
}

/* ============================ búsqueda en página ============================ */
function textNodes(tl) {
  if (tl._nodes) return tl._nodes;
  const w = document.createTreeWalker(tl, NodeFilter.SHOW_TEXT);
  const out = []; let n;
  while ((n = w.nextNode())) if (n.nodeValue) out.push(n);
  tl._nodes = out; return out;
}

function layerIndex(tl) {
  if (tl._idx) return tl._idx;
  const nodes = textNodes(tl);
  let s = ''; const map = [];
  let lastSpace = true, prev = null;
  nodes.forEach((node, ni) => {
    const r = node.parentElement.getBoundingClientRect();
    if (prev) {
      const sameLine = Math.abs(r.top - prev.top) < Math.max(r.height, prev.height) * 0.5;
      const gapPx = r.left - prev.right;
      if ((!sameLine || gapPx > r.height * 0.2) && !lastSpace) { s += ' '; map.push([ni, 0]); lastSpace = true; }
    }
    const t = node.nodeValue;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (/\s/.test(c)) { if (!lastSpace) { s += ' '; map.push([ni, i]); lastSpace = true; } }
      else { s += (c.normalize('NFD')[0] || c).toLowerCase()[0] || c; map.push([ni, i]); lastSpace = false; }
    }
    prev = r;
  });
  tl._idx = { s, map, nodes };
  return tl._idx;
}

function findInLayer(tl, needle) {
  const { s, map, nodes } = layerIndex(tl);
  const out = [];
  if (!needle) return out;
  let i = 0;
  while ((i = s.indexOf(needle, i)) !== -1) {
    const a = map[i], b = map[i + needle.length - 1];
    if (a && b) {
      const range = document.createRange();
      range.setStart(nodes[a[0]], a[1]);
      range.setEnd(nodes[b[0]], Math.min(b[1] + 1, nodes[b[0]].nodeValue.length));
      out.push(range);
    }
    i += needle.length;
  }
  return out;
}

function rangeRectsNorm(range, tl) {
  const pb = tl.getBoundingClientRect();
  const raw = Array.from(range.getClientRects()).filter(r => r.width > 0.5 && r.height > 0.5);
  return mergeRects(raw).map(r => ({ x: (r.left - pb.left) / pb.width, y: (r.top - pb.top) / pb.height, w: (r.right - r.left) / pb.width, h: (r.bottom - r.top) / pb.height }));
}

export function drawSearch(num) {
  const p = pages[num - 1]; if (!p) return;
  const layer = ensureLayer(p, 'srLayer', 'sr-layer');
  layer.innerHTML = '';
  p.matchCount = 0;
  const q = state.searchOpen ? fold(state.searchQuery.trim()).replace(/\s+/g, ' ') : '';
  if (!q || q.length < 2 || !p.textLayer) return;
  const ranges = findInLayer(p.textLayer, q);
  p.matchCount = ranges.length;
  const cur = state.searchCur && state.searchCur.page === num ? state.searchCur.nth : -1;
  let html = '';
  ranges.forEach((rg, i) => {
    for (const r of rangeRectsNorm(rg, p.textLayer)) html += `<i class="sr-rect ${i === cur ? 'cur' : ''}" data-n="${i}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"></i>`;
  });
  layer.innerHTML = html;
}
export function redrawAllSearch() { pages.forEach(p => { if (p.textLayer || p.srLayer) drawSearch(p.num); }); }

export function revealSearchHit(num, nth) {
  const p = pages[num - 1]; if (!p) return;
  const go = () => {
    drawSearch(num);
    const el = p.srLayer?.querySelector(`.sr-rect[data-n="${Math.min(nth, Math.max(0, (p.matchCount || 1) - 1))}"]`);
    if (el && viewer) {
      const r = el.getBoundingClientRect(), vr = viewer.getBoundingClientRect();
      const inView = r.top > vr.top + 60 && r.bottom < vr.bottom - 60;
      if (!inView) viewer.scrollTo({ top: viewer.scrollTop + (r.top - vr.top) - viewer.clientHeight * 0.35, behavior: 'auto' });
    }
  };
  if (p.textLayer) go(); else { goTo(num); pendingReveal = { num, go }; }
}
let pendingReveal = null;

/* Resalta un texto citado (desde el chat) durante unos segundos */
export function flashText(num, text) {
  const p = pages[num - 1]; if (!p) return;
  const run = () => {
    const full = fold(text).replace(/\s+/g, ' ').trim();
    const attempts = [full.slice(0, 120), full.slice(0, 60), full.slice(0, 30)].filter(s => s.length >= 8);
    let ranges = [];
    for (const a of attempts) { ranges = findInLayer(p.textLayer, a); if (ranges.length) break; }
    if (!ranges.length) return false;
    const layer = ensureLayer(p, 'srLayer', 'sr-layer');
    const rects = rangeRectsNorm(ranges[0], p.textLayer);
    layer.insertAdjacentHTML('beforeend', rects.map(r => `<i class="sr-rect flash" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"></i>`).join(''));
    if (rects[0]) goTo(num, { rect: rects[0] });
    setTimeout(() => layer.querySelectorAll('.sr-rect.flash').forEach(el => el.remove()), 4000);
    return true;
  };
  if (p.textLayer) { if (!run()) goTo(num); }
  else { goTo(num); flashQueue.set(num, run); }
}
const flashQueue = new Map();
function onPageRenderedInternal(num) {
  const f = flashQueue.get(num);
  if (f) { flashQueue.delete(num); setTimeout(f, 50); }
  if (pendingReveal && pendingReveal.num === num) { const pr = pendingReveal; pendingReveal = null; setTimeout(pr.go, 30); }
}

/* ============================ selección precisa ============================ */
function mergeRects(rs) {
  const lines = [];
  const sorted = rs.map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })).sort((a, b) => (a.top - b.top) || (a.left - b.left));
  for (const r of sorted) {
    const h = r.bottom - r.top;
    let merged = false;
    for (const L of lines) {
      const lh = L.bottom - L.top;
      const ov = Math.min(L.bottom, r.bottom) - Math.max(L.top, r.top);
      if (ov > 0.55 * Math.min(h, lh) && r.left <= L.right + 0.9 * Math.max(h, lh) && r.right >= L.left - 0.9 * Math.max(h, lh)) {
        L.left = Math.min(L.left, r.left); L.right = Math.max(L.right, r.right);
        L.top = Math.min(L.top, r.top); L.bottom = Math.max(L.bottom, r.bottom);
        merged = true; break;
      }
    }
    if (!merged) lines.push(r);
  }
  return lines;
}

function pieceFromRange(range, tl) {
  const nodes = textNodes(tl);
  const rects = [];
  let text = '', prev = null;
  for (const node of nodes) {
    if (!range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
    if (start >= end) continue;
    const sub = document.createRange();
    sub.setStart(node, start); sub.setEnd(node, end);
    const rs = Array.from(sub.getClientRects()).filter(r => r.width > 0.5 && r.height > 0.5);
    if (!rs.length) continue;
    rects.push(...rs);
    const chunk = node.nodeValue.slice(start, end);
    const r0 = rs[0];
    if (prev) {
      const newLine = Math.abs(r0.top - prev.top) > Math.min(r0.height, prev.height) * 0.5;
      const gapPx = r0.left - prev.right;
      if (newLine) {
        if (/[-‐]$/.test(text) && /^[a-záéíóúñü]/i.test(chunk)) text = text.slice(0, -1);
        else if (!/\s$/.test(text) && !/^\s/.test(chunk)) text += ' ';
      } else if (gapPx > r0.height * 0.2 && !/\s$/.test(text) && !/^\s/.test(chunk)) text += ' ';
    }
    text += chunk;
    prev = rs[rs.length - 1];
  }
  if (!rects.length) return null;
  const pb = tl.getBoundingClientRect();
  const merged = mergeRects(rects).map(r => ({ x: (r.left - pb.left) / pb.width, y: (r.top - pb.top) / pb.height, w: (r.right - r.left) / pb.width, h: (r.bottom - r.top) / pb.height }));
  return { rects: merged, text: text.replace(/\s+/g, ' ').trim() };
}

let selT = 0;
function onSelChange() {
  clearTimeout(selT);
  selT = setTimeout(evalSelection, isTouch() ? 420 : 260);
}

export function evalSelection() {
  if (!viewer) return;
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) { emit('selection', null); return; }
  const range = sel.getRangeAt(0);
  if (!viewer.contains(range.commonAncestorContainer)) { emit('selection', null); return; }
  const layers = Array.from(pagesEl.querySelectorAll('.textLayer')).filter(l => range.intersectsNode(l));
  const pieces = [];
  for (const tl of layers) {
    const piece = pieceFromRange(range, tl);
    if (piece && piece.text) pieces.push({ page: +tl.closest('.pg').dataset.n, ...piece });
  }
  if (!pieces.length) { emit('selection', null); return; }
  const rs = Array.from(range.getClientRects()).filter(r => r.width > 0.5 && r.height > 0.5);
  const first = rs[0], last = rs[rs.length - 1];
  emit('selection', {
    pieces, text: pieces.map(p => p.text).join(' '),
    bounds: range.getBoundingClientRect(), first, last,
  });
}
export function clearSelection() { try { getSelection().removeAllRanges(); } catch (_) {} }

/* Truco de pdf.js: evita que la selección "salte" al arrastrar el ratón entre líneas */
function onPointerDownText(e) {
  const tl = e.target.closest?.('.textLayer'); if (!tl) return;
  const end = tl.querySelector('.endOfContent'); if (!end) return;
  end.classList.add('active');
  if (e.target !== tl && !/firefox/i.test(navigator.userAgent)) {
    const b = tl.getBoundingClientRect();
    end.style.top = (Math.max(0, (e.clientY - b.top) / b.height) * 100).toFixed(2) + '%';
  }
}
function onPointerUpText() {
  pagesEl?.querySelectorAll('.endOfContent.active').forEach(el => { el.classList.remove('active'); el.style.top = ''; });
}

/* ============================ API de bajo nivel para otros módulos ============================ */
export function pagePoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY)?.closest?.('.pg');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { page: +el.dataset.n, x: (clientX - b.left) / b.width, y: (clientY - b.top) / b.height, el };
}
export function rangeToRects(range, num) {
  const p = pages[num - 1]; if (!p?.textLayer) return [];
  return rangeRectsNorm(range, p.textLayer);
}
