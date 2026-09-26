// アプリが生成した USDZ(Cache Storage の 'usdz')を通常の URL で返す
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!url.pathname.includes('/usdz/')) return;
  e.respondWith(
    caches.open('usdz')
      .then((c) => c.match(url.origin + url.pathname))
      .then((r) => r || new Response('not found', { status: 404 })),
  );
});
