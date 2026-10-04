/* Readily v2 — Service Worker con soporte offline completo */
const CACHE_NAME = 'readily-v2';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/proyecto.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/css/style.css',
  '/vendor/supabase.js',
  '/vendor/pdf.min.js',
  '/vendor/pdf.worker.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Permitir que peticiones a Supabase / Gemini externas vayan directo a la red
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navegación HTML: intentar red primero, fallback a caché
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(url.pathname) || caches.match('/proyecto.html') || caches.match('/index.html'))
    );
    return;
  }

  // Recursos estáticos locales (JS, CSS, vendor, imágenes): cache-first con revalidación
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
