// sw.js — Service Worker Gestione Movimentatori
// Nessuna cache: tutti i file vengono sempre scaricati freschi dal server.
// (Identico a CalPnt: garantisce che ogni caricamento usi l'ultima versione.)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => clients.claim())
));
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
// Nessun handler fetch: il browser usa sempre il network.
