// Permite abrir la plataforma sin señal. Las encuestas se guardan en el teléfono (app.js) y se suben al volver la conexión.
const VERSION = 'obs-rcv-v1';
const APP = ['/plataforma/', '/plataforma/index.html', '/plataforma/styles.css', '/plataforma/app.js', '/plataforma/config.js',
  '/plataforma/logo.png', '/plataforma/icon-192.png', '/plataforma/manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.hostname.endsWith('supabase.co')) return; // datos siempre en vivo
  const propio = url.origin === self.location.origin;
  if (propio) {
    // Primero la red (para recibir actualizaciones); sin señal, la copia guardada
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(k => k.put(req, c)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('/plataforma/'))));
  } else if (/jsdelivr|googleapis|gstatic/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const c = res.clone(); caches.open(VERSION).then(k => k.put(req, c)); return res; })));
  }
});
