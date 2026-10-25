// Build assertions for Milestone 1. No browser needed; catches the shell regressions
// that a silent build would otherwise ship.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import assert from 'node:assert/strict'

const DIST = 'dist'
assert.ok(existsSync(DIST), 'dist/ missing — run npm run build first')

const read = (path) => readFileSync(join(DIST, path), 'utf8')
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push('/' + relative(DIST, path).split('\\').join('/'))
  }
  return out
}
const files = walk(DIST)

const PNG_ORIGINS = [
  'https://github.com',
  'https://api.github.com',
  'https://gitlab.com',
  'https://oauth2.googleapis.com',
  'https://www.googleapis.com',
  'https://login.microsoftonline.com',
  'https://graph.microsoft.com',
  'https://api.dropboxapi.com',
  'https://content.dropboxapi.com',
  'https://api.box.com',
  'https://upload.box.com',
  'https://apis.google.com',
  'https://api.netlify.com',
  'https://public-api.wordpress.com',
]

// --- shell ---
const html = read('index.html')
assert.ok(!html.includes('__CSP__'), 'CSP placeholder left unreplaced')
assert.ok(!html.includes('__PRECACHE__'), 'precache placeholder leaked into HTML')
assert.match(html, /viewport-fit=cover/, 'viewport-fit=cover missing')
assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/, 'status bar meta missing')
assert.match(html, /apple-mobile-web-app-title" content="Quire"/, 'apple title missing')
assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/, 'manifest link missing')
assert.match(html, /rel="apple-touch-icon"/, 'apple-touch-icon missing')
for (const origin of PNG_ORIGINS) {
  assert.ok(html.includes(origin), `CSP missing ${origin}`)
}
assert.ok(!/\bws:\/\//.test(html), 'dev-only ws: origin leaked into the built CSP')

// --- manifest (§2.1) ---
const manifest = JSON.parse(read('manifest.webmanifest'))
assert.equal(manifest.name, 'Quire')
assert.equal(manifest.short_name, 'Quire')
assert.equal(manifest.id, '/')
assert.equal(manifest.start_url, '/')
assert.equal(manifest.scope, '/')
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.theme_color, '#0e0e11')
assert.equal(manifest.background_color, '#0e0e11')
assert.ok(!manifest.display_override, 'display_override must stay unset')
assert.deepEqual(
  manifest.icons.map((icon) => [icon.sizes, icon.purpose ?? 'any']),
  [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']],
)

// --- icons are real PNGs at the declared sizes ---
const pngSize = (path) => {
  const buffer = readFileSync(join(DIST, path))
  assert.equal(buffer.subarray(1, 4).toString(), 'PNG', `${path} is not a PNG`)
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}
for (const [path, size] of [
  ['/icons/icon-180.png', 180],
  ['/icons/icon-192.png', 192],
  ['/icons/icon-512.png', 512],
  ['/icons/maskable-512.png', 512],
]) {
  assert.ok(files.includes(path), `${path} missing from build`)
  assert.deepEqual(pngSize(path.slice(1)), [size, size], `${path} has wrong dimensions`)
}

// --- service worker precaches the whole shell ---
const sw = read('sw.js')
assert.ok(!sw.includes('__PRECACHE__'), 'precache manifest not injected')
const precache = JSON.parse(sw.match(/const PRECACHE = (\[.*?\])\n/s)[1])
assert.ok(precache.includes('/index.html'), 'shell index.html not precached')
assert.ok(precache.includes('/manifest.webmanifest'), 'manifest not precached')
assert.ok(precache.includes('/oauth/callback/index.html'), 'callback page not precached')
assert.ok(!precache.includes('/sw.js'), 'service worker must not precache itself')
for (const file of files) {
  if (/\.(js|css)$/.test(file) && file !== '/sw.js') {
    assert.ok(precache.includes(file), `${file} emitted but not precached`)
  }
}
for (const file of precache) {
  assert.ok(files.includes(file), `precache lists missing file ${file}`)
}

// --- payload budget (§1.1) ---
const bytes = files.reduce((sum, file) => sum + statSync(join(DIST, file.slice(1))).size, 0)
assert.ok(bytes < 10 * 1024 * 1024, `payload ${(bytes / 1024 / 1024).toFixed(1)} MB exceeds 10 MB`)

console.log(`ok — ${files.length} files, ${(bytes / 1024).toFixed(1)} KB, ${precache.length} precached`)
