// Quire service worker — shell precache only. Vault data is never cached here (Part 3.3).
// The asset list below is injected at build time.
const PRECACHE = __PRECACHE__
const CACHE = 'quire-shell-v1'

// CDNs (Cloudflare Pages, most static hosts) compress text with brotli/gzip. cache.addAll
// stores the decoded body but keeps the original Content-Encoding header, so replaying the
// entry fails as net::ERR_FAILED — for navigations the whole page dies. Rewrite each entry
// with encoding headers removed. Verified against the live Cloudflare deployment.
async function precache() {
  const cache = await caches.open(CACHE)
  await cache.addAll(PRECACHE)
  for (const request of await cache.keys()) {
    const response = await cache.match(request)
    const headers = new Headers(response.headers)
    for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'vary']) headers.delete(name)
    await cache.put(
      request,
      new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers }),
    )
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Network-first so a new shell is never stale; cache covers offline launch.
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || caches.match('/index.html')),
      ),
    )
    return
  }

  // Hashed assets are immutable, so cache-first is safe.
  // ignoreVary: hosts send Vary: Origin on JS/CSS, which otherwise misses the precache offline.
  // shortcut: old hashed assets linger under one cache name until the version bumps, upgrade when deploys get frequent.
  event.respondWith(caches.match(request, { ignoreVary: true }).then((hit) => hit || fetch(request)))
})
