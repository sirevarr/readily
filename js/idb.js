/* Readily v2 — almacenamiento local (IndexedDB): caché, PDFs sin conexión y cola de sincronización */

const DB_NAME = 'readily-v2';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB no disponible'));
    const timer = setTimeout(() => reject(new Error('IndexedDB timeout')), 2000);
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      };
      r.onsuccess = () => { clearTimeout(timer); resolve(r.result); };
      r.onerror = () => { clearTimeout(timer); reject(r.error); };
      r.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB bloqueada')); };
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const rq = fn(s);
    if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// Si IndexedDB falla (modo privado, cuota) la app sigue funcionando solo con la red.
export const get  = (k, store = 'kv') => tx(store, 'readonly',  s => s.get(k)).catch(() => undefined);
export const set  = (k, v, store = 'kv') => tx(store, 'readwrite', s => s.put(v, k)).catch(() => {});
export const del  = (k, store = 'kv') => tx(store, 'readwrite', s => s.delete(k)).catch(() => {});
export const keys = (store = 'kv') => tx(store, 'readonly', s => s.getAllKeys()).catch(() => []);

export const outboxAdd = (op) => tx('outbox', 'readwrite', s => s.add(op)).catch(() => {});
export const outboxAll = () => tx('outbox', 'readonly', s => s.getAll()).catch(() => []);
export const outboxRemove = (seq) => tx('outbox', 'readwrite', s => s.delete(seq)).catch(() => {});
export const outboxClear = () => tx('outbox', 'readwrite', s => s.clear()).catch(() => {});

export async function estimate() {
  try { const e = await navigator.storage.estimate(); return e; } catch (_) { return null; }
}
