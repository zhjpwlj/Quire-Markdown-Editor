// Quire service worker — shell precache only. Vault data is never cached here (Part 3.3).
// The asset list below is injected at build time.
const PRECACHE = __PRECACHE__
const CACHE = 'quire-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
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
  // ignoreVary: hosts and CDNs send Vary: Origin on JS/CSS; without this, crossorigin-tagged
  // assets miss the precache offline (verified in Chromium).
  // shortcut: old hashed assets linger under one cache name until the version bumps, upgrade when deploys get frequent.
  event.respondWith(caches.match(request, { ignoreVary: true }).then((hit) => hit || fetch(request)))
})
