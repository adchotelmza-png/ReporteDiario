/* Service worker de Registro Diario.
   Estrategia "red primero": siempre intenta traer la versión más nueva desde internet y
   solo usa la copia guardada si no hay conexión. Así las actualizaciones que subís a GitHub
   llegan siempre, sin quedarse con archivos viejos. Los datos (Firestore) nunca se guardan aquí. */
const CACHE = 'registro-diario-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;   // Firebase, CDN, etc.: pasan directo
    e.respondWith(
        fetch(req)
            .then(res => {
                if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
                return res;
            })
            .catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') || caches.match('./') : undefined)))
    );
});
