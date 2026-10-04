/* Readily v2 — cliente de Gemini con rotación de modelos, reintentos y caché.
   Objetivo: que "muy demandado" y "límite de peticiones" aparezcan lo menos posible. */
import { state } from './state.js';
import { GEMINI_BASE, DEFAULT_MODEL, LS } from './config.js';
import * as idb from './idb.js';
import { sleep } from './util.js';

export class AIError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

/* ---------- Modelos disponibles para esta clave ---------- */
const BAD_MODEL = /(image|tts|audio|live|embed|imagen|veo|robotics|computer|exp-|learnlm|nano|banana|customtools|gemma|thinking)/i;

function versionOf(name) { const m = name.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; }

function rankModels(names) {
  const flash = [...new Set(names)].filter(n => /^gemini/.test(n) && /flash/.test(n) && !BAD_MODEL.test(n));
  const isLite = n => /lite/.test(n);
  const isAlias = n => /latest$/.test(n);
  flash.sort((a, b) => (isAlias(a) - isAlias(b)) || (isLite(a) - isLite(b)) || (versionOf(b) - versionOf(a)) || a.localeCompare(b));
  const list = flash.slice(0, 7);
  if (flash.includes(DEFAULT_MODEL)) return [DEFAULT_MODEL, ...list.filter(n => n !== DEFAULT_MODEL)];
  return list;
}

