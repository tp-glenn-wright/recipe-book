// Service worker: offline support and cache invalidation.
//
// VERSION, SHELL and ALL_URLS are substituted by tools/build.mjs. VERSION is a hash of
// the whole built output, so a deploy that changes anything rolls the cache exactly
// once. That is why the asset filenames stay stable and readable: this file, not a
// content hash in a filename, is the cache authority.

const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const ALL_URLS = __ALL_URLS__;

const CACHE = `recipe-book-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' bypasses the HTTP cache, so a deploy cannot be masked by a
    // stale copy the browser is still holding.
    await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith('recipe-book-') && name !== CACHE).map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

async function revalidate(request, cache) {
  try {
    const fresh = await fetch(request, { cache: 'no-cache' });
    if (fresh.ok && fresh.type === 'basic') await cache.put(request, fresh.clone());
  } catch {
    // Offline. The cached copy stands.
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) {
      event.waitUntil(revalidate(request, cache));
      return cached;
    }
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    } catch (error) {
      // A navigation with nothing cached: hand back the index so the app still opens
      // and can explain itself, rather than the browser's offline error page.
      if (request.mode === 'navigate') {
        const fallback = await cache.match('./') ?? await cache.match('./index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-all') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let cached = 0;
    for (const url of ALL_URLS) {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
        cached += 1;
      } catch {
        // Skip whatever cannot be fetched; the count reported back tells the truth.
      }
    }
    for (const client of await self.clients.matchAll()) {
      client.postMessage({ type: 'cache-all-done', cached, total: ALL_URLS.length });
    }
  })());
});
