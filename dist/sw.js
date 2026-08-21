/* 离线缓存 Service Worker（仅生产构建启用）
 * 采用「运行时缓存 + 预缓存 index/manifest/icon」。数据始终在 IndexedDB，离线读写在本地完成。
 */
const CACHE = 'moba-simulator-v1';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      if (res.ok && new URL(request.url).origin === location.origin) caches.open(CACHE).then((c) => c.put(request, copy));
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});