const FALLBACK_MODELS = [DEFAULT_MODEL, 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

export async function listModels(force = false) {
  if (!force) {
    try {
      const o = JSON.parse(localStorage.getItem(LS.models) || 'null');
      if (o && Date.now() - o.ts < 24 * 3600e3 && o.list?.length && o.key === state.geminiKey.slice(-6)) return o.list;
    } catch (_) {}
  }
  try {
    const r = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': state.geminiKey } });
    if (r.ok) {
      const d = await r.json();
      const names = (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
      const list = rankModels(names);
      if (list.length) {
        localStorage.setItem(LS.models, JSON.stringify({ ts: Date.now(), list, key: state.geminiKey.slice(-6) }));
        return list;
      }
    }
  } catch (_) {}
  return FALLBACK_MODELS;
}

function dropModel(name) {
  try {
    const o = JSON.parse(localStorage.getItem(LS.models) || 'null');
    if (o?.list) { o.list = o.list.filter(m => m !== name); localStorage.setItem(LS.models, JSON.stringify(o)); }
  } catch (_) {}
}

/* ---------- Enfriamiento por modelo (cada modelo tiene su propia cuota) ---------- */
const cdRead = () => { try { return JSON.parse(localStorage.getItem(LS.cooldown) || '{}'); } catch (_) { return {}; } };
function cdSet(model, ms, why) {
  const o = cdRead(); o[model] = { until: Date.now() + ms, why };
  localStorage.setItem(LS.cooldown, JSON.stringify(o));
}
export async function modelStatus() {
  const list = await listModels();
  const o = cdRead(), now = Date.now();
  return list.map(m => ({ model: m, until: o[m]?.until > now ? o[m].until : 0, why: o[m]?.until > now ? o[m].why : '' }));
}
export function resetCooldowns() { localStorage.removeItem(LS.cooldown); }

function parseQuota(err) {
  let day = false, ms = 0;
  const details = err?.details || [];
  for (const d of details) {
    const t = d['@type'] || '';
    if (/QuotaFailure/.test(t)) for (const v of (d.violations || [])) {
      if (/PerDay/i.test(v.quotaId || '') || /per day/i.test(v.quotaMetric || '')) day = true;
    }
    if (/RetryInfo/.test(t) && d.retryDelay) ms = Math.max(ms, parseFloat(d.retryDelay) * 1000);
  }
  const msg = err?.message || '';
  if (!ms) { const m = msg.match(/retry in ([\d.]+)s/i); if (m) ms = parseFloat(m[1]) * 1000; }
  if (/per day|daily|PerDay/i.test(msg)) day = true;
  if (/limit:\s*0/.test(msg)) day = true; // el modelo no está disponible en tu plan
  if (day) ms = Math.max(ms, 6 * 3600e3);
  return { day, ms: ms || 30000 };
}

/* ---------- Cola: una petición cada vez, con pausa mínima ---------- */
let chain = Promise.resolve();
let lastAt = 0;
const MIN_GAP = 450;

export function ask(opts) {
  return new Promise((resolve, reject) => {
    chain = chain.then(async () => {
      const wait = lastAt + MIN_GAP - Date.now();
      if (wait > 0) await sleep(wait);
      try { resolve(await run(opts)); } catch (e) { reject(e); }
      lastAt = Date.now();
    });
  });
}

function extract(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
}

async function run(o) {
  if (!state.geminiKey) throw new AIError('nokey', 'Falta la clave de Gemini. Actívala en Ajustes.');
  if (o.cacheKey) {
    const c = await idb.get('ai:' + o.cacheKey);
    if (c?.text) return { text: c.text, model: c.model, cached: true };
  }
  if (!navigator.onLine) throw new AIError('offline', 'Sin conexión. Esta función necesita internet.');

  const models = await listModels();
  const cd = cdRead(), now = Date.now();
  const ready = models.filter(m => !(cd[m]?.until > now));
  const resting = models.filter(m => cd[m]?.until > now && cd[m].why !== 'day');
  const order = [...ready, ...resting];

  const body = {
    contents: o.contents || [{ role: 'user', parts: o.parts || [{ text: o.prompt }] }],
    generationConfig: { temperature: o.temperature ?? 0.6 },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (o.json) body.generationConfig.responseMimeType = 'application/json';
  if (o.maxTokens) body.generationConfig.maxOutputTokens = o.maxTokens;

  const t0 = Date.now();
  let busy = false, quota = false, other = null, tried = 0;

  for (const m of order) {
    tried++;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res, data;
      try {
        res = await fetch(`${GEMINI_BASE}/models/${m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.geminiKey },
          body: JSON.stringify(body),
        });
        data = await res.json().catch(() => ({}));
      } catch (e) { throw new AIError('network', 'No se pudo conectar con Gemini. Revisa tu conexión.'); }

      if (res.ok) {
        const text = extract(data);
        if (text) {
          state.lastModel = m;
          if (o.cacheKey) idb.set('ai:' + o.cacheKey, { text, model: m, ts: Date.now() });
          return { text, model: m };
        }
        other = new AIError('empty', data?.promptFeedback?.blockReason ? 'Gemini no pudo responder a este contenido.' : 'Gemini respondió vacío. Intenta de nuevo.');
        break;
      }
      const err = data?.error || {};
      const status = res.status;
      if (status === 400 && /API key|API_KEY/i.test(err.message || '')) throw new AIError('key', 'La clave de Gemini no es válida. Revísala en Ajustes.');
      if (status === 401 || status === 403) throw new AIError('key', 'Gemini rechazó la clave (' + (err.message || status) + '). Revísala en Ajustes.');
      if (status === 404) { dropModel(m); break; }
      if (status === 429) {
        quota = true;
        const q = parseQuota(err);
        cdSet(m, q.ms, q.day ? 'day' : 'min');
        break;
      }
      if (status >= 500) {
        busy = true;
        if (attempt === 0 && Date.now() - t0 < 12000) { await sleep(900 + Math.random() * 700); continue; }
        cdSet(m, 20000, 'busy');
        break;
      }
      other = new AIError('other', err.message || ('Error ' + status));
      break;
    }
  }

  const cdNow = cdRead();
  const allDay = models.length && models.every(m => cdNow[m]?.until > Date.now() && cdNow[m].why === 'day');
  const soonest = Math.min(...models.map(m => cdNow[m]?.until > Date.now() ? cdNow[m].until : Infinity));
  const retryAfter = isFinite(soonest) ? Math.max(3, Math.ceil((soonest - Date.now()) / 1000)) : 15;
  if (quota && allDay) throw new AIError('quotaDay', 'Se agotó la cuota gratuita de hoy en todos los modelos disponibles. Se renueva por la noche (hora del Pacífico).', { retryAfter });
  if (quota && !busy) throw new AIError('quota', `Límite de peticiones alcanzado (probé ${tried} modelo${tried !== 1 ? 's' : ''}). Reintenta en ${retryAfter}s.`, { retryAfter });
  if (busy || quota) throw new AIError('busy', `Gemini está muy demandado ahora mismo (probé ${tried} modelo${tried !== 1 ? 's' : ''}). Reintenta en unos segundos.`, { retryAfter: Math.min(retryAfter, 20) });
  throw other || new AIError('other', 'No se pudo obtener respuesta de Gemini.');
}

export async function askJSON(o) {
  const r = await ask({ ...o, json: true });
  const t = r.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return { data: JSON.parse(t), model: r.model, cached: r.cached }; }
  catch (_) {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) { try { return { data: JSON.parse(m[0]), model: r.model, cached: r.cached }; } catch (_) {} }
    throw new AIError('other', 'La respuesta de Gemini no tuvo el formato esperado.');
  }
}

export async function testConnection() {
  const r = await ask({ prompt: 'Responde solo con la palabra: listo', temperature: 0 });
  return r.model;
}

/* Texto amigable para mostrar en pantalla */
export function errorText(e) {
  if (e instanceof AIError) return e.message;
  return 'Error: ' + (e?.message || e);
}

/* Cuadro de error con botón de reintento y cuenta atrás */
export function errorBox(e, retryLabel = 'Reintentar') {
  const wait = e?.retryAfter && e.kind !== 'quotaDay' ? e.retryAfter : 0;
  const canRetry = !['nokey', 'key', 'quotaDay'].includes(e?.kind);
  return `<div class="ai-error">
    <div class="ai-error-msg">${errorText(e).replace(/</g, '&lt;')}</div>
    ${canRetry ? `<button class="btn small primary" data-ai-retry ${wait ? 'disabled' : ''}>${retryLabel}${wait ? ` (${wait}s)` : ''}</button>` : ''}
  </div>`;
}

export function bindErrorBox(root, onRetry, e) {
  const btn = root.querySelector('[data-ai-retry]');
  if (!btn) return;
  let left = e?.retryAfter && e.kind !== 'quotaDay' ? e.retryAfter : 0;
  const label = btn.textContent.replace(/\s*\(\d+s\)$/, '');
  const tick = () => {
    if (!btn.isConnected) return;
    if (left > 0) { btn.disabled = true; btn.textContent = `${label} (${left}s)`; left--; setTimeout(tick, 1000); }
    else { btn.disabled = false; btn.textContent = label; }
  };
  tick();
  btn.onclick = onRetry;
}
