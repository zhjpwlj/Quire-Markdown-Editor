import { defineConfig } from 'vite'
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

// Self-hosted providers and publish targets are only reachable in a custom build.
// See README: CSP_EXTRA_ORIGINS="https://gitea.example.com https://blog.example.com" npm run build
const EXTRA_ORIGINS = (process.env.CSP_EXTRA_ORIGINS ?? '').split(/\s+/).filter(Boolean)

const CONNECT_SRC = [
  "'self'",
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
  ...EXTRA_ORIGINS,
].join(' ')

function cspPlugin(command) {
  // DECISION: CSP is a fixed build-time allowlist (§2.13). Dev adds the HMR socket only;
  // the built page never carries ws: — it is replaced at transform time, not patched at runtime.
  const devExtra = command === 'serve' ? ' ws://localhost:* http://localhost:*' : ''
  const policy = [
    "default-src 'self'",
    "script-src 'self' https://apis.google.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${CONNECT_SRC}${devExtra}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')

  return {
    name: 'quire-csp',
    transformIndexHtml: (html) => html.replace('__CSP__', policy),
  }
}

function precachePlugin() {
  return {
    name: 'quire-precache',
    apply: 'build',
    closeBundle() {
      const dist = 'dist'
      const files = []
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name)
          if (statSync(path).isDirectory()) walk(path)
          else files.push('/' + relative(dist, path).split('\\').join('/'))
        }
      }
      walk(dist)

      // The shell must boot offline, so every emitted asset is precached except the worker
      // itself and the update probe. Vault data is never precached (Part 3.3).
      const precache = files.filter((f) => f !== '/sw.js').sort()
      const swPath = join(dist, 'sw.js')
      writeFileSync(
        swPath,
        readFileSync(swPath, 'utf8').replace('const PRECACHE = __PRECACHE__', `const PRECACHE = ${JSON.stringify(precache)}`),
      )
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [cspPlugin(command), precachePlugin()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      // The OAuth callback is a real page, not a public/ file: it needs the same CSP
      // transform as the shell (§15.1).
      input: {
        main: resolve(ROOT, 'index.html'),
        callback: resolve(ROOT, 'oauth/callback/index.html'),
      },
    },
  },
}))
