/* Bump this name whenever the offline shell changes. Market APIs are NEVER cached here. */
const VERSION = 'stockpilot-shell-v3';
const SHELL = ['/', '/offline.html', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    // First page assets load before registration, so explicitly retain its
    // fingerprinted JS/CSS as well. Never put API responses into this cache.
    const response = await cache.match('/');
    const html = response ? await response.text() : '';
    const paths = [...new Set([...html.matchAll(/(?:src|href)="([^"\s]+)"/g)]
      .map(match => match[1]).filter(path => path.startsWith('/_next/static/')))];
    await Promise.all(paths.map(path => cache.add(path)));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('stockpilot-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put('/', copy)); }
      return response;
    }).catch(async () => (await caches.match('/')) || (await caches.match('/offline.html'))));
  } else if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(event.request, copy)); }
      return response;
    })));
  }
});
