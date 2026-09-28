// Service Worker - plain JS (no ES module imports allowed in SW context)
const CACHE_NAME = 'swinesync-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Notify clients to sync when triggered
self.addEventListener('sync', (event) => {
  if (event.tag === 'syncQueue') {
    event.waitUntil(
      self.clients.matchAll().then((clientList) => {
        clientList.forEach((client) => {
          client.postMessage({ type: 'SYNC_TRIGGERED' });
        });
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});