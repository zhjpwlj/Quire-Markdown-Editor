// One Set of blob: URLs per render. Never shared between renders (§M5).
const registries = new Map()

export function createBlobRegistry() {
  const renderId = crypto.randomUUID()
  const urls = new Set()
  registries.set(renderId, urls)
  return {
    renderId,
    track(url) {
      urls.add(url)
      return url
    },
  }
}

export function releaseBlobUrls(renderId) {
  const urls = registries.get(renderId)
  if (!urls) return 0
  for (const url of urls) URL.revokeObjectURL(url)
  const count = urls.size
  urls.clear()
  registries.delete(renderId)
  return count
}

// Read-only view for tests; mutating it does not affect revocation.
export function blobUrlsFor(renderId) {
  const urls = registries.get(renderId)
  return urls ? [...urls] : null
}
